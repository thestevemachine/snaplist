import {createHash} from 'node:crypto';
import {exclusions,type Job,type Row,type Listing,type Backup,type Payload} from './domain';
export const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export interface Adapter {
 read(id:string):Promise<Listing>;
 backup(row:Row,account:string):Promise<Backup>;
 verify(backup:Backup,target:number):Promise<{feeCents:number}>;
 end(id:string):Promise<void>;
 ended(id:string):Promise<boolean>;
 reconcile(uuid:string):Promise<string|null|'unknown'>;
 create(payload:Payload,uuid:string):Promise<string>;
 compare(id:string,backup:Backup,target:number):Promise<boolean>;
}
export interface Repository {
 save(job:Job):Promise<void>;
 paused?(job:Job):Promise<boolean>;
 pause?(job:Job):Promise<void>;
 // Must be a persistent, atomic seller/item lock; never an in-memory live lock.
 lock(seller:string,item:string,job:string):Promise<boolean>;
}
export class TemporaryError extends Error{};
export class AuthorizationError extends Error{};
function transition(row:Row,phase:Row['phase'],note:string){row.phase=phase;row.history.push({at:new Date().toISOString(),phase,note})}
export async function advance(job:Job,row:Row,adapter:Adapter,repo:Repository){
 if(!job.confirmed||['completed','review','skipped'].includes(row.phase)||row.nextAttemptAt&&row.nextAttemptAt>Date.now())return;
 if(job.mode==='live')throw Error('Live-Pilot nicht freigegeben: produktive Änderungen sind in dieser Version gesperrt.');
 if(!await repo.lock(job.seller,row.listing.id,job.id)){transition(row,'skipped','Bereits durch anderen Auftrag gesperrt');await repo.save(job);return;}
 if(job.paused&&!['end_requested','ended','create_requested','created'].includes(row.phase))return;
 try{
 if(row.phase==='selected'){
  const fresh=await adapter.read(row.listing.id);const reasons=exclusions(fresh,job.seller,row.targetCents);
  if(reasons.length||fresh.priceCents!==row.originalCents)throw Error(reasons.join('; ')||'Preis seit Vorschau geändert: neue Vorschau erforderlich.');
  row.backup=await adapter.backup(row,job.account);
  if(!row.backup.images.length||row.backup.images.some(i=>!i.path||!i.sha256||i.bytes<=0))throw Error('Bildsicherung unvollständig.');
  transition(row,'backed_up','Daten und Bilddateien gesichert');await repo.save(job);
 }
 if(row.phase==='backed_up'){
  const v=await adapter.verify(row.backup!,row.targetCents);
  if(v.feeCents!==0)throw Error('Gebühren benötigen gesonderte Freigabe.');
  transition(row,'verified','Nicht veröffentlichende Vorprüfung erfolgreich');await repo.save(job);
 }
 if(row.phase==='verified'){transition(row,'ready','Bereit');await repo.save(job)}
 if(row.phase==='ready'){
  if(job.paused||await repo.paused?.(job))return;
  const fresh=await adapter.read(row.listing.id);
  if(exclusions(fresh,job.seller,row.targetCents).length||fresh.priceCents!==row.originalCents)throw Error('Status, Bestand oder Preis geändert: neue Vorschau erforderlich.');
  transition(row,'end_requested','Simulierte Beendigung angefordert');await repo.save(job);
  await adapter.end(row.listing.id);
 }
 if(row.phase==='end_requested'){
  if(!await adapter.ended(row.listing.id))throw new TemporaryError('Ende noch nicht bestätigt.');
  const after=await adapter.read(row.listing.id);
  if(after.sold!==0||after.quantity!==1)throw Error('Verkauf/Bestandsänderung im Übergang: manuelle Prüfung.');
  transition(row,'ended','Ende bestätigt');await repo.save(job);
 }
 if(row.phase==='ended'){transition(row,'create_requested','Simulierte Erstellung angefordert');await repo.save(job)}
 if(row.phase==='create_requested'){
  const found=await adapter.reconcile(row.uuid);
  if(found==='unknown')throw Error('Erstellung unklar: keine automatische Wiederholung.');
  row.newId=found??await adapter.create({...row.backup!.payload,StartPrice:(row.targetCents/100).toFixed(2)},row.uuid);
  transition(row,'created','Neue Artikelnummer bestätigt');await repo.save(job);
 }
 if(row.phase==='created'){
  if(!await adapter.compare(row.newId!,row.backup!,row.targetCents))throw Error('Nachprüfung abweichend: manuelle Prüfung.');
  transition(row,'completed','Simulierte Nachprüfung erfolgreich; alte/neue Artikelnummer gespeichert');await repo.save(job);
 }
 row.error=undefined;row.nextAttemptAt=undefined;
 }catch(error){
 row.attempts++;
 if(error instanceof AuthorizationError){job.paused=true;await repo.pause?.(job);row.error='Autorisierung abgelaufen; Auftrag pausiert.'}
 else if(error instanceof TemporaryError&&row.attempts<=5){row.nextAttemptAt=Date.now()+Math.min(300000,1000*2**row.attempts);row.error='Vorübergehender Fehler; Wiederaufnahme geplant.'}
 else {transition(row,'review','Manuelle Prüfung erforderlich');row.error=error instanceof Error?error.message:'Verarbeitung fehlgeschlagen.'}
 await repo.save(job);
 }
}
