// The database's legacy unique-SKU column is a storage key, not the seller label.
// Keep blank or exact seller SKUs in metadata until listing review is complete.
export function storeCloudDraft<T extends { id: string; sku: string }>(
  draft: T,
) {
  return { ...draft, sku: `draft:${draft.id}`, sellerSku: draft.sku };
}
export function restoreCloudDraft<
  T extends { sku: string; sellerSku?: string },
>(draft: T) {
  return {
    ...draft,
    sku: typeof draft.sellerSku === "string" ? draft.sellerSku : draft.sku,
  };
}
