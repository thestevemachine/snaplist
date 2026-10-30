import {expect,test} from "@playwright/test";
const member="22222222-2222-4222-8222-222222222222",fixture="sk-fixture-member-browser-123456789";
test("member saves a personal API key in the model settings, refreshes recommendations and never stores the key in browser preferences",async({page})=>{
 let saved=false,paid=0,writes=0;
 await page.addInitScript(id=>{const apply=()=>{if(document.body){document.body.dataset.account=id;document.body.dataset.accountOwner="false";}};new MutationObserver(apply).observe(document,{childList:true,subtree:true});apply();},member);
 await page.route("**/api/**",r=>{
  const url=r.request().url();
  if(/\/api\/(analyze|sort|ai\/)/.test(url))paid++;
  if(url.endsWith("/api/account")){
   if(r.request().method()==="POST"){writes++;expect(r.request().headers()["x-snaplist-account"]).toBe(member);expect(r.request().postDataJSON()).toEqual({action:"key",provider:"openai",key:fixture});expect(url).not.toContain(fixture);saved=true;return r.fulfill({json:{ok:true}});}
   return r.fulfill({json:{enabled:true,id:member,email:"member@example.com",owner:false,providers:{openai:saved,google:false,anthropic:false}}});
  }
  if(url.endsWith("/api/models")){
   const models=[{id:"gemini-3.5-flash-lite",displayName:"Gemini 3.5 Flash-Lite",isDefault:true,configured:false},{id:"gpt-6-luna",displayName:"OpenAI GPT-6 Luna",provider:"openai",configured:saved},{id:"gpt-6.1-terra",displayName:"OpenAI GPT-6.1 Terra",provider:"openai",configured:saved}];
   return r.fulfill({json:{sortModels:models.map(m=>({...m,recommended:m.id==="gpt-6-luna"})),analysisModels:models.map(m=>({...m,recommended:m.id==="gpt-6.1-terra"}))}});
  }
  return r.fulfill({json:{enabled:false,connected:false,configured:false,ok:false}});
 });
 await page.setViewportSize({width:390,height:844});await page.goto("/");await page.getByRole("button",{name:/KI-Einstellungen/}).click();
 const settings=page.locator("#model-settings-body"),keys=settings.getByRole("region",{name:"Deine KI-Zugänge"});
 await expect(settings).not.toContainText("Keine Schlüssel hier eingeben");await expect(settings).not.toContainText("Einrichtung: Vercel");
 await expect(page.locator('#sort-model option[value="gpt-6-luna"]')).toContainText("Empfehlung");await expect(page.locator('#analysis-model option[value="gpt-6.1-terra"]')).toContainText("Empfehlung");
 await page.locator("#sort-model").selectOption("gpt-6-luna");await page.locator("#analysis-model").selectOption("gpt-6.1-terra");
 const input=keys.getByLabel("API-Schlüssel",{exact:true});await input.fill(fixture);await keys.getByRole("button",{name:"API-Schlüssel speichern",exact:true}).click();
 await expect(keys.getByRole("status")).toContainText("OpenAI-Schlüssel sicher gespeichert");await expect(input).toHaveValue("");await expect(page.locator('#sort-model option[value="gpt-6-luna"]')).not.toContainText("API-Schlüssel fehlt");
 await expect(page.locator("#sort-model")).toHaveValue("gpt-6-luna");await expect(page.locator("#analysis-model")).toHaveValue("gpt-6.1-terra");
 expect(await page.evaluate(()=>JSON.stringify(Object.entries(localStorage)))).not.toContain(fixture);expect(await page.evaluate(()=>JSON.stringify(Object.entries(sessionStorage)))).not.toContain(fixture);expect(paid).toBe(0);expect(writes).toBe(1);
 await page.reload();await page.getByRole("button",{name:/KI-Einstellungen/}).click();await expect(page.locator("#sort-model")).toHaveValue("gpt-6-luna");await expect(page.locator("#analysis-model")).toHaveValue("gpt-6.1-terra");await expect(page.locator("#model-settings-body").getByLabel("API-Schlüssel",{exact:true})).toHaveValue("");expect(paid).toBe(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
