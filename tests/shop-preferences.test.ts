import { afterEach, expect, it, vi } from "vitest";
import { applyShopGroup, applyShopListing, emptyPreferences, readShopPreferences, saveShopPreferences, validPolicyDefaults } from "@/lib/shop-preferences";
import type { ItemGroup } from "@/lib/types";
const options = { fulfillment: [{ id: "s", name: "DHL" }], payment: [{ id: "p", name: "Zahlung" }], returns: [{ id: "r", name: "Rückgabe" }], locations: [{ id: "l", name: "Berlin" }] };
const settings = { ...emptyPreferences(), shipping: { fulfillmentPolicyId: "s", paymentPolicyId: "p", returnPolicyId: "r", locationKey: "l" }, descriptionTemplate: "{{titel}}\n{{beschreibung}}\nStandardtext" };
const group: ItemGroup = { id: "a", sku: "A", photoIds: ["1"], status: "done", listing: { title: "Brille", description: "Individuell", condition: "GOOD", ebay_condition: "USED_EXCELLENT", item_specifics: { EAN: "123" } } };
afterEach(() => vi.unstubAllGlobals());
it("keeps defaults separate for two seller accounts and persistent across reads", () => {
  const store = new Map<string,string>();
  vi.stubGlobal("localStorage", { getItem: (k:string) => store.get(k) ?? null, setItem: (k:string,v:string) => store.set(k,v) });
  saveShopPreferences("seller-a", settings);
  expect(readShopPreferences("seller-a")).toEqual(settings);
  expect(readShopPreferences("seller-b")).toEqual(emptyPreferences());
});
it("applies only verified policy IDs, never guessing a policy", () => {
  expect(validPolicyDefaults(settings, { ...options, fulfillment: [] })).not.toHaveProperty("fulfillmentPolicyId");
});
it("sets seller defaults on the draft, with a nonduplicating editable description", () => {
  const first = applyShopGroup(group, settings, options);
  expect(first.listing).toMatchObject({ condition: "NEW_NO_TAGS", ebay_condition: "NEW_OTHER", item_specifics: { EAN: "Nicht zutreffend" }, description: "Brille\nIndividuell\nStandardtext" });
  expect(applyShopGroup(first, settings, options).listing?.description).toBe(first.listing?.description);
  expect(group.listing?.condition).toBe("GOOD");
});
it("does not modify live or processing listings", () => {
  for (const postStatus of ["posted", "posting"] as const) {
    const g = { ...group, postStatus }; expect(applyShopGroup(g, settings, options)).toBe(g);
  }
});
it("requires manual selection if the category does not accept new-other", () => {
  const g = { ...group, preparation: { conditions: [{ value: "NEW", label: "New" }] } } as ItemGroup;
  expect(applyShopGroup(g, settings, options).listing?.ebay_condition).toBe("");
});
it("rejects descriptions exceeding the listing limit", () => {
  expect(() => applyShopListing({ ...group.listing!, description: "x".repeat(15000) }, settings)).toThrow("zu lang");
});
