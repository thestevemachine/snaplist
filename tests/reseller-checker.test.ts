import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const mock = vi.hoisted(() => ({ handler: vi.fn() }));
vi.mock("../lib/services/checker", () => ({ handleChecker: mock.handler }));
import { POST as analyze } from "../app/api/reseller-checker/route";
import { GET, POST, DELETE } from "../app/api/reseller-checker/session/route";
import {
  createResellerSession,
  readResellerSession,
  RESELLER_COOKIE,
} from "../lib/reseller-session";
import { resellerSameOrigin } from "../lib/reseller-origin";
import { sealConnection } from "../lib/ebay/session";
import { accountScope, providerKey } from "../lib/accounts/context";
const model = "gemini-3.5-flash-lite",
  key = "daughter-test-key-123456789";
function req(
  path: string,
  method = "POST",
  body: unknown = {},
  cookie?: string,
  origin = "https://snaplist.test",
) {
  return new NextRequest("https://snaplist.test/api/reseller-checker" + path, {
    method,
    headers: {
      origin,
      ...(cookie ? { cookie: `${RESELLER_COOKIE}=${cookie}` } : {}),
    },
    ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
  });
}
beforeEach(() => {
  vi.stubEnv(
    "SESSION_SECRET",
    "reseller-session-test-secret-at-least-32-characters",
  );
  vi.stubEnv("SNAPLIST_ACCOUNTS_ENABLED", "true");
  vi.stubEnv("GEMINI_API_KEY", "OWNER-SECRET-MUST-NOT-BE-USED");
  vi.clearAllMocks();
  mock.handler.mockImplementation(async (_req, fixedModel) =>
    NextResponse.json({
      model: fixedModel,
      key: providerKey("google"),
      owner: accountScope.getStore()?.owner,
      id: accountScope.getStore()?.id,
    }),
  );
});
afterEach(() => vi.unstubAllEnvs());
describe("isolated reseller credentials", () => {
  it("accepts the real same-origin host behind a Next proxy, rejects foreign origins", () => {
    const request = new NextRequest(
      "http://localhost:3194/api/reseller-checker",
      { headers: { host: "127.0.0.1:3194", origin: "http://127.0.0.1:3194" } },
    );
    expect(resellerSameOrigin(request)).toBe(true);
    const foreign = new NextRequest(
      "http://localhost:3194/api/reseller-checker",
      { headers: { host: "127.0.0.1:3194", origin: "https://evil.test" } },
    );
    expect(resellerSameOrigin(foreign)).toBe(false);
  });
  it("seals credentials, rejects tampering, expiry and other cookie purposes", async () => {
    const sealed = await createResellerSession(model, key);
    expect(sealed).not.toContain(key);
    expect(await readResellerSession(sealed)).toMatchObject({ model, key });
    expect(await readResellerSession(sealed.slice(0, -4) + "AAAA")).toBeNull();
    const expired = await sealConnection({
      refreshToken: JSON.stringify({
        purpose: "reseller-checker-v1",
        id: crypto.randomUUID(),
        model,
        key,
        expires: Date.now() - 1000,
      }),
      refreshExpiresAt: Date.now() - 1000,
    });
    expect(await readResellerSession(expired)).toBeNull();
    const ebay = await sealConnection({
      refreshToken: "ordinary-ebay-refresh-token",
      refreshExpiresAt: Date.now() + 10000,
    });
    expect(await readResellerSession(ebay)).toBeNull();
  });
  it("returns no credentials and scopes the cookie to reseller APIs", async () => {
    const response = await POST(req("/session", "POST", { model, key }));
    expect(response.status).toBe(200);
    expect(JSON.stringify(await response.json())).not.toContain(key);
    const cookie = response.cookies.get(RESELLER_COOKIE)!;
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe("strict");
    expect(cookie.path).toBe("/api/reseller-checker");
    const status = await GET(req("/session", "GET", {}, cookie.value));
    expect(await status.json()).toEqual({ configured: true, model });
    expect(
      (await DELETE(req("/session", "DELETE"))).cookies.get(RESELLER_COOKIE)
        ?.maxAge,
    ).toBe(0);
  });
  it("rejects cross-origin writes and requests without a separate key even with owner context", async () => {
    expect(
      (
        await POST(
          req(
            "/session",
            "POST",
            { model, key },
            undefined,
            "https://evil.test",
          ),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await DELETE(
          req("/session", "DELETE", {}, undefined, "https://evil.test"),
        )
      ).status,
    ).toBe(403);
    const response = await accountScope.run(
      { id: "owner", email: "", owner: true, secrets: {} },
      () => analyze(req("")),
    );
    expect(response.status).toBe(401);
    expect(mock.handler).not.toHaveBeenCalled();
  });
  it("forces the saved model and uses only the entered key, never owner fallback", async () => {
    const sealed = await createResellerSession(model, key);
    const response = await accountScope.run(
      { id: "owner", email: "", owner: true, secrets: {} },
      () => analyze(req("", "POST", { model: "claude-opus-4-8" }, sealed)),
    );
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toMatchObject({ model, key, owner: false });
    expect(data.id).toMatch(/^reseller:/);
    expect(mock.handler).toHaveBeenCalledTimes(1);
  });
  it("fails closed when account-aware provider isolation is disabled", async () => {
    vi.stubEnv("SNAPLIST_ACCOUNTS_ENABLED", "false");
    const sealed = await createResellerSession(model, key);
    expect((await analyze(req("", "POST", {}, sealed))).status).toBe(503);
    expect(mock.handler).not.toHaveBeenCalled();
  });
  it("rejects unsupported models and malformed keys without any AI calls", async () => {
    expect(
      (await POST(req("/session", "POST", { model: "unknown", key }))).status,
    ).toBe(400);
    expect(
      (
        await POST(
          req("/session", "POST", {
            model,
            key: "a key with spaces and characters",
          }),
        )
      ).status,
    ).toBe(400);
    expect(mock.handler).not.toHaveBeenCalled();
  });
});
