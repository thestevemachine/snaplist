import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {advance,digest,type Repository} from '../lib/relister/engine';
import {preview} from '../lib/relister/jobs';
import {Simulation,sampleListing} from '../lib/relister/simulation';
import type {Job} from '../lib/relister/domain';
// Run with `vitest run tests/relister/rehearsal.test.ts` (no secrets or eBay calls).
export async function rehearsal(directory:string){
 await mkdir(directory,{recursive:true});let job=preview('fixture-account','SIMULATION',[sampleListing('100000000001'),sampleListing('100000000002')],'6');job.confirmed=true;
 const file=`${directory}/job.json`;const locks=new Map<string,string>();const repo:Repository={save:async j=>writeFile(file,JSON.stringify(j,null,2)),lock:async(s,i,j)=>{const key=s+':'+i;if(locks.has(key)&&locks.get(key)!==j)return false;locks.set(key,j);return true}};
 const adapter=new Simulation(job.rows,async(path,bytes)=>{await writeFile(`${directory}/${path.split('/').at(-2)}.png`,bytes)},'create');
 await advance(job,job.rows[0],adapter,repo);
 // Restart: discard all job/adapter state and read persisted state from disk.
 job=JSON.parse(await readFile(file,'utf8'));job.rows[0].nextAttemptAt=0;
 const resumed=new Simulation(job.rows,async(path,bytes)=>{await writeFile(`${directory}/${path.split('/').at(-2)}.png`,bytes)});
 for(const row of job.rows)await advance(job,row,resumed,repo);
 const report={mode:'SIMULATED – NO EBAY CALLS',stages:'selection → discount → real fixture image backup → simulated verification → simulated end → simulated create → simulated postcheck',partialFailure:'create response lost; durable job reloaded; existing new ID reconciled',passed:job.rows.every(r=>r.phase==='completed'&&r.targetCents===4699),rows:job.rows.map(r=>({oldId:r.listing.id,newId:r.newId,original:r.originalCents,percent:r.percent,target:r.targetCents,history:r.history})),digest:digest(job)};
 await writeFile(`${directory}/report.json`,JSON.stringify(report,null,2));return report;
}
