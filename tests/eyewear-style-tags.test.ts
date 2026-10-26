import { expect, it } from "vitest";
import { eyewearStyleTagsPatch } from "@/lib/eyewear-style-tags";
import { parseListing } from "@/lib/validation";
import type { AspectMeta } from "@/lib/ebay/taxonomy";
const field = (name: string, extra: Partial<AspectMeta> = {}): AspectMeta => ({
  name,
  required: false,
  usage: "OPTIONAL",
  mode: "FREE_TEXT",
  cardinality: "MULTI",
  values: [],
  ...extra,
});
const listing = {
  title: "CRH Brille Rund Panto Schwarz Silber",
  description: "Text",
  item_specifics: { Marke: "CRH", Form: "Rund", Herstellungsjahr: "" },
};
it("supplies five unique shape/color associations per field without inventing dates or characters", () => {
  const patch = eyewearStyleTagsPatch(listing, [
    field("Thema"),
    field("Charakter"),
  ])!;
  for (const name of ["Thema", "Charakter"]) {
    const values = patch.item_specifics![name].split(" | ");
    expect(new Set(values).size).toBe(5);
    expect(values).toContain("Panto");
    expect(patch.estimates![name]).toBeUndefined();
    expect(patch.evidence![name]).toBeUndefined();
  }
  expect(patch.item_specifics!.Herstellungsjahr).toBe("");
  expect(patch.item_specifics!.Marke).toBe("CRH");
});
it("preserves selected tags and allows originals only in FREE_TEXT categories", () => {
  const l = { ...listing, item_specifics: { Thema: "Mein Stil" } };
  expect(
    eyewearStyleTagsPatch(l, [
      field("Thema", { values: ["Retro"] }),
    ])!.item_specifics!.Thema.split(" | "),
  ).toHaveLength(5);
  expect(
    eyewearStyleTagsPatch(listing, [
      field("Thema", {
        mode: "SELECTION_ONLY",
        values: ["Retro", "Panto", "Batman", "Flieger"],
      }),
    ])!.item_specifics!.Thema,
  ).toBe("Panto | Retro");
});
it("respects single selection and preserves later manual deletions across persistence", () => {
  expect(
    eyewearStyleTagsPatch(listing, [
      field("Charakter", { cardinality: "SINGLE" }),
    ])!.item_specifics!.Charakter.split(" | "),
  ).toHaveLength(1);
  const patch = eyewearStyleTagsPatch(listing, [field("Thema")])!;
  const saved = parseListing({
    ...listing,
    ...patch,
    item_specifics: { Thema: "" },
  });
  expect(eyewearStyleTagsPatch(saved, [field("Thema")])).toBeUndefined();
});
it("does not mark drafts as processed before category metadata exists", () => {
  expect(eyewearStyleTagsPatch(listing, [])).toBeUndefined();
});
