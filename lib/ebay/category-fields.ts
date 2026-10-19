import type { AspectMeta } from "./taxonomy";

export const CATEGORY_FIELDS_VERSION = 3;
// EAN is also a Trading ProductListingDetails field, even if not listed by Taxonomy.
export function categorySpecifics<T>(
  specifics: Record<string, T>,
  meta: AspectMeta[],
): Record<string, T> {
  const allowed = new Set([...meta.map((a) => a.name), "EAN"]);
  return Object.fromEntries(
    Object.entries(specifics).filter(([name]) => allowed.has(name)),
  );
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
  if (/^(lindberg|ic!?[ .]*berlin)$/i.test(brand.trim()))
    set(/^Vintage$/i, "Nein", false);
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
          /^(Form|Brillenform|Rahmenform|Fassungsform)$/i.test(key),
        )
        .flatMap(([, v]) => v);
      const match = style.values.find(
        (v) =>
          shapes.some((s) => s.toLowerCase() === v.toLowerCase()) &&
          !/flieger|aviator|clubmaster|klappmaster/i.test(v),
      );
      const fallback = style.values.find((v) => /^vollrand$/i.test(v));
      aspects[style.name] = match ? [match] : fallback ? [fallback] : [];
    }
  }
}
