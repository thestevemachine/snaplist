import {CV_VERSION, cvKey, cvMeasurement, type CvPoints} from './cv-measurement';
import type {ItemGroup,Photo} from './types';
import {loadPhoto} from './draft-store';
export async function measureLocal(group:ItemGroup,photoId:string,fallback?:Photo){
 const listing=group.listing!;const key=cvKey(group,listing);
 if(!key)throw Error('Belegte oder manuell bestätigte Glasbreite fehlt.');
 const photo=await loadPhoto(photoId)??fallback;
 if(!photo?.data)throw Error('Originalfoto ist nicht verfügbar.');
 const blob=await (await fetch(`data:${photo.mediaType};base64,${photo.data}`)).blob();
 const bitmap=await createImageBitmap(blob);const canvas=document.createElement('canvas');
 const scale=Math.min(1,1800/Math.max(bitmap.width,bitmap.height));
 canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);
 const context=canvas.getContext('2d',{willReadFrequently:true})!;context.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
 const rgba=context.getImageData(0,0,canvas.width,canvas.height).data;
 const worker=new Worker('/cv/worker.js');
 try{
 const result=await new Promise<{points?:CvPoints;size?:[number,number];reasons?:string[]}>((resolve,reject)=>{
 const timeout=setTimeout(()=>reject(Error('Lokale Messung hat zu lange gedauert.')),60000);
 worker.onerror=()=>{clearTimeout(timeout);reject(Error('Lokale Bildverarbeitung konnte nicht starten.'))};
 worker.onmessage=event=>{clearTimeout(timeout);event.data.error?reject(Error(event.data.error)):resolve(event.data.result)};
 worker.postMessage({id:key,rgba:rgba.buffer,width:canvas.width,height:canvas.height},[rgba.buffer]);
 });
 return cvMeasurement({version:CV_VERSION,key,photoId,photoIds:[...group.photoIds],size:result.size??[canvas.width,canvas.height],points:result.points??undefined,createdAt:Date.now()},listing,group.photoIds.indexOf(photoId)+1,result.reasons);
 }finally{worker.terminate()}
}
