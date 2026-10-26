import { expect, it } from "vitest";
import { storeCloudDraft, restoreCloudDraft } from "@/lib/cloud/draft-sku";
it("stores multiple unnumbered drafts without violating the legacy SQL unique key", () => {
  const rows = [
    storeCloudDraft({ id: "one", sku: "" }),
    storeCloudDraft({ id: "two", sku: "" }),
  ];
  expect(new Set(rows.map((g) => g.sku)).size).toBe(2);
  expect(rows.map((g) => restoreCloudDraft(g).sku)).toEqual(["", ""]);
});
it("restores exact seller SKUs and legacy cloud drafts without changing labels", () => {
  expect(
    restoreCloudDraft(storeCloudDraft({ id: "one", sku: "65-23537" })).sku,
  ).toBe("65-23537");
  expect(restoreCloudDraft({ sku: "legacy-sku" }).sku).toBe("legacy-sku");
});
