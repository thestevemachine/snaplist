import {createHash} from 'node:crypto';
import {fetchImage} from './images';
import {digest} from './engine';
import {exclusions,type Listing,type Payload,type Backup} from './domain';
export interface BackupStorage {
 put(path:string,bytes:Buffer,mime:string):Promise<void>;
 get(path:string):Promise<Buffer>;
}
// Injectable storage enables the same byte-integrity checks in isolated tests
// and the protected production bucket, without ever exposing signed URLs.
export async function secureBackup(input:{account:string;rowId:string;seller:string;listing:Listing;payload:Payload;targetCents:number},store:BackupStorage,download=fetchImage):Promise<Backup>{
 if(!/^[a-zA-Z0-9-]{1,80}$/.test(input.account)||!/^[a-zA-Z0-9-]{1,80}$/.test(input.rowId))throw Error('Ungültiger Sicherungsnamensraum.');
 const reasons=exclusions(input.listing,input.seller,input.targetCents);if(reasons.length)throw Error(reasons.join('; '));
 const urls=input.payload.PictureDetails.PictureURL;if(!urls.length||urls.length>24)throw Error('Bilder fehlen oder Anzahl nicht unterstützt.');
 const images:Backup['images']=[];
 for(let index=0;index<urls.length;index++){
  const image=await download(urls[index]);const path=`${input.account}/${input.rowId}/image-${index}`;
  await store.put(path,image.data,image.mime);const saved=await store.get(path);
  const hash=createHash('sha256').update(saved).digest('hex');
  if(saved.length!==image.data.length||hash!==image.sha256)throw Error('Gesicherte Bilddatei stimmt nicht mit dem Original überein.');
  images.push({path,sha256:hash,bytes:saved.length,mime:image.mime});
 }
 const backup:Backup={version:1,listing:structuredClone(input.listing),payload:structuredClone(input.payload),images,createdAt:new Date().toISOString(),digest:''};backup.digest=digest(backup);
 const bytes=Buffer.from(JSON.stringify(backup));const path=`${input.account}/${input.rowId}/backup.json`;
 await store.put(path,bytes,'application/json');if(!(await store.get(path)).equals(bytes))throw Error('Datensicherung nicht verifiziert.');return backup;
}
export async function restoreImages(backup:Backup,store:BackupStorage){
 const images=[];for(const image of backup.images){const bytes=await store.get(image.path);if(bytes.length!==image.bytes||createHash('sha256').update(bytes).digest('hex')!==image.sha256)throw Error('Bildsicherung beschädigt oder unvollständig.');images.push({mediaType:image.mime,data:bytes.toString('base64')})}return images;
}
