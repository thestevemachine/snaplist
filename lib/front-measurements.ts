import {MEASUREMENT_PHOTO_PROMPT} from "./measurement-photos";
import {lensReference} from "./lens-reference";
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
  imageSize: z.object({width:z.number().positive(),height:z.number().positive()}).optional(),
  referenceMm: z.number().positive().optional(),
  referenceSource: z.enum(["label", "manual", "measurement"]).optional(),
  referenceQuote: z.string().max(2000).optional(),
  referencePhotos: z.array(z.number().int().min(1).max(24)).max(24).optional(),
  lensWidthPx: z.number().positive().optional(),
  lensHeightPx: z.number().positive().optional(),
  totalWidthPx: z.number().positive().optional(),
  lensHeightMm: z.number().int().positive().optional(),
  totalWidthMm: z.number().int().positive().optional(),
  totalWidthCorrectionMm: z.literal(3).optional(), // Legacy persisted drafts only; never emitted by new calculations.
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
  if(size) result.imageSize = size;
  const ref = lensReference(listing);
  if (!ref) {
    result.reasons.push("Belegte Glasbreite fehlt: Kastenmaß/Scheibenaufdruck prüfen oder Glasbreite manuell eintragen. Keine Millimeterberechnung ohne Referenz.");
    return result;
  }
  const reference=ref.mm;
  result.referenceMm = reference;
  result.referenceSource = ref.source;
  result.referenceQuote = ref.source === "manual" ? "Manuell bestätigte Scheibenbreite" : ref.quote;
  result.referencePhotos = ref.photos ?? [];
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
  // Physical horizontal extent, with no fixed offset.
  result.totalWidthMm = Math.round(total);
  const bridge = listing.eyewear?.fields.bridgeWidth;
  const bridgeMm = Number(
    bridge?.value.replace(/\s*mm$/i, "").replace(",", "."),
  );
  if (
    (bridge?.source === "manual" || (bridge?.source === "label" && bridge.quote && bridge.photos?.length)) &&
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
      "Referenzprüfung: Linkes und rechtes Glas unterscheiden sich im Foto: Perspektive oder Konturen unsicher.",
    );
  // In a claimed frontal view the nasal gap and complete frame share a centre.
  // Do not move contour points to manufacture symmetry: reject automatic projection.
  const nasalCentre=(a.r.x+b.l.x)/2;
  const frameCentre=(left.x+right.x)/2;
  if(o.frontal && Math.abs(nasalCentre-frameCentre)/result.totalWidthPx > 0.02)
    result.reasons.push("Referenzprüfung: Der nasale Glasabstand liegt nicht mittig zur Gesamtbreite. Perspektive, Konturen oder äußere Endpunkte prüfen.");
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

export const BOXING_SYSTEM_DEFINITION = `
BOXING SYSTEM — mandatory measurement definition:
For EACH individual lens opening construct the smallest AXIS-ALIGNED rectangle tangent to the actual glass/groove contour. The glass stops where the frame rim starts; exclude all frame metal/plastic, bridge, nose pads, stickers and logos from the lens opening.
A = maxX - minX of ONE lens opening (temporal to nasal), never one lens plus part of the bridge.
B = maxY - minY of that SAME opening. Find the absolute highest and lowest glass points, not an arbitrary central vertical chord. These two contact points can have different x coordinates. Likewise the leftmost and rightmost contacts can have different y coordinates.
Return the FOUR ACTUAL EXTREME CONTACT POINTS, not the four rectangle corners. Rectangle corners commonly lie outside the curved lens and are NOT contour points.
DBL = minX of the image-right opening minus maxX of the image-left opening: the gap between NASAL glass/boxing boundaries, not the length of the metal bridge or the nose-pad spacing. A printed 54-18 means A=54 mm for each lens and DBL=18 mm.
In a truly frontal symmetric frame the lens widths/heights should agree and the nasal gap should be centred. Use symmetry ONLY as a plausibility test. NEVER shift points, distort the photo or force equal boxes when the visible contours disagree; lower certainty and report perspective/contour ambiguity instead.
TOTAL WIDTH = maxX - minX of the COMPLETE visible glasses: include the outer frame rims, hinges and any visible temples projecting farther sideways. Exclude display stands, background, tags and cases. Measure horizontal projection between vertical support lines, never diagonal distance between tips and never 2*A+DBL as a substitute. Apply NO fixed millimetre offset. Code converts the full horizontal span and rounds to whole millimetres; do not shorten the span or move its endpoints.
`;

export const FRONT_MEASUREMENT_PROMPT = `\nFor eyewear return front_geometry using ONLY ONE existing front photo (not caliper/detail/temple/side photos). A front photo on millimetre paper is allowed, use a clearly readable grid scale only through measurement_photos; otherwise use the inscription reference. No new photos or extra analysis calls. Choose the best existing front view even with moderate perspective, then mark frontal=false and explain the uncertainty. Do NOT return unavailable merely because a photo is not perfectly straight-on or groove edges are partly obscured: return the visible inner lens contour points, groovesVisible=false and lower confidence. photoIndex is its 1-based position among the supplied images, or 0 ONLY if no front view with locatable lens contours exists. Recognize contours ONLY; never calculate or guess mm here. Coordinates x,y are fractions of the entire displayed image width/height (0..1), origin top-left, NEVER a crop. leftLens and rightLens mean the lens on the image's left and right. For each, mark extreme left/right/top/bottom groove-to-groove points of the lens opening, EXCLUDING frame rim (boxing maximum width/height; not arbitrary diagonal chords). outerLeft/outerRight mark absolute outermost COMPLETE glasses including hinges and ALL visible temple parts, not just the front rim. frontal=true only for straight-on view without yaw/pitch or lens foreshortening. groovesVisible only if actual inner grooves can be located; thick rims, glare or blur must reduce confidence. complete only if every outer extremity is visible and uncropped. samePlane only if outer extremities lie effectively in the lens plane; projecting temples/depth make it false. confidence is contour confidence 0..100, not physical measurement accuracy. note is a short German reason for any uncertainty, otherwise empty. If unavailable use photoIndex=0, all points={x:0,y:0}, all booleans=false, confidence=0 and explain briefly. Use both visible lens openings consistently; a too-small lens width inflates BOTH lens height and total width. Exclude the display stand and do not mistake a logo or demo-lens print for the lens contour. Read reference lens width from existing inscription facts only; do not infer reference mm from appearance. This front-photo ratio method replaces requests for caliper or millimetre-paper photos; never request additional measurement photos.` + BOXING_SYSTEM_DEFINITION + MEASUREMENT_PHOTO_PROMPT;

// New analyses only: keep the width in the reviewed description even if the
// sunglasses category provides no width aspect. Existing manual text is not rewritten.
export function withSunglassesWidth(listing: ListingResult): ListingResult {
  const m = listing.frontMeasurement;
  if (!isSunglasses(listing) || m?.status !== "estimated" || !m.totalWidthMm ||
      listing.manual_measurement_fields?.some(k => /gesamtbreite|rahmenbreite|fassungsbreite/i.test(k)) ||
      /gesamtbreite|rahmenbreite|fassungsbreite/i.test(listing.description)) return listing;
  return {...listing,description: `${listing.description.trim()}\nGesamtbreite: ca. ${m.totalWidthMm} mm (aus Frontfoto berechnet)`.trim()};
}

// Reuse saved contours when an inscription/manual scale becomes available later.
export function recalculateStoredMeasurement(listing: ListingResult): FrontMeasurement | undefined {
 const m=listing.frontMeasurement,o=m?.observation;
 if(!m) return;
 if(!lensReference(listing)) return {method:"front-photo-ratio-v1",status:"unavailable",photoIndex:m.photoIndex,reasons:["Belegte Glasbreite fehlt. Glasbreite manuell eintragen oder Aufdruck prüfen."],observation:o,imageSize:m.imageSize} as FrontMeasurement;
 if(!o || !o.photoIndex) return;
 let size=m.imageSize;
 if(!size && m.lensWidthPx && m.lensHeightPx) {
  const w=((o.leftLens.right.x-o.leftLens.left.x)+(o.rightLens.right.x-o.rightLens.left.x))/2;
  const h=((o.leftLens.bottom.y-o.leftLens.top.y)+(o.rightLens.bottom.y-o.rightLens.top.y))/2;
  if(w>0 && h>0) size={width:m.lensWidthPx/w,height:m.lensHeightPx/h};
 }
 if(!size) return;
 const sizes:(ImageSize|undefined)[]=Array(o.photoIndex).fill(undefined);
 sizes[o.photoIndex-1]=size;
 return calculateFrontMeasurement(o,sizes,listing);
}
