import { isSunglasses } from "./category-selection";
import { z } from "zod";
import type { ListingResult } from "./types";

const point = z.object({
  x: z.number().finite().min(0).max(1),
  y: z.number().finite().min(0).max(1),
});
const bounds = z.object({
  left: point,
  right: point,
  top: point,
  bottom: point,
});
export const frontObservationSchema = z.object({
  photoIndex: z.number().int().min(0).max(24),
  leftLens: bounds,
  rightLens: bounds,
  outerLeft: point,
  outerRight: point,
  frontal: z.boolean(),
  groovesVisible: z.boolean(),
  complete: z.boolean(),
  samePlane: z.boolean(),
  confidence: z.number().finite().min(0).max(100),
  note: z.string().max(1000),
});
export type FrontObservation = z.infer<typeof frontObservationSchema>;
export const frontMeasurementSchema = z.object({
  method: z.literal("front-photo-ratio-v1"),
  status: z.enum(["estimated", "uncertain", "unavailable"]),
  photoIndex: z.number().int().min(0).max(24),
  referenceMm: z.number().positive().optional(),
  referenceQuote: z.string().max(2000).optional(),
  referencePhotos: z.array(z.number().int().min(1).max(24)).max(24).optional(),
  lensWidthPx: z.number().positive().optional(),
  lensHeightPx: z.number().positive().optional(),
  totalWidthPx: z.number().positive().optional(),
  lensHeightMm: z.number().int().positive().optional(),
  totalWidthMm: z.number().int().positive().optional(),
  totalWidthCorrectionMm: z.literal(3).optional(),
  reasons: z.array(z.string().max(1000)).max(30),
  observation: frontObservationSchema.optional(),
});
export type FrontMeasurement = z.infer<typeof frontMeasurementSchema>;
export type ImageSize = { width: number; height: number };

// Contour recognition shares the existing paid listing call. Only ratios and
// validation run here: no model-generated millimetres or additional API call.
export function calculateFrontMeasurement(
  raw: unknown,
  sizes: (ImageSize | undefined)[],
  listing: ListingResult,
): FrontMeasurement {
  const parsed = frontObservationSchema.safeParse(raw);
  const result: FrontMeasurement = {
    method: "front-photo-ratio-v1",
    status: "unavailable",
    photoIndex: 0,
    reasons: [],
  };
  if (!parsed.success || !parsed.data.photoIndex) {
    result.reasons.push(
      parsed.success
        ? "Kein geeignetes Frontfoto erkannt. Maße bleiben unbekannt."
        : "Konturerkennung fehlt oder enthält ungültige Koordinaten. Bitte ein Frontfoto auswählen und nur die Maße berechnen.",
    );
    if (parsed.success && parsed.data.note.trim())
      result.reasons.push(parsed.data.note.trim());
    return result;
  }
  const o = parsed.data;
  result.photoIndex = o.photoIndex;
  result.observation = o;
  const size = sizes[o.photoIndex - 1];
  const ref = listing.eyewear?.fields.lensWidth;
  const reference = Number(ref?.value.replace(/\s*mm$/i, "").replace(",", "."));
  // Use only the inscription parser's unambiguous label evidence, never size,
  // a guessed model number, shop defaults or a model-supplied reference number.
  if (
    ref?.source !== "label" ||
    !ref.quote ||
    !ref.photos?.length ||
    !/^\d{2}(?:[.,]\d+)?(?:\s*mm)?$/i.test(ref.value) ||
    reference < 20 ||
    reference > 90
  ) {
    result.reasons.push(
      "Scheibenbreite vom Bügel-/Brückenaufdruck fehlt oder ist widersprüchlich.",
    );
    return result;
  }
  result.referenceMm = reference;
  result.referenceQuote = ref.quote;
  result.referencePhotos = ref.photos;
  if (!size || size.width < 300 || size.height < 150) {
    result.reasons.push(
      "Bildgröße oder Bildausrichtung nicht zuverlässig lesbar bzw. Auflösung zu gering.",
    );
    return result;
  }
  const px = (p: { x: number; y: number }) => ({
    x: p.x * size.width,
    y: p.y * size.height,
  });
  const lens = (b: FrontObservation["leftLens"]) => {
    const l = px(b.left),
      r = px(b.right),
      t = px(b.top),
      d = px(b.bottom);
    return { width: r.x - l.x, height: d.y - t.y, l, r, t, d };
  };
  const a = lens(o.leftLens),
    b = lens(o.rightLens);
  const left = px(o.outerLeft),
    right = px(o.outerRight);
  const invalidLens = (v: typeof a) =>
    v.l.x >= v.r.x ||
    v.t.y >= v.d.y ||
    v.width < 60 ||
    v.height < 30 ||
    v.height / v.width < 0.25 ||
    v.height / v.width > 1.5 ||
    v.t.x < v.l.x ||
    v.t.x > v.r.x ||
    v.d.x < v.l.x ||
    v.d.x > v.r.x ||
    v.l.y < v.t.y ||
    v.l.y > v.d.y ||
    v.r.y < v.t.y ||
    v.r.y > v.d.y;
  if (
    invalidLens(a) ||
    invalidLens(b) ||
    a.r.x >= b.l.x ||
    left.x >= a.l.x ||
    right.x <= b.r.x ||
    left.x < 2 ||
    right.x > size.width - 2
  ) {
    result.reasons.push(
      "Konturpunkte sind unvollständig, zu klein, abgeschnitten oder widersprüchlich.",
    );
    return result;
  }
  // Average both lens openings to reduce single-contour scale errors.
  result.lensWidthPx = (a.width + b.width) / 2;
  result.lensHeightPx = (a.height + b.height) / 2;
  result.totalWidthPx = right.x - left.x;
  const height = (reference * result.lensHeightPx) / result.lensWidthPx;
  const total = (reference * result.totalWidthPx) / result.lensWidthPx;
  if (
    !Number.isFinite(height) ||
    height < 10 ||
    height > 100 ||
    total < 60 ||
    total > 250 ||
    total / reference < 2
  ) {
    result.reasons.push(
      "Pixelverhältnisse ergeben keine plausiblen Brillenmaße.",
    );
    return result;
  }
  result.lensHeightMm = Math.round(height);
  // Seller-requested trial correction; this is not a calibrated perspective model.
  result.totalWidthMm = Math.round(total - 3);
  result.totalWidthCorrectionMm = 3;
  const bridge = listing.eyewear?.fields.bridgeWidth;
  const bridgeMm = Number(
    bridge?.value.replace(/\s*mm$/i, "").replace(",", "."),
  );
  if (
    bridge?.source === "label" &&
    bridge.quote &&
    bridge.photos?.length &&
    bridgeMm >= 5 &&
    bridgeMm <= 40
  ) {
    const projectedBridge = (reference * (b.l.x - a.r.x)) / result.lensWidthPx;
    if (Math.abs(projectedBridge - bridgeMm) > Math.max(3, bridgeMm * 0.2)) {
      result.reasons.push(
        "Referenzprüfung: Der Abstand zwischen den Gläsern passt nicht zur aufgedruckten Stegbreite. Konturen oder Perspektive sind unzuverlässig; diese Maße nicht automatisch übernehmen.",
      );
    }
  }
  if (!o.frontal) result.reasons.push("Frontfoto ist perspektivisch verzerrt.");
  if (!o.groovesVisible)
    result.reasons.push(
      "Nut-zu-Nut-Konturen ohne Fassungsrand nicht sicher erkennbar.",
    );
  if (!o.complete)
    result.reasons.push(
      "Äußerste Scharniere oder sichtbare Bügelteile nicht vollständig erkennbar.",
    );
  if (!o.samePlane)
    result.reasons.push(
      "Scharniere/Bügel liegen nicht sicher in derselben Messebene; Gesamtbreite kann verzerrt sein.",
    );
  if (o.confidence < 90)
    result.reasons.push(
      "Konturerkennung unter 90 % Modell-Konfidenz (keine Genauigkeitsgarantie).",
    );
  if (
    Math.abs(a.width - b.width) / Math.max(a.width, b.width) > 0.04 ||
    Math.abs(a.height - b.height) / Math.max(a.height, b.height) > 0.06
  )
    result.reasons.push(
      "Linkes und rechtes Glas unterscheiden sich im Foto: Perspektive oder Konturen unsicher.",
    );
  // Bounding-box dimensions (boxing system), not diagonal point distances.
  if (
    Math.abs(left.y - right.y) / result.totalWidthPx > 0.1 ||
    Math.abs(a.t.y + a.d.y - (b.t.y + b.d.y)) / (a.height + b.height) > 0.06
  )
    result.reasons.push("Ausrichtung der Konturen oder Kamera ist unsicher.");
  if (o.note.trim()) result.reasons.push(o.note.trim());
  result.status = result.reasons.length ? "uncertain" : "estimated";
  return result;
}

export function attachFrontMeasurement(
  listing: ListingResult,
  raw: unknown,
  sizes: (ImageSize | undefined)[],
) {
  const m = calculateFrontMeasurement(raw, sizes, listing);
  listing.frontMeasurement = m;
  // Photo-derived dimensions remain a clearly marked review note. They never
  // silently replace manual/label values or become verified eBay specifics.
  const values =
    m.lensHeightMm && m.totalWidthMm
      ? `Scheibenhöhe: ca. ${m.lensHeightMm} mm; Gesamtbreite: ca. ${m.totalWidthMm} mm`
      : "Scheibenhöhe/Gesamtbreite nicht zuverlässig berechenbar";
  const note = `${values} (Frontfoto ${m.photoIndex || "unbekannt"}, ${m.status === "estimated" ? "Pixelberechnung · Schätzung" : "unsicher"})`;
  listing.measurements = [listing.measurements, note]
    .filter(Boolean)
    .join("\n")
    .slice(0, 500);
}

export const FRONT_MEASUREMENT_PROMPT = `\nFor eyewear return front_geometry using ONLY ONE existing front photo (not caliper/detail/temple/side photos). A front photo on millimetre paper is allowed, but ignore the grid as a scale; use the inscription reference only. No new photos or extra analysis calls. Choose the best existing front view even with moderate perspective, then mark frontal=false and explain the uncertainty. Do NOT return unavailable merely because a photo is not perfectly straight-on or groove edges are partly obscured: return the visible inner lens contour points, groovesVisible=false and lower confidence. photoIndex is its 1-based position among the supplied images, or 0 ONLY if no front view with locatable lens contours exists. Recognize contours ONLY; never calculate or guess mm here. Coordinates x,y are fractions of the entire displayed image width/height (0..1), origin top-left, NEVER a crop. leftLens and rightLens mean the lens on the image's left and right. For each, mark extreme left/right/top/bottom groove-to-groove points of the lens opening, EXCLUDING frame rim (boxing maximum width/height; not arbitrary diagonal chords). outerLeft/outerRight mark absolute outermost COMPLETE glasses including hinges and ALL visible temple parts, not just the front rim. frontal=true only for straight-on view without yaw/pitch or lens foreshortening. groovesVisible only if actual inner grooves can be located; thick rims, glare or blur must reduce confidence. complete only if every outer extremity is visible and uncropped. samePlane only if outer extremities lie effectively in the lens plane; projecting temples/depth make it false. confidence is contour confidence 0..100, not physical measurement accuracy. note is a short German reason for any uncertainty, otherwise empty. If unavailable use photoIndex=0, all points={x:0,y:0}, all booleans=false, confidence=0 and explain briefly. Use both visible lens openings consistently; a too-small lens width inflates BOTH lens height and total width. Exclude the display stand and do not mistake a logo or demo-lens print for the lens contour. Read reference lens width from existing inscription facts only; do not infer reference mm from appearance. This front-photo ratio method replaces requests for caliper or millimetre-paper photos; never request additional measurement photos.`;

// New analyses only: keep the width in the reviewed description even if the
// sunglasses category provides no width aspect. Existing manual text is not rewritten.
export function withSunglassesWidth(listing: ListingResult): ListingResult {
  const m = listing.frontMeasurement;
  if (!isSunglasses(listing) || m?.status !== "estimated" || !m.totalWidthMm ||
      listing.manual_measurement_fields?.some(k => /gesamtbreite|rahmenbreite|fassungsbreite/i.test(k)) ||
      /gesamtbreite|rahmenbreite|fassungsbreite/i.test(listing.description)) return listing;
  return {...listing,description: `${listing.description.trim()}\nGesamtbreite: ca. ${m.totalWidthMm} mm (aus Frontfoto berechnet)`.trim()};
}
