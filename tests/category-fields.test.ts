import { it, expect } from "vitest";
import {
  categorySpecifics,
  applySunglassesLensDefault,
} from "@/lib/ebay/category-fields";
import { mergeCategoryAspects } from "@/lib/ebay/secondary-category";
import type { AspectMeta } from "@/lib/ebay/taxonomy";
const material: AspectMeta = {
  name: "Gläsermaterial",
  required: false,
  usage: "OPTIONAL",
  mode: "SELECTION_ONLY",
  cardinality: "MULTI",
  values: ["Glas", "Kunststoff"],
};
it("keeps only actual category fields plus the Trading EAN identifier", () => {
  expect(
    categorySpecifics(
      {
        Marke: "Test",
        "Hinge Type": "Hinge",
        "Nose Pad Type": "Saddle",
        "Temple Tip Material": "Plastic",
        "Lens Treatment": "None",
        EAN: "Nicht zutreffend",
      },
      [{ ...material, name: "Marke" }],
    ),
  ).toEqual({ Marke: "Test", EAN: "Nicht zutreffend" });
});
it("uses plastic as a default only if allowed and never replaces a chosen value", () => {
  const fields: Record<string, string[]> = {};
  applySunglassesLensDefault(fields, [material]);
  expect(fields.Gläsermaterial).toEqual(["Kunststoff"]);
  fields.Gläsermaterial = ["Glas"];
  applySunglassesLensDefault(fields, [material]);
  expect(fields.Gläsermaterial).toEqual(["Glas"]);
  const unsupported = {};
  applySunglassesLensDefault(unsupported, [{ ...material, values: ["Glas"] }]);
  expect(unsupported).toEqual({});
});
it("intersects German material dropdowns across both categories and keeps multi selection", () => {
  const a = {
    ...material,
    name: "Fassungsmaterial",
    mode: "FREE_TEXT" as const,
    values: ["Metall", "Kunststoff", "Holz"],
  };
  expect(
    mergeCategoryAspects([a], [{ ...a, values: ["Metall", "Kunststoff"] }])[0],
  ).toMatchObject({ cardinality: "MULTI", values: ["Metall", "Kunststoff"] });
});
it("uses seller fallback materials only in an empty actual multi-select", async () => {
  const { applyFrameMaterialDefault } =
    await import("@/lib/ebay/category-fields");
  const m = {
    ...material,
    name: "Rahmenmaterial",
    values: ["Kunststoff", "Acetat", "Metall", "Titan"],
  };
  const a: Record<string, string[]> = {};
  applyFrameMaterialDefault(a, [m]);
  expect(a.Rahmenmaterial).toEqual(["Kunststoff", "Acetat", "Metall"]);
  a.Rahmenmaterial = ["Titan"];
  applyFrameMaterialDefault(a, [m]);
  expect(a.Rahmenmaterial).toEqual(["Titan"]);
  const b = {};
  applyFrameMaterialDefault(b, [{ ...m, cardinality: "SINGLE" }]);
  expect(b).toEqual({});
});
