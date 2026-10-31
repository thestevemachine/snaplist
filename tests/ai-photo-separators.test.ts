import {expect,it,vi} from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import {recognizePhotoSeparators} from "@/lib/ai-photo-separators";
const images=Array.from({length:4},()=>({mediaType:"image/jpeg",data:"YQ=="}));
const client=(value:unknown)=>({messages:{create:vi.fn(async()=>({content:[{type:"text",text:JSON.stringify(value)}],usage:{input_tokens:10,output_tokens:5}}))}} as unknown as Anthropic);
it("converts exact numbered dividers to ordered unique indexes",async()=>{
 const c=client({separatorPhotoNumbers:[]});vi.mocked(c.messages.create).mockResolvedValueOnce({content:[{type:"text",text:JSON.stringify({separatorPhotoNumbers:[4,2,2]})}]} as any).mockResolvedValueOnce({content:[{type:"text",text:JSON.stringify({separatorPhotoNumbers:[1,2]})}]} as any);
 expect(await recognizePhotoSeparators(c,images,"gemini-3.5-flash-lite")).toEqual([1,3]);
});
it("keeps no-divider classification empty and rejects invalid numbering rather than silently grouping",async()=>{
 expect(await recognizePhotoSeparators(client({separatorPhotoNumbers:[]}),images,"gemini-3.5-flash-lite")).toEqual([]);
 await expect(recognizePhotoSeparators(client({separatorPhotoNumbers:[0]}),images,"gemini-3.5-flash-lite")).rejects.toThrow();
 await expect(recognizePhotoSeparators(client({separatorPhotoNumbers:[5]}),images,"gemini-3.5-flash-lite")).rejects.toThrow();
});

it("keeps a suspected final product image when the independent candidate check disagrees",async()=>{
 const c=client({separatorPhotoNumbers:[]});vi.mocked(c.messages.create).mockResolvedValueOnce({content:[{type:"text",text:JSON.stringify({separatorPhotoNumbers:[4]})}]} as any);
 expect(await recognizePhotoSeparators(c,images,"gemini-3.5-flash-lite")).toEqual([]);
 expect(c.messages.create).toHaveBeenCalledTimes(2);
});
it("confirms isolated SKU cards twice and never substitutes a product inscription or different number",async()=>{
 const {recognizePhotoMarkers}=await import("@/lib/ai-photo-separators");
 const c=client({separatorPhotoNumbers:[],skuCards:[]});vi.mocked(c.messages.create).mockResolvedValueOnce({content:[{type:"text",text:JSON.stringify({separatorPhotoNumbers:[3],skuCards:[{photoNumber:1,sku:"65-23591"}]})}]} as any).mockResolvedValueOnce({content:[{type:"text",text:JSON.stringify({separatorPhotoNumbers:[2],skuCards:[{photoNumber:1,sku:"65-23591"}]})}]} as any);
 expect(await recognizePhotoMarkers(c,images,"gemini-3.5-flash-lite")).toEqual({separatorIndices:[0,2],skuMarkers:[{photoIndex:0,sku:"65-23591"}]});
 const d=client({separatorPhotoNumbers:[],skuCards:[]});vi.mocked(d.messages.create).mockResolvedValueOnce({content:[{type:"text",text:JSON.stringify({separatorPhotoNumbers:[],skuCards:[{photoNumber:4,sku:"65-23591"}]})}]} as any);
 expect(await recognizePhotoMarkers(d,images,"gemini-3.5-flash-lite")).toEqual({separatorIndices:[],skuMarkers:[]});
});
