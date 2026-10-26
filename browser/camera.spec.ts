import {test,expect,Page} from "@playwright/test";
async function setup(page:Page, denied=false) {
 let writes=0;
 await page.route("**/api/**",route=>{
  if(route.request().method()==="POST") writes++;
  const url=route.request().url();
  return route.fulfill({json:url.includes("/api/models") ? {sortModels:[],analysisModels:[]} : {ok:true,connected:false}});
 });
 await page.addInitScript(({denied})=>{
  let stream:MediaStream;
  Object.defineProperty(navigator.mediaDevices,"getUserMedia",{configurable:true,value:async(constraints:MediaStreamConstraints)=>{
   (window as any).cameraConstraints=constraints;
   if(denied) throw new DOMException("Denied","NotAllowedError");
   const canvas=document.createElement("canvas");canvas.width=1600;canvas.height=1200;
   const ctx=canvas.getContext("2d")!;ctx.fillStyle="#ddd";ctx.fillRect(0,0,1600,1200);ctx.fillStyle="#111";ctx.fillText("Brillen-Testfoto",200,300);
   stream=canvas.captureStream(10);
   const timer=setInterval(()=>{ctx.fillRect(1,1,5,5)},50);
   const track=stream.getVideoTracks()[0], original=track.stop.bind(track);
   track.stop=()=>{clearInterval(timer);original()};
   (window as any).cameraStream=stream;
   return stream;
  }});
 },{denied});
 await page.setViewportSize({width:390,height:844});
 await page.goto("/");
 await expect(page.getByRole("status").filter({hasText:"Auf diesem Gerät gespeichert"})).toBeVisible();
 return ()=>writes;
}
test("phone camera captures a sequence without a file dialog, persists photos, and stops on finish",async({page})=>{
 const writes=await setup(page);
 let dialogs=0;page.on("dialog",async d=>{dialogs++;await d.dismiss()});
 await page.getByRole("button",{name:"Kamera öffnen · mehrere Fotos aufnehmen"}).click();
 const shutter=page.getByRole("button",{name:"Foto aufnehmen",exact:true});
 for(let i=1;i<=3;i++) {
  await expect(shutter).toBeEnabled();await shutter.click();
  await expect(page.locator(".thumb")).toHaveCount(i);
 }
 expect(await page.evaluate(()=>(window as any).cameraConstraints)).toMatchObject({audio:false,video:{facingMode:{ideal:"environment"}}});
 await page.getByRole("button",{name:"Fertig · Kamera schließen"}).click();
 expect(await page.evaluate(()=>(window as any).cameraStream.getTracks().every((t:MediaStreamTrack)=>t.readyState==="ended"))).toBe(true);
 await expect(page.getByLabel("Live-Kamerabild")).toHaveCount(0);
 await expect(page.getByRole("status").filter({hasText:"Auf diesem Gerät gespeichert"})).toBeVisible();
 const sizes=await page.evaluate(async()=>{
  const r=indexedDB.open("listing-writer-drafts");const db=await new Promise<IDBDatabase>(resolve=>r.onsuccess=()=>resolve(r.result));
  const tx=db.transaction("assets","readonly");const get=tx.objectStore("assets").getAll();
  const photos=await new Promise<any[]>(resolve=>get.onsuccess=()=>resolve(get.result));db.close();
  return Promise.all(photos.map(async p=>{const img=await createImageBitmap(p.original);const dims=[img.width,img.height];img.close();return dims}));
 });
 expect(sizes).toHaveLength(3);expect(sizes.every(s=>s[0]>=1200 && s[1]>=900)).toBe(true);
 await page.reload();await expect(page.locator(".thumb")).toHaveCount(3);
 expect(dialogs).toBe(0);expect(writes()).toBe(0);
});
test("camera permission denial keeps ordinary photo selection available",async({page})=>{
 const writes=await setup(page,true);
 await page.getByRole("button",{name:"Kamera öffnen · mehrere Fotos aufnehmen"}).click();
 await expect(page.locator(".camera-capture [role=alert]")).toContainText("Kamerazugriff nicht erlaubt");
 await expect(page.getByRole("button",{name:"Kamera öffnen · mehrere Fotos aufnehmen"})).toBeEnabled();
 await page.locator("input[type=file]").setInputFiles({name:"photo.png",mimeType:"image/png",buffer:Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=","base64")});
 await expect(page.locator(".thumb")).toHaveCount(1);expect(writes()).toBe(0);
});
test("leaving the upload step releases the camera without dropping the saved image",async({page})=>{
 await setup(page);
 await page.getByRole("button",{name:"Kamera öffnen · mehrere Fotos aufnehmen"}).click();
 const shutter=page.getByRole("button",{name:"Foto aufnehmen",exact:true});await expect(shutter).toBeEnabled();await shutter.click();
 await expect(page.locator(".thumb")).toHaveCount(1);
 await page.getByRole("button",{name:"Diese Fotos gehören zu einem Artikel"}).click();
 expect(await page.evaluate(()=>(window as any).cameraStream.getTracks().every((t:MediaStreamTrack)=>t.readyState==="ended"))).toBe(true);
});
