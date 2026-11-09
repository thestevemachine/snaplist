import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { applyShopListing, emptyPreferences } from "../lib/shop-preferences";
import { applyListingDefaults } from "../lib/listing-defaults";
import { isGlasses } from "../lib/glasses-rules";
import { isSunglasses } from "../lib/category-selection";
import { usesEyewearDefaults } from "../lib/listing-mode";
import { composeStoryDescription, storyFacts, validateStory } from "../lib/storytelling";
import { listingSchema } from "../lib/validation";
import type { ListingResult } from "../lib/types";

const model = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("../lib/anthropic", () => ({
  getClient: () => ({ messages: { create: model.create } }),
  parseModelJson: JSON.parse,
}));
vi.mock("../lib/accounts/server", () => ({ withAccount: (handler: unknown) => handler, sameOrigin: () => true }));
vi.mock("../lib/api-guard", () => ({
  guardApiRequest: () => null,
  safeErrorResponse: (_context: string, _error: unknown, message: string) =>
    Response.json({ ok: false, error: message }, { status: 500 }),
}));
import { POST } from "../app/api/storytelling/route";

const vase: ListingResult = {
  title: "Blaue Vase",
  item_type: "Vase",
  eyewear_kind: "not_eyewear",
  description: "Blaue Vase.\n\nZustand und Mängel\nGebraucht.\n\nLieferumfang\nEine Vase.",
  condition: "GOOD",
  condition_notes: "Gebraucht.",
  item_specifics: { Farbe: "Blau", Material: "Porzellan" },
  estimates: { Material: 55 },
};
const request = (listing = vase, history = "") => POST(new NextRequest(
  "https://snaplist-bay.vercel.app/api/storytelling", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ listing, history, images: [{ mediaType: "image/jpeg", data: "/9j/" }] }),
  },
));
function answer(paragraph: string) {
  model.create.mockResolvedValue({
    content: [{ type: "text", text: JSON.stringify({ paragraph }) }],
    model: "gemini-3.5-flash-lite",
    usage: { input_tokens: 12, output_tokens: 15 },
  });
}
beforeEach(() => vi.clearAllMocks());

describe("normal article defaults", () => {
  it("keeps the AI description and defaults to used instead of the eyewear template", () => {
    const settings = { ...emptyPreferences(), descriptionTemplate: "Ungetragen ohne Etui\nBrillen-Größentabelle" };
    const result = applyShopListing(vase, settings);
    expect(result.description).toBe(vase.description);
    expect(result.condition).toBe("GOOD");
    expect(result.condition_notes).toBe("Gebraucht.");
    expect(result.item_specifics).toEqual(vase.item_specifics);
    applyListingDefaults(result, [], new Set([1000, 1500, 3000]));
    expect(result.ebay_condition).toBe("USED_EXCELLENT");
  });
  it("keeps a reviewed condition and handles category-specific used grades", () => {
    const result = { ...vase, ebay_condition: "USED_GOOD" };
    applyListingDefaults(result, [], new Set([1500, 3000, 5000]));
    expect(result.ebay_condition).toBe("USED_GOOD");
    const clothing = { ...vase };
    applyListingDefaults(clothing, [], new Set([1500, 3010]));
    expect(clothing.ebay_condition).toBe("PRE_OWNED_FAIR");
  });
  it("does not mistake an eyewear case for sunglasses or apply eyewear defaults to a normal object", () => {
    const caseListing = { ...vase, title: "Brillenetui für Sonnenbrille", item_type: "Brillenetui" };
    expect(usesEyewearDefaults(caseListing)).toBe(true);
    expect(isGlasses(caseListing)).toBe(false);
    expect(isSunglasses(caseListing)).toBe(false);
    expect(usesEyewearDefaults(vase)).toBe(false);
    expect(isGlasses({ ...vase, title: "Skulptur mit Brille" })).toBe(false);
    expect(applyShopListing({ ...vase, title: "Brille", item_type: "Brille", eyewear_kind: "optical" }, emptyPreferences()).ebay_condition).toBe("NEW_OTHER");
  });
});

describe("story generation through the API", () => {
  it("condenses genuine history and preserves factual details after the preview paragraph", async () => {
    answer("Diese Vase stand auf meinem Küchentisch. Jetzt gebe ich sie weiter.");
    const response = await request(vase, "Die Vase stand auf meinem Küchentisch. Ich gebe sie weiter.");
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.description).toContain("Blaue Vase.\n\nDiese Vase");
    expect(data.description).toContain("Zustand und Mängel\nGebraucht.");
    expect(data.description).toContain("Lieferumfang\nEine Vase.");
    const call = model.create.mock.calls[0][0];
    const input = JSON.parse(call.messages[0].content.at(-1).text);
    expect(input.geschichte).toContain("Küchentisch");
    expect(input.eigenschaften).toEqual({ Farbe: "Blau" });
    expect(call.messages[0].content[0].type).toBe("image");
    expect(call.system).toContain("Erfinde niemals Vorbesitzer");
    expect(data.usage[0].stage).toBe("storytelling");
  });
  it("uses an explicitly possible scene when no history was supplied", async () => {
    answer("Stell dir diese blaue Vase mit Blumen auf deinem Tisch vor.");
    const data = await (await request()).json();
    expect(data.ok).toBe(true);
    expect(data.paragraph).toContain("Stell dir");
    expect(data.description).toContain(vase.description.split("\n\n")[0]);
  });
  it("omits the paragraph for incomplete details and rejects an empty factual draft before generation", async () => {
    const incomplete = { ...vase, title: "Gegenstand", item_type: "", item_specifics: {}, description: "Gegenstand.\n\nGebraucht." };
    answer("");
    const data = await (await request(incomplete)).json();
    expect(data.ok).toBe(true);
    expect(data.paragraph).toBe("");
    expect(data.description).toBe(incomplete.description);
    model.create.mockClear();
    expect((await request({ ...incomplete, description: "" })).status).toBe(400);
    expect(model.create).not.toHaveBeenCalled();
  });
  it("rejects unsupported storytelling output and eyewear requests", async () => {
    expect(() => validateStory("Diese Vase gehörte meiner Großmutter.", "")).toThrow();
    expect(() => validateStory("Ein Satz.", "Vom Küchentisch.")).toThrow();
    expect(() => validateStory(Array(71).fill("Wort").join(" "), "echte Geschichte")).toThrow();
    expect((await request({ ...vase, title: "Brille", eyewear_kind: "optical" })).status).toBe(400);
    expect(model.create).not.toHaveBeenCalled();
  });
});

it("persists the off-by-default optional settings without changing title or item specifics", () => {
  expect(listingSchema.parse(vase).storytelling).toBeUndefined();
  const result = listingSchema.parse({ ...vase, storytelling: { enabled: true, history: "Eigener Gebrauch." } });
  expect(result.storytelling?.history).toBe("Eigener Gebrauch.");
  expect(result.title).toBe(vase.title);
  expect(storyFacts(result)).toEqual({ Farbe: "Blau" });
  expect(composeStoryDescription(vase.description, "")).toBe(vase.description);
});
