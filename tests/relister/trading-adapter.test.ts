import { createHash } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import { it, expect, vi } from "vitest";
import {
  TradingAdapter,
  payloadXml,
  productionUpload,
  type TradingCall,
} from "../../lib/relister/trading-adapter";
import {
  samplePayload,
  sampleListing,
  Simulation,
  fixtureImage,
} from "../../lib/relister/simulation";
import { preview } from "../../lib/relister/jobs";
import {
  advance,
  AuthorizationError,
  TemporaryError,
  type Repository,
} from "../../lib/relister/engine";
const photo = vi.hoisted(() => ({ upload: vi.fn() }));
vi.mock("../../lib/ebay/photo-upload", () => ({
  uploadOnePhoto: photo.upload,
}));
const id = "100000000001";
function fixture() {
  const payload = samplePayload(id);
  payload.PictureDetails.PictureURL = [
    "https://i.ebayimg.com/images/front",
    "https://i.ebayimg.com/images/back",
  ];
  const state = {
    active: true,
    sold: 0,
    created: 0,
    source: structuredClone(payload),
    newItem: structuredClone(payload),
  };
  const call: TradingCall = vi.fn(async (name, body) => {
    if (name === "GetItem") {
      const isNew = body.includes("100000000002");
      return {
        Ack: "Success",
        Item: {
          ...(isNew ? state.newItem : state.source),
          ItemID: isNew ? "100000000002" : id,
          Seller: { UserID: "SIMULATION" },
          Quantity: 1,
          ListingDetails: { StartTime: "2020-01-01T00:00:00Z" },
          SellingStatus: {
            CurrentPrice: {
              "#text": (isNew ? state.newItem : state.source).StartPrice,
              "@_currencyID": "EUR",
            },
            QuantitySold: state.sold,
            ListingStatus: isNew || state.active ? "Active" : "Ended",
          },
        },
      };
    }
    if (name === "VerifyAddFixedPriceItem")
      return {
        Ack: "Success",
        Fees: {
          Fee: [
            {
              Name: "InsertionFee",
              Fee: { "#text": "0.00", "@_currencyID": "EUR" },
            },
          ],
        },
      };
    if (name === "EndFixedPriceItem") {
      state.active = false;
      return { Ack: "Success" };
    }
    if (name === "AddFixedPriceItem") {
      state.created++;
      state.newItem = new XMLParser({ parseTagValue: false }).parse(body).Item;
      return { Ack: "Success", ItemID: "100000000002" };
    }
    return {
      Ack: "Success",
      ActiveList: { PaginationResult: { TotalNumberOfPages: 0 } },
    };
  });
  const evidence = vi.fn(async (_id: string, _raw: any) => ({
    management: "trading" as const,
    offers: "clear" as const,
    promotion: "clear" as const,
  }));
  const adapter = new TradingAdapter(
    "account",
    "SIMULATION",
    call,
    { put: async () => {}, get: async () => fixtureImage },
    evidence,
    async (_image, name) => `https://i.ebayimg.com/images/${name}`,
  );
  return { payload, state, call, adapter, evidence };
}
it("reads ended source stock and sales without querying active offers", async () => {
  const { state, adapter, evidence } = fixture();
  state.active = false;
  evidence.mockRejectedValueOnce(Error("eBay 20140: no active offers"));
  expect(await adapter.read(id)).toMatchObject({
    active: false,
    quantity: 1,
    sold: 0,
    offers: "unknown",
    management: "unknown",
  });
  expect(evidence).not.toHaveBeenCalled();
});
it("continues probing eligibility for active sources", async () => {
  const { adapter, evidence } = fixture();
  evidence.mockRejectedValueOnce(Error("unavailable"));
  await expect(adapter.read(id)).rejects.toThrow("unavailable");
  expect(evidence).toHaveBeenCalledOnce();
});
it("builds explicit Add payload with stable UUID and no old item ID", () => {
  const p = payloadXml(samplePayload(id), "A".repeat(32));
  expect(p).toContain("<UUID>");
  expect(new XMLParser().parse(p).Item.ApplicationData).toBe("A".repeat(32));
  expect(p).not.toContain("<ItemID>");
  expect(p).not.toContain("QuantitySold");
});
it("verifies the publication request including the bounded stable identifier", async () => {
  const { adapter, call } = fixture();
  const uuid = "B".repeat(32);
  await adapter.verify({} as any, 4999, samplePayload(id), uuid);
  const verification = vi
    .mocked(call)
    .mock.calls.find(([name]) => name === "VerifyAddFixedPriceItem")!;
  expect(new XMLParser().parse(verification[1]).Item).toMatchObject({
    UUID: uuid,
    ApplicationData: uuid,
  });
});
it("end/create transport is real code but only executes after engine authorization", async () => {
  const { adapter, call } = fixture(),
    job = preview("account", "SIMULATION", [sampleListing(id)], "6");
  job.confirmed = true;
  job.mode = "live";
  const repo: Repository = { save: async () => {}, lock: async () => true };
  await expect(advance(job, job.rows[0], adapter, repo)).rejects.toThrow(
    "nicht freigegeben",
  );
  expect(call).not.toHaveBeenCalled();
});
it("gets exact price, owner and marketplace and verifies fees without publishing", async () => {
  const { adapter, payload, call } = fixture();
  expect((await adapter.read(id)).priceCents).toBe(4999);
  const backup = await new Simulation(
    preview("account", "SIMULATION", [sampleListing(id)], 0).rows,
  ).backup(
    preview("account", "SIMULATION", [sampleListing(id)], 0).rows[0],
    "account",
  );
  expect(await adapter.verify(backup, 4999, payload)).toEqual({ feeCents: 0 });
  expect(
    (call as any).mock.calls.some(
      (c: any) => c[0] === "EndFixedPriceItem" || c[0] === "AddFixedPriceItem",
    ),
  ).toBe(false);
});
it("rejects wrong owner before mutation", async () => {
  const { call } = fixture();
  const adapter = new TradingAdapter(
    "account",
    "different",
    call,
    { put: async () => {}, get: async () => fixtureImage },
    async () => ({
      management: "trading",
      offers: "clear",
      promotion: "clear",
    }),
    async () => "",
  );
  await expect(adapter.end(id)).rejects.toThrow("Verkäufer");
  expect(
    (call as any).mock.calls.some((c: any) => c[0] === "EndFixedPriceItem"),
  ).toBe(false);
});
it("does not treat missing reconciliation result as permission to duplicate", async () => {
  const { adapter } = fixture();
  expect(await adapter.reconcile("A".repeat(32))).toBe("unknown");
});
it("postcheck preserves image order", async () => {
  const { adapter, payload, state } = fixture();
  const b = await new Simulation(
    preview("account", "SIMULATION", [sampleListing(id)], 0).rows,
  ).backup(
    preview("account", "SIMULATION", [sampleListing(id)], 0).rows[0],
    "account",
  );
  expect(await adapter.compare("100000000002", b, 4999, payload)).toBe(true);
  state.newItem.PictureDetails.PictureURL.reverse();
  expect(await adapter.compare("100000000002", b, 4999, payload)).toBe(false);
  expect(adapter.comparisonDetails()).toContain(
    "Angebot.PictureDetails.PictureURL.0",
  );
});
it("uses matching shipping, return and payment policies rather than generated response copies", async () => {
  const { adapter, payload, state } = fixture();
  payload.ShipToLocations = ["DE", "FR"];
  state.newItem.ShipToLocations = ["FR", "DE"];
  (state.newItem as any).ShippingDetails = {
    ShippingType: "Flat",
    CalculatedShippingRate: { WeightMinor: "0" },
    ExcludeShipToLocation: ["CN", "US"],
  };
  (state.newItem as any).ReturnPolicy = {
    Description: "Current policy response",
  };
  (state.newItem as any).PaymentMethods = ["VisaMC", "PayPal"];
  const backup = {
    payload,
    settingsSnapshot: {
      SellerProfiles: structuredClone(payload.SellerProfiles),
      ShipToLocations: ["DE", "FR"],
      ShippingDetails: {
        ShippingType: "Flat",
        CalculatedShippingRate: { WeightMinor: "200" },
        ExcludeShipToLocation: ["US", "CN"],
      },
      ReturnPolicy: { Description: "Earlier policy response" },
      PaymentMethods: ["PayPal", "VisaMC"],
    },
  } as any;
  expect(await adapter.compare("100000000002", backup, 4999, payload)).toBe(
    true,
  );
  state.newItem.AutoPay = "true";
  expect(await adapter.compare("100000000002", backup, 4999, payload)).toBe(
    false,
  );
});
it.each([
  ["SellerShippingProfile", "ShippingProfileID"],
  ["SellerReturnProfile", "ReturnProfileID"],
  ["SellerPaymentProfile", "PaymentProfileID"],
])("rejects a different framework policy %s", async (kind, field) => {
  const { adapter, payload, state } = fixture();
  (state.newItem.SellerProfiles as any)[kind][field] = "different-policy";
  const backup = {
    payload,
    settingsSnapshot: { SellerProfiles: payload.SellerProfiles },
  } as any;
  expect(await adapter.compare("100000000002", backup, 4999, payload)).toBe(
    false,
  );
});

it("full real-adapter code path backs bytes, restores EPS, verifies, ends once, creates once and compares", async () => {
  const f = fixture(),
    files = new Map<string, Buffer>();
  const adapter = new TradingAdapter(
    "account",
    "SIMULATION",
    f.call,
    {
      put: async (p, b) => {
        files.set(p, b);
      },
      get: async (p) => files.get(p)!,
    },
    async () => ({
      management: "trading",
      offers: "clear",
      promotion: "clear",
    }),
    async (_image, name) => `https://i.ebayimg.com/images/${name}`,
    async () => ({
      data: fixtureImage,
      mime: "image/png",
      sha256: createHash("sha256").update(fixtureImage).digest("hex"),
    }),
  );
  const job = preview("account", "SIMULATION", [sampleListing(id)], "6");
  job.mode = "live";
  job.confirmed = true;
  const repo: Repository = {
    save: async () => {},
    lock: async () => true,
    authorized: async () => true,
  };
  await advance(job, job.rows[0], adapter, repo);
  expect(job.rows[0].phase).toBe("completed");
  expect(f.state.created).toBe(1);
  expect(f.state.active).toBe(false);
  expect(job.rows[0].outgoing!.StartPrice).toBe("46.99");
  expect(files.has(`account/${job.rows[0].id}/backup.json`)).toBe(true);
});

it("classifies sanitized image-upload failures without retrying authorization errors", async () => {
  photo.upload.mockResolvedValueOnce({
    url: null,
    error: "Fixture upload denied (HTTP 403)",
    retryable: false,
  });
  await expect(
    productionUpload("fixture-token")(
      { mediaType: "image/jpeg", data: "fixture" },
      "fixture.jpg",
    ),
  ).rejects.toBeInstanceOf(AuthorizationError);
  photo.upload.mockResolvedValueOnce({
    url: null,
    error: "Fixture temporary failure (HTTP 500)",
    retryable: true,
  });
  await expect(
    productionUpload("fixture-token")(
      { mediaType: "image/jpeg", data: "fixture" },
      "fixture.jpg",
    ),
  ).rejects.toBeInstanceOf(TemporaryError);
});
