import {expect,it} from "vitest";
import {germanGlassesTitle} from "@/lib/glasses-rules";
import {eyewearSellerRulePatch} from "@/lib/eyewear-seller-rules";
import {boxSizePatch} from "@/lib/eyewear-measurements";
import type {AspectMeta} from "@/lib/ebay/taxonomy";
const meta:AspectMeta[]=[{name:"Rahmenfarbe",mode:"SELECTION_ONLY",cardinality:"MULTI",values:["Gold","Schwarz","Roségold"],required:false}];
const l={title:"Ic! Berlin Brille",description:"Original",brand:"Ic! Berlin",color:["Roségold","Schwarz"],condition_notes:"Ungetragen ohne Etui",item_specifics:{Rahmenfarbe:"Roségold | Schwarz",Form:"Rund",Abteilung:"Herren Damen",Modell:"Pluto",Rahmenbreite:"140 mm",Besonderheiten:"Strass"}};
it("prioritizes base Gold and places Strass and L XL immediately after the shape within 80 characters",()=>{
 const title=germanGlassesTitle(l,meta);
 expect(title).toContain("Rund Panto Strass groß L XL Gold Schwarz");expect(title.length).toBeLessThanOrEqual(80);expect(title).toContain("Pluto");
 expect(germanGlassesTitle({...l,item_specifics:{...l.item_specifics,Rahmenbreite:"139"}},meta)).not.toContain("L XL");
 expect(eyewearSellerRulePatch(l,meta)?.item_specifics?.Rahmenfarbe).toBe("Gold | Schwarz");
 expect(eyewearSellerRulePatch({...l,title_manually_edited:true},meta)?.title).toBeUndefined();
 expect(eyewearSellerRulePatch({...l,title:"Mein eigener Brillentitel"},meta)?.title).toBeUndefined();
 expect(eyewearSellerRulePatch({...l,title:"Ic! Berlin Brille Herren Damen Rund Panto Roségold Schwarz Pluto"},meta)?.title).toContain("Rund Panto Strass groß L XL Gold Schwarz");
});
it("adds Roségold only when there is space, preserves condition details, and does not invent strass",()=>{
 const short={...l,brand:"X",color:["Roségold"],item_specifics:{Rahmenfarbe:"Roségold",Form:"Rund"},condition_notes:"Ungetragen ohne Etui ohne Demoscheiben"};
 const title=germanGlassesTitle(short,meta);expect(title).toContain("Gold");expect(title).toContain("Roségold");expect(title).not.toContain("Strass");
 expect(eyewearSellerRulePatch(short,meta)?.condition_notes).toBe("Ungetragen ohne Etui, ohne Demoscheiben");
});
it("fills already recognized 44 square 20 150 into empty taxonomy fields even when size is present",()=>{
 const fields={lensWidth:{value:"44",source:"label" as const,quote:"44 □ 20 150",photos:[2]},bridgeWidth:{value:"20",source:"label" as const,quote:"44 □ 20 150",photos:[2]},templeLength:{value:"150",source:"label" as const,quote:"44 □ 20 150",photos:[2]}};
 const listing={title:"Brille",description:"",size:"44 □ 20 150",eyewear:{fields,warnings:[]},item_specifics:{Glasbreite:"",Stegbreite:"",Bügellänge:""}};
 const dims:AspectMeta[]=["Glasbreite","Stegbreite","Bügellänge"].map(name=>({name,mode:"FREE_TEXT",cardinality:"SINGLE",dataType:"NUMBER",values:[],required:false}));
 const patch=boxSizePatch(listing,dims)!;expect(patch.item_specifics).toMatchObject({Glasbreite:"44",Stegbreite:"20",Bügellänge:"150"});
 expect(boxSizePatch({...listing,...patch},dims)).toBeUndefined();
});

it("includes different front and temple colors in the title and actual color field",()=>{
 const listing={title:"X Brille Rund",brand:"X",description:"",item_specifics:{Form:"Rund",Frontfarbe:"Schwarz",Bügelfarbe:"Gold",Rahmenfarbe:"Schwarz"}};
 expect(germanGlassesTitle(listing,meta)).toContain("Schwarz Gold");
 const patch=eyewearSellerRulePatch(listing,meta)!;
 expect(patch.item_specifics?.Rahmenfarbe).toBe("Schwarz | Gold");
 expect(patch.title).toContain("Schwarz Gold");
});

it("restores stored box size into empty visible measurements without inventing photo evidence",()=>{
 const l={title:"Brille",description:"",size:"48-23-145"};
 const p=boxSizePatch(l,[])!;
 expect(p.eyewear?.fields.lensWidth?.value).toBe("48");expect(p.eyewear?.fields.bridgeWidth?.value).toBe("23");expect(p.eyewear?.fields.templeLength?.value).toBe("145");
 expect(p.eyewear?.fields.lensWidth?.photos).toEqual([]);
 expect(boxSizePatch({...l,...p},[])).toBeUndefined();
});
it("puts dominant Lila before small gold accents and translates Lilac",()=>{
 const l={title:"Ic! Berlin Brille Damen Gold Metall Alexandra N. Gold Lilac",description:"",brand:"Ic! Berlin",item_specifics:{Rahmenfarbe:"Gold | Lila",Hauptfarbe:"Lila",Form:"Rechteckig | Geometrisch",Farbcode:"Gold Lilac",Modell:"Alexandra N."}};
 const m=[{...meta[0],values:["Gold","Lila"]}];
 const title=germanGlassesTitle(l,m);expect(title).toContain("Lila Gold");expect(title).not.toMatch(/lilac|geometr/i);
});
