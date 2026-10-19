import { it, expect } from "vitest";
import { applyBatchSkus, planBatchSkus } from "@/lib/batch-sku";
import type { ItemGroup } from "@/lib/types";
const group = (id: string, patch: Partial<ItemGroup> = {}): ItemGroup => ({
  id,
  sku: id,
  name: id,
  photoIds: ["p"],
  status: "done",
  ...patch,
});
it("increments the final numeric component and preserves leading zeros", () => {
  expect(
    planBatchSkus([group("a"), group("b"), group("c")], "5-0099").map(
      (x) => x.sku,
    ),
  ).toEqual(["5-0099", "5-0100", "5-0101"]);
});
it("skips published and attempted publications and keeps their identity", () => {
  const posted = group("posted", { postStatus: "posted" }),
    attempted = group("uncertain", { publicationAttemptSku: "uncertain" });
  const groups = [
    posted,
    group("a", { verificationMessage: "old" }),
    attempted,
    group("b"),
  ];
  const result = applyBatchSkus(groups, "5-23001");
  expect(result.map((x) => x.sku)).toEqual([
    "posted",
    "5-23001",
    "uncertain",
    "5-23002",
  ]);
  expect(result[0]).toBe(posted);
  expect(result[2]).toBe(attempted);
  expect(result[1].verificationMessage).toBeUndefined();
});
it("rejects invalid input or collisions without mutating any drafts", () => {
  const groups = [
    group("5-100", { postStatus: "posted" }),
    group("a"),
    group("b"),
  ];
  expect(() => applyBatchSkus(groups, "5-100")).toThrow("bereits");
  expect(() => applyBatchSkus(groups, "BOX-A")).toThrow("Zahl");
  expect(groups[1].sku).toBe("a");
});
it("does not lose precision for long numeric SKUs", () => {
  expect(
    planBatchSkus([group("a"), group("b")], "X-9007199254740999")[1].sku,
  ).toBe("X-9007199254741000");
});
