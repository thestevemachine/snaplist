import {test,expect} from '@playwright/test';
test('local worker loads OpenCV and returns geometry without AI requests',async({page})=>{
 let paid=0;page.on('request',r=>{if(/\/api\/(analyze|ai\/measure)/.test(r.url()))paid++});
 await page.goto('/login');
 const result=await page.evaluate(async()=>{
 const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=600;
 const c=canvas.getContext('2d')!;c.fillStyle='white';c.fillRect(0,0,1200,600);c.strokeStyle='black';c.lineWidth=12;
 for(const x of [350,800]){c.beginPath();c.ellipse(x,300,180,120,0,0,Math.PI*2);c.stroke()}
 c.beginPath();c.moveTo(530,300);c.lineTo(620,300);c.stroke();
 const rgba=c.getImageData(0,0,1200,600).data;
 const worker=new Worker('/cv/worker.js');
 try{return await new Promise<any>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('worker timeout')),45000);worker.onerror=e=>{clearTimeout(timer);reject(Error(e.message))};worker.onmessage=e=>{clearTimeout(timer);resolve(e.data)};worker.postMessage({id:'synthetic',rgba:rgba.buffer,width:1200,height:600},[rgba.buffer])})}finally{worker.terminate()}
 });
 expect(result.error).toBeUndefined();expect(result.result.size).toEqual([1200,600]);expect(result.result.points?.left_top).toBeTruthy();expect(paid).toBe(0);
});
