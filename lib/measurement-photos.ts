import {z} from "zod";
import type {ListingResult} from "./types";
const point=z.object({x:z.number().finite().min(0).max(1),y:z.number().finite().min(0).max(1)});
export const measurementPhotoSchema=z.object({
 dimension:z.enum(["lensWidth","bridgeWidth","templeLength","lensHeight","totalWidth"]),
 method:z.enum(["caliper","grid"]),photoIndex:z.number().int().min(1).max(24),
 reading:z.string().max(200),scaleMm:z.number().finite().min(0).max(100),
 scaleStart:point,scaleEnd:point,start:point,end:point,
 readable:z.boolean(),aligned:z.boolean(),samePlane:z.boolean(),
 confidence:z.number().finite().min(0).max(100),note:z.string().max(500),
 imageSize:z.object({width:z.number().positive(),height:z.number().positive()}),
});
export type MeasurementPhoto=z.infer<typeof measurementPhotoSchema>;
export type MeasurementDimension=MeasurementPhoto["dimension"];
export const MEASUREMENT_PHOTO_PROMPT=`\nEYEWEAR MEASUREMENT PHOTOS: Existing caliper or millimetre-paper photos ARE valid evidence. Return measurement_photos (empty array if none) in the SAME analysis call. Each entry measures one clearly identified dimension: lensWidth is the maximum horizontal opening of ONE glass excluding rim and bridge; lensHeight is its maximum vertical opening; totalWidth spans the COMPLETE glasses including hinges/visible temples; bridgeWidth is between nasal lens-box edges. Never confuse stand, frame height, outer lens rim or half bridge with the glass. Caliper: use method=caliper, transcribe the fully readable numeric reading WITH mm unit in reading; aligned=true ONLY if both jaws demonstrably contact the correct extrema of that dimension. Unreadable scale/dial/units, partial jaws or unknown dimension: omit. Use zero points and scaleMm=0 for caliper. Grid: method=grid, mark start/end of the target dimension and scaleStart/scaleEnd of a long CLEARLY IDENTIFIABLE known grid span in the SAME image, coordinates normalized to the full image. Set scaleMm to that span's actual mm length, reading to the visible grid legend or explain the counted grid cells in note. Never assume that an arbitrary squared background has 1 mm squares. Both spans must have the same horizontal/vertical direction and be on the same plane, with negligible perspective; raised/tilted glasses or ambiguous cell spacing: samePlane=false or omit. Prefer a long multi-cell reference over one tiny square. Server calculates the ratio; NEVER put guessed mm from appearance into specifics. readable/aligned/samePlane flags and confidence must reflect real evidence. For caliper samePlane=true only for an unambiguous jaw measurement. No extra photos, paid calls, or automatic retries.`;
export function measuredValue(raw:unknown):number|undefined {
 const parsed=measurementPhotoSchema.safeParse(raw);if(!parsed.success)return;
 const m=parsed.data;
 if(!m.readable || !m.aligned || !m.samePlane || m.confidence<80)return;
 let value:number;
 if(m.method==="caliper"){
  const match=m.reading.trim().match(/^(\d{1,3}(?:[.,]\d{1,2})?)\s*mm$/i);if(!match)return;
  value=Number(match[1].replace(",","."));
 }else{
  if(![1,5,10,20,25,50,100].includes(m.scaleMm) || !m.note.trim())return;
  const {width:w,height:h}=m.imageSize;
  const dx=(m.end.x-m.start.x)*w,dy=(m.end.y-m.start.y)*h;
  const sx=(m.scaleEnd.x-m.scaleStart.x)*w,sy=(m.scaleEnd.y-m.scaleStart.y)*h;
  const vertical=m.dimension==="lensHeight";
  const length=Math.abs(vertical?dy:dx),scale=Math.abs(vertical?sy:sx);
  if(scale<20 || length<20 || Math.abs(vertical?dx:dy)>length*.08 || Math.abs(vertical?sx:sy)>scale*.08)return;
  value=length/scale*m.scaleMm;
 }
 const [min,max]=m.dimension==="totalWidth"?[80,220]:m.dimension==="lensWidth"?[20,90]:m.dimension==="lensHeight"?[10,90]:m.dimension==="bridgeWidth"?[5,40]:[80,200];
 if(value<min || value>max)return;
 return Math.round(value);
}
export function photoMeasurement(listing:ListingResult,dimension:MeasurementDimension){
 const candidates=(listing.measurementPhotos ?? []).filter(m=>m.dimension===dimension && measuredValue(m)!==undefined);
 if(!candidates.length)return;
 const printed=dimension==="lensWidth" ? listing.eyewear?.fields.lensWidth : undefined;
 if(printed?.value && ["label","manual"].includes(printed.source) && candidates.some(m=>Math.abs(Number(printed.value.replace(/\s*mm$/i,""))-measuredValue(m)!)>2))return;
 const values=candidates.map(m=>measuredValue(m)!);if(Math.max(...values)-Math.min(...values)>2)return;
 const evidence=candidates.find(m=>m.method==="caliper") ?? candidates[0];
 return {mm:measuredValue(evidence)!,evidence};
}
export function readMeasurementPhotos(raw:unknown,sizes:({width:number;height:number}|undefined)[]):MeasurementPhoto[]{
 if(!Array.isArray(raw))return [];
 return raw.slice(0,12).flatMap(m=>{
  if(!m || typeof m!=="object")return [];
  const parsed=measurementPhotoSchema.safeParse({...m,imageSize:sizes[m.photoIndex-1]});
  return parsed.success && measuredValue(parsed.data)!==undefined ? [parsed.data] : [];
 });
}
