import { createCipheriv } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  decryptSharedRefreshToken,
  testSharedEbayConnection,
} from "@/lib/ebay/shared-connection";
import { POST } from "@/app/api/ebay/test-connection/route";

const key = "ab".repeat(32);
const refresh = "private-refresh-token";
function seal(value = refresh) {
  const iv = Buffer.alloc(12, 3);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "hex"), iv);
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("hex"),
    cipher.getAuthTag().toString("hex"),
    ciphertext.toString("hex"),
  ].join(":");
}
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubEnv("SUPABASE_EU_URL", "https://example.supabase.co");
  vi.stubEnv("SUPABASE_EU_SECRET_KEY", "sb_secret_private");
  vi.stubEnv("EBAY_TOKEN_ENCRYPTION_KEY", key);
  vi.stubEnv("EBAY_CLIENT_ID", "app-id");
  vi.stubEnv("EBAY_CLIENT_SECRET", "app-secret");
  vi.stubEnv("APP_SECRET", "access-code");
  fetchMock = vi
    .fn()
    .mockResolvedValueOnce(Response.json([{ refresh_token_encrypted: seal() }]))
    .mockResolvedValueOnce(
      Response.json({ access_token: "private-access-token", expires_in: 7200 }),
    )
    .mockResolvedValueOnce(Response.json({ fulfillmentPolicies: [] }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("shared eBay credential source", () => {
  it("decrypts exactly the existing project's AES-GCM format", () => {
    expect(decryptSharedRefreshToken(seal(), key)).toBe(refresh);
  });
  it.each(["v2:00:00:00", "v1:zz:00:aa", "v1:00:00:aa", "", undefined])(
    "rejects malformed stored values: %s",
    (value) => {
      expect(() => decryptSharedRefreshToken(value, key)).toThrow(
        "nicht entschlüsselt",
      );
    },
  );
  it("rejects a wrong key, a tampered authentication tag and empty plaintext", () => {
    expect(() => decryptSharedRefreshToken(seal(), "cd".repeat(32))).toThrow();
    const parts = seal().split(":");
    parts[2] = "00".repeat(16);
    expect(() => decryptSharedRefreshToken(parts.join(":"), key)).toThrow();
    expect(() => decryptSharedRefreshToken(seal(""), key)).toThrow();
  });
  it("only reads row 1, refreshes with original scopes and reads account policies", async () => {
    await testSharedEbayConnection();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [dbUrl, dbInit] = fetchMock.mock.calls[0];
    expect(dbUrl.searchParams.get("id")).toBe("eq.1");
    expect(dbUrl.searchParams.get("select")).toBe("refresh_token_encrypted");
    expect(dbInit.method).toBeUndefined();
    expect(dbInit.headers).toEqual({ apikey: "sb_secret_private" });
    const [tokenUrl, tokenInit] = fetchMock.mock.calls[1];
    expect(tokenUrl).toBe("https://api.ebay.com/identity/v1/oauth2/token");
    expect(tokenInit.method).toBe("POST");
    expect(new URLSearchParams(tokenInit.body).get("refresh_token")).toBe(
      refresh,
    );
    expect(new URLSearchParams(tokenInit.body).has("scope")).toBe(false);
    const [accountUrl, accountInit] = fetchMock.mock.calls[2];
    expect(accountUrl.pathname).toBe("/sell/account/v1/fulfillment_policy");
    expect(accountInit.method).toBeUndefined();
    for (const [, init] of fetchMock.mock.calls) {
      expect(init.cache).toBe("no-store");
      expect(init.redirect).toBe("error");
    }
  });
  it("supports legacy JWT Supabase keys without treating new secret keys as JWTs", async () => {
    vi.stubEnv("SUPABASE_EU_SECRET_KEY", "legacy.jwt.key");
    await testSharedEbayConnection();
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(
      "Bearer legacy.jwt.key",
    );
  });
  it("stops before contacting eBay if the database row is missing", async () => {
    fetchMock.mockReset().mockResolvedValue(Response.json([]));
    await expect(testSharedEbayConnection()).rejects.toMatchObject({
      code: "TOKEN_MISSING",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("does not report success when only token refresh works", async () => {
    fetchMock
      .mockReset()
      .mockResolvedValueOnce(
        Response.json([{ refresh_token_encrypted: seal() }]),
      )
      .mockResolvedValueOnce(
        Response.json({
          access_token: "private-access-token",
          expires_in: 7200,
        }),
      )
      .mockResolvedValueOnce(
        new Response("private upstream data", { status: 403 }),
      );
    await expect(testSharedEbayConnection()).rejects.toMatchObject({
      code: "ACCOUNT_READ_FAILED",
    });
  });
  it("does not transmit secrets over HTTP", async () => {
    vi.stubEnv("SUPABASE_EU_URL", "http://example.supabase.co");
    await expect(testSharedEbayConnection()).rejects.toMatchObject({
      code: "CONFIGURATION_INVALID",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

function request(secret?: string) {
  return new NextRequest("https://snaplist.example/api/ebay/test-connection", {
    method: "POST",
    headers: secret ? { "x-app-secret": secret } : {},
  });
}
it("requires authentication before accessing Supabase or eBay", async () => {
  const response = await POST(request());
  expect(response.status).toBe(401);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(fetchMock).not.toHaveBeenCalled();
});
it("fails closed in production without an app access code", async () => {
  vi.stubEnv("APP_SECRET", undefined);
  vi.stubEnv("NODE_ENV", "production");
  expect((await POST(request())).status).toBe(503);
  expect(fetchMock).not.toHaveBeenCalled();
});
it("returns only test results, without tokens, cookies or account details", async () => {
  const response = await POST(request("access-code"));
  const body = await response.text();
  expect(response.status).toBe(200);
  expect(JSON.parse(body)).toMatchObject({
    ok: true,
    tokenRefresh: true,
    accountRead: true,
  });
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(response.headers.get("Set-Cookie")).toBeNull();
  expect(body).not.toContain(refresh);
  expect(body).not.toContain("private-access-token");
  expect(body).not.toContain("sb_secret_private");
});
it("redacts arbitrary exceptions and upstream error bodies", async () => {
  fetchMock
    .mockReset()
    .mockRejectedValue(new Error("private-access-token sb_secret_private"));
  const response = await POST(request("access-code"));
  expect(response.status).toBe(502);
  expect(await response.text()).not.toContain("private");
});
