import { expect, it } from "vitest";
import { eyewearFeatureDefaultPatch } from "@/lib/ebay/category-fields";
import { parseListing } from "@/lib/validation";
import type { AspectMeta } from "@/lib/ebay/taxonomy";
const meta: AspectMeta[] = [
  {
    name: "Besonderheiten",
    required: true,
    mode: "SELECTION_ONLY",
    cardinality: "MULTI",
    usage: "REQUIRED",
    values: ["Wasserfest", "Randlos"],
  },
];
const base = {
  title: "Brille",
  description: "Text",
  category_fields_version: 4,
  item_specifics: { Gesamtbreite: "140 mm" },
  evidence: { Besonderheiten: [1], Gesamtbreite: [2] },
  estimates: { Besonderheiten: 80 },
};
it("fills an existing prepared empty draft with the exact seller default, removes false AI evidence and preserves other fields", () => {
  const patch = eyewearFeatureDefaultPatch(base, meta)!;
  expect(patch.item_specifics).toEqual({
    Gesamtbreite: "140 mm",
    Besonderheiten: "Wasserfest",
  });
  expect(patch.evidence).toEqual({ Gesamtbreite: [2] });
  expect(patch.estimates).toEqual({});
  expect(base.item_specifics).toEqual({ Gesamtbreite: "140 mm" });
  expect(parseListing({ ...base, ...patch }).feature_defaults_version).toBe(1);
});
it("keeps any existing seller or recognized feature", () => {
  expect(
    eyewearFeatureDefaultPatch(
      { ...base, item_specifics: { Besonderheiten: "Randlos" } },
      meta,
    ),
  ).toEqual({ feature_defaults_version: 1 });
});
it("never re-adds the fallback after a manual removal or later preparation", () => {
  expect(
    eyewearFeatureDefaultPatch(
      {
        ...base,
        feature_defaults_version: 1,
        item_specifics: { Besonderheiten: "" },
      },
      meta,
    ),
  ).toBeUndefined();
});
it("does not invent unsupported category choices or fill absent fields", () => {
  expect(eyewearFeatureDefaultPatch(base, [])).toBeUndefined();
  expect(
    eyewearFeatureDefaultPatch(base, [{ ...meta[0], values: ["LED"] }]),
  ).toEqual({ feature_defaults_version: 1 });
});
it("treats whitespace as empty and honors the exact category spelling", () => {
  expect(
    eyewearFeatureDefaultPatch(
      { ...base, item_specifics: { Besonderheiten: " " } },
      [{ ...meta[0], values: ["wasserfest"] }],
    )?.item_specifics?.Besonderheiten,
  ).toBe("wasserfest");
});
