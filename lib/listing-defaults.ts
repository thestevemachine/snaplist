import { usesEyewearDefaults } from "./listing-mode";
import type { ListingResult } from "./types";
import type { AspectMeta } from "./ebay/taxonomy";

// Seller-requested defaults, not facts inferred from the photos. Apply only
// to empty fields while preparing the draft, never during publication.
export function applyListingDefaults(
  listing: ListingResult,
  meta: AspectMeta[],
  acceptedIds: Set<number>,
): void {
  const sizeType = meta.find((a) => a.name === "Size Type");
  if (
    !listing.item_specifics?.["Size Type"]?.trim() &&
    sizeType &&
    (sizeType.mode === "FREE_TEXT" || sizeType.values.includes("Regular"))
  ) {
    listing.item_specifics = {
      ...listing.item_specifics,
      "Size Type": "Regular",
    };
    if (listing.evidence) {
      listing.evidence = { ...listing.evidence };
      delete listing.evidence["Size Type"];
    }
    if (listing.estimates) {
      listing.estimates = { ...listing.estimates };
      delete listing.estimates["Size Type"];
    }
  }
  if (!usesEyewearDefaults(listing) && !listing.ebay_condition) {
    const used = [
      [3000, "USED_EXCELLENT"],
      [5000, "USED_GOOD"],
      [3010, "PRE_OWNED_FAIR"],
      [6000, "USED_ACCEPTABLE"],
      [4000, "USED_VERY_GOOD"],
      [2990, "PRE_OWNED_EXCELLENT"],
    ] as const;
    const selected = used.find(([id]) => acceptedIds.has(id));
    if (listing.condition === "FOR_PARTS_OR_NOT_WORKING" && acceptedIds.has(7000)) {
      listing.ebay_condition = "FOR_PARTS_OR_NOT_WORKING";
    } else if (selected) {
      listing.ebay_condition = selected[1];
    }
    return;
  }
  // 2990 is Pre-owned Excellent. 3000 must not be used as a substitute:
  // in these clothing categories it means Pre-owned Good.
  if (!listing.ebay_condition && acceptedIds.has(2990)) {
    listing.ebay_condition = "PRE_OWNED_EXCELLENT";
    listing.condition = "EXCELLENT";
  }
}
