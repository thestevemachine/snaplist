import { contentIssues } from "@/lib/listing-content-rules";
import { isSunglasses } from "./category-selection";
import type { ItemGroup } from "./types";
import { shippingSchema, skuSchema } from "./validation";
import { validateAspects } from "./ebay/draft";
export function draftIssues(g: ItemGroup): string[] {
  const l = g.listing;
  if (!l) return ["Bitte zuerst einen Entwurf erstellen."];
  const issues: string[] = [...contentIssues(l)];
  if (isSunglasses(l) && !l.secondary_category_id)
    issues.push("Bitte Sonnenbrillen für Herren und Damen vorbereiten.");
  if (!skuSchema.safeParse(g.sku).success)
    issues.push("Bitte eine gültige SKU eingeben.");
  if (!l.title.trim() || l.title.length > 80)
    issues.push("Der Titel muss 1–80 Zeichen haben.");
  if (!l.description.trim()) issues.push("Bitte eine Beschreibung eingeben.");
  if (
    !Number.isFinite(Number(l.suggested_price)) ||
    Number(l.suggested_price) <= 0
  )
    issues.push("Bitte einen Preis größer als null eingeben.");
  if (
    !g.preparation ||
    g.preparation.categoryId !== l.category_id ||
    (g.preparation.secondaryCategoryId || "") !==
      (l.secondary_category_id || "") ||
    g.preparation.expiresAt < Date.now()
  )
    issues.push("Bitte die Kategorie vor dem Veröffentlichen vorbereiten.");
  else {
    if (!g.preparation.conditions.some((c) => c.value === l.ebay_condition))
      issues.push("Choose an eBay-Zustand.");
    issues.push(
      ...validateAspects(
        Object.fromEntries(
          Object.entries(l.item_specifics ?? {})
            .filter(([, v]) => v.trim())
            .map(([k, v]) => [k, v.split(" | ").map((x) => x.trim())]),
        ),
        g.preparation.aspects,
      ),
    );
  }
  if (!shippingSchema.safeParse(g.shipping).success)
    issues.push(
      "Bitte Rahmenbedingungen und Artikelstandort auswählen. Vorhandene Paketmaße müssen vollständig und gültig sein.",
    );
  if (!g.photoIds.length || g.photoIds.length > 24)
    issues.push("Bitte 1–24 Fotos für diesen Artikel auswählen.");
  return issues;
}
