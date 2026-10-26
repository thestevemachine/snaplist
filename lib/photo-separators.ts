import type {Photo} from "./types";

// Conservative blank-white detection: even a small dark contour rejects it.
// Ambiguous photos remain ordinary photos and can be marked explicitly.
export function isBlankWhitePixels(data: ArrayLike<number>): boolean {
 if(data.length < 4 || data.length % 4) return false;
 let bright=0,neutral=0;
 const count=data.length/4;
 for(let i=0;i<data.length;i+=4) {
  const r=data[i],g=data[i+1],b=data[i+2];
  if(data[i+3]<250 || Math.min(r,g,b)<200) return false;
  if(Math.min(r,g,b)>=225) bright++;
  if(Math.max(r,g,b)-Math.min(r,g,b)<=18) neutral++;
 }
 return bright/count>=.98 && neutral/count>=.995;
}
export async function detectWhiteSeparator(previewUrl:string):Promise<boolean> {
 try {
  const image=new Image(); image.src=previewUrl;await image.decode();
  if(image.naturalWidth<32 || image.naturalHeight<32) return false;
  const canvas=document.createElement("canvas");canvas.width=96;canvas.height=96;
  const context=canvas.getContext("2d",{willReadFrequently:true});if(!context) return false;
  context.drawImage(image,0,0,96,96);
  return isBlankWhitePixels(context.getImageData(0,0,96,96).data);
 } catch {return false;}
}
export function splitAtSeparators(photos:Pick<Photo,"id"|"separator">[]):string[][] {
 const groups:string[][]=[];let current:string[]=[];
 for(const photo of photos) {
  if(photo.separator) {if(current.length) groups.push(current);current=[];}
  else current.push(photo.id);
 }
 if(current.length) groups.push(current);
 return groups;
}
