import {test,expect} from "@playwright/test";
test("AI recognizes an exposed-gray empty divider, keeps numbered order and excludes it from both articles",async({page})=>{
 let sortCalls=0,scanCalls=0,paid=0;
 await page.route("**/api/**",r=>{
  const url=r.request().url();if(url.endsWith("/api/sort")) {
   const body=r.request().postDataJSON();
   if(body.action === "detect-separators") {scanCalls++;expect(body.images).toHaveLength(3);return r.fulfill({json:{ok:true,separatorIndices:[1],usage:[]}});}
   sortCalls++;
  }
  if(/analyze|publish/.test(url)) paid++;
  return r.fulfill({json:url.endsWith("/api/models") ? {sortModels:[],analysisModels:[]} : {enabled:false,connected:false,ok:false}});
 });
 await page.goto("/");await expect(page.getByRole("status").filter({hasText:"Auf diesem Gerät gespeichert"})).toBeVisible();
 const images=await page.evaluate(()=>[true,false,true].map(hasGlasses=>{
  const c=document.createElement("canvas");c.width=600;c.height=400;const ctx=c.getContext("2d")!;ctx.fillStyle=hasGlasses ? "white" : "#aaa";ctx.fillRect(0,0,600,400);
  if(hasGlasses){ctx.strokeStyle="#111";ctx.lineWidth=12;ctx.strokeRect(100,100,150,120);ctx.strokeRect(300,100,150,120);}
  return c.toDataURL("image/png").split(",")[1];
 }));
 await page.locator("input[type=file]").setInputFiles(images.map((data,i)=>({name:`0${i+1}.png`,mimeType:"image/png",buffer:Buffer.from(data,"base64")})));
 await expect(page.locator(".thumb")).toHaveCount(3);await expect(page.locator(".separator-photo")).toHaveCount(0);
 await expect(page.getByRole("status").filter({hasText:"Auf diesem Gerät gespeichert"})).toBeVisible();
 await page.reload();await expect(page.locator(".separator-photo")).toHaveCount(0);
 await page.getByRole("button",{name:/Fotos mit KI sortieren/}).click();
 await expect(page.getByRole("button",{name:/Entwürfe erstellen/})).toBeVisible();
 await expect(page.getByRole("status").filter({hasText:"Auf diesem Gerät gespeichert"})).toBeVisible();
 const result=await page.evaluate(async()=>{
  const r=indexedDB.open("listing-writer-drafts");const db=await new Promise<IDBDatabase>(resolve=>r.onsuccess=()=>resolve(r.result));
  const tx=db.transaction("workspace","readonly"),get=tx.objectStore("workspace").get("current");const d=await new Promise<any>(resolve=>get.onsuccess=()=>resolve(get.result));db.close();return {groups:d.groups.map((g:any)=>g.photoIds),divider:d.photos.find((p:any)=>p.separator).id};
 });
 expect(result.groups).toHaveLength(2);expect(result.groups.map((g:string[])=>g.length)).toEqual([1,1]);expect(result.groups.flat()).not.toContain(result.divider);
 expect(scanCalls).toBe(1);expect(sortCalls).toBe(0);expect(paid).toBe(0);
});

test("without a divider the existing AI sorting runs; a failed scan never silently merges articles",async({page})=>{
 let normalCalls=0,scanCalls=0,fail=false;
 await page.route("**/api/**",r=>{
  const url=r.request().url();
  if(url.endsWith("/api/sort")) {
   if(r.request().postDataJSON().action === "detect-separators") {scanCalls++;return r.fulfill({json:fail ? {ok:false,error:"Trennerprüfung fehlgeschlagen"} : {ok:true,separatorIndices:[],usage:[]}});}
   normalCalls++;return r.fulfill({json:{ok:true,groups:[{name:"Normale KI-Gruppe",photoIndices:[0,1]}],orphanIndices:[],usage:[]}});
  }
  return r.fulfill({json:url.endsWith("/api/models") ? {sortModels:[],analysisModels:[]} : {enabled:false,connected:false,ok:false}});
 });
 await page.goto("/");
 const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=","base64");
 await page.locator("input[type=file]").setInputFiles([1,2].map(i=>({name:`IMG_${i}.png`,mimeType:"image/png",buffer:png})));
 await expect(page.locator(".thumb")).toHaveCount(2);
 await page.getByRole("button",{name:/Fotos mit KI sortieren/}).click();
 await expect(page.getByLabel("Artikelname")).toHaveValue("Normale KI-Gruppe");expect(normalCalls).toBe(1);expect(scanCalls).toBe(1);
 await page.getByRole("button",{name:/Zurück zu den Fotos/}).click();
 fail=true;
 await page.getByRole("button",{name:/Fotos mit KI sortieren/}).click();
 await expect(page.getByText("Trennerprüfung fehlgeschlagen",{exact:true})).toBeVisible();expect(normalCalls).toBe(1);expect(scanCalls).toBe(2);
});

test("clicking the photo toggles its divider button and frame red, and toggles back",async({page})=>{
 await page.route("**/api/**",r=>r.fulfill({json:{ok:false,connected:false,enabled:false,sortModels:[],analysisModels:[]}}));
 await page.goto("/");
 const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=","base64");
 await page.locator("input[type=file]").setInputFiles({name:"photo.png",mimeType:"image/png",buffer:png});
 await expect(page.locator(".thumb")).toHaveCount(1);
 await page.getByRole("button",{name:"Foto 1 als Trennbild markieren",exact:true}).click();
 await expect(page.locator(".separator-photo")).toHaveCSS("border-top-color","rgb(220, 38, 38)");
 const active=page.getByRole("button",{name:"Trennbild als normales Foto verwenden"});
 await expect(active).toHaveCSS("background-color","rgb(185, 28, 28)");await expect(active).toHaveAttribute("aria-pressed","true");
 await page.getByRole("button",{name:"Foto 1 als normales Foto verwenden",exact:true}).click();await expect(page.locator(".separator-photo")).toHaveCount(0);
 await expect(page.getByRole("button",{name:"Als Trennbild markieren",exact:true})).toHaveAttribute("aria-pressed","false");
});
