import type { ListingResult } from "./types";

type KindInput = Pick<ListingResult, "title" | "item_type" | "category_hint" | "eyewear_kind">;

export function isEyewearCase(listing: KindInput): boolean {
  const type = listing.item_type?.trim() ?? "";
  return /brillenetuis?|brillenfutteral|(?:eyeglass|spectacle|sunglasses?)\s+cases?/i.test(
    [listing.title, type, listing.category_hint].join(" "),
  ) || /^(?:etui|etuis|brillenetui)$/i.test(type) || /^etuis?\b/i.test(listing.title.trim());
}

export function usesEyewearDefaults(listing: KindInput): boolean {
  if (isEyewearCase(listing)) return true;
  if (listing.eyewear_kind === "not_eyewear") return false;
  return Boolean(listing.eyewear_kind) ||
    /\b(?:brillen?|brillenfassungen?|sonnenbrillen?|sunglasses|eyeglasses|spectacles)\b/i.test(
      [listing.title, listing.item_type, listing.category_hint].join(" "),
    );
}

export const GENERAL_LISTING_PROMPT = `
MODE SELECTION: Determine the actual item from these photos. Eyeglass frames, sunglasses and eyeglass cases keep the eyewear seller defaults. Every other item uses the general resale workflow. This rule overrides eyewear-specific instructions for non-eyewear.
For other items use eyewear_kind=not_eyewear. Default condition to GOOD (Gebraucht), except clearly supported defective/parts-only status. Describe only clearly visible wear or seller-supplied defects. Do not invent tested functionality, completeness, absence of defects, authenticity, provenance, age, rare status or material.
Write all buyer-facing text and category/aspect names in German. Choose the best matching item profile, category hint and useful item specifics automatically. Make reasonable visual classifications such as shape or style when useful and report their confidence as estimate facts. Keep uncertain identifiers, materials, dates and measurements empty unless there is evidence. Never present guesses as label facts.
For ordinary items generate a concise factual description with an opening product summary, followed by clearly separated Zustand und Mängel, Maße and Lieferumfang when supported. Identify included items only from seller input or unambiguous photos. Keep unknown testing status in seller-review notes. Do not mention eyewear or use Ungetragen ohne Etui. Do not add a story at this stage. The optional storytelling editor handles that separately.
`;
