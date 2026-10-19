"use client";
import {
  eyewearLabels,
  eyewearWarnings,
  mapEyewear,
  type EyewearKey,
} from "@/lib/eyewear-inscriptions";
import { germanGlassesTitle } from "@/lib/glasses-rules";
import type { ListingResult } from "@/lib/types";

export function EyewearDetails({
  listing,
  meta,
  onEdit,
}: {
  listing: ListingResult;
  meta: import("@/lib/ebay/taxonomy").AspectMeta[];
  onEdit: (patch: Partial<ListingResult>) => void;
}) {
  if (!listing.eyewear) return null;
  const warnings = eyewearWarnings(listing);
  return (
    <details className="result-field">
      <summary>Erkannte Bügelaufdrucke und Maße</summary>
      <p>
        Maße in mm. Leere Werte sind unbekannt. Hier stehen auch Lesedaten, für
        die eBay kein eigenes Merkmal anbietet. Nur passende eBay-Felder werden
        übertragen.
      </p>
      {listing.frontMeasurement && (
        <section aria-label="Pixelmaße aus Frontfoto">
          <strong>
            Maße aus Frontfoto ·{" "}
            {listing.frontMeasurement.status === "estimated"
              ? "Schätzung"
              : "unsicher / nicht verfügbar"}
          </strong>
          <p>
            Frontfoto {listing.frontMeasurement.photoIndex || "nicht erkannt"}.
            Scheibenhöhe und Gesamtbreite sind aus Pixelverhältnissen berechnet
            und keine geprüften Messwerte. Sie werden nicht automatisch in
            eBay-Merkmale übernommen.
          </p>
          {listing.frontMeasurement.referenceMm && (
            <p>
              Referenz: Scheibenbreite {listing.frontMeasurement.referenceMm} mm
              · Aufdruck: {listing.frontMeasurement.referenceQuote} · Foto{" "}
              {listing.frontMeasurement.referencePhotos?.join(", ")}
            </p>
          )}
          {listing.frontMeasurement.lensWidthPx && (
            <p>
              Pixel: Scheibenbreite{" "}
              {listing.frontMeasurement.lensWidthPx.toFixed(1)}, Scheibenhöhe{" "}
              {listing.frontMeasurement.lensHeightPx?.toFixed(1)}, Gesamtbreite{" "}
              {listing.frontMeasurement.totalWidthPx?.toFixed(1)}. Umrechnung:
              Pixelmaß × Referenz-mm ÷ Scheibenbreite-Pixel.
            </p>
          )}
          {listing.frontMeasurement.lensHeightMm && (
            <p>
              Scheibenhöhe: ca. {listing.frontMeasurement.lensHeightMm} mm ·
              Gesamtbreite: ca. {listing.frontMeasurement.totalWidthMm} mm
            </p>
          )}
          {!!listing.frontMeasurement.reasons.length && (
            <ul>
              {listing.frontMeasurement.reasons.map((reason, i) => (
                <li key={i}>{reason}</li>
              ))}
            </ul>
          )}
          <small>
            Nut zu Nut ohne Fassungsrand; Gesamtbreite einschließlich
            Scharnieren und sichtbaren Bügelteilen. Änderungen am
            Referenzaufdruck nach der Analyse ändern diese gespeicherte
            Berechnung nicht.
          </small>
        </section>
      )}
      {listing.measurements && (
        <label style={{ display: "block" }}>
          Geschätzte Maße – bitte prüfen
          <textarea
            aria-label="Geschätzte Maße"
            value={listing.measurements}
            onChange={(e) => onEdit({ measurements: e.target.value })}
          />
          <small>
            Die Notiz bleibt erhalten, auch wenn eBay kein passendes Merkmal
            anbietet. Änderungen hier ändern die eBay-Merkmale nicht.
          </small>
        </label>
      )}
      {Object.entries(eyewearLabels).map(([rawKey, label]) => {
        const key = rawKey as EyewearKey;
        const field = listing.eyewear!.fields[key];
        return (
          <label key={key} style={{ display: "block", marginBottom: "0.5rem" }}>
            {label}
            {[
              "lensWidth",
              "bridgeWidth",
              "templeLength",
              "totalWidth",
            ].includes(key) && " (mm)"}
            <input
              value={field?.value ?? ""}
              maxLength={500}
              onChange={(e) => {
                const next: ListingResult = {
                  ...listing,
                  eyewear: {
                    ...listing.eyewear!,
                    fields: {
                      ...listing.eyewear!.fields,
                      [key]: { value: e.target.value, source: "manual" },
                    },
                  },
                };
                const aspects = Object.fromEntries(
                  Object.entries(listing.item_specifics ?? {}).map(
                    ([name, value]) => [
                      name,
                      value.split(" | ").filter(Boolean),
                    ],
                  ),
                );
                mapEyewear(next, aspects, meta, key);
                next.item_specifics = Object.fromEntries(
                  Object.entries(aspects).map(([name, values]) => [
                    name,
                    values.join(" | "),
                  ]),
                );
                if (key === "brand") next.brand = e.target.value;
                if (key === "material") next.material = e.target.value;
                onEdit({
                  eyewear: next.eyewear,
                  item_specifics: next.item_specifics,
                  ...(key === "brand" ? { brand: next.brand } : {}),
                  ...(key === "material" ? { material: next.material } : {}),
                  estimates: Object.fromEntries(
                    Object.entries(listing.estimates ?? {}).filter(
                      ([name]) =>
                        next.item_specifics?.[name] ===
                        listing.item_specifics?.[name],
                    ),
                  ),
                  evidence: Object.fromEntries(
                    Object.entries(listing.evidence ?? {}).filter(
                      ([name]) =>
                        next.item_specifics?.[name] ===
                        listing.item_specifics?.[name],
                    ),
                  ),
                });
              }}
            />
            {field?.source === "shop" && (
              <small>
                Shop-Vorgabe für Lindberg – bitte bestätigen oder korrigieren.
              </small>
            )}
            {field?.source === "label" && (
              <small>
                Aufdruck: {field.quote} · Foto {field.photos?.join(", ")}
              </small>
            )}
          </label>
        );
      })}
      {warnings.length > 0 && (
        <ul>
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      {!!listing.eyewear.warnings.length && (
        <button
          type="button"
          onClick={() =>
            onEdit({ eyewear: { ...listing.eyewear!, warnings: [] } })
          }
        >
          Aufdruck-Hinweise geprüft
        </button>
      )}
      <p>
        Manuelle Titel bleiben erhalten. Nach Korrekturen kannst du den Titel
        ausdrücklich neu bilden.
      </p>
      <button
        type="button"
        disabled={!meta.length}
        onClick={() => onEdit({ title: germanGlassesTitle(listing, meta) })}
      >
        Titel aus geprüften Angaben neu bilden
      </button>
    </details>
  );
}
