import { expect, it } from "vitest";
import { categoryMatches, categorySearchQuery } from "@/lib/category-selection";
const listing = { title: "ic! berlin Sunglasses", description: "", category: "mens_accessories" };
it("accepts German Herren categories for a men's draft", () => {
  expect(categoryMatches({ id: "1", name: "Sonnenbrillen", path: "Kleidung > Herren > Accessoires > Sonnenbrillen" }, listing)).toBe(true);
  expect(categoryMatches({ id: "2", name: "Sonnenbrillen", path: "Kleidung > Damen > Accessoires > Sonnenbrillen" }, listing)).toBe(false);
});
it("accepts German Damen and localized department values", () => {
  const l = { ...listing, category: "accessory", item_specifics: { Abteilung: "Damen" } };
  expect(categoryMatches({ id: "2", name: "Sonnenbrillen", path: "Damen > Sonnenbrillen" }, l)).toBe(true);
  expect(categorySearchQuery(l, true)).toBe("Sonnenbrille Damen");
});
it("uses short German product queries instead of long English brand titles", () => {
  expect(categorySearchQuery(listing, true)).toBe("Sonnenbrille Herren");
  expect(categorySearchQuery(listing, false)).toContain("Men");
});

it("does not substitute cases or children's sunglasses for adult sunglasses", () => {
  expect(categoryMatches({id:"3",name:"Brillenetuis",path:"Herren > Brillenetuis"}, listing)).toBe(false);
  expect(categoryMatches({id:"4",name:"Sonnenbrillen",path:"Kinder > Sonnenbrillen"}, {...listing, category:"accessory"})).toBe(false);
});
