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
  },
  {
    name: "Rahmenbreite",
    mode: "FREE_TEXT",
    values: [],
    cardinality: "SINGLE",
    usage: "OPTIONAL",
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
  expect(frontMeasurementFields(l, meta)).toBeUndefined();
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
