import {it} from 'vitest';
import {readFileSync} from 'node:fs';
import {AI_LISTING_SCHEMA} from '../lib/ai-schema';
import {FRONT_MEASUREMENT_PROMPT,calculateFrontMeasurement} from '../lib/front-measurements';
import {imageSize} from '../lib/image-size';
it.skipIf(process.env.RUN_APPROVED_NOEGO_TEST!=='once')('single approved noego measurement; no database writes',async()=>{
 const key=process.env.GEMINI_API_KEY?.trim();
 if(!key)throw new Error('Server Gemini key unavailable; no request made');
 const data=readFileSync('diagnostics/noego.jpg').toString('base64');
 const p=AI_LISTING_SCHEMA.properties;
 const response=await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent',{method:'POST',headers:{'x-goog-api-key':key,'Content-Type':'application/json'},signal:AbortSignal.timeout(80000),body:JSON.stringify({systemInstruction:{parts:[{text:FRONT_MEASUREMENT_PROMPT+'\nReturn one JSON object only.'}]},contents:[{role:'user',parts:[{inlineData:{mimeType:'image/jpeg',data}},{text:'This is the seller-selected front or measurement photo, photoIndex=1. If a readable caliper or identifiable millimetre grid is present return measurement_photos; otherwise return an empty array. Return contour geometry only. Locate both inner lens openings and all outer extremities. If angled or partly obscured, return the best visible contours with uncertainty flags; do not substitute zero coordinates. No title, description or other listing fields.'}]}],generationConfig:{maxOutputTokens:5200,responseMimeType:'application/json',responseJsonSchema:{type:'object',additionalProperties:false,properties:{front_geometry:p.front_geometry,front_geometry_alternatives:p.front_geometry_alternatives,measurement_photos:p.measurement_photos},required:['front_geometry','front_geometry_alternatives','measurement_photos']}}})});
 if(!response.ok)throw new Error('Gemini HTTP '+response.status+'; no retry');
 const result=await response.json();
 const text=result.candidates?.[0]?.content?.parts?.filter((p:any)=>p.text).map((p:any)=>p.text).join('');
 const raw=JSON.parse(text);
 const candidates=[raw.front_geometry,...(Array.isArray(raw.front_geometry_alternatives)?raw.front_geometry_alternatives.slice(0,2):[])];
 const measurement=calculateFrontMeasurement(candidates,[imageSize(data)],{title:'noego Brille',description:'',eyewear:{fields:{lensWidth:{value:'50',source:'manual'},bridgeWidth:{value:'19',source:'manual'}},warnings:[]}});
 console.log('APPROVED_TEST_RESULT '+JSON.stringify({geometry:candidates,measurement,usage:result.usageMetadata}));
},90000);
