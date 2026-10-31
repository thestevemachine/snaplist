import type { AspectMeta, CategorySuggestion } from "./taxonomy";
import { categoryMatches } from "../category-selection";
import type { ListingResult } from "../types";

export function sunglassesPair(
  men: CategorySuggestion[],
  women: CategorySuggestion[],
  listing: ListingResult,
) {
  const m = men.find((c) =>
    categoryMatches(c, { ...listing, category: "mens_accessories" }),
  );
  const w = women.find((c) =>
    categoryMatches(c, { ...listing, category: "womens_accessories" }),
  );
  if (!m || !w || m.id === w.id)
    throw new Error(
      "Die beiden eBay.de-Kategorien Sonnenbrillen Herren und Damen konnten nicht eindeutig geladen werden. Bitte erneut vorbereiten.",
    );
  return listing.category_id === w.id ? ([w, m] as const) : ([m, w] as const);
}

// One shared set of specifics must satisfy both categories. Keep the stricter rules.
export function mergeCategoryAspects(
  primary: AspectMeta[],
  secondary: AspectMeta[],
): AspectMeta[] {
  const result = new Map(primary.map((a) => [a.name, a]));
  for (const b of secondary) {
    const a = result.get(b.name);
    if (!a) {
      result.set(b.name, b);
      continue;
    }
    const restrictedA =
        a.mode === "SELECTION_ONLY" ||
        (/farbe|material/i.test(a.name) && a.values.length > 0),
      restrictedB =
        b.mode === "SELECTION_ONLY" ||
        (/farbe|material/i.test(b.name) && b.values.length > 0);
    const values =
      restrictedA && restrictedB
        ? a.values.filter((v) => b.values.includes(v))
        : restrictedA
          ? a.values
          : restrictedB
            ? b.values
            : [...new Set([...a.values, ...b.values])];
    if (
      (restrictedA || restrictedB) &&
      !values.length &&
      (a.required || b.required)
    )
      throw new Error(
        `Die Kategorien erlauben keine gemeinsamen Werte für ${a.name}. Bitte die Kategorieauswahl prüfen.`,
      );
    result.set(b.name, {
      ...a,
      required: a.required || b.required,
      usage:
        a.required || b.required
          ? "REQUIRED"
          : a.usage === "RECOMMENDED" || b.usage === "RECOMMENDED"
            ? "RECOMMENDED"
            : "OPTIONAL",
      mode: restrictedA || restrictedB ? "SELECTION_ONLY" : "FREE_TEXT",
      cardinality:
        a.cardinality === "SINGLE" || b.cardinality === "SINGLE"
          ? "SINGLE"
          : "MULTI",
      maxLength: Math.min(a.maxLength ?? 65, b.maxLength ?? 65),
      values,
      constraints: Object.fromEntries(
        [
          ...new Set([
            ...Object.keys(a.constraints ?? {}),
            ...Object.keys(b.constraints ?? {}),
          ]),
        ].map((v) => [
          v,
          [...(a.constraints?.[v] ?? []), ...(b.constraints?.[v] ?? [])],
        ]),
      ),
      dataType:
        a.dataType && a.dataType !== "STRING"
          ? a.dataType
          : (b.dataType ?? a.dataType),
      format: a.format ?? b.format,
    });
  }
  return [...result.values()];
}
