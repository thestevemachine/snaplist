import type { AspectMeta } from "./taxonomy";

export const CATEGORY_FIELDS_VERSION = 2;
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
