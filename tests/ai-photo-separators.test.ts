import {expect,it,vi} from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import {recognizePhotoSeparators} from "@/lib/ai-photo-separators";
const images=Array.from({length:4},()=>({mediaType:"image/jpeg",data:"YQ=="}));
const client=(value:unknown)=>({messages:{create:vi.fn(async()=>({content:[{type:"text",text:JSON.stringify(value)}],usage:{input_tokens:10,output_tokens:5}}))}} as unknown as Anthropic);
it("converts exact numbered dividers to ordered unique indexes",async()=>{
 expect(await recognizePhotoSeparators(client({separatorPhotoNumbers:[4,2,2]}),images,"gemini-3.5-flash-lite")).toEqual([1,3]);
});
it("keeps no-divider classification empty and rejects invalid numbering rather than silently grouping",async()=>{
 expect(await recognizePhotoSeparators(client({separatorPhotoNumbers:[]}),images,"gemini-3.5-flash-lite")).toEqual([]);
 await expect(recognizePhotoSeparators(client({separatorPhotoNumbers:[0]}),images,"gemini-3.5-flash-lite")).rejects.toThrow();
 await expect(recognizePhotoSeparators(client({separatorPhotoNumbers:[5]}),images,"gemini-3.5-flash-lite")).rejects.toThrow();
});
