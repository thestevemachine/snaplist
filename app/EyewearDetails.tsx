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
    <details className="result-field" open>
      <summary>Erkannte Bügelaufdrucke und Maße</summary>
      <p>
        Maße in mm. Leere Werte sind unbekannt. Hier stehen auch Lesedaten, für
        die eBay kein eigenes Merkmal anbietet. Nur passende eBay-Felder werden
        übertragen.
      </p>
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
