import {createHash} from 'node:crypto';
import {boundedFetch} from '../network';
export function checkedImageUrl(value:string){
 const u=new URL(value);if(u.protocol!=='https:'||u.hostname!=='i.ebayimg.com'||u.port||u.username||u.password||u.search||!u.pathname.startsWith('/images/'))throw Error('Bild-URL nicht zugelassen.');return u;
}
export async function fetchImage(url:string){
 const response=await boundedFetch(checkedImageUrl(url),{redirect:'error',cache:'no-store'});
 const mime=response.headers.get('content-type')?.split(';')[0];if(!response.ok||!['image/jpeg','image/png','image/webp'].includes(mime??'')||!response.body)throw Error('Bild nicht sicher abrufbar.');
 const reader=response.body.getReader();const chunks:Uint8Array[]=[];let bytes=0;
 try{for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>20*1024*1024)throw Error('Bild zu groß.');chunks.push(part.value)}}finally{await reader.cancel()}
 const data=Buffer.concat(chunks);if(data.length<12)throw Error('Bilddatei unvollständig.');
 const valid=mime==='image/jpeg'?data[0]===255&&data[1]===216:mime==='image/png'?data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):data.subarray(0,4).toString()==='RIFF'&&data.subarray(8,12).toString()==='WEBP';
 if(!valid)throw Error('Bildformat widersprüchlich.');return {data,mime:mime!,sha256:createHash('sha256').update(data).digest('hex')};
}
