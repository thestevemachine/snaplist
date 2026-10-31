import {photoMeasurement} from "./measurement-photos";
import {measurementChoice} from "./measurement-choice";
import {lensReference} from "./lens-reference";
import type { ListingResult } from "./types";
import type { AspectMeta } from "./ebay/taxonomy";

// Deterministic projection into the actual category. Empty means missing;
// explicit blanks are seller removals and must remain blank after reload.
export function frontMeasurementFields(
  listing: ListingResult,
  meta: AspectMeta[],
): Partial<ListingResult> | undefined {
  const m = listing.frontMeasurement;
  const useFront=Boolean(lensReference(listing) && m && m.status!=="unavailable" && !m.reasons.some(reason=>reason.startsWith("Referenzprüfung:")));
  if(!useFront && !["lensWidth","lensHeight","totalWidth","bridgeWidth","templeLength"].some(d=>photoMeasurement(listing,d as import("./measurement-photos").MeasurementDimension))) return;
  const specifics = { ...listing.item_specifics };
  const estimates = { ...listing.estimates };
  const evidence = { ...listing.evidence };
  let changed = false;
  for (const [pattern, value] of [
    [
      /^(Scheibenhöhe|Glashöhe|Gläserhöhe|Lens Height)(?:\s*\(mm\))?$/i,
      photoMeasurement(listing,"lensHeight")?.mm ?? (useFront ? m?.lensHeightMm : undefined),
    ],
    [
      /^(Gesamtbreite|Fassungsbreite|Rahmenbreite|Frame Width|Total Frame Width)(?:\s*\(mm\))?$/i,
      photoMeasurement(listing,"totalWidth")?.mm ?? (useFront ? m?.totalWidthMm : undefined),
    ],
    [/^(Glasbreite|Scheibenbreite|Gläserbreite|Lens Width)(?:\s*\(mm\))?$/i,photoMeasurement(listing,"lensWidth")?.mm],
    [/^(Stegbreite|Brückenbreite|Bridge Width)(?:\s*\(mm\))?$/i,photoMeasurement(listing,"bridgeWidth")?.mm ?? (useFront ? m?.bridgeWidthMm : undefined)],
    [/^(Bügellänge|Temple Length)(?:\s*\(mm\))?$/i,photoMeasurement(listing,"templeLength")?.mm],
  ] as const) {
    if (!value || !Number.isInteger(value) || value <= 0) continue;
    // An alias is not the actual category field: populate the latter too.
    // An explicit seller clear is preserved across aliases.
    if (listing.manual_measurement_fields?.some((k) => pattern.test(k)))
      continue;
    const field = meta.find((f) => pattern.test(f.name));
    if (!field || specifics[field.name]?.trim()) continue;
    const measured=photoMeasurement(listing,/höhe|height/i.test(field.name)?"lensHeight":/rahmen|fassung|gesamt|frame/i.test(field.name)?"totalWidth":/steg|brück|bridge/i.test(field.name)?"bridgeWidth":/bügel|temple/i.test(field.name)?"templeLength":"lensWidth");
    const existing = Object.entries(specifics).find(
      ([k, v]) => pattern.test(k) && v.trim(),
    );
    const projected = existing
      ? Number(existing[1].replace(/\s*mm$/i, "").replace(",", "."))
      : value;
    if (!Number.isFinite(projected) || projected <= 0) continue;
    const choice=measurementChoice(field.values,projected);
    if (!choice && field.mode !== "FREE_TEXT") continue;
    specifics[field.name] =
      choice ??
      (field.dataType === "NUMBER" ? String(projected) : `${projected} mm`);
    estimates[field.name] = Math.min(
      measured?.evidence.confidence ?? m?.observation?.confidence ?? 60,
      measured ? 99 : m?.status === "uncertain" ? 59 : 99,
    );
    evidence[field.name] = [
      ...new Set([...(measured ? [measured.evidence.photoIndex] : [m?.photoIndex ?? 0,...(m?.referencePhotos ?? [])])]),
    ].filter((n) => n > 0);
    changed = true;
  }
  return changed
    ? { item_specifics: specifics, estimates, evidence }
    : undefined;
}
