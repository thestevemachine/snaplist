import { expect, it } from "vitest";
import { acceptedPhotoFact, MIN_ESTIMATE_CONFIDENCE } from "@/lib/photo-facts";

const fact = (over: Record<string, unknown>) => ({
  name: "Upper Material",
  value: "Canvas",
  basis: "estimate",
  quote: "",
  photoIndices: [1],
  confidence: 75,
  ...over,
});

it("uses a 60% threshold for educated guesses", () => {
  expect(MIN_ESTIMATE_CONFIDENCE).toBe(60);
});

it("accepts confident educated guesses for any category aspect", () => {
  expect(acceptedPhotoFact(fact({}), 2)).toBe(true);
  expect(
    acceptedPhotoFact(
      fact({ name: "Shoe Width", value: "Medium", confidence: 60 }),
      2,
    ),
  ).toBe(true);
  expect(
    acceptedPhotoFact(
      fact({
        name: "Closure",
        value: "Lace Up",
        basis: "visible_feature",
        confidence: 90,
      }),
      2,
    ),
  ).toBe(true);
});

it("leaves an aspect blank when confidence is under 60% or missing", () => {
  const width = { name: "Shoe Width", value: "Medium" };
  expect(acceptedPhotoFact(fact({ ...width, confidence: 59 }), 2)).toBe(false);
  expect(acceptedPhotoFact(fact({ ...width, confidence: undefined }), 2)).toBe(
    false,
  );
  expect(acceptedPhotoFact(fact({ ...width, confidence: "high" }), 2)).toBe(
    false,
  );
});

it("never guesses identifiers, provenance or measurements", () => {
  for (const name of [
    "UPC",
    "EAN",
    "ISBN",
    "MPN",
    "Year Manufactured",
    "Country/Region of Manufacture",
    "Vintage",
    "Handmade",
    "Personalize",
    "Inseam",
  ])
    expect(
      acceptedPhotoFact(fact({ name, value: "X", confidence: 95 }), 2),
    ).toBe(false);
});

it("still accepts label-read identifiers that match their quote", () => {
  expect(
    acceptedPhotoFact(
      fact({
        name: "US Shoe Size",
        value: "6.5",
        basis: "label",
        quote: "W US 6.5",
        confidence: 99,
      }),
      2,
    ),
  ).toBe(true);
  expect(
    acceptedPhotoFact(
      fact({
        name: "UPC",
        value: "012345678905",
        basis: "label",
        quote: "012345678905",
      }),
      2,
    ),
  ).toBe(true);
});

it("always accepts a best guess for Upper Material, whatever the confidence", () => {
  expect(acceptedPhotoFact(fact({ confidence: 20 }), 2)).toBe(true);
  expect(
    acceptedPhotoFact(fact({ name: "upper material", confidence: 0 }), 2),
  ).toBe(true);
  expect(acceptedPhotoFact(fact({ confidence: undefined }), 2)).toBe(false);
  expect(
    acceptedPhotoFact(fact({ name: "Lining Material", confidence: 20 }), 2),
  ).toBe(false);
});
it("accepts only documented grid estimates for eyewear height and widths", () => {
  for (const name of ["Scheibenhöhe", "Gesamtbreite", "Lichte Breite"]) {
    expect(
      acceptedPhotoFact(
        fact({
          name,
          value: "42 mm",
          quote: "Millimeterpapier: Raster 1 mm, 42 Kästchen",
          confidence: 85,
        }),
        1,
      ),
    ).toBe(true);
    expect(
      acceptedPhotoFact(
        fact({ name, value: "42 mm", quote: "geschätzt", confidence: 99 }),
        1,
      ),
    ).toBe(false);
  }
  expect(
    acceptedPhotoFact(
      fact({
        name: "Glasbreite",
        value: "52 mm",
        quote: "Millimeterpapier",
        confidence: 99,
      }),
      1,
    ),
  ).toBe(false);
});

it("accepts documented caliper estimates for lens height and total frame width", () => {
  for (const name of ["Glashöhe", "Gesamtbreite"])
    expect(
      acceptedPhotoFact(
        fact({
          name,
          value: "42 mm",
          quote: "Messschieber: Skala zeigt ungefähr 42 mm",
        }),
        1,
      ),
    ).toBe(true);
});

it("accepts exact material translations printed on demo lenses without inventing another material", () => {
  const fact = {
    name: "Fassungsmaterial",
    value: "Titan",
    quote: "TITANIUM",
    photoIndices: [1],
    basis: "label",
  };
  expect(acceptedPhotoFact(fact, 1)).toBe(true);
  expect(acceptedPhotoFact({ ...fact, value: "Acetat" }, 1)).toBe(false);
  expect(
    acceptedPhotoFact({ ...fact, name: "Modell", value: "Titan" }, 1),
  ).toBe(false);
});

it('accepts mm units and taxonomy suffixes without swapping width and bridge in box inscriptions',()=>{
 expect(acceptedPhotoFact(fact({name:'Glasbreite (mm)',value:'51 mm',basis:'label',quote:'51 □ 18 145'}),2)).toBe(true);
 expect(acceptedPhotoFact(fact({name:'Stegbreite',value:'18 mm',basis:'label',quote:'51 □ 18 145'}),2)).toBe(true);
 expect(acceptedPhotoFact(fact({name:'Glasbreite',value:'18 mm',basis:'label',quote:'51 □ 18 145'}),2)).toBe(false);
 expect(acceptedPhotoFact(fact({name:'Glasbreite',value:'51 mm',basis:'label',quote:'Modell 6151'}),2)).toBe(false);
});
