import type { ListingResult, ItemGroup } from "./types";
export const FIXED_CONDITION_NOTES = "Ungetragen ohne Etui";
// Seller's word blacklist, independent of any legal assessment.
const forbidden =
  /\b(?:aviator[\p{L}-]*|flieger[\p{L}-]*|clubmaster[\p{L}-]*|klappmaster[\p{L}-]*)\b/giu;
export function cleanListingText(text: string) {
  return text
    .replace(forbidden, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
export function contentIssues(l: ListingResult) {
  const texts = [
    l.title,
    l.description,
    l.condition_notes,
    ...Object.values(l.item_specifics ?? {}),
    ...(l.search_terms ?? []),
    ...(l.seo_keywords ?? []),
    ...(l.key_features ?? []),
  ];
  const issues = texts.some(
    (t) => t && cleanListingText(t) !== t.trim().replace(/[ \t]{2,}/g, " "),
  )
    ? [
        "Gesperrter Begriff im Angebot: Flieger/Aviator/Clubmaster oder eine Variante. Bitte entfernen.",
      ]
    : [];
  if (l.eyewear_kind === "uncertain")
    issues.push(
      "Brillenart unklar. Bitte Korrektionsfassung oder Sonnenbrille auswählen.",
    );
  return issues;
}
export function applyContentRules(
  l: ListingResult,
  resetCondition = true,
): ListingResult {
  return {
    ...l,
    content_rules_version: 3,
    title: cleanListingText(l.title),
    description: cleanListingText(l.description),
    condition_notes: resetCondition
      ? FIXED_CONDITION_NOTES
      : (l.condition_notes ?? FIXED_CONDITION_NOTES),
    item_specifics: Object.fromEntries(
      Object.entries(l.item_specifics ?? {}).map(([k, v]) => [
        k,
        cleanListingText(v),
      ]),
    ),
    search_terms: l.search_terms?.map(cleanListingText),
    seo_keywords: l.seo_keywords?.map(cleanListingText),
    key_features: l.key_features?.map(cleanListingText),
  };
}
export function migrateContentGroup(g: ItemGroup): ItemGroup {
  if (
    !g.listing ||
    g.status !== "done" ||
    g.postStatus === "posted" ||
    g.postStatus === "posting" ||
    g.listing.content_rules_version === 3
  )
    return g;
  const l = g.listing;
  if (
    !l.eyewear &&
    !/brille|eyeglass|sunglass/i.test(
      [l.title, l.item_type, l.category_hint].join(" "),
    )
  )
    return g;
  return {
    ...g,
    listing: applyContentRules(l),
    verificationMessage: undefined,
  };
}
export function changeEyewearKind(
  l: ListingResult,
  kind: "optical" | "sunglasses" | "uncertain",
): ListingResult {
  const noun = kind === "sunglasses" ? "Sonnenbrille" : "Brille";
  return {
    ...l,
    eyewear_kind: kind,
    item_type: noun,
    category_hint: kind === "sunglasses" ? "Sonnenbrillen" : "Brillenfassungen",
    category: "",
    category_id: "",
    secondary_category_id: undefined,
    title: l.title.replace(
      /\b(?:sonnenbrillen?|sunglasses|eyeglasses|brillen?)\b/gi,
      noun,
    ),
    classification_note: "Vom Verkäufer ausgewählt.",
  };
}
export const CLASSIFICATION_PROMPT = `\nClassify eyewear independently of style/brand/title: eyewear_kind optical for prescription frames or clear/demo lenses; sunglasses only with positive evidence of sun-protection lenses, not merely dark reflections, lighting, round shape or frame style. Tinted prescription/photochromic lenses alone do not establish sunglasses. If ambiguous, use uncertain and explain in German classification_note; never force a sunglasses category. Non-eyewear: not_eyewear. Pilot and Pilotenbrille are explicitly allowed. Do not use Flieger, Fliegerbrille, Aviator or variants anywhere in generated listing text or specifics: these are the seller's forbidden words. Never translate Pilot into Aviator; keep Pilot in German. Do not assess condition from photographs. condition_notes defaults to Ungetragen ohne Etui. Exception: if an optical frame clearly has NO demo lenses fitted, report a visible_feature specific Demoscheiben with value Nicht vorhanden, photoIndices and confidence; do not confuse transparent lenses with absent lenses. Do not describe scratches, wear, cleanliness or condition inferred from images in the description, specifics, features or notes. The seller supplies condition information. Keep unclear inscriptions in separate review notes.`;

export function descriptionWithCondition(
  description: string,
  notes: string | undefined,
): string {
  const condition = (notes ?? FIXED_CONDITION_NOTES).trim();
  if (!condition) return description;
  const body = description.trimStart();
  if (body === condition || body.startsWith(condition + "\n")) return body;
  return condition + "\n\n" + body;
}
