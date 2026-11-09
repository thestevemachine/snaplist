import {test,expect} from '@playwright/test';
test('Re-Lister tab, global selection and decimal-discount preview',async({page})=>{
 const items=Array.from({length:205},(_,i)=>({id:String(100000000000+i),seller:'SIMULATION',site:'Germany',title:`Brille ${i}`,sku:`SKU-${i}`,started:new Date(2020,0,i+1).toISOString(),priceCents:4999,currency:'EUR',quantity:1,sold:0,type:'FixedPriceItem',active:true,variations:false,management:'trading',offers:'clear',promotion:'clear',views:null,firstSeen:'2026-11-03',predecessors:[]}));
 let posted:any;
 await page.route('**/api/relister',async route=>{if(route.request().method()==='GET')return route.fulfill({json:{ok:true,catalog:{seller:'SIMULATION',listings:items,synced_at:'2026-11-03T12:00:00Z'},jobs:[]}});posted=route.request().postDataJSON();return route.fulfill({json:{ok:true,job:{id:'fixture',mode:'simulation',previewDigest:'fixture',rows:posted.ids.map((id:string)=>({id,listing:items.find(i=>i.id===id),originalCents:4999,percent:posted.percent,targetCents:4824}))}}})});
 await page.goto('/relister');await expect(page.getByRole('heading',{name:'Re-Lister',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Erste 200 auswählen',exact:true}).click();await expect(page.getByText('200 Angebote ausgewählt.')).toBeVisible();
 await page.getByLabel('Eigener Prozentwert').fill('3,5');await page.getByRole('button',{name:'Vorbereitung und Vorschau starten'}).click();
 await expect(page.getByRole('heading',{name:'Unveränderliche Rabattvorschau – Simulation'})).toBeVisible();expect(posted.ids).toHaveLength(200);expect(posted.percent).toBe('3,5');
 await expect(page.getByRole('button',{name:'Geprüften Probelauf ausdrücklich bestätigen'})).toBeVisible();
});
