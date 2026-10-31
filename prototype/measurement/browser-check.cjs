const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({headless:true,channel:"chrome"});try{
 const page=await browser.newPage({viewport:{width:1100,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:8765');
 await page.locator('#files').setInputFiles(process.argv[2]);await page.locator('#ref').fill('50');await page.locator('#bridge').fill('19');
 await page.locator('#run').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Steg passt'));
 assert.match(await page.locator('#metrics').textContent(),/Glashöhe –/);
 await page.locator('#point').selectOption('left_left');const old=+(await page.locator('#px').inputValue());
 await page.locator('#px').fill(String(old+.001));await page.locator('#px').blur();await page.locator('#correct').click();
 await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('manuell korrigiert'));
 await page.locator('#run').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Gespeicherte Messung'));
 assert.equal(+(await page.locator('#px').inputValue()),old+.001);assert.equal(errors.length,0);
 await page.screenshot({path:process.argv[3],fullPage:true});console.log('PASS: upload → CV → rejected uncertain measurement → manual point correction → persistent reload; no browser errors');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exit(1)});
