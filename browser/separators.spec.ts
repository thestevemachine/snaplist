import {test,expect} from "@playwright/test";
test("white dividers split consecutive glasses without an AI call and stay out of every group",async({page})=>{
 let sortCalls=0,paid=0;
 await page.route("**/api/**",r=>{
  const url=r.request().url();if(url.endsWith("/api/sort")) sortCalls++;
  if(/analyze|publish/.test(url)) paid++;
  return r.fulfill({json:url.endsWith("/api/models") ? {sortModels:[],analysisModels:[]} : {enabled:false,connected:false,ok:false}});
 });
 await page.goto("/");await expect(page.getByRole("status").filter({hasText:"Auf diesem Gerät gespeichert"})).toBeVisible();
 const images=await page.evaluate(()=>[true,false,true].map(hasGlasses=>{
  const c=document.createElement("canvas");c.width=600;c.height=400;const ctx=c.getContext("2d")!;ctx.fillStyle="white";ctx.fillRect(0,0,600,400);
  if(hasGlasses){ctx.strokeStyle="#111";ctx.lineWidth=12;ctx.strokeRect(100,100,150,120);ctx.strokeRect(300,100,150,120);}
  return c.toDataURL("image/png").split(",")[1];
 }));
 await page.locator("input[type=file]").setInputFiles(images.map((data,i)=>({name:`0${i+1}.png`,mimeType:"image/png",buffer:Buffer.from(data,"base64")})));
 await expect(page.locator(".thumb")).toHaveCount(3);await expect(page.locator(".separator-photo")).toHaveCount(1);
 await expect(page.getByRole("status").filter({hasText:"Auf diesem Gerät gespeichert"})).toBeVisible();
 await page.reload();await expect(page.locator(".separator-photo")).toHaveCount(1);
 await page.getByRole("button",{name:"Trennbilder anwenden",exact:true}).click();
 await expect(page.getByRole("button",{name:/Entwürfe erstellen/})).toBeVisible();
 await expect(page.getByRole("status").filter({hasText:"Auf diesem Gerät gespeichert"})).toBeVisible();
 const result=await page.evaluate(async()=>{
  const r=indexedDB.open("listing-writer-drafts");const db=await new Promise<IDBDatabase>(resolve=>r.onsuccess=()=>resolve(r.result));
  const tx=db.transaction("workspace","readonly"),get=tx.objectStore("workspace").get("current");const d=await new Promise<any>(resolve=>get.onsuccess=()=>resolve(get.result));db.close();return {groups:d.groups.map((g:any)=>g.photoIds),divider:d.photos.find((p:any)=>p.separator).id};
 });
 expect(result.groups).toHaveLength(2);expect(result.groups.map((g:string[])=>g.length)).toEqual([1,1]);expect(result.groups.flat()).not.toContain(result.divider);
 expect(sortCalls).toBe(0);expect(paid).toBe(0);
});
