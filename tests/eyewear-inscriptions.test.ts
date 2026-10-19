import { expect, it } from "vitest";
import {
  extractEyewear,
  parseBoxDimensions,
  mapEyewear,
  materialTitleIssues,
  syncManualEyewear,
} from "@/lib/eyewear-inscriptions";
import { germanGlassesTitle } from "@/lib/glasses-rules";
import { parseListing } from "@/lib/validation";
import type { PhotoFact } from "@/lib/photo-facts";
import type { ListingResult } from "@/lib/types";
import type { AspectMeta } from "@/lib/ebay/taxonomy";
const fact = (name: string, value: string, quote = value): PhotoFact => ({
  name,
  value,
  quote,
  basis: "label",
  photoIndices: [1],
});
const meta: AspectMeta[] = [
  "Marke",
  "Modell",
  "Glasbreite",
  "Stegbreite",
  "Bügellänge",
  "Fassungsmaterial",
].map((name) => ({
  name,
  required: false,
  usage: "OPTIONAL",
  mode: "FREE_TEXT",
  cardinality: "SINGLE",
  values: name === "Fassungsmaterial" ? ["Titan", "Acetat"] : [],
}));
it.each(["52□18-140", "52-18-140", "52 □ 18 140", "52/18 140"])(
  "parses %s exactly",
  (text) => {
    expect(parseBoxDimensions(text)).toEqual({
      lensWidth: "52",
      bridgeWidth: "18",
      templeLength: "140",
    });
  },
);
it("does not invent missing temple length or total width", () => {
  expect(parseBoxDimensions("48□20")).toEqual({
    lensWidth: "48",
    bridgeWidth: "20",
  });
  expect(parseBoxDimensions("model1234 C02")).toBeUndefined();
});
it("separates classified model, code and dimensions from a complete inscription", () => {
  const quote = "Lindberg Air Titanium 1234 C02 52□18 140";
  const data = extractEyewear([
    fact("Marke", "Lindberg", quote),
    fact("Modellnummer", "1234", quote),
    fact("Modellname", "Air Titanium", quote),
    fact("Farbcode", "C02", quote),
  ]);
  expect(data.fields.modelNumber?.value).toBe("1234");
  expect(data.fields.colorCode?.value).toBe("C02");
  expect(data.fields.material?.value).toBe("Titan");
  expect(data.fields.lensWidth?.value).toBe("52");
  expect(data.fields.totalWidth).toBeUndefined();
});
it("rejects dimensions classified as model and retains vintage outliers for review", () => {
  const data = extractEyewear([
    fact("Modellnummer", "52", "52□18 140"),
    fact("Bügelaufdruck", "70□30-160"),
  ]);
  expect(data.fields.modelNumber).toBeUndefined();
  expect(data.warnings.length).toBeGreaterThan(0);
});
it("applies inventory rule only to label-proven Lindberg without contradictory material", () => {
  expect(extractEyewear([fact("Marke", "Lindberg")]).fields.material).toEqual({
    value: "Titan",
    source: "shop",
  });
  expect(
    extractEyewear([{ ...fact("Marke", "Lindberg"), basis: "estimate" }]).fields
      .material,
  ).toBeUndefined();
  const conflict = extractEyewear([
    fact("Marke", "Lindberg"),
    fact("Material", "Acetat"),
  ]);
  expect(conflict.fields.material?.value).toBe("Acetat");
  expect(conflict.warnings.join()).toContain("widerspricht");
});
it("does not default over visually different material or contradictory printing", () => {
  expect(
    extractEyewear([
      fact("Marke", "Lindberg"),
      { ...fact("Material", "Acetate"), basis: "visible_feature" },
    ]).fields.material,
  ).toBeUndefined();
  const conflict = extractEyewear([
    fact("Marke", "Lindberg"),
    fact("Material", "Titan"),
    fact("Material", "Acetat"),
  ]);
  expect(conflict.fields.material).toBeUndefined();
  expect(conflict.warnings.length).toBeGreaterThan(0);
});
it("maps only actual allowed fields and preserves manual values including cleared values", () => {
  const listing: ListingResult = {
    title: "Brille",
    description: "",
    eyewear: extractEyewear([
      fact("Marke", "Lindberg"),
      fact("Bügelaufdruck", "46□18-140"),
      fact("Modellnummer", "1234"),
    ]),
    item_specifics: { Marke: "Korrigiert", Glasbreite: "" },
  };
  const aspects: Record<string, string[]> = {
    Marke: ["Korrigiert"],
    Glasbreite: [],
  };
  mapEyewear(listing, aspects, meta);
  expect(aspects.Marke).toEqual(["Korrigiert"]);
  expect(aspects.Glasbreite).toEqual([]);
  expect(aspects.Bügellänge).toEqual(["140 mm"]);
  expect(aspects.Modell).toEqual(["1234"]);
  expect(aspects.Fassungsmaterial).toEqual(["Titan"]);
  expect(aspects).not.toHaveProperty("Bügelaufdruck");
  expect(parseListing(listing).eyewear).toEqual(listing.eyewear);
});
it("keeps title manual and synchronizes explicit attribute changes back to extracted fields", () => {
  const old: ListingResult = {
    title: "Mein Titel",
    description: "",
    eyewear: extractEyewear([fact("Marke", "Lindberg")]),
    item_specifics: { Fassungsmaterial: "Titan" },
  };
  const next = { ...old, item_specifics: { Fassungsmaterial: "Acetat" } };
  syncManualEyewear(old, next);
  expect(next.title).toBe("Mein Titel");
  expect(next.eyewear?.fields.material).toEqual({
    value: "Acetat",
    source: "manual",
  });
  expect(old.eyewear?.fields.material?.value).toBe("Titan");
});
it("builds material before model with dimensions and never computes total", () => {
  const l: ListingResult = {
    title: "Brille",
    description: "",
    brand: "Lindberg",
    eyewear: extractEyewear([
      fact("Bügelaufdruck", "46□18-140"),
      fact("Modellnummer", "1234"),
    ]),
    item_specifics: {
      Fassungsmaterial: "Titan",
      Form: "Rund",
      Abteilung: "Herren",
    },
  };
  const title = germanGlassesTitle(l, meta);
  expect(title).toContain("Titan 1234");
  expect(title).toContain("kleine Gläser");
  expect(title).not.toContain("groß L XL");
  expect(title.length).toBeLessThanOrEqual(80);
  expect(materialTitleIssues({ ...l, title })).toEqual([]);
  expect(
    materialTitleIssues({
      ...l,
      title,
      item_specifics: { Fassungsmaterial: "Acetat" },
    }).length,
  ).toBe(1);
});
it.each(["Titan", "Acetat", "Metall", "Kunststoff", "Stahl"])(
  "checks title consistency for material %s",
  (material) => {
    const listing: ListingResult = {
      title: `Brille ${material}`,
      description: "",
      eyewear: { fields: {}, warnings: [] },
      item_specifics: { Fassungsmaterial: material },
    };
    expect(materialTitleIssues(listing)).toEqual([]);
    expect(
      materialTitleIssues({ ...listing, item_specifics: {} }),
    ).toHaveLength(1);
  },
);
it("maps box dimensions only to matching existing eBay dropdown values", () => {
  const l = {
    title: "Brille",
    description: "",
    eyewear: extractEyewear([fact("Bügelaufdruck", "52□18 140")]),
  };
  const m = (name: string, values: string[]): AspectMeta => ({
    name,
    values,
    required: false,
    usage: "OPTIONAL",
    mode: "FREE_TEXT",
    cardinality: "SINGLE",
  });
  const a: Record<string, string[]> = {};
  mapEyewear(l, a, [
    m("Glasbreite", ["50 mm", "52 mm"]),
    m("Stegbreite", ["18 mm"]),
    m("Bügellänge", []),
  ]);
  expect(a.Glasbreite).toEqual(["52 mm"]);
  expect(a.Stegbreite).toEqual(["18 mm"]);
  const b = {};
  mapEyewear(l, b, [m("Glasbreite", ["50 mm"]), m("Stegbreite", [])]);
  expect(b).toEqual({});
});

it("keeps printed Optyl and maps it to plastic, never acetate", () => {
  const eyewear = extractEyewear([fact("Bügelaufdruck", "FENDI OPTYL")]);
  expect(eyewear.fields.material?.value).toBe("Optyl");
  const listing = {
    eyewear,
    item_specifics: { Fassungsmaterial: "Acetat" },
  } as any;
  const aspects = { Fassungsmaterial: ["Acetat"] };
  mapEyewear(listing, aspects, [
    {
      name: "Fassungsmaterial",
      mode: "SELECTION_ONLY",
      cardinality: "MULTI",
      values: ["Acetat", "Kunststoff", "Metall"],
    } as any,
  ]);
  expect(aspects.Fassungsmaterial).toEqual(["Kunststoff"]);
});

it("extracts Bogner box dimensions from the bridge without temple markings", () => {
  const data = extractEyewear([fact("Brückenaufdruck", "53-18")]);
  expect(data.fields.lensWidth).toMatchObject({ value: "53", source: "label", quote: "53-18", photos: [1] });
  expect(data.fields.bridgeWidth?.value).toBe("18");
  expect(data.fields.templeLength).toBeUndefined();
  expect(data.fields.modelNumber).toBeUndefined();
  expect(data.fields.totalWidth).toBeUndefined();
});
