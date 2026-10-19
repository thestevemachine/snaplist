import { beforeEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { withPublicationIdentity } from "@/lib/publication-identity";
import {
  applicationData,
  listingUuid,
  inspectPublication,
  repairPublication,
} from "@/lib/ebay/publication-identity";
import { tradingCall } from "@/lib/ebay/trading";
import type { ItemGroup } from "@/lib/types";
vi.mock("@/lib/ebay/trading", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  tradingCall: vi.fn(),
}));
const group = (id: string): ItemGroup => ({
  id,
  sku: "65-23522",
  name: "s.Oliver",
  status: "done",
  photoIds: ["photo"],
  listing: {
    title: "s.Oliver",
    description: "Keep",
    suggested_price: 45,
    item_specifics: { Marke: "s.Oliver" },
  },
});
const found = (id = "old") => ({
  Ack: "Success",
  Item: {
    ItemID: "940025900611",
    SKU: "65-23522",
    Title: "Enni Marco",
    ApplicationData: id === "old" ? undefined : applicationData(id),
  },
});
const absent = {
  Ack: "Failure",
  Errors: [{ SeverityCode: "Error", ErrorCode: "21916270" }],
};
beforeEach(() => vi.mocked(tradingCall).mockReset());
it("independent drafts with identical SKUs have different UUIDs, copied drafts retain theirs", () => {
  const a = withPublicationIdentity(group("desktop")),
    b = withPublicationIdentity(group("phone"));
  expect(listingUuid(a.publicationId!)).not.toBe(listingUuid(b.publicationId!));
  expect(withPublicationIdentity({ ...a, sku: "changed" }).publicationId).toBe(
    a.publicationId,
  );
  expect(
    withPublicationIdentity(JSON.parse(JSON.stringify(a))).publicationId,
  ).toBe(a.publicationId);
});
it("legacy uncertain attempts keep the exact old UUID, posted items are untouched", () => {
  const a = withPublicationIdentity({
    ...group("desktop"),
    publicationAttemptSku: "65-23522",
  });
  expect(listingUuid(a.publicationId!)).toBe(
    createHash("sha256")
      .update("snaplist:trading:DE:65-23522")
      .digest("hex")
      .slice(0, 32)
      .toUpperCase(),
  );
  const posted = { ...group("posted"), postStatus: "posted" as const };
  expect(withPublicationIdentity(posted)).toBe(posted);
  expect(
    withPublicationIdentity({ ...group("interrupted"), postStatus: "posting" })
      .publicationId,
  ).toBe("legacy:65-23522");
});
it("does not mistake an unrelated live SKU for this draft", async () => {
  vi.mocked(tradingCall).mockResolvedValue(found());
  expect(
    (await inspectPublication("token", "65-23522", "draft:desktop")).status,
  ).toBe("conflict");
});
it("recovers a successful attempt only with matching publication metadata", async () => {
  vi.mocked(tradingCall).mockResolvedValue(found("draft:desktop"));
  expect(
    (await inspectPublication("token", "65-23522", "draft:desktop")).status,
  ).toBe("published");
});
it("repair is stable, read-only, and refuses changed conflicts", async () => {
  const input = {
    sku: "65-23522",
    publicationId: "legacy:65-23522",
    draftId: "desktop",
    conflictItemId: "940025900611",
    differentItem: true,
  };
  vi.mocked(tradingCall)
    .mockResolvedValueOnce(found())
    .mockResolvedValueOnce(absent)
    .mockResolvedValueOnce(found())
    .mockResolvedValueOnce(absent);
  const a = await repairPublication("token", input),
    b = await repairPublication("token", input);
  expect(a).toEqual(b);
  expect(a.sku).toMatch(/^65-23522-[A-F0-9]{12}$/);
  expect(a.publicationId).toBe("draft:desktop");
  expect(
    vi.mocked(tradingCall).mock.calls.every((c) => c[1] === "GetItem"),
  ).toBe(true);
  vi.mocked(tradingCall).mockResolvedValue(found());
  await expect(
    repairPublication("token", { ...input, conflictItemId: "wrong" }),
  ).rejects.toThrow("Konflikt");
  await expect(
    repairPublication("token", { ...input, differentItem: false }),
  ).rejects.toThrow("bestätigen");
});
it("fails closed on lookup failures and does not rotate uncertain legacy identities", async () => {
  vi.mocked(tradingCall).mockResolvedValue({
    Ack: "Failure",
    Errors: [{ SeverityCode: "Error", ErrorCode: "931" }],
  });
  await expect(
    inspectPublication("token", "65-23522", "draft:desktop"),
  ).rejects.toThrow();
  vi.mocked(tradingCall).mockResolvedValue(absent);
  expect(
    (await inspectPublication("token", "65-23522", "legacy:65-23522")).status,
  ).toBe("uncertain");
});

it("keeps eBay ApplicationData within its 32 character limit", () => { expect(applicationData("draft:example")).toMatch(/^[A-F0-9]{32}$/); });
