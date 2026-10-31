import { expect, it } from "vitest";
import { xml } from "@/lib/ebay/trading";
import { XMLValidator } from "fast-xml-parser";
it("removes XML 1.0 forbidden controls and lone surrogates, preserving German text and supplementary characters", () => {
  const value = xml("Brille\b & <Titan>\u0000\u000b\ud800 äöü 😀\n\t");
  expect(value).toBe("Brille &amp; &lt;Titan&gt; äöü 😀\n\t");
  expect(XMLValidator.validate("<Title>" + value + "</Title>")).toBe(true);
});
