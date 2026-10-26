import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { XMLParser } from "fast-xml-parser";
import { NextRequest } from "next/server";
import { signReview } from "@/lib/review";
import { submitTradingListing, listingUuid } from "@/lib/ebay/trading-publish";
import { tradingCall } from "@/lib/ebay/trading";
import { fetchTradingOptions } from "@/lib/ebay/trading-options";
import { categoryAspects, acceptedConditionIds } from "@/lib/ebay/taxonomy";
import type { PublishInput } from "@/lib/ebay/publish";
import { sellerAccessToken } from "@/lib/ebay/session";
import { POST as verifyRoute } from "@/app/api/ebay/verify/route";
import { POST as publishRoute } from "@/app/api/ebay/publish/route";

vi.mock("@/lib/ebay/taxonomy", () => ({
  categoryAspects: vi.fn(),
  acceptedConditionIds: vi.fn(),
}));
vi.mock("@/lib/ebay/session", () => ({
  EBAY_COOKIE: "ebay_conn",
  sellerAccessToken: vi.fn(),
}));

let calls: { url: string; call: string; body: string; headers: Headers }[];
let verifyAck: string, addAck: string, addTimeout: boolean;
const reply = (call: string, body: string) =>
  new Response(
    `<${call}Response xmlns="urn:ebay:apis:eBLBaseComponents">${body}</${call}Response>`,
  );
function input(): PublishInput {
  const expiresAt = Date.now() + 60_000;
  return {
    publicationId: "draft:test-independent-draft",
    sku: "TEST-BRILLE-001",
    listing: {
      title: "Brille & Rahmen <Modell>",
      description: "Deutsch & English\n<script>kein HTML</script>",
      category_id: "180957",
      ebay_condition: "NEW_OTHER",
      suggested_price: 9999,
      item_specifics: { Marke: "A & B", Material: "Metall | Acetat" },
    },
    imageUrls: ["https://i.ebayimg.com/images/test.jpg"],
    expectedPhotoCount: 1,
    shipping: {
      fulfillmentPolicyId: "11",
      paymentPolicyId: "22",
      returnPolicyId: "33",
      locationKey: "ebay-registration-address",
    },
    review: {
      categoryId: "180957",
      expiresAt,
      signature: signReview("180957", expiresAt),
    },
  };
}
beforeEach(() => {
  vi.stubEnv("APP_SECRET", "test-access-code");
  vi.stubEnv("EBAY_MARKETPLACE_ID", "EBAY_DE");
  vi.stubEnv("EBAY_CURRENCY", "EUR");
  vi.stubEnv("EBAY_CATEGORY_TREE_ID", "77");
  vi.mocked(categoryAspects).mockResolvedValue([
    {
      name: "Marke",
      required: true,
      mode: "FREE_TEXT",
      values: [],
      cardinality: "SINGLE",
    } as any,
  ]);
  vi.mocked(acceptedConditionIds).mockResolvedValue(
    new Set([1000, 1500, 3000]),
  );
  vi.mocked(sellerAccessToken).mockResolvedValue("private-token");
  calls = [];
  verifyAck = "Success";
  addAck = "Success";
  addTimeout = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init: RequestInit = {}) => {
      const headers = new Headers(init.headers),
        call = headers.get("X-EBAY-API-CALL-NAME") || "";
      calls.push({
        url: String(url),
        call,
        body: String(init.body || ""),
        headers,
      });
      if (String(url).includes("/fulfillment_policy?marketplace_id=EBAY_DE"))
        return Response.json({
          fulfillmentPolicies: [{ fulfillmentPolicyId: "11", name: "DHL" }],
        });
      if (String(url).includes("/payment_policy?marketplace_id=EBAY_DE"))
        return Response.json({
          paymentPolicies: [{ paymentPolicyId: "22", name: "eBay-Zahlung" }],
        });
      if (String(url).includes("/return_policy?marketplace_id=EBAY_DE"))
        return Response.json({
          returnPolicies: [{ returnPolicyId: "33", name: "Rückgabe" }],
        });
      if (call === "GetItem")
        return reply(
          call,
          "<Ack>Failure</Ack><Errors><SeverityCode>Error</SeverityCode><ErrorCode>21916270</ErrorCode></Errors>",
        );
      if (call === "GetUser")
        return reply(
          call,
          "<Ack>Success</Ack><User><RegistrationAddress><Country>DE</Country><PostalCode>01234</PostalCode><CityName>Berlin</CityName></RegistrationAddress></User>",
        );
      if (call === "VerifyAddFixedPriceItem")
        return reply(
          call,
          `<Ack>${verifyAck}</Ack>${verifyAck === "Failure" ? "<Errors><SeverityCode>Error</SeverityCode><ErrorCode>123</ErrorCode><LongMessage>Merkmal fehlt &amp; prüfen</LongMessage></Errors>" : '<Fees><Fee><Name>InsertionFee</Name><Fee currencyID="EUR">0.35</Fee></Fee></Fees>'}`,
        );
      if (call === "AddFixedPriceItem") {
        if (addTimeout)
          throw new Error("network failure including private-token");
        return reply(
          call,
          `<Ack>${addAck}</Ack>${addAck === "Failure" ? "<Errors><SeverityCode>Error</SeverityCode><ErrorCode>219</ErrorCode><LongMessage>UUID schon verwendet. Artikel 123456789012</LongMessage></Errors>" : "<ItemID>123456789012</ItemID>"}`,
        );
      }
      throw new Error(`Unexpected endpoint ${url}`);
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("Trading listing flow", () => {
  it("verifies without creating an offer or listing, preserving exact reviewed values", async () => {
    const result = await submitTradingListing(
      "private-token",
      input(),
      "verify",
    );
    expect(result).toMatchObject({
      success: true,
      verified: true,
      fees: [{ name: "InsertionFee", amount: "0.35", currency: "EUR" }],
    });
    expect(
      calls.some(
        (c) => c.url.includes("/inventory/") || c.call === "AddFixedPriceItem",
      ),
    ).toBe(false);
    const request = calls.find((c) => c.call === "VerifyAddFixedPriceItem")!;
    expect(request.headers.get("X-EBAY-API-SITEID")).toBe("77");
    const item = new XMLParser({ parseTagValue: false }).parse(request.body)
      .VerifyAddFixedPriceItemRequest.Item;
    expect(item).toMatchObject({
      Site: "Germany",
      Currency: "EUR",
      StartPrice: "9999.00",
      Quantity: "1",
      ConditionID: "1500",
      PostalCode: "01234",
      Title: input().listing.title,
      InventoryTrackingMethod: "ItemID",
      UUID: listingUuid(input().publicationId!),
      VATDetails: { VATPercent: "19" },
      BestOfferDetails: { BestOfferEnabled: "true" },
      ProductListingDetails: {
        EAN: "Nicht zutreffend",
        IncludeeBayProductDetails: "false",
      },
    });
    expect(item.Description).toBe(
      "Ungetragen ohne Etui<br><br>Deutsch &amp; English<br>&lt;script&gt;kein HTML&lt;/script&gt;",
    );
    expect(item.SellerProfiles.SellerShippingProfile.ShippingProfileID).toBe(
      "11",
    );
  });
  it("verifies then adds once, returning the item ID for Seller Hub", async () => {
    const result = await submitTradingListing(
      "private-token",
      input(),
      "publish",
    );
    expect(result.listingId).toBe("123456789012");
    expect(
      calls.filter((c) => c.call && c.call !== "GetUser").map((c) => c.call),
    ).toEqual(["GetItem", "VerifyAddFixedPriceItem", "AddFixedPriceItem"]);
    expect(calls.some((c) => c.url.includes("/inventory/"))).toBe(false);
    for (const call of calls.filter(
      (c) =>
        c.call === "VerifyAddFixedPriceItem" || c.call === "AddFixedPriceItem",
    )) {
      expect(call.body).toContain("<EAN>Nicht zutreffend</EAN>");
    }
  });
  it("preserves an entered EAN instead of replacing it with the default", async () => {
    const draft = input();
    draft.listing.item_specifics!.EAN = "4006381333931";
    await submitTradingListing("private-token", draft, "verify");
    expect(
      calls.find((c) => c.call === "VerifyAddFixedPriceItem")!.body,
    ).toContain("<EAN>4006381333931</EAN>");
  });
  it("supplies the missing EAN before required-aspect validation", async () => {
    vi.mocked(categoryAspects).mockResolvedValue([
      {
        name: "EAN",
        required: true,
        mode: "FREE_TEXT",
        values: [],
        cardinality: "SINGLE",
      } as any,
    ]);
    await expect(
      submitTradingListing("private-token", input(), "verify"),
    ).resolves.toMatchObject({ verified: true });
  });
  it("does not publish a legacy sunglasses draft in only one category", async () => {
    const draft = input();
    draft.listing.title = "Vintage Sunglasses";
    await expect(
      submitTradingListing("private-token", draft, "publish"),
    ).rejects.toThrow("Herren und Damen");
    expect(calls).toHaveLength(0);
  });
  it("sends one listing in two signed categories to Verify and Add", async () => {
    const draft = input();
    draft.listing.secondary_category_id = "999";
    draft.review!.secondaryCategoryId = "999";
    draft.review!.signature = signReview(
      draft.review!.categoryId,
      draft.review!.expiresAt,
      "999",
    );
    await submitTradingListing("private-token", draft, "publish");
    const writes = calls.filter(
      (c) =>
        c.call === "VerifyAddFixedPriceItem" || c.call === "AddFixedPriceItem",
    );
    expect(writes.map((c) => c.call)).toEqual([
      "VerifyAddFixedPriceItem",
      "AddFixedPriceItem",
    ]);
    for (const c of writes)
      expect(c.body).toContain(
        "<SecondaryCategory><CategoryID>999</CategoryID></SecondaryCategory>",
      );
    expect(categoryAspects).toHaveBeenCalledWith("999");
  });
  it("rejects an added or changed second category without a matching signed review", async () => {
    const draft = input();
    draft.listing.secondary_category_id = "999";
    await expect(
      submitTradingListing("private-token", draft, "publish"),
    ).rejects.toThrow("Kategorie erneut");
    expect(calls).toHaveLength(0);
    draft.review!.secondaryCategoryId = "999";
    await expect(
      submitTradingListing("private-token", draft, "publish"),
    ).rejects.toThrow("Kategorie erneut");
  });
  it("validates required specifics from the second category before Verify or Add", async () => {
    const draft = input();
    draft.listing.secondary_category_id = "999";
    draft.review!.secondaryCategoryId = "999";
    draft.review!.signature = signReview(
      draft.review!.categoryId,
      draft.review!.expiresAt,
      "999",
    );
    vi.mocked(categoryAspects).mockImplementation(async (id) => [
      {
        name: id === "999" ? "SecondRequired" : "Marke",
        required: true,
        mode: "FREE_TEXT",
        values: [],
        cardinality: "SINGLE",
      } as any,
    ]);
    await expect(
      submitTradingListing("private-token", draft, "publish"),
    ).rejects.toThrow("SecondRequired");
    expect(
      calls.some(
        (c) =>
          c.call === "VerifyAddFixedPriceItem" ||
          c.call === "AddFixedPriceItem",
      ),
    ).toBe(false);
  });
  it("stops at failed verification without Add or automatic fact changes", async () => {
    verifyAck = "Failure";
    await expect(
      submitTradingListing("private-token", input(), "publish"),
    ).rejects.toThrow("Merkmal fehlt & prüfen");
    expect(calls.some((c) => c.call === "AddFixedPriceItem")).toBe(false);
  });
  it("keeps UUID across changed price and retries, rejects duplicates without revising", async () => {
    addAck = "Failure";
    const original = input();
    const edited = input();
    edited.listing.suggested_price = 10000;
    for (const i of [original, edited])
      await expect(
        submitTradingListing("private-token", i, "publish"),
      ).rejects.toThrow("UUID schon verwendet");
    const uuids = calls
      .filter((c) => c.call === "AddFixedPriceItem")
      .map((c) => c.body.match(/<UUID>(.*?)<\/UUID>/)![1]);
    expect(uuids[0]).toBe(uuids[1]);
    expect(uuids[0]).toMatch(/^[A-F0-9]{32}$/);
  });
  it("does not retry an uncertain publication and never leaks the token", async () => {
    addTimeout = true;
    await expect(
      submitTradingListing("private-token", input(), "publish"),
    ).rejects.toThrow("Seller Hub prüfen");
    expect(calls.filter((c) => c.call === "AddFixedPriceItem")).toHaveLength(1);
  });
  it.each(["USD", ""])(
    "blocks wrong currency %s before any network request",
    async (currency) => {
      vi.stubEnv("EBAY_CURRENCY", currency);
      await expect(
        submitTradingListing("private-token", input(), "verify"),
      ).rejects.toThrow("EUR");
      expect(calls).toHaveLength(0);
    },
  );
  it("blocks missing photos, stale review, unsupported condition and wrong policies", async () => {
    const missing = input();
    missing.expectedPhotoCount = 2;
    await expect(
      submitTradingListing("private-token", missing, "publish"),
    ).rejects.toThrow("Fotos");
    const stale = input();
    stale.review!.signature = "invalid";
    await expect(
      submitTradingListing("private-token", stale, "publish"),
    ).rejects.toThrow("Kategorie");
    const badCondition = input();
    badCondition.listing.ebay_condition = "LIKE_NEW";
    await expect(
      submitTradingListing("private-token", badCondition, "publish"),
    ).rejects.toThrow("Zustand");
    const badPolicy = input();
    badPolicy.shipping!.paymentPolicyId = "444";
    await expect(
      submitTradingListing("private-token", badPolicy, "publish"),
    ).rejects.toThrow("Rahmenbedingungen");
    expect(calls.some((c) => c.call === "AddFixedPriceItem")).toBe(false);
  });
  it("loads policies and a clearly labeled account address without Inventory API", async () => {
    const options = await fetchTradingOptions("private-token");
    expect(options.locations[0]).toMatchObject({
      postalCode: "01234",
      country: "DE",
    });
    expect(options.locations[0].name).toContain(
      "als Artikelstandort bestätigen",
    );
    expect(calls.some((c) => c.url.includes("/inventory/"))).toBe(false);
  });
  it.each([
    "<bad>",
    "<GetUserResponse><Ack>Success</Ack></GetUserResponse>",
    '<!DOCTYPE x [<!ENTITY secret "bad">]><AddFixedPriceItemResponse><Ack>Success</Ack></AddFixedPriceItemResponse>',
  ])("rejects malformed, wrong-call and entity responses", async (body) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)));
    await expect(
      tradingCall("private-token", "AddFixedPriceItem", ""),
    ).rejects.toThrow();
  });
});

const request = (body: unknown, secret = "test-access-code") =>
  new NextRequest("https://snaplist.example/api/ebay/publish", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-app-secret": secret },
    body: JSON.stringify(body),
  });
it("guards both routes before credentials or network calls", async () => {
  for (const handler of [verifyRoute, publishRoute]) {
    const r = await handler(request(input(), "wrong"));
    expect(r.status).toBe(401);
  }
  expect(sellerAccessToken).not.toHaveBeenCalled();
  expect(calls).toHaveLength(0);
});
it("requires explicit publication confirmation before token access", async () => {
  const r = await publishRoute(request(input()));
  expect(r.status).toBe(400);
  expect(sellerAccessToken).not.toHaveBeenCalled();
});
it("verify endpoint ignores a supplied confirmation and never publishes", async () => {
  const r = await verifyRoute(request({ ...input(), confirmed: true }));
  expect(r.status).toBe(200);
  expect((await r.json()).verified).toBe(true);
  expect(calls.some((c) => c.call === "AddFixedPriceItem")).toBe(false);
});
it("publish endpoint uses Trading and returns the eBay item ID", async () => {
  const r = await publishRoute(request({ ...input(), confirmed: true }));
  expect(r.status).toBe(200);
  expect((await r.json()).listingId).toBe("123456789012");
  expect(calls.some((c) => c.url.includes("/inventory/"))).toBe(false);
});
it("never sends invented item-specific names to Trading", async () => {
  const draft = input();
  draft.listing.item_specifics = {
    Marke: "A & B",
    "Hinge Type": "Double",
    "Nose Pad Type": "Saddle",
    "Temple Tip Material": "Plastic",
    "Lens Treatment": "None",
  };
  await submitTradingListing("private-token", draft, "verify");
  const xml = calls.find((c) => c.call === "VerifyAddFixedPriceItem")!.body;
  expect(xml).toContain("<Name>Marke</Name>");
  for (const name of [
    "Hinge Type",
    "Nose Pad Type",
    "Temple Tip Material",
    "Lens Treatment",
  ])
    expect(xml).not.toContain(`<Name>${name}</Name>`);
});
it("honors disabled best offers while retaining seller VAT", async () => {
  const draft = input();
  draft.listing.best_offer_enabled = false;
  await submitTradingListing("private-token", draft, "verify");
  const body = calls.find((c) => c.call === "VerifyAddFixedPriceItem")!.body;
  expect(body).toContain("<BestOfferEnabled>false</BestOfferEnabled>");
  expect(body).toContain("<VATPercent>19</VATPercent>");
  expect(body).not.toContain("BestOfferAutoAcceptPrice");
});

describe("parallel employees and retries", () => {
  function fakeEbay() {
    const base = globalThis.fetch;
    const live = new Map<
      string,
      { uuid: string; app: string; sku: string; id: string }
    >();
    let adds = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init: RequestInit = {}) => {
        const call = new Headers(init.headers).get("X-EBAY-API-CALL-NAME");
        const xmlBody = String(init.body || "");
        const tag = (name: string) =>
          xmlBody.match(new RegExp(`<${name}>(.*?)</${name}>`))?.[1] || "";
        if (call === "GetItem") {
          const item = tag("ItemID")
            ? [...live.values()].find((i) => i.id === tag("ItemID"))
            : undefined;
          return reply(
            call,
            item
              ? `<Ack>Success</Ack><Item><ItemID>${item.id}</ItemID><SKU>${item.sku}</SKU><ApplicationData>${item.app}</ApplicationData></Item>`
              : "<Ack>Failure</Ack><Errors><SeverityCode>Error</SeverityCode><ErrorCode>21916270</ErrorCode></Errors>",
          );
        }
        if (call === "AddFixedPriceItem") {
          const uuid = tag("UUID"),
            sku = tag("SKU");
          const existing = live.get(uuid);
          if (existing)
            return reply(
              call,
              `<Ack>Failure</Ack><Errors><SeverityCode>Error</SeverityCode><ErrorCode>488</ErrorCode><LongMessage>Die UUID wurde bereits verwendet; Artikelnummer=${existing.id}.</LongMessage></Errors>`,
            );
          const item = {
            uuid,
            sku,
            app: tag("ApplicationData"),
            id: String(940000000000 + ++adds),
          };
          live.set(uuid, item);
          return reply(call, `<Ack>Success</Ack><ItemID>${item.id}</ItemID>`);
        }
        return base(url, init);
      }),
    );
    return { live, count: () => adds };
  }
  it("two employees create independent listings with different technical IDs", async () => {
    const ebay = fakeEbay();
    const a = input(),
      b = { ...input(), sku: "OTHER", publicationId: "draft:employee-two" };
    const result = await Promise.all([
      submitTradingListing("token", a, "publish"),
      submitTradingListing("token", b, "publish"),
    ]);
    expect(result.every((r) => r.success)).toBe(true);
    expect(ebay.count()).toBe(2);
    expect(new Set([...ebay.live.keys()]).size).toBe(2);
  });
  it("concurrent retries and a later retry create only one listing", async () => {
    const ebay = fakeEbay(),
      a = input();
    const result = await Promise.all([
      submitTradingListing("token", a, "publish"),
      submitTradingListing("token", a, "publish"),
    ]);
    expect(result[0].listingId).toBe(result[1].listingId);
    expect(ebay.count()).toBe(1);
    expect(
      (
        await submitTradingListing(
          "token",
          { ...a, sku: "EDITED-LABEL" },
          "publish",
        )
      ).listingId,
    ).toBe(result[0].listingId);
    expect(ebay.count()).toBe(1);
  });
  it("same SKU in two different drafts never overwrites or reports the wrong listing as success", async () => {
    const ebay = fakeEbay(),
      a = input();
    await submitTradingListing("token", a, "publish");
    const second = await submitTradingListing(
      "token",
      { ...a, publicationId: "draft:different-glasses" },
      "publish",
    );
    expect(second.success).toBe(true);
    expect(ebay.count()).toBe(2);
  });
  it("rejects stale clients without a publication identity before any eBay request", async () => {
    const a = input();
    delete a.publicationId;
    await expect(submitTradingListing("token", a, "publish")).rejects.toThrow(
      "neu laden",
    );
    expect(calls).toHaveLength(0);
  });
});

it("sends the exact seller SKU 65-23537 to the verification API with no generated suffix", async () => {
  const draft = input();
  draft.sku = "65-23537";
  await submitTradingListing("private-token", draft, "verify");
  const verified = calls.find((c) => c.call === "VerifyAddFixedPriceItem");
  expect(verified?.body).toContain("<SKU>65-23537</SKU>");
  expect(calls.some((c) => c.call === "AddFixedPriceItem")).toBe(false);
});
