import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({
  account: { id: "account", owner: true },
  read: vi.fn(),
  save: vi.fn(),
  reader: vi.fn(),
  update: vi.fn(),
  getJob: vi.fn(),
  activate: vi.fn(),
}));
vi.mock("../../lib/accounts/context", () => ({
  currentAccount: () => m.account,
  accountsEnabled: () => true,
}));
vi.mock("../../lib/accounts/server", () => ({
  withAccount: (f: unknown) => f,
  sameOrigin: () => true,
  accountDb: () => ({ from: () => ({ update: m.update }), rpc: m.activate }),
}));
vi.mock("../../lib/api-guard", () => ({ guardApiRequest: () => null }));
vi.mock("../../lib/relister/store", () => ({
  enabled: () => true,
  catalog: async () => null,
  saveCatalog: m.save,
  jobs: async () => [],
  insert: vi.fn(),
  getJob: m.getJob,
  command: vi.fn(),
}));
vi.mock("../../lib/relister/ebay", () => ({ reader: m.reader }));
vi.mock("../../lib/relister/runtime", () => ({
  realAdapter: async () => ({ read: m.read }),
}));
vi.mock("../../lib/relister/sync", () => ({ syncStep: vi.fn() }));
vi.mock("../../lib/relister/jobs", () => ({
  preview: vi.fn(),
  processJob: vi.fn(),
}));
import { POST } from "../../app/api/relister/route";
const request = (body: unknown) =>
  POST(
    new NextRequest("https://snaplist-bay.vercel.app/api/relister", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("RELISTER_PREPARATION_ONLY", "true");
  vi.stubEnv("RELISTER_LIVE_ENABLED", "false");
  m.account.owner = true;
  m.reader.mockResolvedValue({ seller: "owner-seller" });
  m.update.mockReturnValue({ eq: async () => ({ error: null }) });
});
it("keeps the owner pilot disabled before the separate live release", async () => {
  m.getJob.mockResolvedValueOnce({
    id: "job",
    mode: "dry-run",
    previewDigest: "digest",
  });
  expect(
    (await request({ action: "confirm", id: "job", digest: "digest" })).status,
  ).toBe(400);
  expect(m.activate).not.toHaveBeenCalled();
});
it("requires exact database approval even for the owner-only live pilot", async () => {
  vi.stubEnv("RELISTER_LIVE_ENABLED", "true");
  m.getJob.mockResolvedValueOnce({
    id: "job",
    mode: "dry-run",
    previewDigest: "digest",
  });
  m.activate.mockResolvedValueOnce({ error: { message: "missing approval" } });
  expect(
    (await request({ action: "confirm", id: "job", digest: "digest" })).status,
  ).toBe(400);
  expect(m.activate).toHaveBeenCalledWith("relister_activate", {
    p_job: "job",
    p_account: "account",
    p_digest: "digest",
  });
});
afterEach(() => vi.unstubAllEnvs());
it("rejects non-owner before any seller access", async () => {
  m.account.owner = false;
  expect(
    (await request({ action: "load-item", item: "100000000001" })).status,
  ).toBe(403);
  expect(m.reader).not.toHaveBeenCalled();
  expect(m.save).not.toHaveBeenCalled();
});
it("rejects malformed item IDs before calling eBay", async () => {
  expect(
    (await request({ action: "load-item", item: "../foreign" })).status,
  ).toBe(400);
  expect(m.reader).not.toHaveBeenCalled();
  expect(m.save).not.toHaveBeenCalled();
});
it("cannot save an item rejected by the owned-German-item adapter", async () => {
  m.read.mockRejectedValueOnce(Error("Wrong seller/site"));
  expect(
    (await request({ action: "load-item", item: "100000000001" })).status,
  ).toBe(400);
  expect(m.save).not.toHaveBeenCalled();
});
it("loads the checked source and pauses bulk sync without starting a job", async () => {
  const listing = {
    id: "100000000001",
    seller: "owner-seller",
    site: "Germany",
  };
  m.read.mockResolvedValueOnce(listing);
  expect(
    (await request({ action: "load-item", item: listing.id })).status,
  ).toBe(200);
  expect(m.read).toHaveBeenCalledWith(listing.id);
  expect(m.save).toHaveBeenCalledWith("account", "owner-seller", [listing]);
  expect(m.update).toHaveBeenCalledWith(
    expect.objectContaining({ pending: false }),
  );
});

it("reports only the stage and eBay code, never arbitrary upstream secrets", async () => {
  m.read.mockRejectedValueOnce(Error("eBay 12345: secret-fixture-token"));
  const r = await request({ action: "load-item", item: "100000000001" });
  const body = await r.json();
  expect(r.status).toBe(400);
  expect(body.error).toContain("item-check");
  expect(body.error).toContain("12345");
  expect(body.error).not.toContain("secret-fixture-token");
});

it("loads the server-selected oldest active source rather than a caller supplied ID", async () => {
  const oldest = vi.fn(async () => "100000000002");
  m.reader.mockResolvedValueOnce({ seller: "owner-seller", oldest });
  m.read.mockResolvedValueOnce({
    id: "100000000002",
    seller: "owner-seller",
    site: "Germany",
  });
  expect(
    (await request({ action: "load-oldest", item: "100000000099" })).status,
  ).toBe(200);
  expect(oldest).toHaveBeenCalledOnce();
  expect(m.read).toHaveBeenCalledWith("100000000002");
});
