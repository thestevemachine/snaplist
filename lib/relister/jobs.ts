import {randomUUID} from 'node:crypto';
import {digest,advance} from './engine';
import {reducedPrice,exclusions,percentUnits,type Job,type Listing} from './domain';
import {accountDb} from '../accounts/server';
import {bucket,repository} from './store';
import {Simulation} from './simulation';
export function preview(account:string,seller:string,listings:Listing[],percent:unknown):Job {
 percentUnits(percent);if(!listings.length||listings.length>200||new Set(listings.map(l=>l.id)).size!==listings.length)throw Error('1 bis 200 verschiedene Angebote auswählen.');
 const rows=listings.map(listing=>{const target=reducedPrice(listing.priceCents,percent);const reasons=exclusions(listing,seller,target);if(reasons.length)throw Error(`${listing.id}: ${reasons.join('; ')}`);return {id:randomUUID(),listing,originalCents:listing.priceCents,percent:String(percent),targetCents:target,phase:'selected' as const,uuid:randomUUID().replaceAll('-','').toUpperCase(),attempts:0,history:[]}});
 return {id:randomUUID(),account,seller,rows,confirmed:false,paused:false,mode:'simulation',createdAt:new Date().toISOString(),previewDigest:digest(rows)};
}
export async function processJob(id:string){
 const db=accountDb(),owner=randomUUID();const claim=await db.rpc('relister_claim',{p_job:id,p_owner:owner});if(claim.error)throw Error('Hintergrundsperre nicht verfügbar.');if(!claim.data)return;
 try{
 const {data,error}=await db.from('relister_jobs').select('document').eq('id',id).single();if(error||!data)throw Error('Auftrag nicht verfügbar.');const job=data.document as Job;
 // Background workers never borrow the owner's eBay identity.
 if(job.mode!=='simulation')throw Error('Live-Pilot nicht freigegeben.');
 const repo=repository(job.account);const adapter=new Simulation(job.rows,async(path,bytes)=>{const r=await db.storage.from(bucket).upload(path,bytes,{contentType:'image/png',upsert:true});if(r.error)throw Error('Bildsicherung fehlgeschlagen.');const downloaded=await db.storage.from(bucket).download(path);if(downloaded.error||!downloaded.data||downloaded.data.size!==bytes.length)throw Error('Bildsicherung nicht bestätigt.');});
 // One article per invocation bounds runtime; the cron picks up remaining rows.
 const row=job.rows.find(r=>!['completed','review','skipped'].includes(r.phase)&&(!job.paused||['end_requested','ended','create_requested','created'].includes(r.phase))&&(!r.nextAttemptAt||r.nextAttemptAt<=Date.now()));
 if(row)await advance(job,row,adapter,repo);
 }finally{await db.from('relister_claims').delete().eq('job_id',id).eq('lease_owner',owner)}
}
