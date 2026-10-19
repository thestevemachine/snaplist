import { z } from "zod";
import type { AccountOptions } from "./ebay/publish";
import type { ListingResult, ItemGroup } from "./types";

export const policyFields = [
  ["fulfillment", "fulfillmentPolicyId", "Versand"],
  ["payment", "paymentPolicyId", "Zahlung"],
  ["returns", "returnPolicyId", "Rückgabe"],
  ["locations", "locationKey", "Artikelstandort"],
] as const;
const schema = z.object({
  version: z.literal(1),
  shipping: z.object({
    fulfillmentPolicyId: z.string().max(100).optional(),
    paymentPolicyId: z.string().max(100).optional(),
    returnPolicyId: z.string().max(100).optional(),
    locationKey: z.string().max(100).optional(),
  }),
  descriptionTemplate: z.string().max(10000),
});
export type ShopPreferences = z.infer<typeof schema>;
export const emptyPreferences = (): ShopPreferences => ({
  version: 1,
  shipping: {},
  descriptionTemplate: "",
});
const storageKey = (account: string) => `snaplist-shop-v1:${account}`;
export function readShopPreferences(account?: string): ShopPreferences {
  if (!account || typeof localStorage === "undefined")
    return emptyPreferences();
  const raw = localStorage.getItem(storageKey(account));
  if (!raw) return emptyPreferences();
  const parsed = schema.safeParse(JSON.parse(raw));
  if (!parsed.success)
    throw new Error(
      "Gespeicherte Vorgaben konnten nicht gelesen werden. Bitte neu speichern.",
    );
  return parsed.data;
}
export function saveShopPreferences(
  account: string,
  settings: ShopPreferences,
) {
  if (!account) throw new Error("Bitte zuerst das eBay-Konto laden.");
  localStorage.setItem(
    storageKey(account),
    JSON.stringify(schema.parse(settings)),
  );
}
export function validPolicyDefaults(
  settings: ShopPreferences,
  options: AccountOptions,
) {
  const shipping: ShopPreferences["shipping"] = {};
  for (const [kind, key] of policyFields) {
    const id = settings.shipping[key];
    if (id && options[kind].some((o) => o.id === id)) shipping[key] = id;
  }
  return shipping;
}
// Only new drafts or explicit batch application use these defaults. Card edits remain authoritative.
export function applyShopListing(
  listing: ListingResult,
  settings: ShopPreferences,
  baseDescription = listing.description,
): ListingResult {
  const description = settings.descriptionTemplate.trim()
    ? settings.descriptionTemplate.replace(
        /\{\{(beschreibung|titel)\}\}/g,
        (_, key) => (key === "titel" ? listing.title : baseDescription),
      )
    : baseDescription;
  if (description.length > 15000)
    throw new Error(
      "Die Beschreibung mit Vorlage ist zu lang (maximal 15.000 Zeichen).",
    );
  return {
    ...listing,
    description,
    condition_notes: "Ungetragen ohne Etui",
    condition: "NEW_NO_TAGS",
    ebay_condition: "NEW_OTHER",
    item_specifics: { ...listing.item_specifics, EAN: "Nicht zutreffend" },
  };
}
export function applyShopGroup(
  group: ItemGroup,
  settings: ShopPreferences,
  options: AccountOptions,
): ItemGroup {
  if (
    !group.listing ||
    group.status === "writing" ||
    group.postStatus === "posted" ||
    group.postStatus === "posting"
  )
    return group;
  const base = group.shopBaseDescription ?? group.listing.description;
  const listing = applyShopListing(
    group.listing,
    settings,
    settings.descriptionTemplate.trim() ? base : group.listing.description,
  );
  // Do not choose a different condition when the category does not support the default.
  if (
    group.preparation &&
    !group.preparation.conditions.some(
      (c) => c.value === listing.ebay_condition,
    )
  )
    listing.ebay_condition = "";
  return {
    ...group,
    listing,
    shopBaseDescription: base,
    shipping: { ...group.shipping, ...validPolicyDefaults(settings, options) },
    verificationMessage: undefined,
  };
}
