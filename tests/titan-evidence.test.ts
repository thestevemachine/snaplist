import { expect, it } from "vitest";
import { titanEvidencePatch, titanMetalPatch } from "@/lib/titan-evidence";
import { acceptedPhotoFact } from "@/lib/photo-facts";
import type {ListingResult} from "@/lib/types";
const l = ():ListingResult => ({title:"ic! berlin Titan Brille",brand:"ic! berlin",description:"Manueller Text",material:"Titan | Acetat",item_specifics:{Fassungsmaterial:"Titan | Acetat"}});
it("does not infer titanium from ic! berlin, and normalizes old generated guesses idempotently without changing description",()=>{
 const original=l(); const patch=titanEvidencePatch(original)!;
 expect(patch.material).toBe("Metall | Acetat");
 expect(patch.item_specifics?.Fassungsmaterial).toBe("Metall | Acetat");
 expect(patch.title).toBe("ic! berlin Metall Brille");
 expect(patch.description).toBeUndefined();
 expect(titanEvidencePatch({...original,...patch})).toBeUndefined();
 expect(original.material).toBe("Titan | Acetat");
});
it("preserves titanium proven by a readable material marking or explicit seller confirmation",()=>{
 for(const source of ["label","manual"] as const) {
  const listing={...l(),brand:"Test",eyewear:{fields:{material:{value:"Titan | Acetat",source,quote:"TITANIUM ACETATE",photos:[2]}},warnings:[]}};
  expect(titanEvidencePatch(listing)).toBeUndefined();
 }
});
it("preserves manual titles and the existing explicit Lindberg shop setting but not an ic berlin shop guess",()=>{
 expect(titanEvidencePatch({...l(),title_manually_edited:true})?.title).toBe(l().title);
 const listing={...l(),brand:"Lindberg",eyewear:{fields:{material:{value:"Titan",source:"shop" as const}},warnings:[]}};
 expect(titanEvidencePatch(listing)).toBeUndefined();
 expect(titanEvidencePatch({...listing,brand:"ic! berlin"})?.material).toBe("Metall | Acetat");
});
it("rejects estimated titanium even at high model confidence and accepts exact printed titanium",()=>{
 const fact={name:"Bügelmaterial",value:"Titan",basis:"estimate",quote:"",photoIndices:[1],confidence:100};
 expect(acceptedPhotoFact(fact,1)).toBe(false);
 expect(acceptedPhotoFact({...fact,basis:"label",quote:"TITANIUM"},1)).toBe(true);
});

it("requires explicit seller confirmation for ic berlin even if OCR claims a titanium label",()=>{
 const item={...l(),eyewear:{fields:{material:{value:"Titan",source:"label" as const,quote:"TITANIUM",photos:[1]}},warnings:[]}};
 expect(titanEvidencePatch(item)?.item_specifics?.Fassungsmaterial).toBe("Metall | Acetat");
 expect(titanEvidencePatch({...item,brand:"Other",item_specifics:{...item.item_specifics,Marke:"Ic! Berlin"}})?.item_specifics?.Fassungsmaterial).toBe("Metall | Acetat");
 expect(titanEvidencePatch({...item,eyewear:{...item.eyewear,fields:{material:{...item.eyewear.fields.material,source:"manual"}}}})).toBeUndefined();
});
it("selects metal alongside titanium only for a supported multi-value material field",()=>{
 const meta={name:"Rahmenmaterial",required:false,usage:"OPTIONAL" as const,mode:"SELECTION_ONLY" as const,cardinality:"MULTI" as const,values:["Titan","Metall","Acetat"]};
 const item={...l(),item_specifics:{Rahmenmaterial:"Titan | Acetat"}};
 const patch=titanMetalPatch(item,[meta])!;
 expect(patch.item_specifics?.Rahmenmaterial).toBe("Titan | Acetat | Metall");
 expect(titanMetalPatch({...item,...patch},[meta])).toBeUndefined();
 expect(titanMetalPatch(item,[{...meta,cardinality:"SINGLE"}])).toBeUndefined();
});
