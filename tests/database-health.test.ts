import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "../app/api/cron/database-health/route";

const secret = "a".repeat(64);
const request = (authorization = `Bearer ${secret}`) =>
  new Request("https://snaplist-bay.vercel.app/api/cron/database-health", { headers: { authorization } });
beforeEach(() => {
  vi.stubEnv("CRON_SECRET", secret);
  vi.stubEnv("SUPABASE_EU_URL", "https://xeiqskpmclvavojhxgay.supabase.co");
  vi.stubEnv("SUPABASE_EU_SECRET_KEY", "sb_secret_test");
  vi.stubGlobal("fetch", vi.fn(async () => Response.json([{ id: 1 }])));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("daily database health check", () => {
  it.each(["", "Bearer wrong", "Basic secret"])("rejects unauthorized calls: %s", async (header) => {
    expect((await GET(request(header))).status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("fails closed without a cron secret", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(request())).status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("only reads the EU row ID three times, without tokens or writes", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(fetch).toHaveBeenCalledTimes(3);
    for (const [url, options] of vi.mocked(fetch).mock.calls) {
      expect(String(url)).toBe("https://xeiqskpmclvavojhxgay.supabase.co/rest/v1/ebay_oauth_tokens?select=id&id=eq.1&limit=1");
      expect(options).toMatchObject({ method: "GET", cache: "no-store", redirect: "error", headers: { apikey: "sb_secret_test" } });
      expect(options?.headers).not.toHaveProperty("Authorization");
    }
  });
  it("supports legacy JWT server keys", async () => {
    vi.stubEnv("SUPABASE_EU_SECRET_KEY", "legacy.jwt.key");
    await GET(request());
    expect(vi.mocked(fetch).mock.calls[0][1]?.headers).toMatchObject({ Authorization: "Bearer legacy.jwt.key" });
  });
  it.each(["https://aoffpvzmxjccdspwkmwl.supabase.co", "http://xeiqskpmclvavojhxgay.supabase.co", "https://user:password@xeiqskpmclvavojhxgay.supabase.co"])("rejects an incorrect database: %s", async (url) => {
    vi.stubEnv("SUPABASE_EU_URL", url);
    expect((await GET(request())).status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("requires the database key", async () => {
    vi.stubEnv("SUPABASE_EU_SECRET_KEY", "");
    expect((await GET(request())).status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([[], [{ id: 2 }], { error: "secret" }])("rejects missing or malformed data", async (rows) => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(rows));
    expect((await GET(request())).status).toBe(503);
  });
  it("sanitizes upstream failures", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("private upstream details", { status: 500 }));
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.text()).toBe('{"ok":false}');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("sanitizes network failures", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("secret"));
    expect(await (await GET(request())).json()).toEqual({ ok: false });
  });
});
