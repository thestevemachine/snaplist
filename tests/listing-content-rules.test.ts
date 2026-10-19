import { it, expect } from "vitest";
import {
  applyContentRules,
  changeEyewearKind,
  contentIssues,
  migrateContentGroup,
} from "@/lib/listing-content-rules";
import {
  isSunglasses,
  categorySearchQuery,
  categoryMatches,
} from "@/lib/category-selection";
import type { ListingResult, ItemGroup } from "@/lib/types";
const l: ListingResult = {
  title: "Lindberg Brille",
  description: "Beschreibung",
  item_type: "Brille",
  condition_notes: "Kratzer vom Foto",
};
it("an explicit optical classification outranks stale sunglasses text and hints", () => {
  expect(
    isSunglasses({ ...l, title: "Sonnenbrille", category_hint: "sunglasses" }),
  ).toBe(false);
  expect(
    isSunglasses({ ...l, eyewear_kind: "optical", item_type: "Sunglasses" }),
  ).toBe(false);
  expect(categorySearchQuery({ ...l, eyewear_kind: "optical" }, true)).toBe(
    "Brillenfassungen",
  );
  expect(
    categoryMatches(
      { id: "1", name: "Sonnenbrillen", path: "Herren" },
      { ...l, eyewear_kind: "optical" },
    ),
  ).toBe(false);
});
it("manual correction clears both old categories and changes only product noun", () => {
  const next = changeEyewearKind(
    {
      ...l,
      title: "Lindberg Sonnenbrille Schwarz 1234",
      category_id: "79720",
      secondary_category_id: "45246",
    },
    "optical",
  );
  expect(next.title).toBe("Lindberg Brille Schwarz 1234");
  expect(next.category_id).toBe("");
  expect(next.secondary_category_id).toBeUndefined();
  expect(isSunglasses(next)).toBe(false);
});
it.each([
  "Flieger",
  "Fliegerbrille",
  "Fliegerform",
  "Aviator",
  "AVIATORS",
  "Clubmaster",
  "Klappmaster",
])("removes prohibited word %s from generated listing fields", (word) => {
  const next = applyContentRules({
    ...l,
    title: `Lindberg ${word} Brille`,
    description: `Eine ${word} Fassung`,
    item_specifics: { Form: word },
    seo_keywords: [word],
  });
  expect(next.title).toBe("Lindberg Brille");
  expect(next.item_specifics?.Form).toBe("");
  expect(next.condition_notes).toBe("Ungetragen ohne Etui");
  expect(contentIssues(next)).toEqual([]);
  expect(contentIssues({ ...l, title: word }).length).toBe(1);
});
it("uncertain classifications require seller choice", () =>
  expect(contentIssues({ ...l, eyewear_kind: "uncertain" }).join()).toContain(
    "Brillenart unklar",
  ));
it("migrates open drafts once but leaves published drafts untouched", () => {
  const g: ItemGroup = {
    id: "1",
    name: "Brille",
    sku: "1",
    photoIds: ["1"],
    status: "done",
    listing: l,
  };
  const next = migrateContentGroup(g);
  expect(next.listing?.condition_notes).toBe("Ungetragen ohne Etui");
  expect(migrateContentGroup(next)).toBe(next);
  const posted = { ...g, postStatus: "posted" as const };
  expect(migrateContentGroup(posted)).toBe(posted);
});

it.each(["Pilot", "Pilotenbrille", "Pilotenform"])(
  "explicitly allows %s",
  (word) => {
    const next = applyContentRules({
      ...l,
      title: `Lindberg ${word} Brille`,
      item_specifics: { Form: word },
    });
    expect(next.title).toBe(`Lindberg ${word} Brille`);
    expect(next.item_specifics?.Form).toBe(word);
    expect(contentIssues(next)).toEqual([]);
  },
);
it("updates old word-list drafts without restoring removed text or changing publication", () => {
  const g: ItemGroup = {
    id: "1",
    name: "Brille",
    sku: "1",
    photoIds: ["1"],
    status: "done",
    listing: {
      ...l,
      title: "Lindberg Pilot Flieger Brille",
      content_rules_version: 1,
    },
  };
  const next = migrateContentGroup(g);
  expect(next.listing?.title).toBe("Lindberg Pilot Brille");
  expect(next.listing?.content_rules_version).toBe(3);
  expect(migrateContentGroup(next)).toBe(next);
});

it("preserves seller condition notes during preparation, including deliberate clearing", () => {
  expect(
    applyContentRules({ ...l, condition_notes: "Ungetragen, mit Etui" }, false)
      .condition_notes,
  ).toBe("Ungetragen, mit Etui");
  expect(
    applyContentRules({ ...l, condition_notes: "" }, false).condition_notes,
  ).toBe("");
});
