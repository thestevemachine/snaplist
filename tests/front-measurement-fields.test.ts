import { expect, it } from "vitest";
import { frontMeasurementFields } from "@/lib/front-measurement-fields";
import { parseListing } from "@/lib/validation";
import type { ListingResult } from "@/lib/types";
import type { AspectMeta } from "@/lib/ebay/taxonomy";
const meta: AspectMeta[] = [
  {
    name: "Glashöhe",
    mode: "FREE_TEXT",
    values: [],
    cardinality: "SINGLE",
    usage: "OPTIONAL",
    required: false,
  },
  {
    name: "Rahmenbreite",
    mode: "FREE_TEXT",
    values: [],
    cardinality: "SINGLE",
    usage: "OPTIONAL",
    required: false,
  },
];
const listing = (): ListingResult => ({
  title: "Brille",
  description: "Text",
  frontMeasurement: {
    method: "front-photo-ratio-v1",
    photoIndex: 1,
    referencePhotos: [10],
    status: "estimated",
    reasons: [],
    lensHeightMm: 40,
    totalWidthMm: 138,
  },
});
it("fills actual blank prepared category fields and survives parsing with estimate markers", () => {
  const l = {
    ...listing(),
    item_specifics: { Glashöhe: "", Rahmenbreite: "" },
  };
  const patch = frontMeasurementFields(l, meta)!;
  expect(patch.item_specifics).toEqual({
    Glashöhe: "40 mm",
    Rahmenbreite: "138 mm",
  });
  expect(patch.estimates?.Glashöhe).toBe(60);
  expect(patch.evidence?.Glashöhe).toEqual([1, 10]);
  expect(parseListing({ ...l, ...patch }).frontMeasurement).toEqual(
    l.frontMeasurement,
  );
});
it("preserves manual positive values and cleared fields across aliases", () => {
  const l = {
    ...listing(),
    item_specifics: { Gesamtbreite: "141 mm", Glashöhe: "" },
    manual_measurement_fields: ["Scheibenhöhe"],
  };
  expect(frontMeasurementFields(l, meta)?.item_specifics).toEqual({
    Gesamtbreite: "141 mm",
    Glashöhe: "",
    Rahmenbreite: "141 mm",
  });
});
it("marks uncertain calculations explicitly instead of pretending verified measurements", () => {
  const l = listing();
  l.frontMeasurement!.status = "uncertain";
  expect(frontMeasurementFields(l, meta)?.estimates?.Glashöhe).toBe(59);
});
it("never fabricates unknown dimensions or unsupported dropdown sizes", () => {
  const l = listing();
  l.frontMeasurement!.status = "unavailable";
  expect(frontMeasurementFields(l, meta)).toBeUndefined();
  expect(
    frontMeasurementFields(listing(), [
      { ...meta[0], mode: "SELECTION_ONLY", values: ["39 mm"] },
    ]),
  ).toBeUndefined();
  expect(
    frontMeasurementFields(listing(), [
      { ...meta[0], mode: "SELECTION_ONLY", values: ["40 mm"] },
    ])?.item_specifics?.Glashöhe,
  ).toBe("40 mm");
});

it("accepts calculated frame width in FREE_TEXT fields with suggested sizes", () => {
  expect(
    frontMeasurementFields(listing(), [
      { ...meta[1], values: ["130 mm", "140 mm"] },
    ])?.item_specifics?.Rahmenbreite,
  ).toBe("138 mm");
});
it("does not undo an explicit seller clear of frame width", () => {
  const l = {
    ...listing(),
    manual_measurement_fields: ["Rahmenbreite"],
    item_specifics: { Rahmenbreite: "" },
  };
  expect(frontMeasurementFields(l, [meta[1]])).toBeUndefined();
});

it("does not automatically transfer measurements after a failed inscription scale check", () => {
  const l = listing();
  l.frontMeasurement!.status = "uncertain";
  l.frontMeasurement!.reasons = [
    "Referenzprüfung: Maßstab passt nicht zur Stegbreite.",
  ];
  expect(frontMeasurementFields(l, meta)).toBeUndefined();
});
it("keeps a perspective-uncertain total width for seller review and preserves manual values",()=>{
 const l=listing();l.frontMeasurement!.status="uncertain";
 l.item_specifics={Rahmenbreite:"138 mm"};l.estimates={Rahmenbreite:59};
 expect(frontMeasurementFields(l,meta)?.item_specifics?.Rahmenbreite).toBe("138 mm");
 l.manual_measurement_fields=["Rahmenbreite"];
 expect(frontMeasurementFields(l,meta)?.item_specifics?.Rahmenbreite).toBe("138 mm");
});
