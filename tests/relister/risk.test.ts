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
