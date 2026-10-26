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
  expect(body.listing.glasses_rules_version).toBe(4);
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
      usage: "REQUIRED",
      mode: "FREE_TEXT",
      cardinality: "SINGLE",
      values: [],
    },
    {
      name: "Gläsermaterial",
      required: false,
      usage: "OPTIONAL",
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
  expect(body.listing.category_fields_version).toBe(4);
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
it("preserves a manual title even before the first category preparation", async () => {
  const body = await (
    await prepareListing({
      listing: {
        title: "Meine Sonnenbrille korrigiert",
        title_manually_edited: true,
        description: "Text",
        item_specifics: { Marke: "Lindberg" },
      },
      enrich: false,
    })
  ).json();
  expect(body.ok).toBe(true);
  expect(body.listing.title).toBe("Meine Sonnenbrille korrigiert");
});
it("stops an uncertain classification before category lookup", async () => {
  const body = await (
    await prepareListing({
      listing: {
        title: "Brille",
        description: "Text",
        eyewear_kind: "uncertain",
      },
      enrich: false,
    })
  ).json();
  expect(body.ok).toBe(false);
  expect(body.error).toContain("Brillenart unklar");
  expect(suggestLeafCategories).not.toHaveBeenCalled();
});
it("prepares optical frames without either sunglasses category", async () => {
  vi.mocked(suggestLeafCategories).mockResolvedValue([
    {
      id: "180957",
      name: "Brillenfassungen",
      path: "Beauty & Gesundheit > Augenoptik > Brillenfassungen",
    },
  ]);
  const body = await (
    await prepareListing({
      listing: {
        title: "Lindberg Sonnenbrille",
        item_type: "Brille",
        eyewear_kind: "optical",
        description: "Text",
        condition_notes: "Kratzer",
        item_specifics: { Marke: "Lindberg" },
      },
      enrich: false,
    })
  ).json();
  expect(body.ok).toBe(true);
  expect(suggestLeafCategories).toHaveBeenCalledWith("Brillenfassungen", 10);
  expect(body.listing.category_id).toBe("180957");
  expect(body.listing.secondary_category_id).toBeUndefined();
  expect(body.listing.title).not.toContain("Sonnenbrille");
  expect(body.listing.condition_notes).toBe("Kratzer");
});

it("fills missing required Besonderheiten for an already prepared version-4 draft without KI enrichment", async () => {
  vi.mocked(categoryAspects).mockResolvedValue([
    {
      name: "Besonderheiten",
      required: true,
      usage: "REQUIRED",
      mode: "SELECTION_ONLY",
      cardinality: "MULTI",
      values: ["Wasserfest", "Randlos"],
    },
  ]);
  const body = await (
    await prepareListing({
      listing: {
        title: "Test Brille",
        description: "Text",
        eyewear_kind: "optical",
        category_id: "180957",
        category_fields_version: 4,
        glasses_rules_version: 4,
        item_specifics: {},
      },
      enrich: false,
    })
  ).json();
  expect(body.ok).toBe(true);
  expect(body.listing.item_specifics.Besonderheiten).toBe("Wasserfest");
  expect(body.preparation.issues).not.toContainEqual(
    expect.stringMatching(/Besonderheiten/),
  );
  expect(body.usage).toEqual([]);
});

it("maps stored front-photo height into the actual category Glashöhe field", async () => {
  vi.mocked(categoryAspects).mockResolvedValue([
    {
      name: "Glashöhe",
      mode: "FREE_TEXT",
      values: [],
      cardinality: "SINGLE",
      usage: "OPTIONAL",
      required: false,
    },
  ]);
  const data = await (
    await prepareListing({
      listing: {
        title: "Test Brille",
        description: "Text",
        eyewear_kind: "optical",
        category_id: "180957",
        category_fields_version: 4,
        glasses_rules_version: 4,
        item_specifics: { Glashöhe: "" },
        frontMeasurement: {
          method: "front-photo-ratio-v1",
          status: "uncertain",
          photoIndex: 1,
          reasons: ["Perspektive"],
          lensHeightMm: 40,
          totalWidthMm: 138,
        },
      },
      enrich: false,
    })
  ).json();
  expect(data.ok).toBe(true);
  expect(data.listing.item_specifics.Glashöhe).toBe("40 mm");
  expect(data.listing.estimates.Glashöhe).toBe(59);
  expect(data.usage).toEqual([]);
});
