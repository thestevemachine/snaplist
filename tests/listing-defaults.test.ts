import { expect, it } from "vitest";
import { applyListingDefaults } from "@/lib/listing-defaults";
import type { ListingResult } from "@/lib/types";
import type { AspectMeta } from "@/lib/ebay/taxonomy";
const meta: AspectMeta[] = [
  {
    name: "Size Type",
    values: ["Regular", "Petite"],
    mode: "SELECTION_ONLY",
    required: true,
    usage: "REQUIRED",
    cardinality: "SINGLE",
  },
];
it("defaults ordinary articles to used without claiming excellent condition", () => {
  const l: ListingResult = {
    title: "Shirt",
    description: "",
    condition: "GOOD",
    evidence: { "Size Type": [1] },
  };
  applyListingDefaults(l, meta, new Set([2990, 3000]));
  expect(l.item_specifics?.["Size Type"]).toBe("Regular");
  expect(l.ebay_condition).toBe("USED_EXCELLENT");
  expect(l.condition).toBe("GOOD");
  expect(l.evidence?.["Size Type"]).toBeUndefined();
});
it("preserves a seller's alternate size and new-condition choice on repeated preparation", () => {
  const l: ListingResult = {
    title: "Shirt",
    description: "",
    item_specifics: { "Size Type": "Petite" },
    ebay_condition: "NEW",
    condition: "NEW_WITH_TAGS",
  };
  applyListingDefaults(l, meta, new Set([1000, 2990]));
  expect(l.item_specifics?.["Size Type"]).toBe("Petite");
  expect(l.ebay_condition).toBe("NEW");
  expect(l.condition).toBe("NEW_WITH_TAGS");
});
it("does not relabel Good as Excellent or add unsupported size types", () => {
  const l: ListingResult = { title: "Item", description: "" };
  applyListingDefaults(l, [], new Set([3000]));
  expect(l.ebay_condition).toBe("USED_EXCELLENT");
  expect(l.item_specifics).toBeUndefined();
});
