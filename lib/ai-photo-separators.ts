import type Anthropic from "@anthropic-ai/sdk";
import {z} from "zod";
import {measuredMessage} from "./ai-usage";
import {parseModelJson} from "./anthropic";
import {labeledContent,type WireImage} from "./images";

async function recognizeOnce(client:Anthropic,images:WireImage[],model:string):Promise<number[]> {
 const response=await measuredMessage("sort",client,{
  model,max_tokens:1200,
  output_config:{format:{type:"json_schema",schema:{type:"object",additionalProperties:false,properties:{separatorPhotoNumbers:{type:"array",items:{type:"integer",minimum:1,maximum:images.length}}},required:["separatorPhotoNumbers"]}}},
  messages:[{role:"user",content:[{type:"text",text:`Identify separator photos in this numbered sequence of ${images.length} photos. A separator is a photo of an EMPTY white/light neutral background with NO glasses and NO product. It may appear gray, shaded, unevenly lit, out of focus, or show an empty tabletop/background seam because of camera exposure. Do not require pure white pixels. A separator marks the END of the preceding glasses item; the next product photo begins a NEW physical item, even if visually identical. Any visible glasses, lens, temple, frame, detail, inscription, case or other product means NOT a separator, even on a mostly white background. Return ONLY separatorPhotoNumbers using the exact 1-based Photo numbers. Do not group, reorder or omit product images. If none exist return an empty array. Never assume the last image is a divider. If any product contour is visible, including thin transparent lenses or a small temple inscription, KEEP that photo. When uncertain return it as NOT a separator.`},...labeledContent(images)]}],
 },{timeout:75000,maxRetries:0});
 const block=response.content.find(b=>b.type==="text");
 if(!block || block.type!=="text") throw Error("Trennbilderkennung lieferte keine Antwort. Bitte erneut starten.");
 const parsed=z.object({separatorPhotoNumbers:z.array(z.number().int().min(1).max(images.length))}).strict().parse(parseModelJson(block.text));
 return [...new Set(parsed.separatorPhotoNumbers.map(n=>n-1))].sort((a,b)=>a-b);
}

// Confirm only candidates independently. Disagreement keeps the product photo.
export async function recognizePhotoSeparators(client:Anthropic,images:WireImage[],model:string):Promise<number[]> {
 const candidates=await recognizeOnce(client,images,model);
 if(!candidates.length) return [];
 const confirmed=await recognizeOnce(client,candidates.map(i=>images[i]),model);
 return confirmed.map(i=>candidates[i]);
}

export interface SkuMarker {photoIndex:number;sku:string}
// Isolated number cards start the FOLLOWING item. Never read product inscriptions as SKU cards.
export async function recognizePhotoMarkers(client:Anthropic,images:WireImage[],model:string):Promise<{separatorIndices:number[];skuMarkers:SkuMarker[]}> {
 const once=async(batch:WireImage[])=>{
  const response=await measuredMessage("sort",client,{
   model,max_tokens:1600,
   output_config:{format:{type:"json_schema",schema:{type:"object",additionalProperties:false,properties:{separatorPhotoNumbers:{type:"array",items:{type:"integer",minimum:1,maximum:batch.length}},skuCards:{type:"array",items:{type:"object",additionalProperties:false,properties:{photoNumber:{type:"integer",minimum:1,maximum:batch.length},sku:{type:"string"}},required:["photoNumber","sku"]}}},required:["separatorPhotoNumbers","skuCards"]}}},
   messages:[{role:"user",content:[{type:"text",text:`Inspect these ${batch.length} numbered photos for empty dividers and isolated SKU NUMBER CARDS. Empty white/gray background with NO glasses/product is a divider ending the preceding item. A separate card/page/screen showing ONLY an inventory number (e.g. 65-23591) and NO glasses/product is a SKU card starting the FOLLOWING glasses item. Read the complete SKU exactly, including leading zeros and hyphens; never append suffixes. A number on a lens, temple, price tag beside glasses, model marking or caliper is NOT a SKU card. Any visible glasses, lens edge, temple, case or product detail means KEEP the photo; never assume the last photo is a divider. Ambiguous card/text: keep as ordinary photo. Return exact 1-based Photo numbers: separatorPhotoNumbers for EMPTY backgrounds only; skuCards=[{photoNumber,sku}] for clearly readable isolated number cards. Do not put the same photo in both lists. No grouping and no invented numbers. When none exist return empty arrays.`},...labeledContent(batch)]}],
  },{timeout:75000,maxRetries:0});
  const text=response.content.find(b=>b.type==="text");if(!text || text.type!=="text")throw Error("Trenn-/SKU-Erkennung lieferte keine Antwort.");
  return z.object({separatorPhotoNumbers:z.array(z.number().int().min(1).max(batch.length)),skuCards:z.array(z.object({photoNumber:z.number().int().min(1).max(batch.length),sku:z.string().regex(/^\d{1,20}(?:[-/]\d{1,20}){0,3}$/).max(50)})).default([])}).strict().parse(parseModelJson(text.text));
 };
 const first=await once(images);
 const candidates=[...new Set([...first.separatorPhotoNumbers,...first.skuCards.map(s=>s.photoNumber)])].sort((a,b)=>a-b);
 if(!candidates.length)return {separatorIndices:[],skuMarkers:[]};
 const second=await once(candidates.map(n=>images[n-1]));
 const blanks=first.separatorPhotoNumbers.filter(n=>second.separatorPhotoNumbers.some(k=>candidates[k-1]===n) && !first.skuCards.some(s=>s.photoNumber===n)).map(n=>n-1);
 const skuMarkers=first.skuCards.filter(s=>second.skuCards.some(t=>candidates[t.photoNumber-1]===s.photoNumber && t.sku===s.sku)).map(s=>({photoIndex:s.photoNumber-1,sku:s.sku}));
 return {separatorIndices:[...new Set([...blanks,...skuMarkers.map(s=>s.photoIndex)])].sort((a,b)=>a-b),skuMarkers};
}
