import { DEFAULT_AI_MODEL } from "@/lib/ai-defaults";
import { eyewearStyleTagsPatch } from "@/lib/eyewear-style-tags";
import { frontMeasurementFields } from "@/lib/front-measurement-fields";
import { applyContentRules } from "@/lib/listing-content-rules";
import { mapEyewear } from "@/lib/eyewear-inscriptions";
import {
  categorySpecifics,
  applyFrameMaterialDefault,
  mapGridMeasurements,
  applyEyewearSellerDefaults,
  expandEyewearFeatures,
  applySunglassesLensDefault,
  CATEGORY_FIELDS_VERSION,
  eyewearFeatureDefaultPatch,
} from "@/lib/ebay/category-fields";
import {
  isGlasses,
  germanAspects,
  germanGlassesTitle,
  GLASSES_RULES_VERSION,
} from "@/lib/glasses-rules";
import {
  mergeCategoryAspects,
  sunglassesPair,
} from "@/lib/ebay/secondary-category";
import { EBAY_MARKETPLACE_ID } from "@/lib/ebay/config";
import { applyListingDefaults } from "@/lib/listing-defaults";
import {
  categoryMatches,
  expectedDepartment,
  categorySearchQuery,
  isSunglasses,
} from "@/lib/category-selection";
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
import { resolveModel } from "@/lib/models";
import { providerFor } from "@/lib/ai-catalog";
export const maxDuration = 180;
export async function prepareListing(body: any, sealedConnection?: string) {
  return (
    await collectUsage(() =>
      withDeadline(150_000, async () => {
        try {
          let listing = parseListing(body.listing);
          if (listing.eyewear_kind === "uncertain")
            throw new Error(
              "Brillenart unklar. Bitte Korrektionsfassung oder Sonnenbrille auswählen.",
            );
          const images =
            body.enrich === true ? imagesSchema.parse(body.images) : [];
          const dual =
            EBAY_MARKETPLACE_ID === "EBAY_DE" && isSunglasses(listing);
          const pair = dual
            ? sunglassesPair(
                ...(await Promise.all([
                  suggestLeafCategories("Sonnenbrille Herren", 10),
                  suggestLeafCategories("Sonnenbrille Damen", 10),
                ])),
                listing,
              )
            : undefined;
          const suggestions = pair
            ? [...pair]
            : listing.category_id
              ? []
              : await suggestLeafCategories(
                  categorySearchQuery(
                    listing,
                    EBAY_MARKETPLACE_ID === "EBAY_DE",
                  ),
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
              "Keine passende Kategorie gefunden. Bitte die Kategorie prüfen oder eine passende Kategorie-ID eingeben.",
            );
          const token = await sellerAccessToken(sealedConnection);
          let [meta, ids] = await Promise.all([
            categoryAspects(id),
            acceptedConditionIds(id, token ?? undefined),
          ]);
          if (!meta.length || !ids.size)
            throw new Error(
              "Merkmale oder Zustände konnten nicht geladen werden. Bitte die eBay-Verbindung prüfen und erneut versuchen.",
            );
          if (secondaryId) {
            const [secondMeta, secondIds] = await Promise.all([
              categoryAspects(secondaryId),
              acceptedConditionIds(secondaryId, token ?? undefined),
            ]);
            if (!secondMeta.length || !secondIds.size)
              throw new Error(
                "Die zweite Kategorie konnte nicht geprüft werden.",
              );
            meta = mergeCategoryAspects(meta, secondMeta);
            ids = new Set([...ids].filter((id) => secondIds.has(id)));
            if (!ids.size)
              throw new Error(
                "Die Kategorien unterstützen keinen gemeinsamen Zustand.",
              );
          }
          meta = meta.map((m) => ({
            ...m,
            required:
              m.required ||
              (isGlasses(listing) && /^Besonderheiten$/i.test(m.name)),
            values: m.values.filter(
              (v) => !/flieger|aviator|clubmaster|klappmaster/i.test(v),
            ),
          }));
          const departmentMeta = meta.find((a) => a.name === "Department");
          const expected = expectedDepartment(listing);
          if (
            !dual &&
            expected &&
            departmentMeta?.mode === "SELECTION_ONLY" &&
            !departmentMeta.values.includes(expected)
          )
            throw new Error(
              `This category does not accept Department ${expected}. Choose the correct category.`,
            );
          applyListingDefaults(listing, meta, ids);
          const aspects = buildAspects(listing, listing.category || "");
          const glasses =
            EBAY_MARKETPLACE_ID === "EBAY_DE" && isGlasses(listing);
          if (glasses) {
            mapEyewear(listing, aspects, meta);
            mapGridMeasurements(listing.item_specifics ?? {}, aspects, meta);
            germanAspects(listing, aspects, meta);
          }
          reconcileAspects(aspects, meta, listing, listing.category || "");
          if (body.enrich === true)
            await fillRecommendedAspects(
              listing,
              aspects,
              meta,
              "draft",
              images,
              [],
              providerFor(
                resolveModel(body.analysisModel, DEFAULT_AI_MODEL),
              ) === "anthropic"
                ? "claude-sonnet-4-6"
                : resolveModel(body.analysisModel, DEFAULT_AI_MODEL),
            );
          if (glasses) {
            mapEyewear(listing, aspects, meta);
            mapGridMeasurements(listing.item_specifics ?? {}, aspects, meta);
            germanAspects(listing, aspects, meta);
          }
          if (
            dual &&
            listing.category_fields_version !== CATEGORY_FIELDS_VERSION
          ) {
            const defaulted = applySunglassesLensDefault(aspects, meta);
            if (defaulted) {
              if (listing.evidence) delete listing.evidence[defaulted];
              if (listing.estimates) delete listing.estimates[defaulted];
            }
          }
          if (
            glasses &&
            listing.category_fields_version !== CATEGORY_FIELDS_VERSION
          )
            applyFrameMaterialDefault(aspects, meta);
          if (
            glasses &&
            listing.category_fields_version !== CATEGORY_FIELDS_VERSION
          )
            applyEyewearSellerDefaults(
              aspects,
              meta,
              dual,
              listing.brand || aspects.Marke?.join(" ") || "",
            );
          if (
            glasses &&
            listing.category_fields_version !== CATEGORY_FIELDS_VERSION
          )
            expandEyewearFeatures(aspects, meta);
          if (glasses) {
            for (const field of meta.filter(
              (m) =>
                /^(Bügellänge|Temple Length)$/i.test(m.name) &&
                m.dataType !== "NUMBER",
            )) {
              aspects[field.name] = (aspects[field.name] ?? []).map((value) => {
                if (!/^\d+$/.test(value.trim())) return value;
                const withUnit = value.trim() + " mm";
                return (
                  field.values.find(
                    (v) => v.toLowerCase() === withUnit.toLowerCase(),
                  ) ?? (field.mode === "FREE_TEXT" ? withUnit : value)
                );
              });
            }
          }
          enforceCardinality(aspects, meta);
          sanitizeNumericAspects(aspects, meta);
          snapStandardSizes(aspects, meta);
          const conditions = [...ids]
            .filter((id) => CONDITION_ID_ENUM[id])
            .map((id) => ({
              value: CONDITION_ID_ENUM[id],
              label:
                (
                  {
                    1000: "Neu",
                    1500: "Neu ohne Etikett / neu: Sonstige",
                    1750: "Neu mit Fehlern",
                    2750: "Wie neu",
                    2990: "Gebraucht – ausgezeichnet",
                    3000: "Gebraucht",
                    3010: "Gebraucht – akzeptabel",
                    4000: "Gebraucht – sehr gut",
                    5000: "Gebraucht – gut",
                    6000: "Gebraucht – akzeptabel",
                    7000: "Defekt / Ersatzteile",
                  } as Record<number, string>
                )[id] + ` (${id})`,
            }));
          if (ids.has(2990) || ids.has(3010)) {
            const c = conditions.find(
              (c) => c.value === CONDITION_ID_ENUM[3000],
            );
            if (c) c.label = "Gebraucht – gut (3000)";
          }
          listing.category_id = id;
          listing.item_specifics = Object.fromEntries(
            Object.entries(aspects).map(([k, v]) => [k, v.join(" | ")]),
          );
          if (glasses && !listing.item_type)
            listing.item_type = dual ? "Sonnenbrille" : "Brille";
          if (
            glasses &&
            ((!listing.title_manually_edited &&
              listing.glasses_rules_version !== GLASSES_RULES_VERSION) ||
              body.applyGermanRules === true)
          ) {
            listing.title = germanGlassesTitle(listing, meta);
            listing.glasses_rules_version = GLASSES_RULES_VERSION;
          }
          if (glasses) listing.glasses_rules_version = GLASSES_RULES_VERSION;
          listing.item_specifics = categorySpecifics(
            listing.item_specifics ?? {},
            meta,
          );
          if (glasses) {
            const patch = eyewearFeatureDefaultPatch(listing, meta);
            if (patch) {
              Object.assign(listing, patch);
              for (const [name, value] of Object.entries(
                patch.item_specifics ?? {},
              ))
                aspects[name] = value.split(" | ").filter(Boolean);
            }
          }
          if (glasses) {
            const patch = frontMeasurementFields(listing, meta);
            if (patch) {
              Object.assign(listing, patch);
              for (const [name, value] of Object.entries(
                patch.item_specifics ?? {},
              ))
                aspects[name] = value.split(" | ").filter(Boolean);
            }
          }
          if (glasses) {
            Object.assign(listing, eyewearStyleTagsPatch(listing, meta));
            listing = applyContentRules(listing, false);
            for (const name of ["Thema", "Charakter"])
              if (listing.item_specifics?.[name])
                aspects[name] = listing.item_specifics[name].split(" | ");
          }
          listing.category_fields_version = CATEGORY_FIELDS_VERSION;
          if (listing.evidence)
            listing.evidence = categorySpecifics(listing.evidence, meta);
          if (listing.estimates)
            listing.estimates = categorySpecifics(listing.estimates, meta);
          // Default only an unset choice, never replace a reviewed grade.
          if (listing.ebay_condition === undefined && conditions.some(c => c.value === "NEW_OTHER"))
            listing.ebay_condition = "NEW_OTHER";
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
