import { describe, it, expect } from "vitest";
import {
  calculateFrontMeasurement,
  attachFrontMeasurement,
  type FrontObservation,
} from "@/lib/front-measurements";
import { imageSize } from "@/lib/image-size";
import { parseListing } from "@/lib/validation";
import type { ListingResult } from "@/lib/types";

const observation = (): FrontObservation => ({
  photoIndex: 1,
  leftLens: {
    left: { x: 0.15, y: 0.4 },
    right: { x: 0.4, y: 0.4 },
    top: { x: 0.27, y: 0.2 },
    bottom: { x: 0.27, y: 0.6 },
  },
  rightLens: {
    left: { x: 0.6, y: 0.4 },
    right: { x: 0.85, y: 0.4 },
    top: { x: 0.73, y: 0.2 },
    bottom: { x: 0.73, y: 0.6 },
  },
  outerLeft: { x: 0.05, y: 0.4 },
  outerRight: { x: 0.95, y: 0.4 },
  frontal: true,
  groovesVisible: true,
  complete: true,
  samePlane: true,
  confidence: 95,
  note: "",
});
const listing = (): ListingResult => ({
  title: "Brille",
  description: "Manueller Text",
  item_specifics: { Gesamtbreite: "141 mm" },
  eyewear: {
    fields: {
      lensWidth: {
        value: "50",
        source: "label",
        quote: "50□18 140",
        photos: [2],
      },
    },
    warnings: [],
  },
});
const sizes = [
  { width: 1000, height: 500 },
  { width: 800, height: 1200 },
];
describe("front photo pixel ratios", () => {
  it("converts only contours with the inscription reference, accounts for image aspect ratio and rounds to whole mm", () => {
    const m = calculateFrontMeasurement(observation(), sizes, listing());
    expect(m).toMatchObject({
      status: "estimated",
      referenceMm: 50,
      lensWidthPx: 250,
      lensHeightPx: 200,
      totalWidthPx: 900,
      lensHeightMm: 40,
      totalWidthMm: 180,
      referencePhotos: [2],
    });
    expect(m.reasons).toEqual([]);
  });
  it("uses boxing x/y spans, not diagonal chords, and rounds rather than truncates", () => {
    const o = observation();
    o.leftLens.left.y = 0.3;
    o.leftLens.right.y = 0.5;
    const l = listing();
    l.eyewear!.fields.lensWidth!.value = "51";
    expect(calculateFrontMeasurement(o, sizes, l)).toMatchObject({
      lensWidthPx: 250,
      lensHeightMm: 41,
      totalWidthMm: 184,
    });
  });
  it("is invariant under proportional image resizing", () => {
    const first = calculateFrontMeasurement(observation(), sizes, listing());
    const second = calculateFrontMeasurement(
      observation(),
      [{ width: 2000, height: 1000 }],
      listing(),
    );
    expect(second.lensHeightMm).toBe(first.lensHeightMm);
    expect(second.totalWidthMm).toBe(first.totalWidthMm);
    expect(second.lensWidthPx).toBe(first.lensWidthPx! * 2);
  });
  it.each(["frontal", "groovesVisible", "complete", "samePlane"] as const)(
    "marks %s=false as uncertain rather than verified",
    (key) => {
      const o = observation();
      o[key] = false;
      expect(calculateFrontMeasurement(o, sizes, listing())).toMatchObject({
        status: "uncertain",
        lensHeightMm: 40,
      });
    },
  );
  it("detects unequal lenses, low confidence and explicit ambiguity", () => {
    const o = observation();
    o.rightLens.right.x = 0.89;
    o.confidence = 75;
    o.note = "Reflexion am Rand";
    const m = calculateFrontMeasurement(o, sizes, listing());
    expect(m.status).toBe("uncertain");
    expect(m.reasons).toHaveLength(3);
  });
  it.each([
    undefined,
    {},
    { ...observation(), photoIndex: 0 },
    { ...observation(), photoIndex: 3 },
    { ...observation(), photoIndex: 99 },
    { ...observation(), outerLeft: { x: -1, y: 0 } },
  ])("fails closed for missing/malformed/out-of-range geometry", (raw) => {
    expect(calculateFrontMeasurement(raw, sizes, listing())).toMatchObject({
      status: "unavailable",
    });
  });
  it("does not use another photo's scale or contours", () => {
    const o = observation();
    o.photoIndex = 2;
    const m = calculateFrontMeasurement(o, sizes, listing());
    expect(m.status).toBe("unavailable");
    expect(m.lensHeightMm).toBeUndefined(); // impossible tall lens ratio rejected
  });
  it.each(["manual", "shop"] as const)(
    "never accepts %s as an automatically read reference",
    (source) => {
      const l = listing();
      l.eyewear!.fields.lensWidth!.source = source;
      expect(
        calculateFrontMeasurement(observation(), sizes, l).lensHeightMm,
      ).toBeUndefined();
    },
  );
  it("rejects missing/conflicting inscription, clipped frames, zero width and undersized evidence", () => {
    const l = listing();
    delete l.eyewear!.fields.lensWidth;
    expect(calculateFrontMeasurement(observation(), sizes, l).status).toBe(
      "unavailable",
    );
    const clipped = observation();
    clipped.outerLeft.x = 0;
    expect(calculateFrontMeasurement(clipped, sizes, listing()).status).toBe(
      "unavailable",
    );
    const zero = observation();
    zero.leftLens.right = zero.leftLens.left;
    expect(calculateFrontMeasurement(zero, sizes, listing()).status).toBe(
      "unavailable",
    );
    expect(
      calculateFrontMeasurement(
        observation(),
        [{ width: 200, height: 100 }],
        listing(),
      ).status,
    ).toBe("unavailable");
  });
  it("persists evidence through validation without changing seller text, inscription or eBay specifics", () => {
    const l = listing();
    const original = structuredClone(l);
    attachFrontMeasurement(l, observation(), sizes);
    const roundtrip = parseListing(JSON.parse(JSON.stringify(l)));
    expect(roundtrip.frontMeasurement).toEqual(l.frontMeasurement);
    expect(roundtrip.item_specifics).toEqual(original.item_specifics);
    expect(roundtrip.description).toBe(original.description);
    expect(roundtrip.eyewear).toEqual(original.eyewear);
    expect(roundtrip.measurements).toContain("ca. 40 mm");
    expect(roundtrip.measurements).toContain("Schätzung");
  });
});

describe("bounded image header sizes", () => {
  it("reads PNG dimensions without decoding pixels", () => {
    const b = Buffer.alloc(24);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(b);
    b.write("IHDR", 12);
    b.writeUInt32BE(1000, 16);
    b.writeUInt32BE(500, 20);
    expect(imageSize(b.toString("base64"))).toEqual({
      width: 1000,
      height: 500,
    });
    expect(imageSize("data:image/png;base64," + b.toString("base64"))).toEqual({
      width: 1000,
      height: 500,
    });
  });
  it("reads JPEG and rejects rotated EXIF rather than swapping coordinate axes silently", () => {
    const jpeg = Buffer.from([
      255, 216, 255, 192, 0, 8, 8, 1, 244, 3, 232, 0, 255, 217,
    ]);
    expect(imageSize(jpeg.toString("base64"))).toEqual({
      width: 1000,
      height: 500,
    });
    const exif = Buffer.alloc(36);
    exif.set([255, 225, 0, 34]);
    exif.write("Exif\0\0", 4);
    exif.write("II", 10);
    exif.writeUInt16LE(42, 12);
    exif.writeUInt32LE(8, 14);
    exif.writeUInt16LE(1, 18);
    exif.writeUInt16LE(274, 20);
    exif.writeUInt16LE(3, 22);
    exif.writeUInt32LE(1, 24);
    exif.writeUInt16LE(6, 28);
    expect(
      imageSize(
        Buffer.concat([jpeg.subarray(0, 2), exif, jpeg.subarray(2)]).toString(
          "base64",
        ),
      ),
    ).toBeUndefined();
  });
  it.each(["VP8X", "VP8 ", "VP8L"])("supports normalized %s WebP", (kind) => {
    const b = Buffer.alloc(32);
    b.write("RIFF", 0);
    b.write("WEBP", 8);
    b.write(kind, 12);
    if (kind === "VP8X") {
      b.writeUIntLE(999, 24, 3);
      b.writeUIntLE(499, 27, 3);
    }
    if (kind === "VP8 ") {
      b.set([157, 1, 42], 23);
      b.writeUInt16LE(1000, 26);
      b.writeUInt16LE(500, 28);
    }
    if (kind === "VP8L") {
      b[20] = 47;
      b.writeUInt32LE(999 | (499 << 14), 21);
    }
    expect(imageSize(b.toString("base64"))).toEqual({
      width: 1000,
      height: 500,
    });
  });
  it.each(["AAAA", "", "aW52YWxpZA=="])(
    "leaves invalid images unknown",
    (data) => expect(imageSize(data)).toBeUndefined(),
  );
});
