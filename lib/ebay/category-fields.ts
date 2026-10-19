import type { AspectMeta } from "./taxonomy";

export const isMeasurementAspect = (name: string) =>
  /^(?:Rahmenbreite|Fassungsbreite|Gesamtbreite|Glasbreite|Gläserbreite|Glasdurchmesser|Glashöhe|Scheibenhöhe|Stegbreite|Brückenbreite|Bügellänge|Frame Width|Lens Width|Lens Height|Bridge Width|Temple Length)(?:\s*\(mm\))?$/i.test(
    name,
  );
export const formatMeasurement = (name: string, value: string) =>
  isMeasurementAspect(name) && /^\d+(?:[.,]\d+)?$/.test(value.trim())
    ? `${value.trim()} mm`
    : value;

export const CATEGORY_FIELDS_VERSION = 4;
// EAN is also a Trading ProductListingDetails field, even if not listed by Taxonomy.
export function categorySpecifics<T>(
  specifics: Record<string, T>,
  meta: AspectMeta[],
): Record<string, T> {
  const allowed = new Set([...meta.map((a) => a.name), "EAN"]);
  return Object.fromEntries(
    Object.entries(specifics)
      .filter(([name]) => allowed.has(name))
      .map(([name, value]) => {
        const field = meta.find((m) => m.name === name);
        // Preserve eBay's exact dropdown values. Only free-text dimensions gain units.
        if (field?.mode !== "FREE_TEXT" || !isMeasurementAspect(name))
          return [name, value];
        const format = (v: string) =>
          field.values.includes(v) ? v : formatMeasurement(name, v);
        return [
          name,
          typeof value === "string"
            ? format(value)
            : Array.isArray(value)
              ? value.map((v) => (typeof v === "string" ? format(v) : v))
              : value,
        ];
      }),
  ) as Record<string, T>;
}
export function applySunglassesLensDefault(
  aspects: Record<string, string[]>,
  meta: AspectMeta[],
) {
  const lens = meta.find((a) =>
    /^(gläsermaterial|glasmaterial|linsenmaterial)$/i.test(a.name),
  );
  if (!lens || aspects[lens.name]?.length) return;
  const plastic = lens.values.find((v) => /^kunststoff$/i.test(v));
  if (plastic) {
    aspects[lens.name] = [plastic];
    return lens.name;
  }
}

// Seller-requested fallback, only when no material is known; category cardinality wins.
export function applyFrameMaterialDefault(
  aspects: Record<string, string[]>,
  meta: AspectMeta[],
) {
  const field = meta.find((a) =>
    /^(rahmenmaterial|fassungsmaterial|material)$/i.test(a.name),
  );
  if (!field || aspects[field.name]?.length || field.cardinality !== "MULTI")
    return;
  const values = ["Kunststoff", "Acetat", "Metall"].flatMap((w) =>
    field.values.filter((v) => v.toLowerCase() === w.toLowerCase()),
  );
  if (values.length) aspects[field.name] = values;
}

export function applyEyewearSellerDefaults(
  aspects: Record<string, string[]>,
  meta: AspectMeta[],
  sunglasses: boolean,
  brand: string,
) {
  const set = (pattern: RegExp, desired: string, fallbackOnly = true) => {
    const m = meta.find((a) => pattern.test(a.name));
    if (!m || (fallbackOnly && aspects[m.name]?.length)) return;
    const value = m.values.find(
      (v) => v.toLowerCase() === desired.toLowerCase(),
    );
    if (value) aspects[m.name] = [value];
  };
  set(/^Vintage$/i, "Nein");
  set(/^Abteilung$/i, "Unisex Erwachsene");
  set(/^Produktart$/i, sunglasses ? "Sonnenbrille" : "Brille", false);
  if (sunglasses) {
    set(/^UV[- ]?Schutz$/i, "UV400");
    const lens = meta.find((a) =>
      /^(Gläsertechnologie|Glastechnologie|Linsentechnologie)$/i.test(a.name),
    );
    if (lens) {
      const tinted = lens.values.find((v) => /^getönt$/i.test(v));
      const values = aspects[lens.name] ?? [];
      if (
        tinted &&
        (!values.length ||
          (lens.cardinality === "MULTI" &&
            values.some((v) => /verlauf/i.test(v))))
      )
        aspects[lens.name] = [...new Set([...values, tinted])];
    }
  }
  const style = meta.find((a) => /^Stil$/i.test(a.name));
  if (style) {
    const existing = (aspects[style.name] ?? []).filter(
      (v) =>
        style.values.includes(v) &&
        !/flieger|aviator|clubmaster|klappmaster/i.test(v),
    );
    if (existing.length) aspects[style.name] = existing;
    else {
      const shapes = Object.entries(aspects)
        .filter(([key]) =>
          /^(Form|Brillenform|Rahmenform|Fassungsform|Besonderheiten|Rahmentyp)$/i.test(
            key,
          ),
        )
        .flatMap(([, v]) => v);
      const match = style.values.find(
        (v) =>
          shapes.some((s) => s.toLowerCase() === v.toLowerCase()) &&
          !/flieger|aviator|clubmaster|klappmaster/i.test(v),
      );
      const fallback = shapes.some((v) =>
        /randlos|halbrand|halbrahmen|nylon/i.test(v),
      )
        ? undefined
        : style.values.find((v) => /^vollrand$/i.test(v));
      aspects[style.name] = match ? [match] : fallback ? [fallback] : [];
    }
  }
}

export function expandEyewearFeatures(
  aspects: Record<string, string[]>,
  meta: AspectMeta[],
) {
  const field = meta.find((m) => /^Besonderheiten$/i.test(m.name));
  if (!field) return;
  const physical = Object.entries(aspects)
    .filter(([k]) =>
      /^(Besonderheiten|Stil|Form|Brillenform|Rahmenform|Fassungsart|Rahmentyp)$/i.test(
        k,
      ),
    )
    .flatMap(([, v]) => v)
    .join(" ");
  const candidates: string[] = [];
  if (/randlos/i.test(physical)) candidates.push("Randlos");
  else if (/halbrand|halbrahmen|nylon/i.test(physical))
    candidates.push("Halbrand", "Halbrahmen");
  else if (/vollrand/i.test(physical)) candidates.push("Vollrand");
  if (/rechteckig|rectangular/i.test(physical))
    candidates.push("Rechteckig", "Eckig");
  else if (/quadratisch|eckig|square/i.test(physical))
    candidates.push("Eckig", "Quadratisch");
  if (/rund|round|panto/i.test(physical)) candidates.push("Rund");
  const current = aspects[field.name] ?? [];
  const valid = candidates.flatMap((c) =>
    field.values.filter((v) => v.toLowerCase() === c.toLowerCase()),
  );
  const combined = [...new Set([...current, ...valid])];
  aspects[field.name] = combined.slice(
    0,
    field.cardinality === "MULTI" ? 5 : 1,
  );
}

// Match photo-derived size aliases to the actual category fields, never create new fields.
export function mapGridMeasurements(
  specifics: Record<string, string>,
  aspects: Record<string, string[]>,
  meta: AspectMeta[],
) {
  for (const aliases of [
    /^(Scheibenhöhe|Glashöhe|Gläserhöhe)$/i,
    /^(Gesamtbreite|Fassungsbreite|Rahmenbreite)$/i,
  ]) {
    const source = Object.entries(specifics).find(
      ([name, value]) =>
        aliases.test(name) && /^\d+(?:[.,]\d+)?(?:\s*mm)?$/i.test(value.trim()),
    );
    if (!source) continue;
    const measured = Math.floor(
      Number(source[1].replace(/\s*mm$/i, "").replace(",", ".")),
    );
    for (const field of meta.filter((m) => aliases.test(m.name))) {
      if (aspects[field.name]?.length) continue;
      const choices = field.values
        .map((value) => ({
          value,
          mm: /^\d+(?:[.,]\d+)?(?:\s*mm)?$/i.test(value.trim())
            ? Number(value.replace(/\s*mm$/i, "").replace(",", "."))
            : NaN,
        }))
        .filter((v) => v.mm <= measured && measured - v.mm <= 1)
        .sort((a, b) => b.mm - a.mm);
      if (choices.length) aspects[field.name] = [choices[0].value];
      else if (!field.values.length && field.mode === "FREE_TEXT")
        aspects[field.name] = [String(measured)];
    }
  }
}
