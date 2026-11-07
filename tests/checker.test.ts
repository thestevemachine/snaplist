import { describe, it, expect } from "vitest";
import { checkerResultSchema, CHECKER_PROMPT } from "../lib/checker";
describe("Checker output boundary", () => {
  const sample = {
    title: "Blaues Hemd",
    description: "Blaues Hemd mit sichtbarem Etikett.",
    price: 15,
    priceReason: "Geschätzter Wiederverkaufspreis",
    uncertainties: ["Größe prüfen"],
  };
  it("allows uncertain prices without inventing a value", () => {
    expect(
      checkerResultSchema.parse({ ...sample, price: null }).price,
    ).toBeNull();
  });
  it("rejects invalid prices and unbounded output", () => {
    for (const price of [-1, 0, Infinity, "15"])
      expect(checkerResultSchema.safeParse({ ...sample, price }).success).toBe(
        false,
      );
    expect(
      checkerResultSchema.safeParse({ ...sample, title: "x".repeat(101) })
        .success,
    ).toBe(false);
  });
  it("keeps private listing rules separate from shop defaults", () => {
    expect(CHECKER_PROMPT).toContain("KEINEN Live-Zugriff");
    expect(CHECKER_PROMPT).toContain(
      "Keine pauschale Behauptung neu/ungetragen",
    );
  });
});
