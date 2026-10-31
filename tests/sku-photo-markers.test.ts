import {expect,it} from "vitest";
import {assignPhotoSkus} from "@/lib/sku-photo-markers";
import {publicationSpecifics} from "@/lib/publication-specifics";
it("assigns exact card SKUs only to the following first group, preserving zeros and existing values",()=>{
 const photos=[{id:"sku1",skuMarker:"065-0023591"},{id:"a"},{id:"b"},{id:"sku2",skuMarker:"65-23592"},{id:"c"}];
 expect(assignPhotoSkus([{photoIds:["a"],sku:""},{photoIds:["b"],sku:""},{photoIds:["c"],sku:""}],photos).map(g=>g.sku)).toEqual(["065-0023591","","65-23592"]);
 expect(assignPhotoSkus([{photoIds:["a"],sku:"MINE"},{photoIds:["b"],sku:""}],photos).map(g=>g.sku)).toEqual(["MINE",""]);
 expect(assignPhotoSkus([{photoIds:["b"],sku:""},{photoIds:["a"],sku:""}],photos).map(g=>g.sku)).toEqual(["","065-0023591"]);
});
it("keeps actual outgoing measurement aspects consecutive and excludes blank values",()=>{
 expect(publicationSpecifics({title:"Brille",description:"",item_specifics:{Glashöhe:"28 mm",Marke:"Test",Stegbreite:"18 mm",Rahmenbreite:"144 mm",Farbe:"Gold",Glasbreite:"54 mm",Bügellänge:"145 mm",EAN:""}}).map(([name])=>name)).toEqual(["Glasbreite","Stegbreite","Bügellänge","Glashöhe","Rahmenbreite","Marke","Farbe"]);
});
