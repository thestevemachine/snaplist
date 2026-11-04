import { it, expect, vi } from "vitest";
const fetch = vi.hoisted(() => vi.fn());
vi.mock("../../lib/network", () => ({ boundedFetch: fetch }));
import { riskProbe } from "../../lib/relister/risk";
import type { TradingCall } from "../../lib/relister/trading-adapter";
const id = "100000000001";
function setup(response: any, status = 404) {
  fetch.mockResolvedValue({
    ok: status === 200,
    status,
    json: async () => ({ errors: [{ errorId: 25710 }] }),
  });
  const call: TradingCall = async () => ({ Ack: "Success", ...response });
  return riskProbe("fixture-token", call);
}
it("recognizes documented root BestOfferArray rather than assuming no offers", async () => {
  expect(
    (
      await setup({
        BestOfferArray: { BestOffer: { Status: "Active" } },
        Item: { ItemID: id },
      })(id, { SKU: "sku" })
    ).offers,
  ).toBe("pending");
});
it("recognizes nested documented BestOfferArray", async () => {
  expect(
    (
      await setup({
        ItemBestOffersArray: {
          ItemBestOffers: {
            Item: { ItemID: id },
            BestOfferArray: { BestOffer: { Status: "Active" } },
          },
        },
      })(id, { SKU: "sku" })
    ).offers,
  ).toBe("pending");
});
it("requires explicit bound empty evidence to clear offers", async () => {
  expect((await setup({})(id, { SKU: "sku" })).offers).toBe("unknown");
  expect(
    (
      await setup({ BestOfferArray: "", Item: { ItemID: id } })(id, {
        SKU: "sku",
      })
    ).offers,
  ).toBe("clear");
});
it("does not infer Trading ownership from missing scope or generic 404", async () => {
  expect((await setup({}, 403)(id, { SKU: "sku" })).management).toBe("unknown");
  expect((await setup({}, 200)(id, { SKU: "sku" })).management).toBe(
    "inventory",
  );
});
it("excludes promotional or strike-through prices", async () =>
  expect(
    (
      await setup({})(id, {
        SKU: "sku",
        DiscountPriceInfo: { OriginalRetailPrice: "100" },
      })
    ).promotion,
  ).toBe("active"));

const activeSource = {
  SKU: "sku",
  ItemID: id,
  Site: "Germany",
  Seller: { UserID: "seller" },
  SellingStatus: { ListingStatus: "Active" },
};
const noOffers = {
  Ack: "Failure",
  Errors: [{ ErrorCode: "20140", SeverityCode: "Error" }],
};
it("accepts documented no-active-offers 20140 for the exact verified active source", async () => {
  expect((await setup(noOffers)(id, activeSource)).offers).toBe("clear");
});
it("does not hide mixed API errors or a source mismatch behind 20140", async () => {
  await expect(
    setup({
      ...noOffers,
      Errors: [...noOffers.Errors, { ErrorCode: "931", SeverityCode: "Error" }],
    })(id, activeSource),
  ).rejects.toThrow();
  await expect(
    setup(noOffers)(id, { ...activeSource, ItemID: "100000000099" }),
  ).rejects.toThrow();
});
it("does not turn a conflicting returned offer into a clear result", async () => {
  await expect(
    setup({ ...noOffers, BestOfferArray: { BestOffer: { Status: "Active" } } })(
      id,
      activeSource,
    ),
  ).rejects.toThrow();
});

async function inventoryFallback(summary: any, ok = true) {
  fetch.mockReset();
  fetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
  fetch.mockResolvedValueOnce({
    ok: false,
    status: 400,
    json: async () => ({ errors: [{ errorId: 25709 }] }),
  });
  fetch.mockResolvedValueOnce({
    ok,
    status: ok ? 200 : 403,
    json: async () => summary,
  });
  return riskProbe("fixture-token", async () => ({ Ack: "Success" }))(id, {
    SKU: "fixture-sku",
  });
}
it("requires an explicit empty inventory before clearing an invalid-SKU response", async () => {
  expect(
    (await inventoryFallback({ total: 0, inventoryItems: [] })).management,
  ).toBe("trading");
  expect(fetch.mock.calls[1][0]).toBe(
    "https://api.ebay.com/sell/inventory/v1/inventory_item?limit=1",
  );
});
it.each([
  { total: 2, inventoryItems: [{ sku: "fixture" }] },
  { total: "0" },
  {},
  { total: 0, inventoryItems: [{ sku: "fixture" }] },
])(
  "does not infer inventory absence from incomplete or conflicting summaries",
  async (summary) =>
    expect((await inventoryFallback(summary)).management).toBe("unknown"),
);
it("keeps authorization failure unknown despite a misleading empty body", async () =>
  expect((await inventoryFallback({ total: 0 }, false)).management).toBe(
    "unknown",
  ));
it("accepts the documented 400/25710 absence response", async () =>
  expect((await setup({}, 400)(id, { SKU: "fixture" })).management).toBe(
    "trading",
  ));

it("proves absence only after every inventory page was read", async () => {
  fetch.mockReset();
  fetch.mockResolvedValueOnce({
    ok: false,
    status: 400,
    json: async () => ({ errors: [{ errorId: 25709 }] }),
  });
  fetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({ total: 2, inventoryItems: [{ sku: "other-1" }] }),
  });
  fetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({ total: 2, inventoryItems: [{ sku: "other-2" }] }),
  });
  expect(
    (
      await riskProbe("fixture", async () => ({ Ack: "Success" }))(id, {
        SKU: "target",
      })
    ).management,
  ).toBe("trading");
  expect(fetch.mock.calls[2][0]).toContain("offset=1");
});
it("detects inventory-managed SKU on a later page", async () => {
  fetch.mockReset();
  fetch.mockResolvedValueOnce({
    ok: false,
    status: 400,
    json: async () => ({ errors: [{ errorId: 25709 }] }),
  });
  fetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({ total: 2, inventoryItems: [{ sku: "other-1" }] }),
  });
  fetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({ total: 2, inventoryItems: [{ sku: "target" }] }),
  });
  expect(
    (
      await riskProbe("fixture", async () => ({ Ack: "Success" }))(id, {
        SKU: "target",
      })
    ).management,
  ).toBe("inventory");
});
it("does not clear duplicated or changing inventory pagination", async () => {
  for (const next of [
    { total: 2, inventoryItems: [{ sku: "same" }] },
    { total: 3, inventoryItems: [{ sku: "other" }] },
  ]) {
    fetch.mockReset();
    fetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ errors: [{ errorId: 25709 }] }),
    });
    fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ total: 2, inventoryItems: [{ sku: "same" }] }),
    });
    fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => next,
    });
    expect(
      (
        await riskProbe("fixture", async () => ({ Ack: "Success" }))(id, {
          SKU: "target",
        })
      ).management,
    ).toBe("unknown");
  }
});
