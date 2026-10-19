import type { AspectMeta } from "./taxonomy";

export const CATEGORY_FIELDS_VERSION = 1;
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
