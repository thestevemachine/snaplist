import {expect,it} from "vitest";
import {measuredValue,photoMeasurement,readMeasurementPhotos,type MeasurementPhoto} from "@/lib/measurement-photos";
import {frontMeasurementFields} from "@/lib/front-measurement-fields";
import {measurementSafetyPatch} from "@/lib/measurement-safety";
import {parseListing} from "@/lib/validation";
const reading=(extra:Partial<MeasurementPhoto>={}):MeasurementPhoto=>({dimension:"totalWidth",method:"caliper",photoIndex:2,reading:"144.2 mm",scaleMm:0,scaleStart:{x:0,y:0},scaleEnd:{x:0,y:0},start:{x:0,y:0},end:{x:0,y:0},readable:true,aligned:true,samePlane:true,confidence:95,note:"Messbacken an den äußeren Scharnieren",imageSize:{width:1600,height:1200},...extra});
it("reads a clear mm caliper value only when dimension, jaws and plane are unambiguous",()=>{
 expect(measuredValue(reading())).toBe(144);
 for(const extra of [{reading:"144.2"},{reading:"5.6 in"},{reading:"Modell 144"},{readable:false},{aligned:false},{samePlane:false},{confidence:79},{reading:"999 mm"}])expect(measuredValue(reading(extra))).toBeUndefined();
});
it("calculates grid ratios in real pixel axes, rejecting guessed cells, perspective and short scales",()=>{
 const m=reading({method:"grid",dimension:"lensHeight",reading:"",scaleMm:10,scaleStart:{x:.1,y:.1},scaleEnd:{x:.1,y:.2},start:{x:.5,y:.2},end:{x:.5,y:.48},note:"10 sichtbare 1-mm-Zellen"});
 expect(measuredValue(m)).toBe(28);
 for(const extra of [{samePlane:false},{scaleMm:7},{note:""},{scaleEnd:{x:.2,y:.2}},{scaleEnd:{x:.1,y:.101}}])expect(measuredValue({...m,...extra})).toBeUndefined();
});
it("maps independent measurement photos into actual category fields without an inscription, and preserves manual clears",()=>{
 const l={title:"Brille",description:"Original",measurementPhotos:[reading()],item_specifics:{}};
 const meta=[{name:"Rahmenbreite",mode:"FREE_TEXT" as const,cardinality:"SINGLE" as const,values:[],required:false,usage:"OPTIONAL" as const}];
 const p=frontMeasurementFields(l,meta)!;expect(p.item_specifics).toEqual({Rahmenbreite:"144 mm"});expect(p.evidence?.Rahmenbreite).toEqual([2]);
 expect(measurementSafetyPatch({...l,...p})).toBeUndefined();expect(parseListing({...l,...p}).measurementPhotos?.[0].reading).toBe("144.2 mm");
 expect(frontMeasurementFields({...l,manual_measurement_fields:["Gesamtbreite"]},meta)).toBeUndefined();
});
it("rejects conflicting readings and never uses an unrelated measurement to unlock unscaled old front estimates",()=>{
 const a=reading(),b=reading({reading:"160 mm"});expect(photoMeasurement({title:"Brille",description:"",measurementPhotos:[a,b]},"totalWidth")).toBeUndefined();
 const l={title:"Brille",description:"",measurementPhotos:[reading({dimension:"lensHeight",reading:"28 mm"})],frontMeasurement:{method:"front-photo-ratio-v1" as const,status:"estimated" as const,photoIndex:1,totalWidthMm:180,reasons:[]}};
 expect(frontMeasurementFields(l,[{name:"Rahmenbreite",mode:"FREE_TEXT",cardinality:"SINGLE",values:[],required:false,usage:"OPTIONAL"}])).toBeUndefined();
});
it("accepts evidence only with an existing image and rejects a conflicting printed lens width",()=>{
 expect(readMeasurementPhotos([reading()],[])).toEqual([]);expect(readMeasurementPhotos([reading()],[undefined,{width:1600,height:1200}])).toHaveLength(1);
 expect(photoMeasurement({title:"Brille",description:"",eyewear:{fields:{lensWidth:{value:"54",source:"label"}},warnings:[]},measurementPhotos:[reading({dimension:"lensWidth",reading:"50 mm"})]},"lensWidth")).toBeUndefined();
});
