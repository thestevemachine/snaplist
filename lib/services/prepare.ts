import { mergeCategoryAspects, sunglassesPair } from "@/lib/ebay/secondary-category";
import { EBAY_MARKETPLACE_ID } from "@/lib/ebay/config";
import { applyListingDefaults } from "@/lib/listing-defaults";
import { categoryMatches, expectedDepartment, categorySearchQuery, isSunglasses } from "@/lib/category-selection";
import { NextRequest, NextResponse } from "next/server";
import { guardApiRequest } from "@/lib/api-guard";
import {
  parseListing,
  imagesSchema,
  validationMessage,
} from "@/lib/validation";
import {
  categoryAspects,
  suggestLeafCategories,
  acceptedConditionIds,
} from "@/lib/ebay/taxonomy";
import {
  buildAspects,
  reconcileAspects,
  CONDITION_ID_ENUM,
} from "@/lib/ebay/publish";
import {
  enforceCardinality,
  sanitizeNumericAspects,
  snapStandardSizes,
} from "@/lib/ebay/aspects";
import { fillRecommendedAspects } from "@/lib/ebay/aspectFill";
import { validateAspects } from "@/lib/ebay/draft";
import { EBAY_COOKIE, sellerAccessToken } from "@/lib/ebay/session";
import { signReview } from "@/lib/review";
import { withDeadline } from "@/lib/network";
import { collectUsage, currentUsage } from "@/lib/ai-usage";
export const maxDuration = 180;
export async function prepareListing(body: any, sealedConnection?: string) {
  return (
    await collectUsage(() =>
      withDeadline(150_000, async () => {
        try {
          const listing = parseListing(body.listing);
          const images =
            body.enrich === true ? imagesSchema.parse(body.images) : [];
          const dual = EBAY_MARKETPLACE_ID === "EBAY_DE" && isSunglasses(listing);
          const pair = dual ? sunglassesPair(...await Promise.all([suggestLeafCategories("Sonnenbrille Herren", 10), suggestLeafCategories("Sonnenbrille Damen", 10)]), listing) : undefined;
          const suggestions = pair ? [...pair] : listing.category_id
            ? []
            : await suggestLeafCategories(
                categorySearchQuery(listing, EBAY_MARKETPLACE_ID === "EBAY_DE"),
                10,
              );
          const compatible = suggestions.filter((c) =>
            categoryMatches(c, listing),
          );
          const id = pair?.[0].id || listing.category_id || compatible[0]?.id;
          const secondaryId = pair?.[1].id;
          listing.secondary_category_id = secondaryId;
          if (!id)
            throw new Error(
              "Could not resolve a category matching this department. Review the department/category and enter the correct leaf category ID.",
            );
          const token = await sellerAccessToken(sealedConnection);
          let [meta, ids] = await Promise.all([
            categoryAspects(id),
            acceptedConditionIds(id, token ?? undefined),
          ]);
          if (!meta.length || !ids.size)
            throw new Error(
              "Category specifics or conditions could not be loaded. Connect eBay and retry.",
            );
          if (secondaryId) {
            const [secondMeta, secondIds] = await Promise.all([categoryAspects(secondaryId), acceptedConditionIds(secondaryId, token ?? undefined)]);
            if (!secondMeta.length || !secondIds.size) throw new Error("Die zweite Kategorie konnte nicht geprüft werden.");
            meta = mergeCategoryAspects(meta, secondMeta);
            ids = new Set([...ids].filter(id => secondIds.has(id)));
            if (!ids.size) throw new Error("Die Kategorien unterstützen keinen gemeinsamen Zustand.");
          }
          const departmentMeta = meta.find((a) => a.name === "Department");
          const expected = expectedDepartment(listing);
          if (
            !dual && expected &&
            departmentMeta?.mode === "SELECTION_ONLY" &&
            !departmentMeta.values.includes(expected)
          )
            throw new Error(
              `This category does not accept Department ${expected}. Choose the correct category.`,
            );
          applyListingDefaults(listing, meta, ids);
          const aspects = buildAspects(listing, listing.category || "");
          reconcileAspects(aspects, meta, listing, listing.category || "");
          if (body.enrich === true)
            await fillRecommendedAspects(
              listing,
              aspects,
              meta,
              "draft",
              images,
            );
          enforceCardinality(aspects, meta);
          sanitizeNumericAspects(aspects, meta);
          snapStandardSizes(aspects, meta);
          const conditions = [...ids]
            .filter((id) => CONDITION_ID_ENUM[id])
            .map((id) => ({
              value: CONDITION_ID_ENUM[id],
              label:
                id === 1500
                  ? "Neu ohne Etikett / neu: Sonstige (1500)"
                  : id === 2990
                  ? "Pre-owned Excellent (2990)"
                  : `${CONDITION_ID_ENUM[id].replace(/_/g, " ")} (${id})`,
            }));
          if (ids.has(2990) || ids.has(3010)) {
            const c = conditions.find(
              (c) => c.value === CONDITION_ID_ENUM[3000],
            );
            if (c) c.label = "Pre-owned Good (3000)";
          }
          listing.category_id = id;
          listing.item_specifics = Object.fromEntries(
            Object.entries(aspects).map(([k, v]) => [k, v.join(" | ")]),
          );
          // Preserve supported seller choices/defaults; never substitute another grade.
          if (!conditions.some((c) => c.value === listing.ebay_condition))
            listing.ebay_condition = "";
          const expiresAt = Date.now() + 23 * 3600_000;
          return NextResponse.json({
            ok: true,
            listing,
            preparation: {
              categoryId: id,
              secondaryCategoryId: secondaryId,
              secondaryCategoryName: pair?.[1].path,
              categoryName:
                suggestions.find((c) => c.id === id)?.path || `Category ${id}`,
              suggestions: pair ? [...pair] : compatible,
              aspects: meta,
              conditions,
              expiresAt,
              signature: signReview(id, expiresAt, secondaryId),
              issues: validateAspects(aspects, meta),
            },
            usage: currentUsage(),
          });
        } catch (e) {
          return NextResponse.json(
            { ok: false, error: validationMessage(e), usage: currentUsage() },
            { status: 422 },
          );
        }
      }),
    )
  ).result;
}
