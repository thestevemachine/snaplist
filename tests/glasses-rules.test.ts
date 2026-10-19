import { expect, it } from "vitest";
import { germanAspects, germanGlassesTitle } from "@/lib/glasses-rules";
import { parseListing } from "@/lib/validation";
import { acceptedPhotoFact } from "@/lib/photo-facts";
import type { AspectMeta } from "@/lib/ebay/taxonomy";
const aspect = (name: string, values: string[] = []): AspectMeta => ({
  name,
  values,
  required: false,
  usage: "OPTIONAL",
  mode: "FREE_TEXT",
  cardinality: "SINGLE",
});
const meta = [
  aspect("Marke"),
  aspect("Fassungsfarbe", ["Braun", "Schwarz"]),
  aspect("Fassungsmaterial", ["Acetat", "Metall"]),
];
it("maps Brand to Marke and category values but keeps seller corrections", () => {
  const l = { title: "Eyeglasses", description: "", brand: "Old" };
  const a: Record<string, string[]> = {
    Brand: ["Old"],
    Marke: ["Seller"],
    "Frame Color": ["Tortoiseshell"],
    "Frame Material": ["Acetate"],
  };
  germanAspects(l, a, meta);
  expect(a).toEqual({
    Marke: ["Seller"],
    Fassungsfarbe: ["Braun"],
    Fassungsmaterial: ["Acetat"],
  });
  expect(l.brand).toBe("Seller");
  const b = { Brand: ["Known"] };
  germanAspects(l, b, meta);
  expect(b).toHaveProperty("Marke", ["Known"]);
});
it("does not invent an allowed color or material", () => {
  const a = { "Frame Color": ["Mystery"], Material: ["Unknown alloy"] };
  germanAspects({ title: "Brille", description: "" }, a, meta);
  expect(a).toHaveProperty("Fassungsfarbe", []);
  expect(a).toHaveProperty("Fassungsmaterial", []);
});
it("formats German titles and strict measurement boundaries without xy", () => {
  const l = {
    title: "Eyeglasses xy",
    description: "",
    brand: "Lindberg",
    item_specifics: {
      Abteilung: "Unisex",
      Fassungsfarbe: "Braun",
      Form: "Round",
      Modellnummer: "1014",
      Glasbreite: "46",
      Gesamtbreite: "140",
    },
  };
  expect(germanGlassesTitle(l, meta)).toBe(
    "Lindberg Brille Herren Damen Rund Panto Braun 1014 kleine Gläser groß L XL",
  );
  expect(
    germanGlassesTitle(
      {
        ...l,
        item_specifics: {
          ...l.item_specifics,
          Glasbreite: "47",
          Gesamtbreite: "139",
        },
      },
      meta,
    ),
  ).not.toMatch(/kleine Gläser|groß L XL/);
  expect(
    germanGlassesTitle(
      {
        ...l,
        estimates: { Modellnummer: 90, Glasbreite: 90, Gesamtbreite: 90 },
      },
      meta,
    ),
  ).not.toMatch(/1014|kleine Gläser|groß L XL/);
});
it("preserves estimate metadata through request validation", () => {
  expect(
    parseListing({
      title: "Brille",
      description: "",
      estimates: { Glasbreite: 90 },
    }).estimates,
  ).toEqual({ Glasbreite: 90 });
});
it("requires label evidence for German model and dimension facts", () => {
  for (const name of ["Modellnummer", "Glasbreite", "Gesamtbreite", "Marke"]) {
    expect(
      acceptedPhotoFact(
        {
          name,
          value: "46",
          photoIndices: [1],
          basis: "estimate",
          quote: "",
          confidence: 99,
        },
        1,
      ),
    ).toBe(false);
    expect(
      acceptedPhotoFact(
        {
          name,
          value: "46",
          photoIndices: [1],
          basis: "label",
          quote: "46",
          confidence: 100,
        },
        1,
      ),
    ).toBe(true);
  }
});
it("retains the model before optional words at 80 characters", () => {
  const title = germanGlassesTitle(
    {
      title: "Sunglasses",
      description: "",
      brand: "Very Long Brand Name",
      item_specifics: {
        Modellnummer: "ABC123",
        Abteilung: "Unisex",
        Form: "Rund",
        Fassungsfarbe: "Schwarz",
        Glasbreite: "46",
        Gesamtbreite: "140",
      },
    },
    meta,
  );
  expect(title.length).toBeLessThanOrEqual(80);
  expect(title).toContain("ABC123");
  expect(title).toContain("Sonnenbrille");
});
it("uses actual eBay Rahmenfarbe, Rahmenmaterial and Brillenform in titles", () => {
  const actual = [
    aspect("Marke"),
    aspect("Rahmenfarbe", ["Schwarz"]),
    aspect("Rahmenmaterial", ["Titan"]),
    aspect("Brillenform", ["Rund"]),
  ];
  const l = { title: "Brille", description: "", brand: "Lindberg" };
  const a = {
    "Frame Color": ["Black"],
    "Frame Material": ["Titanium"],
    "Frame Shape": ["Round"],
  };
  germanAspects(l, a, actual);
  expect(a).toMatchObject({
    Rahmenfarbe: ["Schwarz"],
    Rahmenmaterial: ["Titan"],
    Brillenform: ["Rund"],
  });
  const title = germanGlassesTitle(
    {
      ...l,
      item_specifics: {
        ...Object.fromEntries(
          Object.entries(a).map(([k, v]) => [k, v.join(" | ")]),
        ),
        Abteilung: "Herren",
        Modellnummer: "1014",
      },
    },
    actual,
  );
  expect(title).toBe("Lindberg Brille Herren Rund Panto Schwarz Titan 1014");
});
it("retains free-text category values and supported extra keywords", () => {
  const m = [
    aspect("Rahmenfarbe"),
    aspect("Rahmenmaterial"),
    aspect("Besonderheiten", ["Randlos"]),
  ];
  expect(
    germanGlassesTitle(
      {
        title: "Sonnenbrille",
        description: "",
        brand: "ic! berlin",
        item_specifics: {
          Rahmenfarbe: "Schwarz",
          Rahmenmaterial: "Metall",
          Modell: "glacier",
          Abteilung: "Unisex",
          Besonderheiten: "Randlos",
        },
      },
      m,
    ),
  ).toBe("ic! berlin Sonnenbrille Herren Damen Schwarz Metall glacier Randlos");
});
it("does not refill a deliberately cleared canonical color from an old alias", () => {
  const m = [aspect("Rahmenfarbe", ["Braun"])];
  const a = { Rahmenfarbe: [], "Frame Color": ["Tortoiseshell"] };
  germanAspects({ title: "Brille", description: "" }, a, m);
  expect(a.Rahmenfarbe).toEqual([]);
  expect(
    germanGlassesTitle(
      {
        title: "Brille",
        description: "",
        item_specifics: { Rahmenfarbe: "", Fassungsfarbe: "Braun" },
      },
      m,
    ),
  ).not.toContain("Braun");
});
it("fits additional truthful category keywords without exceeding 80 characters", () => {
 const m=[aspect("Rahmenfarbe",["Braun"]),aspect("Charakter",["Klassisch","Elegant"]),aspect("Besonderheiten",["Vollrand"])];
 const title=germanGlassesTitle({title:"Brille",description:"",brand:"Test",item_specifics:{Rahmenfarbe:"Braun",Charakter:"Klassisch | Elegant",Besonderheiten:"Vollrand",Modell:"1234"}},m);
 expect(title).toBe("Test Brille Braun 1234 Vollrand Klassisch Elegant");
 expect(title.length).toBeLessThanOrEqual(80);
});
