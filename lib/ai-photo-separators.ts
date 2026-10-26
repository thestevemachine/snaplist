import type Anthropic from "@anthropic-ai/sdk";
import {z} from "zod";
import {measuredMessage} from "./ai-usage";
import {parseModelJson} from "./anthropic";
import {labeledContent,type WireImage} from "./images";

export async function recognizePhotoSeparators(client:Anthropic,images:WireImage[],model:string):Promise<number[]> {
 const response=await measuredMessage("sort",client,{
  model,max_tokens:1200,
  output_config:{format:{type:"json_schema",schema:{type:"object",additionalProperties:false,properties:{separatorPhotoNumbers:{type:"array",items:{type:"integer",minimum:1,maximum:images.length}}},required:["separatorPhotoNumbers"]}}},
  messages:[{role:"user",content:[{type:"text",text:`Identify separator photos in this numbered sequence of ${images.length} photos. A separator is a photo of an EMPTY white/light neutral background with NO glasses and NO product. It may appear gray, shaded, unevenly lit, out of focus, or show an empty tabletop/background seam because of camera exposure. Do not require pure white pixels. A separator marks the END of the preceding glasses item; the next product photo begins a NEW physical item, even if visually identical. Any visible glasses, lens, temple, frame, detail, inscription, case or other product means NOT a separator, even on a mostly white background. Return ONLY separatorPhotoNumbers using the exact 1-based Photo numbers. Do not group, reorder or omit product images. If none exist return an empty array.`},...labeledContent(images)]}],
 },{timeout:75000,maxRetries:0});
 const block=response.content.find(b=>b.type==="text");
 if(!block || block.type!=="text") throw Error("Trennbilderkennung lieferte keine Antwort. Bitte erneut starten.");
 const parsed=z.object({separatorPhotoNumbers:z.array(z.number().int().min(1).max(images.length))}).strict().parse(parseModelJson(block.text));
 return [...new Set(parsed.separatorPhotoNumbers.map(n=>n-1))].sort((a,b)=>a-b);
}
