import { beforeEach, afterEach, expect, it, vi } from "vitest";
vi.mock("@/lib/ebay/config", async (importOriginal) => ({
  ...(await importOriginal<any>()),
  EBAY_MARKETPLACE_ID: "EBAY_DE",
}));
vi.mock("@/lib/ebay/taxonomy", () => ({
  categoryAspects: vi.fn(),
  suggestLeafCategories: vi.fn(),
  acceptedConditionIds: vi.fn(),
}));
vi.mock("@/lib/ebay/session", () => ({
  EBAY_COOKIE: "ebay_conn",
  sellerAccessToken: vi.fn(async () => "token"),
}));
import { prepareListing } from "@/lib/services/prepare";
import {
  categoryAspects,
  acceptedConditionIds,
  suggestLeafCategories,
} from "@/lib/ebay/taxonomy";
import { verifyReview } from "@/lib/review";
beforeEach(() => {
  vi.stubEnv("APP_SECRET", "test-secret");
  vi.mocked(suggestLeafCategories).mockImplementation(async (q) => [
    {
      id: q.includes("Herren") ? "11" : "22",
      name: "Sonnenbrillen",
      path: `${q.includes("Herren") ? "Herren" : "Damen"} > Sonnenbrillen`,
    },
  ]);
  vi.mocked(categoryAspects).mockResolvedValue([
    {
      name: "Marke",
      required: true,
      usage: "REQUIRED",
      mode: "FREE_TEXT",
      cardinality: "SINGLE",
      values: [],
    },
  ]);
  vi.mocked(acceptedConditionIds).mockResolvedValue(new Set([1500, 3000]));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
it("prepares and signs both categories for one sunglasses draft", async () => {
  const response = await prepareListing({
    listing: {
      title: "ic! berlin Sunglasses",
      description: "Seller text",
      category: "mens_accessories",
      ebay_condition: "NEW_OTHER",
      item_specifics: { Marke: "ic! berlin" },
    },
    enrich: false,
  });
  const body = await response.json();
  expect(body.ok).toBe(true);
  expect(body.listing).toMatchObject({
    category_id: "11",
    secondary_category_id: "22",
    description: "Seller text",
  });
  expect(body.preparation).toMatchObject({
    categoryId: "11",
    secondaryCategoryId: "22",
    secondaryCategoryName: "Damen > Sonnenbrillen",
  });
  expect(
    verifyReview(
      "11",
      body.preparation.expiresAt,
      body.preparation.signature,
      "22",
    ),
  ).toBe(true);
  expect(
    verifyReview("11", body.preparation.expiresAt, body.preparation.signature),
  ).toBe(false);
});
it("keeps the draft unprepared when one category cannot be found", async () => {
  vi.mocked(suggestLeafCategories).mockResolvedValue([]);
  const body = await (
    await prepareListing({
      listing: { title: "Sonnenbrille", description: "Text" },
    })
  ).json();
  expect(body.ok).toBe(false);
  expect(body.error).toContain("beiden");
});
it("transfers the known Brand into Marke and preserves reviewed titles on another preparation", async () => {
  const body = await (
    await prepareListing({
      listing: {
        title: "Test Sunglasses",
        description: "Mein Text",
        brand: "Test",
        item_specifics: { Brand: "Test" },
      },
      enrich: false,
    })
  ).json();
  expect(body.ok).toBe(true);
  expect(body.listing.item_specifics.Marke).toBe("Test");
  expect(body.listing.title).toBe("Test Sonnenbrille");
  expect(body.listing.glasses_rules_version).toBe(1);
  const second = await (
    await prepareListing({
      listing: { ...body.listing, title: "Meine eigene Korrektur" },
      enrich: false,
    })
  ).json();
  expect(second.listing.title).toBe("Meine eigene Korrektur");
  expect(second.listing.secondary_category_id).toBe("22");
});
it("removes invented fields and defaults only the official lens material", async () => {
  vi.mocked(categoryAspects).mockResolvedValue([
    {
      name: "Marke",
      required: true,
      mode: "FREE_TEXT",
      cardinality: "SINGLE",
      values: [],
    },
    {
      name: "Gläsermaterial",
      required: false,
      mode: "SELECTION_ONLY",
      cardinality: "MULTI",
      values: ["Glas", "Kunststoff"],
    },
  ]);
  const body = await (
    await prepareListing({
      listing: {
        title: "Test Sonnenbrille",
        description: "Text",
        brand: "Test",
        material: "Metal",
        item_specifics: {
          "Hinge Type": "Special",
          "Nose Pad Type": "Saddle",
          "Temple Tip Material": "Plastic",
          "Lens Treatment": "None",
        },
      },
      enrich: false,
    })
  ).json();
  expect(body.ok).toBe(true);
  expect(body.listing.item_specifics).toEqual({
    Marke: "Test",
    Gläsermaterial: "Kunststoff",
  });
  expect(body.listing.category_fields_version).toBe(1);
  const second = await (
    await prepareListing({
      listing: {
        ...body.listing,
        item_specifics: { Marke: "Test", Gläsermaterial: "" },
      },
      enrich: false,
    })
  ).json();
  expect(second.listing.item_specifics.Gläsermaterial || "").toBe("");
});
