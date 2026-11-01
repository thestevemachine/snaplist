importScripts('/cv/engine.js');
let ready;
function load(){if(!ready)ready=(async()=>{importScripts('/cv/opencv.js');const library=self.cv;if(library instanceof Promise)return {cv:await library};if(library?.Mat)return {cv:library};return await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('OpenCV startet nicht.')),30000);library.onRuntimeInitialized=()=>{clearTimeout(timeout);resolve({cv:library})}})})();return ready}
self.onmessage=async event=>{const {id,rgba,width,height}=event.data;try{const {cv}=await load();const result=self.SnaplistCv.run(cv,new Uint8ClampedArray(rgba),width,height);self.postMessage({id,result})}catch(error){self.postMessage({id,error:error instanceof Error?error.message:'Bildverarbeitung fehlgeschlagen.'})}};
