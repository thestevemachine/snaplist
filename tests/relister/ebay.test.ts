import { it, expect, vi } from "vitest";
vi.mock("../../lib/ebay/session", () => ({
  sellerAccessToken: async () => "TEST-ONLY",
}));
const mock = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("../../lib/ebay/trading", () => ({
  tradingCall: mock.call,
  assertTradingSuccess: () => {},
  list: (v: any) => (v === undefined ? [] : Array.isArray(v) ? v : [v]),
  xml: (v: any) => String(v),
}));
import { reader, normalize, publicationPayload } from "../../lib/relister/ebay";
import { checkedImageUrl } from "../../lib/relister/images";
it("enumerates every seller page and does not infer German site from EUR", async () => {
  mock.call.mockImplementation(
    async (_token: string, call: string, body: string) => {
      if (call === "GetUser") return { User: { UserID: "seller" } };
      const page = Number(body.match(/<PageNumber>(\d+)/)?.[1]);
      return {
        ActiveList: {
          PaginationResult: { TotalNumberOfPages: "3" },
          ItemArray: {
            Item: { ItemID: String(page), Title: "Title", Currency: "EUR" },
          },
        },
      };
    },
  );
  const r = await reader(),
    all = await r.all();
  expect(all.map((l) => l.id)).toEqual(["1", "2", "3"]);
  expect(
    all.every(
      (l) =>
        l.site === "unknown" && l.management === "unknown" && l.views === null,
    ),
  ).toBe(true);
});
it("refuses incomplete pagination", async () => {
  mock.call.mockImplementation(async (_t: string, c: string) =>
    c === "GetUser" ? { User: { UserID: "seller" } } : {},
  );
  await expect((await reader()).all()).rejects.toThrow("Pagination");
});
it("does not infer no sales from missing quantity fields", () =>
  expect(normalize({ Currency: "EUR" }, "seller").sold).toBeNull());
it("requires explicit publication fields", () =>
  expect(() => publicationPayload({})).toThrow());
it.each([
  "http://i.ebayimg.com/images/a",
  "https://localhost/images/a",
  "https://i.ebayimg.com.evil.example/images/a",
  "https://i.ebayimg.com:8443/images/a",
  "https://user:pass@i.ebayimg.com/images/a",
  "https://i.ebayimg.com/images/a?redirect=local",
])("blocks unsafe image URL %s", (url) =>
  expect(() => checkedImageUrl(url)).toThrow(),
);

it("queries oldest-first at eBay and skips foreign or ended items across pages", async () => {
  mock.call.mockClear();
  mock.call.mockImplementation(
    async (_token: string, call: string, body: string) => {
      if (call === "GetUser") return { User: { UserID: "seller" } };
      if (call === "GetMyeBaySelling") {
        expect(body).toContain("<Sort>StartTime</Sort>");
        const page = Number(body.match(/<PageNumber>(\d+)/)?.[1]);
        return {
          ActiveList: {
            PaginationResult: { TotalNumberOfPages: "2" },
            ItemArray: {
              Item:
                page === 1
                  ? [{ ItemID: "100001" }, { ItemID: "100002" }]
                  : [{ ItemID: "100003" }],
            },
          },
        };
      }
      const id = body.match(/<ItemID>(\d+)/)?.[1];
      return {
        Item: {
          ItemID: id,
          Seller: { UserID: "seller" },
          Site: id === "100001" ? "US" : "Germany",
          SellingStatus: {
            ListingStatus: id === "100002" ? "Ended" : "Active",
          },
        },
      };
    },
  );
  expect(await (await reader()).oldest()).toBe("100003");
});
it("rejects another seller in oldest-item results", async () => {
  mock.call.mockImplementation(async (_t: string, c: string) =>
    c === "GetUser"
      ? { User: { UserID: "seller" } }
      : c === "GetMyeBaySelling"
        ? {
            ActiveList: {
              PaginationResult: { TotalNumberOfPages: "1" },
              ItemArray: { Item: { ItemID: "100001" } },
            },
          }
        : {
            Item: {
              ItemID: "100001",
              Seller: { UserID: "other" },
              Site: "Germany",
              SellingStatus: { ListingStatus: "Active" },
            },
          },
  );
  await expect((await reader()).oldest()).rejects.toThrow("Verkäufer");
});
