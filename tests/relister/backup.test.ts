import { it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  secureBackup,
  restoreImages,
  type BackupStorage,
} from "../../lib/relister/backup";
import {
  sampleListing,
  samplePayload,
  fixtureImage,
} from "../../lib/relister/simulation";
const download = async () => ({
  data: fixtureImage,
  mime: "image/png",
  sha256: createHash("sha256").update(fixtureImage).digest("hex"),
});
const input = () => ({
  account: "account",
  rowId: "row",
  seller: "SIMULATION",
  listing: sampleListing("100000000001"),
  payload: samplePayload("100000000001"),
  targetCents: 4699,
});
it("saves and reads back ordered actual image bytes and full snapshot", async () => {
  const files = new Map<string, Buffer>();
  const store: BackupStorage = {
    put: async (p, b) => {
      files.set(p, b);
    },
    get: async (p) => files.get(p)!,
  };
  const backup = await secureBackup(input(), store, download);
  expect(files.has("account/row/backup.json")).toBe(true);
  expect((await restoreImages(backup, store))[0].data).toBe(
    fixtureImage.toString("base64"),
  );
  files.set(backup.images[0].path, Buffer.from("corrupt"));
  await expect(restoreImages(backup, store)).rejects.toThrow("beschädigt");
});
it("refuses corrupted readback and foreign seller before any end is possible", async () => {
  const store: BackupStorage = {
    put: async () => {},
    get: async () => Buffer.from("broken"),
  };
  await expect(secureBackup(input(), store, download)).rejects.toThrow(
    "stimmt nicht",
  );
  await expect(
    secureBackup({ ...input(), seller: "other" }, store, download),
  ).rejects.toThrow("Verkäuferkonto");
});
