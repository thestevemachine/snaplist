import {NextRequest,NextResponse} from 'next/server';
import {withAccount,sameOrigin} from '@/lib/accounts/server';
import {currentAccount,accountsEnabled} from '@/lib/accounts/context';
import {guardApiRequest} from '@/lib/api-guard';
import {enabled,catalog,saveCatalog,jobs,insert,getJob,command} from '@/lib/relister/store';
import {reader} from '@/lib/relister/ebay';
import {preview} from '@/lib/relister/jobs';
import {sampleListing} from '@/lib/relister/simulation';
export const maxDuration=300;
async function handle(req:NextRequest){
 const denied=guardApiRequest(req);if(denied)return denied;
 if(!enabled()||!accountsEnabled())return NextResponse.json({ok:false,error:'Re-Lister benötigt freigeschaltete Konten und die geprüfte Datenbankmigration.'},{status:503});
 const account=currentAccount()!;
 try{
 if(req.method==='GET')return NextResponse.json({ok:true,catalog:await catalog(account.id),jobs:await jobs(account.id),mode:'simulation',viewsNotice:'Aufrufe nicht verfügbar. Analytics-Berechtigung wurde nicht erweitert.'},{headers:{'Cache-Control':'private, no-store'}});
 if(!sameOrigin(req))return NextResponse.json({ok:false},{status:403});
 const body=await req.json();
 if(body.action==='sync'){const ebay=await reader();const items=await ebay.all();await saveCatalog(account.id,ebay.seller,items);return NextResponse.json({ok:true})}
 if(body.action==='demo'){await saveCatalog(account.id,'SIMULATION',Array.from({length:205},(_,i)=>sampleListing(String(100000000000+i))));return NextResponse.json({ok:true})}
 if(body.action==='preview'){
 const c=await catalog(account.id);if(!c)throw Error('Zuerst synchronisieren.');if(!Array.isArray(body.ids)||body.ids.length>200)throw Error('Ungültige Auswahl.');
 const selected=body.ids.map((id:string)=>c.listings.find(l=>l.id===id));if(selected.some((l:unknown)=>!l))throw Error('Auswahl nicht im Verkäuferbestand.');
 // Real listings remain read-only until management/promotions are positively proven.
 const job=preview(account.id,c.seller,selected,body.percent);await insert(job);return NextResponse.json({ok:true,job});
 }
 if(['confirm','pause','resume'].includes(body.action)){
 if(typeof body.id!=='string')throw Error('Auftrag fehlt.');const job=await getJob(account.id,body.id);
 if(body.action==='confirm'){if(job.mode!=='simulation'||body.digest!==job.previewDigest)throw Error('Vorschau stimmt nicht überein.');job.confirmed=true}
 else job.paused=body.action==='pause';await command(account.id,job.id,body.action);return NextResponse.json({ok:true,job});
 }
 return NextResponse.json({ok:false,error:'Unbekannte Aktion.'},{status:400});
 }catch{return NextResponse.json({ok:false,error:'Re-Lister-Anfrage fehlgeschlagen. Auswahl, Konto und Konfiguration prüfen.'},{status:400})}
}
export const GET=withAccount(handle);export const POST=withAccount(handle);
