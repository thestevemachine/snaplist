import { createCipheriv } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/ebay/readiness/route";

const key = "ab".repeat(32);
const iv = Buffer.alloc(12, 3);
const cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "hex"), iv);
const encrypted = Buffer.concat([
  cipher.update("private-refresh"),
  cipher.final(),
]);
const sealed = `v1:${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${encrypted.toString("hex")}`;
let fetchMock: ReturnType<typeof vi.fn>;
let policyBody: unknown;
let tradingBody: string;
let tradingStatus: number;
let policyStatus: number;

beforeEach(() => {
  for (const [name, value] of Object.entries({
    SUPABASE_EU_URL: "https://example.supabase.co",
    SUPABASE_EU_SECRET_KEY: "sb_secret_private",
    EBAY_TOKEN_ENCRYPTION_KEY: key,
    EBAY_CLIENT_ID: "app-id",
    EBAY_CLIENT_SECRET: "app-secret",
    APP_SECRET: "access-code",
    EBAY_MARKETPLACE_ID: "EBAY_DE",
    EBAY_CURRENCY: "EUR",
    EBAY_CATEGORY_TREE_ID: "77",
  }))
    vi.stubEnv(name, value);
  policyBody = undefined;
  policyStatus = 200;
  tradingStatus = 200;
  tradingBody =
    '<GetUserResponse xmlns="urn:ebay:apis:eBLBaseComponents"><Ack>Success</Ack><User><Email>private@example.com</Email></User></GetUserResponse>';
  fetchMock = vi.fn(async (input: string | URL) => {
    const url = String(input);
    if (url.includes("supabase.co"))
      return Response.json([{ refresh_token_encrypted: sealed }]);
    if (url.includes("oauth2/token"))
      return Response.json({
        access_token: "private-access",
        expires_in: 7200,
      });
    if (url.includes("api.dll"))
      return new Response(tradingBody, { status: tradingStatus });
    const kind = url.match(/\/(fulfillment|payment|return)_policy/)?.[1];
    if (!kind) throw new Error("unexpected request");
    return Response.json(
      policyBody ?? { [`${kind}Policies`]: [{ name: "private-policy" }] },
      { status: policyStatus },
    );
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
const request = (authenticated = true) =>
  new NextRequest("https://snaplist.example/api/ebay/readiness", {
    method: "POST",
    headers: authenticated ? { "x-app-secret": "access-code" } : {},
  });

it("checks all German policies and GetUser, without publishing or exposing personal data", async () => {
  const response = await POST(request());
  const body = await response.text();
  expect(response.status).toBe(200);
  expect(JSON.parse(body)).toMatchObject({
    ok: true,
    marketplace: "EBAY_DE",
    currency: "EUR",
    tradingRead: true,
    policiesAvailable: true,
    policyCounts: { fulfillment: 1, payment: 1, return: 1 },
  });
  expect(body).not.toContain("private");
  expect(response.headers.get("Set-Cookie")).toBeNull();
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(fetchMock).toHaveBeenCalledTimes(6);
  for (const [input, init] of fetchMock.mock.calls as unknown as [
    string | URL,
    RequestInit,
  ][]) {
    const url = String(input);
    expect(init.cache).toBe("no-store");
    expect(init.redirect).toBe("error");
    if (url.includes("_policy")) {
      expect(new URL(url).searchParams.get("marketplace_id")).toBe("EBAY_DE");
      expect(init.method).toBeUndefined();
    } else if (url.includes("api.dll")) {
      expect(init.headers).toMatchObject({
        "X-EBAY-API-CALL-NAME": "GetUser",
        "X-EBAY-API-SITEID": "77",
        "X-EBAY-API-IAF-TOKEN": "private-access",
      });
      expect(init.body).toContain("<GetUserRequest");
    } else if (url.includes("supabase.co")) expect(init.method).toBeUndefined();
    else expect(url).toBe("https://api.ebay.com/identity/v1/oauth2/token");
  }
});
it.each(["EBAY_MARKETPLACE_ID", "EBAY_CURRENCY", "EBAY_CATEGORY_TREE_ID"])(
  "rejects incorrect %s before using credentials",
  async (name) => {
    vi.stubEnv(name, "incorrect");
    expect(await (await POST(request())).json()).toMatchObject({
      ok: false,
      code: "GERMAN_CONFIGURATION_REQUIRED",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  },
);
it("requires the app access code", async () => {
  expect((await POST(request(false))).status).toBe(401);
  expect(fetchMock).not.toHaveBeenCalled();
});
it("fails closed without a production access code", async () => {
  vi.stubEnv("APP_SECRET", undefined);
  vi.stubEnv("NODE_ENV", "production");
  expect((await POST(request())).status).toBe(503);
  expect(fetchMock).not.toHaveBeenCalled();
});
it.each(["Failure", "PartialFailure"])(
  "rejects Trading %s even with HTTP 200",
  async (ack) => {
    tradingBody = `<GetUserResponse><Ack>${ack}</Ack><Errors>private-error</Errors></GetUserResponse>`;
    const response = await POST(request());
    const body = await response.text();
    expect(response.status).toBe(502);
    expect(JSON.parse(body).code).toBe("TRADING_READ_FAILED");
    expect(body).not.toContain("private-error");
  },
);
it("accepts a successful Trading response with warnings", async () => {
  tradingBody = "<GetUserResponse><Ack>Warning</Ack></GetUserResponse>";
  expect((await POST(request())).status).toBe(200);
});
it.each(["<html>private-error</html>", "<GetUserResponse><Ack>Success</Ack>"])(
  "rejects invalid or truncated Trading replies",
  async (body) => {
    tradingBody = body;
    expect(await (await POST(request())).json()).toMatchObject({
      ok: false,
      code: "TRADING_READ_FAILED",
    });
  },
);
it("rejects an unsuccessful HTTP status even with a success acknowledgement", async () => {
  tradingStatus = 500;
  expect((await POST(request())).status).toBe(502);
});
it("does not turn a policy permission error into success", async () => {
  policyStatus = 403;
  expect(await (await POST(request())).json()).toMatchObject({
    ok: false,
    code: "FULFILLMENT_READ_FAILED",
  });
  expect(fetchMock).toHaveBeenCalledTimes(3);
});
it("does not mistake missing policy data for an empty policy list", async () => {
  policyBody = {};
  expect(await (await POST(request())).json()).toMatchObject({
    ok: false,
    code: "POLICY_RESPONSE_INVALID",
  });
});
it("reports empty policy lists as missing policies, while confirming connectivity", async () => {
  policyBody = {
    fulfillmentPolicies: [],
    paymentPolicies: [],
    returnPolicies: [],
  };
  expect(await (await POST(request())).json()).toMatchObject({
    ok: true,
    policiesAvailable: false,
    tradingRead: true,
  });
});
