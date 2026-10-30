import {expect,it} from "vitest";
import {parseBoxDimensions} from "@/lib/eyewear-inscriptions";
import {boxSizePatch,manualEyewearMeasurement} from "@/lib/eyewear-measurements";
it("reads common box symbols, OCR brackets and complete plain size triplets without accepting model-like pairs",()=>{
 for(const text of ["ABC 52☐18 140","52 [] 18 140","52 18 140","52□18-140"])
  expect(parseBoxDimensions(text)).toEqual({lensWidth:"52",bridgeWidth:"18",templeLength:"140"});
 expect(parseBoxDimensions("85-99")).toBeUndefined();
 expect(parseBoxDimensions("52□18 140 / 54□18 140")).toBeUndefined();
});
it("recovers missing measurements from stored quoted temple evidence without model calls and preserves manual values",()=>{
 const l={title:"Brille",description:"Original",eyewear:{fields:{modelNumber:{value:"AB123",source:"label" as const,quote:"AB123 52☐18 140",photos:[2]}},warnings:[]}};
 const patch=boxSizePatch(l,[])!;
 expect(patch.eyewear?.fields.lensWidth?.value).toBe("52");expect(patch.size).toBe("52 □ 18 140");
 expect(boxSizePatch({...l,...patch},[])).toBeUndefined();
 const manual={...l,eyewear:{fields:{...l.eyewear.fields,lensWidth:{value:"51",source:"manual" as const}},warnings:[]}};
 expect(boxSizePatch(manual,[])?.eyewear?.fields.lensWidth?.value).toBe("51");
 expect(manualEyewearMeasurement(l,"Gesamtbreite","138",[]).manual_measurement_values?.Gesamtbreite).toBe("138");
 expect(manualEyewearMeasurement(l,"Gesamtbreite","138",[]).item_specifics?.Gesamtbreite).toBeUndefined();
 expect(manualEyewearMeasurement(l,"Glashöhe","",[]).manual_measurement_fields).toContain("Glashöhe");
 expect(manualEyewearMeasurement(l,"Gesamtbreite","138",[{name:"Rahmenbreite",mode:"FREE_TEXT",cardinality:"SINGLE",values:[],required:false,dataType:"NUMBER"}]).item_specifics?.Rahmenbreite).toBe("138");
});
