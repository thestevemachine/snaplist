import {test,expect} from "@playwright/test";
const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=","base64");
test("a random quote is above upload and changes per batch without AI calls or phone overflow",async({page})=>{
 let paid=0;await page.route("**/api/**",r=>{if(/\/api\/(analyze|sort|ai\/)/.test(r.request().url()))paid++;return r.fulfill({json:{enabled:false,configured:false,connected:false,sortModels:[],analysisModels:[]}})});
 await page.setViewportSize({width:390,height:844});await page.goto("/");
 const quote=page.getByLabel("Spruch zum Hochladen",{exact:true});await expect(quote).not.toHaveText(/^\s*$/);
 const first=await quote.textContent();const file=page.locator("input[type=file]");
 await file.setInputFiles({name:"one.png",mimeType:"image/png",buffer:png});await expect(page.locator(".thumb")).toHaveCount(1);await expect(quote).not.toHaveText(first!);
 const second=await quote.textContent();await file.setInputFiles({name:"two.png",mimeType:"image/png",buffer:png});await expect(page.locator(".thumb")).toHaveCount(2);await expect(quote).not.toHaveText(second!);
 const position=await quote.evaluate(el=>({quoteBottom:el.getBoundingClientRect().bottom,uploadTop:el.parentElement!.querySelector(".dropzone")!.getBoundingClientRect().top}));expect(position.quoteBottom).toBeLessThanOrEqual(position.uploadTop);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);expect(paid).toBe(0);
});
test("pending personal eBay setup explains the operator action and hides unusable legacy connection steps",async({page})=>{
 await page.route("**/api/**",r=>r.fulfill({json:r.request().url().endsWith("/api/ebay/status") ? {configured:true,connected:false,personalConnectionReady:false} : {enabled:false,sortModels:[],analysisModels:[]}}));
 await page.goto("/");await expect(page.getByText("Dein SNAPLIST-Konto ist eingerichtet. Die persönliche eBay-Verbindung muss Stefan noch freischalten.")).toBeVisible();
 await expect(page.getByRole("button",{name:"Open eBay ↗",exact:true})).toHaveCount(0);await expect(page.locator("#ebay-paste")).toHaveCount(0);
});
test("personal eBay connection uses the automatic flow with no code-paste form",async({page})=>{
 await page.route("**/api/**",r=>r.fulfill({json:r.request().url().endsWith("/api/ebay/status") ? {configured:true,connected:false,personalConnectionReady:true,accountMode:true} : r.request().url().endsWith("/api/ebay/auth") ? {ok:true,url:"https://auth.ebay.com/oauth2/authorize?fixture=1"} : {enabled:false,sortModels:[],analysisModels:[]}}));
 await page.route("https://auth.ebay.com/**",r=>r.fulfill({contentType:"text/html",body:"eBay fixture"}));
 await page.goto("/");await page.getByRole("button",{name:"Eigenes eBay-Konto verbinden"}).click();await expect(page).toHaveURL(/auth.ebay.com/);await expect(page.locator("#ebay-paste")).toHaveCount(0);
});
