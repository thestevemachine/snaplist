import { describe, it, expect } from "vitest";
import {
  reducedPrice,
  percentUnits,
  exclusions,
  filtered,
  quickSelect,
} from "../../lib/relister/domain";
import { sampleListing } from "../../lib/relister/simulation";
describe("Re-Lister selection and pricing", () => {
  it.each([0, 2, 4, 6, 8, 10, 12.5, 99.9])("accepts %s percent", (p) =>
    expect(reducedPrice(4999, p)).toBeGreaterThan(0),
  );
  it("rounds 49.99 less 6 percent to 46.99 and accepts comma", () => {
    expect(reducedPrice(4999, "6")).toBe(4699);
    expect(reducedPrice(10000, "3,5")).toBe(9650);
  });
  it.each([
    "-1",
    "100",
    "Infinity",
    "NaN",
    "1e2",
    "",
    "1.00001",
    null,
    {},
    true,
  ])("rejects invalid percent %j", (p) =>
    expect(() => percentUnits(p)).toThrow(),
  );
  it("filters actual marketplace and seller, not currency/country", () => {
    expect(
      exclusions({ ...sampleListing("1"), site: "UK" }, "SIMULATION"),
    ).toContain("Kein deutsches Originalangebot");
    expect(exclusions(sampleListing("1"), "other")).toContain(
      "Anderes Verkäuferkonto",
    );
  });
  it.each([
    { quantity: null },
    { sold: null },
    { quantity: 2 },
    { sold: 1 },
    { variations: true },
    { management: "inventory" },
    { offers: "unknown" },
    { promotion: "active" },
    { type: "Chinese" },
    { active: false },
  ])("excludes unsafe state %j", (patch) =>
    expect(
      exclusions({ ...sampleListing("1"), ...patch } as any, "SIMULATION")
        .length,
    ).toBeGreaterThan(0),
  );
  it("blocks offer thresholds above target", () =>
    expect(
      exclusions(
        { ...sampleListing("1"), autoAcceptCents: 4900 },
        "SIMULATION",
        4699,
      ),
    ).toContain("Preisvorschlagsgrenze über Zielpreis"));
  it("selects over all pages after filtering/sorting and skips unsuitable rows", () => {
    const all = Array.from({ length: 205 }, (_, i) => ({
      ...sampleListing(String(i).padStart(3, "0")),
      started: new Date(2020, 0, i + 1).toISOString(),
    }));
    all[0].sold = 1;
    const sorted = filtered(all, "Testbrille", "oldest");
    expect(quickSelect(sorted, "SIMULATION", 200)).toHaveLength(200);
    expect(quickSelect(sorted, "SIMULATION", 200)[0]).toBe("001");
    expect(quickSelect(sorted, "SIMULATION", 200)[199]).toBe("200");
  });
  it("puts missing views last in both directions", () => {
    const a = { ...sampleListing("a"), views: 3 },
      b = { ...sampleListing("b"), views: null },
      c = { ...sampleListing("c"), views: 0 };
    expect(filtered([a, b, c], "", "viewsAsc").map((l) => l.id)).toEqual([
      "c",
      "a",
      "b",
    ]);
    expect(filtered([a, b, c], "", "viewsDesc").map((l) => l.id)).toEqual([
      "a",
      "c",
      "b",
    ]);
  });
});
