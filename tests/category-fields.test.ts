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
it("applies category-backed sun defaults and retains multiple lens technologies", async () => {
  const { applyEyewearSellerDefaults } =
    await import("@/lib/ebay/category-fields");
  const m = (name: string, values: string[]) => ({ ...material, name, values });
  const meta = [
    m("UV-Schutz", ["UV400"]),
    m("Vintage", ["Ja", "Nein"]),
    m("Stil", ["Vollrand", "Rund", "Clubmaster"]),
    m("Gläsertechnologie", ["Getönt", "Verlaufsgetönt"]),
  ];
  const a: Record<string, string[]> = {
    Vintage: ["Ja"],
    Gläsertechnologie: ["Verlaufsgetönt"],
    Stil: ["Clubmaster"],
  };
  applyEyewearSellerDefaults(a, meta, true, "ic! berlin");
  expect(a).toMatchObject({
    "UV-Schutz": ["UV400"],
    Vintage: ["Nein"],
    Stil: ["Vollrand"],
    Gläsertechnologie: ["Verlaufsgetönt", "Getönt"],
  });
  const b: Record<string, string[]> = { Gläsertechnologie: ["Verlaufsgetönt"] };
  applyEyewearSellerDefaults(
    b,
    meta.map((m) => ({ ...m, cardinality: "SINGLE" })),
    true,
    "Other",
  );
  expect(b.Gläsertechnologie).toEqual(["Verlaufsgetönt"]);
  expect(b.Vintage).toBeUndefined();
});
it("expands physical features without misclassifying rimless frames", async () => {
  const { expandEyewearFeatures } = await import("@/lib/ebay/category-fields");
  const m = {
    ...material,
    name: "Besonderheiten",
    values: [
      "Randlos",
      "Halbrand",
      "Halbrahmen",
      "Vollrand",
      "Eckig",
      "Rechteckig",
      "Rund",
    ],
  };
  const a: Record<string, string[]> = {
    Stil: ["Randlos"],
    Form: ["Rechteckig"],
  };
  expandEyewearFeatures(a, [m]);
  expect(a.Besonderheiten).toEqual(["Randlos", "Rechteckig", "Eckig"]);
  const b: Record<string, string[]> = { Stil: ["Nylon"], Form: ["Rund"] };
  expandEyewearFeatures(b, [m]);
  expect(b.Besonderheiten).toEqual(["Halbrand", "Halbrahmen", "Rund"]);
});

it("maps measured lens height and total width to real category dropdown values", async () => {
  const { mapGridMeasurements } = await import("@/lib/ebay/category-fields");
  const aspects: Record<string, string[]> = {};
  mapGridMeasurements(
    { Scheibenhöhe: "42.8 mm", Gesamtbreite: "137 mm" },
    aspects,
    [
      {
        name: "Glashöhe",
        values: ["41 mm", "42 mm", "43 mm"],
        mode: "SELECTION_ONLY",
      },
      {
        name: "Fassungsbreite",
        values: ["136 mm", "140 mm"],
        mode: "SELECTION_ONLY",
      },
    ] as any,
  );
  expect(aspects).toEqual({ Glashöhe: ["42 mm"], Fassungsbreite: ["136 mm"] });
});
