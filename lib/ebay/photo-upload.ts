import {boundedFetch} from "../network";
const BASE="https://apim.ebay.com/commerce/media/v1_beta/image";
export type PhotoUploadResult={url:string|null;error?:string;retryable?:boolean};
function imageUrl(value:unknown):string|null {
 if(typeof value!=="string")return null;
 try{const u=new URL(value);return u.protocol==="https:" && !u.username && !u.password && (u.hostname==="ebayimg.com" || u.hostname.endsWith(".ebayimg.com")) ? u.href : null;}catch{return null;}
}
function failure(status:number,body:any):PhotoUploadResult {
 const codes=(Array.isArray(body?.errors)?body.errors:[]).map((e:any)=>String(e.errorId)).filter((v:string)=>/^\d{1,12}$/.test(v));
 const message=status===401 || status===403 ? "eBay-Freigabe für den Bild-Upload fehlt oder ist abgelaufen. Bitte Zugang prüfen." : status===429 ? "eBay begrenzt gerade die Bild-Uploads. Bitte später erneut versuchen." : status>=500 ? "Der eBay-Bildserver ist vorübergehend nicht erreichbar." : "eBay hat dieses Foto nicht angenommen. Format und Bildgröße prüfen.";
 return {url:null,error:message+` (HTTP ${status}${codes.length ? "; eBay "+codes.join(", ") : ""})`,retryable:status===429 || status>=500};
}
export async function uploadOnePhoto(token:string,image:{mediaType:string;data:string},name:string):Promise<PhotoUploadResult>{
 try {
  const data=image.data.includes(",") ? image.data.split(",")[1] : image.data;
  const bytes=Buffer.from(data,"base64");
  if(!bytes.length || bytes.length>12*1024*1024)return {url:null,error:"Das Foto ist leer oder größer als 12 MB."};
  const form=new FormData();
  form.append("image",new Blob([new Uint8Array(bytes)],{type:image.mediaType}),name.replace(/[^a-zA-Z0-9_.-]/g,"_"));
  const response=await boundedFetch(BASE+"/create_image_from_file",{method:"POST",headers:{Authorization:`Bearer ${token}`},body:form,redirect:"error",cache:"no-store"});
  const body=await response.json().catch(()=>null);
  if(!response.ok)return failure(response.status,body);
  let url=imageUrl(body?.imageUrl);
  // Some successful creates return only the image resource URI. Never forward
  // credentials to an arbitrary Location supplied in a response.
  if(!url){
   const location=response.headers.get("location");
   if(location){const resource=new URL(location,BASE+"/");
    if(["https://apim.ebay.com","https://api.ebay.com"].includes(resource.origin) && /^\/commerce\/media\/v1_beta\/image\/[a-zA-Z0-9_-]+$/.test(resource.pathname) && !resource.username && !resource.password && !resource.search){
     const read=await boundedFetch(resource,{headers:{Authorization:`Bearer ${token}`},redirect:"error",cache:"no-store"});
     const details=await read.json().catch(()=>null);if(!read.ok)return failure(read.status,details);url=imageUrl(details?.imageUrl);
    }
   }
  }
  return url ? {url} : {url:null,error:"eBay hat keine gültige Bildadresse zurückgegeben. Es wurde nichts veröffentlicht."};
 }catch{return {url:null,error:"Der eBay-Bildserver konnte nicht erreicht werden. Bitte den Upload erneut versuchen.",retryable:true};}
}
export async function uploadPhotosDetailed(token:string,images:{mediaType:string;data:string}[],sku:string,offset=0){
 const results:PhotoUploadResult[]=new Array(images.length);let cursor=0;
 await Promise.all(Array.from({length:Math.min(3,images.length)},async()=>{while(cursor<images.length){const i=cursor++;results[i]=await uploadOnePhoto(token,images[i],`${sku}-${offset+i+1}.jpg`);}}));
 return {results,urls:results.flatMap(r=>r.url ? [r.url] : []),failed:results.filter(r=>!r.url).length};
}
