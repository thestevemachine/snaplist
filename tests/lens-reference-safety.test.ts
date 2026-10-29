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
