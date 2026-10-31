import {it,expect} from "vitest";
import {lensReference} from "@/lib/lens-reference";
import {measurementSafetyPatch} from "@/lib/measurement-safety";
import {recalculateStoredMeasurement} from "@/lib/front-measurements";
import type {ListingResult} from "@/lib/types";
const listing=(quote:string,value="51"):ListingResult=>({title:"Brille",description:"",eyewear:{fields:{lensWidth:{value,source:"label",quote,photos:[2]}},warnings:[]}});
it("requires the matching printed reference, not merely a source label and photo ID",()=>{
 expect(lensReference(listing("51 □ 18 145"))?.mm).toBe(51);
 expect(lensReference(listing("49 □ 18 145"))).toBeUndefined();
 expect(lensReference(listing("Modell 51 CE"))).toBeUndefined();
 expect(lensReference(listing("Bügelstand 51"))).toBeUndefined();
 expect(lensReference(listing("Glasbreite: 51 mm"))?.mm).toBe(51);
 expect(lensReference(listing("51 mm"))?.mm).toBe(51);
});
it("accepts demo lens model/width pairs only for Lindberg and explicit manual scale",()=>{
 const l=listing("1257 46","46");expect(lensReference(l)).toBeUndefined();
 l.brand="Lindberg";expect(lensReference(l)?.mm).toBe(46);
 l.eyewear!.fields.lensWidth={value:"47",source:"manual"};expect(lensReference(l)?.mm).toBe(47);
});
it("removes stale unscaled automatic values but preserves explicit seller dimensions",()=>{
 const l=listing("Modell 51");l.item_specifics={Glashöhe:"48 mm",Rahmenbreite:"170 mm",Marke:"Test"};
 l.estimates={Glashöhe:90,Rahmenbreite:80};l.manual_measurement_fields=["Gesamtbreite"];
 const p=measurementSafetyPatch(l)!;expect(p.item_specifics).toEqual({Rahmenbreite:"170 mm",Marke:"Test"});
 expect(p.estimates).toEqual({Rahmenbreite:80});
 l.frontMeasurement={method:"front-photo-ratio-v1",status:"estimated",photoIndex:1,reasons:[],referenceMm:51,lensHeightMm:48,totalWidthMm:170};
 expect(recalculateStoredMeasurement(l)).toMatchObject({status:"unavailable"});
 expect(recalculateStoredMeasurement(l)?.totalWidthMm).toBeUndefined();
});
it("removes cached automatic specifics after a boxing consistency failure while retaining manual height",()=>{
 const l=listing("51 □ 18 145");l.item_specifics={Glashöhe:"28 mm",Rahmenbreite:"178 mm"};l.manual_measurement_fields=["Glashöhe"];
 l.frontMeasurement={method:"front-photo-ratio-v1",status:"uncertain",photoIndex:1,reasons:["Referenzprüfung: nasal nicht mittig"],totalWidthMm:178};
 expect(measurementSafetyPatch(l)?.item_specifics).toEqual({Glashöhe:"28 mm"});
});
it("recovers a short or unlinked width from matching full box evidence on another field, never from size text alone",()=>{
 const l=listing("50","50");l.eyewear!.fields.lensWidth!.photos=[];l.eyewear!.fields.bridgeWidth={value:"19",source:"label",quote:"NEOGO 50 □ 19",photos:[3]};
 expect(lensReference(l)).toMatchObject({mm:50,quote:"NEOGO 50 □ 19",photos:[3]});
 delete l.eyewear!.fields.bridgeWidth;l.size="50-19";expect(lensReference(l)).toBeUndefined();
});
it("recalculates saved contours once box provenance is recovered and maps to the existing eBay fields",async()=>{
 const {calculateFrontMeasurement}=await import("@/lib/front-measurements");const {frontMeasurementFields}=await import("@/lib/front-measurement-fields");
 const l=listing("50","50");l.eyewear!.fields.bridgeWidth={value:"19",source:"label",quote:"50 □ 19",photos:[2]};
 const lens=(left:number,right:number)=>({left:{x:left,y:.38},right:{x:right,y:.38},top:{x:(left+right)/2,y:.2},bottom:{x:(left+right)/2,y:.56}});
 l.frontMeasurement=calculateFrontMeasurement({photoIndex:1,leftLens:lens(.1,.4),rightLens:lens(.514,.814),outerLeft:{x:.05,y:.4},outerRight:{x:.864,y:.4},frontal:true,groovesVisible:true,complete:true,samePlane:true,confidence:90,note:""},[{width:1000,height:500}],l);
 expect(l.frontMeasurement.lensHeightMm).toBe(30);expect(l.frontMeasurement.totalWidthMm).toBe(136);
 const patch=frontMeasurementFields(l,[{name:"Glashöhe",mode:"FREE_TEXT",cardinality:"SINGLE",values:[],required:false,usage:"OPTIONAL"},{name:"Rahmenbreite",mode:"FREE_TEXT",cardinality:"SINGLE",values:[],required:false,usage:"OPTIONAL"}]);
 expect(patch?.item_specifics).toEqual({Glashöhe:"30 mm",Rahmenbreite:"136 mm"});
});
it("automatically uses an explicitly transcribed numeric lens-width label without asking for manual confirmation",()=>{
 expect(lensReference(listing("50","50"))).toMatchObject({mm:50,source:"label"});
 expect(lensReference(listing("Modell 50 CE","50"))).toBeUndefined();
 expect(lensReference(listing("51","50"))).toBeUndefined();
});
