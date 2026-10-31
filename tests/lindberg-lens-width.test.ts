import {it,expect} from "vitest";
import {lindbergLensWidthPatch} from "@/lib/lindberg-lens-width";
import type {ListingResult} from "@/lib/types";
const listing=():ListingResult=>({title:"Lindberg Brille",description:"Manueller Text",brand:"Lindberg",eyewear:{fields:{modelNumber:{value:"1257",source:"label",quote:"LINDBERG 1257 46",photos:[2]}},warnings:[]}});
it("recovers a missing lens width from stored label evidence and fills a supported width alias idempotently",()=>{
 const l=listing(), patch=lindbergLensWidthPatch(l,[{name:"Scheibenbreite",mode:"FREE_TEXT",required:false,cardinality:"SINGLE",values:[]} as any])!;
 expect(patch.eyewear?.fields.lensWidth?.value).toBe("46");
 expect(patch.item_specifics?.Scheibenbreite).toBe("46 mm");
 expect(patch.description).toBeUndefined();
 expect(lindbergLensWidthPatch({...l,...patch})).toBeUndefined();
 expect(lindbergLensWidthPatch({...l,eyewear:{...l.eyewear!,fields:{...l.eyewear!.fields,lensWidth:{value:"",source:"manual"}}}})).toBeUndefined();
 expect(lindbergLensWidthPatch({...l,manual_measurement_fields:["Scheibenbreite"]})).toBeUndefined();
});
it("uses the recovered 46 mm reference to recalculate stored contours without changing manual measurements",()=>{
 const l=listing();
 const lens=(a:number,b:number)=>({left:{x:a,y:.4},right:{x:b,y:.4},top:{x:(a+b)/2,y:.2},bottom:{x:(a+b)/2,y:.6}});
 l.frontMeasurement={method:"front-photo-ratio-v1",status:"estimated",photoIndex:1,referenceMm:50,lensWidthPx:250,lensHeightPx:200,totalWidthPx:900,totalWidthMm:177,lensHeightMm:40,reasons:[],observation:{photoIndex:1,leftLens:lens(.15,.4),rightLens:lens(.6,.85),outerLeft:{x:.05,y:.4},outerRight:{x:.95,y:.4},frontal:true,groovesVisible:true,complete:true,samePlane:true,confidence:95,note:""}};
 l.item_specifics={Gesamtbreite:"177 mm",Glashöhe:"40 mm"};l.estimates={Gesamtbreite:95,Glashöhe:95};
 const patch=lindbergLensWidthPatch(l)!;
 expect(patch.frontMeasurement).toMatchObject({referenceMm:46,lensHeightMm:37,totalWidthMm:166});
 expect(patch.item_specifics).toMatchObject({Gesamtbreite:"166 mm",Glashöhe:"37 mm"});
 expect(lindbergLensWidthPatch({...l,manual_measurement_fields:["Gesamtbreite"]})?.item_specifics?.Gesamtbreite).toBe("177 mm");
 expect(patch.description).toBeUndefined();
});
