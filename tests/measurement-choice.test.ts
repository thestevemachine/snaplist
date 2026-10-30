import {it,expect} from "vitest";
import {measurementChoice} from "@/lib/measurement-choice";
import {frontMeasurementFields} from "@/lib/front-measurement-fields";
import {manualEyewearMeasurement,boxSizePatch} from "@/lib/eyewear-measurements";
import type {AspectMeta} from "@/lib/ebay/taxonomy";
it("maps measured 144 mm and 28 mm into exact eBay ranges without nearest-size guesses",()=>{
 expect(measurementChoice(["130-139 mm","140-149 mm"],144)).toBe("140-149 mm");
 expect(measurementChoice(["25 bis 29 mm","30 bis 34 mm"],28)).toBe("25 bis 29 mm");
 expect(measurementChoice(["140 mm","145 mm"],144)).toBeUndefined();
 expect(measurementChoice(["140-150 mm","145-155 mm"],148)).toBeUndefined();
});
it("uses actual category names for manual and calculated height/frame width and creates no alias",()=>{
 const meta:AspectMeta[]=[{name:"Rahmenbreite",mode:"SELECTION_ONLY",required:false,cardinality:"SINGLE",values:["140-149 mm"]},{name:"Glashöhe",mode:"FREE_TEXT",dataType:"NUMBER",required:false,cardinality:"SINGLE",values:[]}];
 const l={title:"Brille",description:"",eyewear:{fields:{lensWidth:{value:"51",source:"manual" as const}},warnings:[]},frontMeasurement:{method:"front-photo-ratio-v1" as const,status:"estimated" as const,photoIndex:1,reasons:[],lensHeightMm:28,totalWidthMm:144}};
 expect(frontMeasurementFields(l,meta)?.item_specifics).toEqual({Rahmenbreite:"140-149 mm",Glashöhe:"28"});
 const p=manualEyewearMeasurement(l,"Gesamtbreite","144",meta);expect(p.item_specifics).toEqual({Rahmenbreite:"140-149 mm"});
 expect(manualEyewearMeasurement(l,"Glashöhe","28",[]).item_specifics).toEqual({});
 const local={...l,...manualEyewearMeasurement(l,"Glashöhe","28",[])};
 expect(boxSizePatch(local,meta)?.item_specifics?.Glashöhe).toBe("28");
});
