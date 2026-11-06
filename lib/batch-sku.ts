import type { ItemGroup } from "./types";
import { skuSchema } from "./validation";
import { workspaceStorageKey } from "./workspace-scope";

const continuationKey = () => workspaceStorageKey("snaplist:last-batch-sku");

export function batchSkuSuggestion(batchId?: string): string {
  try {
    const saved = JSON.parse(window.localStorage.getItem(continuationKey()) ?? "null");
    const value = saved?.batchId === batchId && batchId ? saved?.first : saved?.next;
    return typeof value === "string" && skuSchema.safeParse(value).success ? value : "";
  } catch {
    return "";
  }
}

export function rememberBatchSku(batchId: string, first: string, last: string) {
  const match = last.trim().match(/^(.*?)(\d+)$/);
  if (!match) return;
  const next = match[1] + (BigInt(match[2]) + 1n).toString().padStart(match[2].length, "0");
  if (!skuSchema.safeParse(next).success) return;
  try {
    window.localStorage.setItem(continuationKey(), JSON.stringify({ batchId, first, next }));
  } catch {
    // The current draft still keeps its assigned SKUs if local storage is blocked.
  }
}

export const canNumberSku = (g: ItemGroup) =>
  g.photoIds.length > 0 &&
  g.postStatus !== "posted" &&
  g.postStatus !== "posting" &&
  !g.publicationAttemptSku;

export function planBatchSkus(
  groups: ItemGroup[],
  first: string,
): { id: string; sku: string }[] {
  const value = first.trim();
  if (!skuSchema.safeParse(value).success || !/\d$/.test(value))
    throw new Error(
      "Bitte eine gültige erste SKU mit einer Zahl am Ende eingeben, zum Beispiel 5-23001.",
    );
  const match = value.match(/^(.*?)(\d+)$/)!;
  const rows = groups.filter(canNumberSku);
  if (!rows.length)
    throw new Error("Keine offenen Angebote zum Nummerieren vorhanden.");
  const reserved = new Set(
    groups.filter((g) => !canNumberSku(g)).map((g) => g.sku),
  );
  const start = BigInt(match[2]);
  return rows.map((g, index) => {
    const sku =
      match[1] +
      (start + BigInt(index)).toString().padStart(match[2].length, "0");
    if (!skuSchema.safeParse(sku).success)
      throw new Error(
        "Die fortlaufende SKU ist zu lang. Bitte einen kürzeren Startwert wählen.",
      );
    if (reserved.has(sku))
      throw new Error(
        `Die SKU ${sku} gehört bereits zu einem anderen Artikel in diesem Stapel. Bitte einen anderen Startwert wählen.`,
      );
    return { id: g.id, sku };
  });
}
export function applyBatchSkus(
  groups: ItemGroup[],
  first: string,
): ItemGroup[] {
  const assignments = new Map(
    planBatchSkus(groups, first).map((row) => [row.id, row.sku]),
  );
  return groups.map((g) =>
    assignments.has(g.id)
      ? { ...g, sku: assignments.get(g.id)!, verificationMessage: undefined }
      : g,
  );
}

// Only offer an explicit repair for the historical numeric-prefix generator.
// Never rename drafts automatically or strip arbitrary seller-entered suffixes.
export function originalSellerSku(sku: string): string | undefined {
  return /^(\d+-\d+)-[A-Z]+-[a-f\d]{12}$/i.exec(sku)?.[1];
}
