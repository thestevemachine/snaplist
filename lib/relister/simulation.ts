import {createHash} from 'node:crypto';
import type {Adapter} from './engine';
import {digest,TemporaryError} from './engine';
import type {Listing,Payload,Backup,Row} from './domain';
export const samplePayload=(id:string):Payload=>({Title:`Testbrille ${id}`,Description:'<p>Generalprobe – kein echtes Angebot</p>',SKU:`TEST-${id}`,Site:'Germany',Currency:'EUR',ListingType:'FixedPriceItem',ListingDuration:'GTC',Quantity:1,StartPrice:'49.99',PrimaryCategory:{CategoryID:'180957'},ConditionID:'1500',ItemSpecifics:{NameValueList:[{Name:'Marke',Value:['Testmarke']}]},PictureDetails:{PictureURL:['fixture://front']},Country:'DE',Location:'Berlin',PostalCode:'10115',DispatchTimeMax:'2',SellerProfiles:{SellerShippingProfile:{ShippingProfileID:'fixture-shipping'},SellerReturnProfile:{ReturnProfileID:'fixture-return'},SellerPaymentProfile:{PaymentProfileID:'fixture-payment'}}});
export const sampleListing=(id:string):Listing=>({id,seller:'SIMULATION',site:'Germany',title:`Testbrille ${id}`,sku:`TEST-${id}`,started:'2020-01-01T00:00:00Z',priceCents:4999,currency:'EUR',quantity:1,sold:0,type:'FixedPriceItem',active:true,variations:false,management:'trading',offers:'clear',promotion:'clear',views:null,firstSeen:new Date().toISOString(),predecessors:[]});
// Actual tiny PNG bytes, persisted into the protected image store for simulation.
export const fixtureImage=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=','base64');
export class Simulation implements Adapter {
 constructor(private rows:Row[],private persistImage:(path:string,bytes:Buffer)=>Promise<void>=async()=>{},private fault?:'end'|'create'){}
 async read(id:string){const row=this.rows.find(r=>r.listing.id===id)!;return {...row.listing,active:!['end_requested','ended','create_requested','created','completed'].includes(row.phase)}}
 async backup(row:Row,account:string):Promise<Backup>{const path=`${account}/${row.id}/0.png`;await this.persistImage(path,fixtureImage);const b={version:1 as const,listing:row.listing,payload:samplePayload(row.listing.id),images:[{path,sha256:createHash('sha256').update(fixtureImage).digest('hex'),bytes:fixtureImage.length,mime:'image/png'}],createdAt:new Date().toISOString(),digest:''};b.digest=digest(b);return b}
 async verify(){return {feeCents:0}}
 async end(){if(this.fault==='end'){this.fault=undefined;throw new TemporaryError('simulated timeout')}}
 async ended(){return true}
 async reconcile(uuid:string){const row=this.rows.find(r=>r.uuid===uuid)!;return row.newId??null}
 async create(_payload:Payload,uuid:string){const id=`SIM-${uuid}`;this.rows.find(r=>r.uuid===uuid)!.newId=id;if(this.fault==='create'){this.fault=undefined;throw new TemporaryError('simulated response lost after create')}return id}
 async compare(id:string,_backup:Backup,target:number){return id.startsWith('SIM-')&&target>0}
}
