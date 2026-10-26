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
it("maps printed dimensions to free text while respecting selection-only dropdowns", () => {
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
  expect(b).toEqual({Glasbreite:["52"],Stegbreite:["18"]});
  const restricted={};
  mapEyewear(l,restricted,[{...m("Glasbreite",["50 mm"]),mode:"SELECTION_ONLY"}]);
  expect(restricted).toEqual({});
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
  expect(data.fields.lensWidth).toMatchObject({
    value: "53",
    source: "label",
    quote: "53-18",
    photos: [1],
  });
  expect(data.fields.bridgeWidth?.value).toBe("18");
  expect(data.fields.templeLength).toBeUndefined();
  expect(data.fields.modelNumber).toBeUndefined();
  expect(data.fields.totalWidth).toBeUndefined();
});

it("uses a Titanium demo-lens marking and keeps proven acetate front material alongside it", () => {
  const eyewear = extractEyewear([
    fact("Scheibenaufdruck", "TITANIUM", "TITANIUM"),
  ]);
  expect(eyewear.fields.material?.value).toBe("Titan");
  const l: ListingResult = {
    title: "Brille",
    description: "",
    eyewear,
    item_specifics: { Rahmenmaterial: "Metall | Acetat" },
  };
  const aspects = { Rahmenmaterial: ["Metall", "Acetat"] };
  mapEyewear(l, aspects, [
    {
      ...meta[0],
      name: "Rahmenmaterial",
      cardinality: "MULTI",
      values: ["Titan", "Acetat", "Metall"],
    },
  ]);
  expect(aspects.Rahmenmaterial).toEqual(expect.arrayContaining(["Titan", "Metall", "Acetat"]));
  expect(l.material?.split(" | ")).toEqual(expect.arrayContaining(["Titan", "Metall", "Acetat"]));
});
it("combines different label-proven front and temple materials without treating them as a conflict", () => {
  const eyewear = extractEyewear([
    fact("Bügelmaterial", "Titan", "TITAN"),
    fact("Frontmaterial", "Acetat", "ACETAT"),
  ]);
  expect(eyewear.fields.material?.value).toBe("Titan | Acetat");
  expect(eyewear.warnings).toEqual([]);
});
it("does not erase a compound material when its printed words are read again", () => {
  expect(
    extractEyewear([fact("Fassungsmaterial", "Titan | Acetat", "TITAN ACETAT")])
      .fields.material?.value,
  ).toBe("Titan | Acetat");
});
it("repairs a stored generic metal value from positive label evidence once, without overriding a seller edit", async () => {
  const { printedMaterialPatch } = await import("@/lib/eyewear-inscriptions");
  const l: ListingResult = {
    title: "Mein Titel",
    description: "Text",
    eyewear: extractEyewear([fact("Scheibenaufdruck", "TITANIUM")]),
    item_specifics: { Rahmenmaterial: "Metall | Acetat" },
  };
  const m = [
    {
      ...meta[0],
      name: "Rahmenmaterial",
      cardinality: "MULTI" as const,
      values: ["Titan", "Acetat", "Metall"],
    },
  ];
  const patch = printedMaterialPatch(l, m)!;
  expect(patch.item_specifics?.Rahmenmaterial?.split(" | ")).toEqual(expect.arrayContaining(["Titan", "Metall", "Acetat"]));
  expect(printedMaterialPatch({ ...l, ...patch }, m)).toBeUndefined();
  expect(
    printedMaterialPatch(
      {
        ...l,
        eyewear: {
          fields: { material: { value: "Metall", source: "manual" } },
          warnings: [],
        },
      },
      m,
    ),
  ).toBeUndefined();
  expect(l.item_specifics?.Rahmenmaterial).toBe("Metall | Acetat");
});

it("warns briefly in either direction when titanium differs between title and material", () => {
  expect(
    materialTitleIssues({
      title: "Brille Metall",
      description: "",
      eyewear: { fields: {}, warnings: [] },
      item_specifics: { Rahmenmaterial: "Titan | Acetat" },
    }),
  ).toEqual(["Titel/Material: Titan prüfen."]);
  expect(
    materialTitleIssues({
      title: "Brille Titan",
      description: "",
      eyewear: { fields: {}, warnings: [] },
      item_specifics: { Rahmenmaterial: "Metall" },
    }),
  ).toHaveLength(1);
});

it("retains a visually supported acetate front alongside printed titanium, including its estimate marker", () => {
  const eyewear = extractEyewear([
    fact("Scheibenaufdruck", "TITANIUM"),
    {
      ...fact("Frontmaterial", "Acetat", "Front aus Acetat"),
      basis: "estimate",
      confidence: 85,
    },
  ]);
  const l: ListingResult = {
    title: "Brille",
    description: "",
    eyewear,
    item_specifics: { Rahmenmaterial: "Metall" },
  };
  const aspects = { Rahmenmaterial: ["Metall"] };
  mapEyewear(l, aspects, [
    {
      ...meta[0],
      name: "Rahmenmaterial",
      cardinality: "MULTI",
      values: ["Titan", "Acetat", "Metall"],
    },
  ]);
  expect(aspects.Rahmenmaterial).toEqual(expect.arrayContaining(["Titan", "Metall", "Acetat"]));
  expect(l.estimates?.Rahmenmaterial).toBe(85);
  expect(parseListing(l).eyewear?.materials?.[0]).toMatchObject({
    part: "front",
    value: "Acetat",
    source: "estimate",
    confidence: 85,
  });
});

it("keeps a model identifier and separate lens width read on a Lindberg demo lens", () => {
  const data=extractEyewear([fact("Modellnummer","1234","LINDBERG 1234 74"),fact("Glasbreite","74","LINDBERG 1234 74")]);
  expect(data.fields.modelNumber?.value).toBe("1234");
  expect(data.fields.lensWidth).toMatchObject({value:"74",source:"label",photos:[1]});
});
it("extracts 46 mm from a complete Lindberg demo-lens print without a box separator",()=>{
 const data=extractEyewear([fact("Marke","Lindberg"),fact("Scheibenaufdruck","1257 46","LINDBERG 1257 46")]);
 expect(data.fields.modelNumber?.value).toBe("1257");
 expect(data.fields.lensWidth).toMatchObject({value:"46",source:"label",quote:"LINDBERG 1257 46",photos:[1]});
 const alias=extractEyewear([fact("Scheibenbreite","46 mm","46 mm")]);
 expect(alias.fields.lensWidth?.value).toBe("46");
 expect(extractEyewear([fact("Marke","ic! berlin"),fact("Scheibenaufdruck","1257 46")]).fields.lensWidth).toBeUndefined();
});
