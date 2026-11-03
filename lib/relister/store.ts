import {accountDb} from '../accounts/server';
import type {Job,Listing} from './domain';
import type {Repository} from './engine';
export const bucket='snaplist-relister';
export const enabled=()=>process.env.RELISTER_ENABLED==='true';
function check(error:unknown){if(error)throw Error('Re-Lister-Speicher nicht verfügbar. Migration/Konfiguration prüfen.');}
export async function catalog(account:string){const {data,error}=await accountDb().from('relister_catalog').select('*').eq('account_id',account).maybeSingle();check(error);return data as {seller:string;listings:Listing[];synced_at:string}|null}
export async function saveCatalog(account:string,seller:string,listings:Listing[]){const old=await catalog(account);const previous=new Map(old?.listings.map(l=>[l.id,l]));for(const l of listings){const p=previous.get(l.id);if(p){l.firstSeen=p.firstSeen;l.predecessors=p.predecessors;l.lastRenewed=p.lastRenewed}}const {error}=await accountDb().from('relister_catalog').upsert({account_id:account,seller,listings,synced_at:new Date().toISOString()});check(error)}
export async function jobs(account:string){const {data,error}=await accountDb().from('relister_jobs').select('document').eq('account_id',account).order('created_at',{ascending:false}).limit(20);check(error);return (data??[]).map(r=>r.document as Job)}
export async function getJob(account:string,id:string){const {data,error}=await accountDb().from('relister_jobs').select('document').eq('account_id',account).eq('id',id).single();check(error);if(!data)throw Error('Auftrag nicht gefunden.');return data.document as Job}
export async function insert(job:Job){const {error}=await accountDb().from('relister_jobs').insert({id:job.id,account_id:job.account,seller:job.seller,document:job});check(error)}
export function repository(account:string):Repository{return {
 async save(job){if(job.account!==account)throw Error('Kontokonflikt.');const {error}=await accountDb().rpc('relister_save',{p_job:job.id,p_account:account,p_document:job});check(error)},
 async pause(job){await command(account,job.id,'pause')},
 async paused(job){return (await getJob(account,job.id)).paused},
 async lock(seller,item,job){const db=accountDb();const {error}=await db.from('relister_item_locks').insert({seller,item_id:item,job_id:job});if(!error)return true;const {data}=await db.from('relister_item_locks').select('job_id').eq('seller',seller).eq('item_id',item).single();return data?.job_id===job}
}}

export async function command(account:string,id:string,action:'confirm'|'pause'|'resume'){const {error}=await accountDb().rpc('relister_command',{p_job:id,p_account:account,p_action:action});check(error)}
