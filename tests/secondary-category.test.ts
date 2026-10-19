import { expect, it } from "vitest";
import { mergeCategoryAspects, sunglassesPair } from "@/lib/ebay/secondary-category";
import type { AspectMeta } from "@/lib/ebay/taxonomy";
const men = [{ id: "11", name: "Sonnenbrillen", path: "Herren > Accessoires > Sonnenbrillen" }];
const women = [{ id: "22", name: "Sonnenbrillen", path: "Damen > Accessoires > Sonnenbrillen" }];
const listing = { title: "ic! berlin Sunglasses", description: "" };
it("resolves two distinct current German leaf categories and preserves the chosen primary", () => {
  expect(sunglassesPair(men, women, listing).map(c => c.id)).toEqual(["11", "22"]);
  expect(sunglassesPair(men, women, {...listing, category_id:"22"}).map(c => c.id)).toEqual(["22", "11"]);
});
it("never silently falls back to just one category", () => {
  expect(() => sunglassesPair(men, [], listing)).toThrow("beiden");
});
it("combines required fields and intersects constrained values", () => {
  const a: AspectMeta = { name:"Abteilung", required:false, usage:"OPTIONAL", mode:"SELECTION_ONLY", cardinality:"MULTI", values:["Herren","Unisex"] };
  const b: AspectMeta = { ...a, required:true, cardinality:"SINGLE", values:["Damen","Unisex"] };
  expect(mergeCategoryAspects([a], [b])[0]).toMatchObject({required:true,cardinality:"SINGLE",values:["Unisex"]});
  expect(() => mergeCategoryAspects([a], [{...b,values:["Damen"]}])).toThrow("gemeinsamen");
});
