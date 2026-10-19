import type { ListingResult } from "./types";
import type { AspectMeta } from "./ebay/taxonomy";

// Deterministic projection into the actual category. Empty means missing;
// explicit blanks are seller removals and must remain blank after reload.
export function frontMeasurementFields(
  listing: ListingResult,
  meta: AspectMeta[],
): Partial<ListingResult> | undefined {
  const m = listing.frontMeasurement;
  if (!m || m.status === "unavailable") return;
  const specifics = { ...listing.item_specifics };
  const estimates = { ...listing.estimates };
  const evidence = { ...listing.evidence };
  let changed = false;
  for (const [pattern, value] of [
    [
      /^(Scheibenhöhe|Glashöhe|Gläserhöhe|Lens Height)(?:\s*\(mm\))?$/i,
      m.lensHeightMm,
    ],
    [
      /^(Gesamtbreite|Fassungsbreite|Rahmenbreite|Frame Width|Total Frame Width)(?:\s*\(mm\))?$/i,
      m.totalWidthMm,
    ],
  ] as const) {
    if (!value || !Number.isInteger(value) || value <= 0) continue;
    // Preserve prior measurements under aliases too, including explicit clears.
    if (
      Object.entries(specifics).some(([k, v]) => pattern.test(k) && v.trim()) ||
      listing.manual_measurement_fields?.some((k) => pattern.test(k))
    )
      continue;
    const field = meta.find((f) => pattern.test(f.name));
    if (!field) continue;
    const choice = field.values.find(
      (v) =>
        /^\d+(?:\s*mm)?$/i.test(v) &&
        Number(v.replace(/\s*mm$/i, "")) === value,
    );
    if (!choice && (field.mode !== "FREE_TEXT" || field.values.length))
      continue;
    specifics[field.name] =
      choice ?? (field.dataType === "NUMBER" ? String(value) : `${value} mm`);
    estimates[field.name] = Math.min(
      m.observation?.confidence ?? 60,
      m.status === "uncertain" ? 59 : 99,
    );
    evidence[field.name] = [
      ...new Set([m.photoIndex, ...(m.referencePhotos ?? [])]),
    ].filter((n) => n > 0);
    changed = true;
  }
  return changed
    ? { item_specifics: specifics, estimates, evidence }
    : undefined;
}
