import {it,expect} from "vitest";
import {removeLegacyWidthCorrection} from "@/lib/legacy-width-correction";
import type {ListingResult} from "@/lib/types";
const listing=():ListingResult=>({title:"Brille",description:"Mein Text",eyewear:{fields:{lensWidth:{value:"54",source:"manual"}},warnings:[]},frontMeasurement:{method:"front-photo-ratio-v1",status:"estimated",photoIndex:1,reasons:[],totalWidthMm:138,totalWidthCorrectionMm:3},item_specifics:{Rahmenbreite:"138 mm"},estimates:{Rahmenbreite:95}});
const meta=[{name:"Rahmenbreite",mode:"FREE_TEXT" as const,cardinality:"SINGLE" as const,required:false,values:[]}];
it("removes the stored offset once and projects the full width without another model call",()=>{
 const l=listing(),p=removeLegacyWidthCorrection(l,meta)!;
 expect(p.frontMeasurement?.totalWidthMm).toBe(141);expect(p.frontMeasurement?.totalWidthCorrectionMm).toBeUndefined();
 expect(p.item_specifics?.Rahmenbreite).toBe("141 mm");expect(p.description).toBe("Mein Text");
 expect(removeLegacyWidthCorrection({...l,...p},meta)).toBeUndefined();
});
it("preserves a manually corrected width and custom description",()=>{
 const l=listing();l.manual_measurement_fields=["Rahmenbreite"];l.item_specifics={Rahmenbreite:"144 mm"};l.description="Von mir gemessen: 144 mm";
 const p=removeLegacyWidthCorrection(l,meta)!;expect(p.item_specifics?.Rahmenbreite).toBe("144 mm");expect(p.description).toBeUndefined();
});
it("does not fabricate a width when scale or old width is missing",()=>{
 const l=listing();delete l.eyewear;delete l.frontMeasurement!.totalWidthMm;
 const p=removeLegacyWidthCorrection(l,meta)!;expect(p.frontMeasurement?.totalWidthMm).toBeUndefined();expect(p.item_specifics?.Rahmenbreite).toBe("138 mm");
});
