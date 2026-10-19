import {
  applyContentRules,
  CLASSIFICATION_PROMPT,
} from "@/lib/listing-content-rules";
import {
  extractEyewear,
  parseBoxDimensions,
  INSCRIPTION_PROMPT,
} from "@/lib/eyewear-inscriptions";
import { isGlasses } from "@/lib/glasses-rules";
import { GERMAN_LISTING_PROMPT } from "@/lib/glasses-rules";
import { EBAY_MARKETPLACE_ID } from "@/lib/ebay/config";
import { cleanGeneratedDescription } from "@/lib/description";
import { acceptedPhotoFact, isEstimate } from "@/lib/photo-facts";
import { AI_LISTING_SCHEMA } from "@/lib/ai-schema";
import {
  parseListing,
  imagesSchema,
  validationMessage,
} from "@/lib/validation";
import { collectUsage, currentUsage } from "@/lib/ai-usage";
import { measuredMessage } from "@/lib/ai-usage";
import { NextRequest, NextResponse } from "next/server";
import type Anthropic from "@anthropic-ai/sdk";
import {
  getClient,
  parseModelJson,
  AnthropicAuthError,
  anthropicAuthError,
} from "@/lib/anthropic";
import { guardApiRequest, safeErrorResponse } from "@/lib/api-guard";
import {
  PROFILE_ROUTER_PROMPT,
  buildProfiledAnalysisPrompt,
  normalizeItemProfile,
} from "@/lib/prompts";
import { toImageBlock, type ImageBlock } from "@/lib/images";
import { optimizeTitle } from "@/lib/titleOptimizer";
import { applyPriceMarkup, priceMarkupPercent } from "@/lib/pricing";
import { resolveModel } from "@/lib/models";
import { AiProviderError, isAiTerminal } from "@/lib/ai-providers";
import { providerFor } from "@/lib/ai-catalog";
import type { AnalyzeRequestBody, ListingResult } from "@/lib/types";

// Analysis takes 20-40s for a multi-photo item on a good day — and far longer
// when the API is slow. Run under the platform's 300s cap with our own budget
// (below) so a slow run fails with an error we control and a working Retry,
// not a platform kill (FUNCTION_INVOCATION_TIMEOUT).
export const maxDuration = 300;

const ANALYSIS_MODEL = "claude-opus-4-8";
const ROUTER_MODEL = "claude-sonnet-4-6";
const MAX_IMAGES = 24;

// Stop starting work once the budget is spent — headroom under maxDuration.
const ANALYZE_TIME_BUDGET_MS = 250_000;
// Per-call caps: the SDK's default timeout is 10 MINUTES, so without these one
// stalled call would eat the whole function budget. SDK-internal retries stay
// off — the loops below are the single retry layer.
const ROUTER_TIMEOUT_MS = 20_000;
const ANALYSIS_CALL_TIMEOUT_MS = 120_000;
// Don't bother starting a call with less budget than this left.
const MIN_CALL_MS = 5_000;

function toImageBlocks(images: AnalyzeRequestBody["images"]): ImageBlock[] {
  const blocks: ImageBlock[] = [];
  for (const img of images.slice(0, MAX_IMAGES)) {
    const block = toImageBlock(img);
    if (block) blocks.push(block);
  }
  return blocks;
}

// Mirrors route_item_profile(): honor a forced profile, else ask the model.
// Falls back to hard_goods when the router can't run (error or budget spent) —
// same fallback the catch below has always used.
async function routeProfile(
  client: Anthropic,
  imageBlocks: ImageBlock[],
  requested: string,
  routerModel: string,
  deadline: number,
): Promise<string> {
  const forced = normalizeItemProfile(requested);
  if (forced !== "auto") return forced;

  const remaining = deadline - Date.now();
  if (remaining < MIN_CALL_MS) return "hard_goods";

  try {
    const resp = await measuredMessage(
      "routing",
      client,
      {
        model: routerModel,
        max_tokens: 300,
        messages: [
          {
            role: "user",
            content: [
              ...imageBlocks,
              { type: "text", text: PROFILE_ROUTER_PROMPT },
            ],
          },
        ],
      },
      { timeout: Math.min(ROUTER_TIMEOUT_MS, remaining), maxRetries: 0 },
    );
    const text = firstText(resp);
    const data = parseModelJson<{ profile?: string }>(text);
    const routed = normalizeItemProfile(data?.profile ?? "auto");
    return routed !== "auto" ? routed : "hard_goods";
  } catch (e) {
    if (isAiTerminal(e)) throw e;
    // Auth/billing failures must surface, not silently fall back to a profile.
    const fatal = anthropicAuthError(e);
    if (fatal) throw fatal;
    return "hard_goods";
  }
}

function firstText(resp: Anthropic.Message): string {
  const block = resp.content.find((b) => b.type === "text");
  return block && block.type === "text" ? block.text.trim() : "";
}

async function handle(input: unknown) {
  let body: AnalyzeRequestBody;
  try {
    body = input as AnalyzeRequestBody;
    imagesSchema.parse(body.images);
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid request body." },
      { status: 400 },
    );
  }

  // Validate client-supplied models against the server allowlist; fall back to
  // the trusted default on anything unknown (prevents billing an arbitrary or
  // premium model to the owner's key).
  let analysisModel: string, routerModel: string;
  try {
    analysisModel = resolveModel(body.analysisModel, ANALYSIS_MODEL);
    routerModel = resolveModel(
      body.routerModel,
      providerFor(analysisModel) === "anthropic" ? ROUTER_MODEL : analysisModel,
    );
  } catch {
    return NextResponse.json(
      { ok: false, error: "Modell nicht freigegeben. Bitte erneut auswählen." },
      { status: 400 },
    );
  }

  if (!Array.isArray(body.images) || body.images.length === 0) {
    return NextResponse.json(
      { ok: false, error: "Please add at least one photo." },
      { status: 400 },
    );
  }

  const imageBlocks = toImageBlocks(body.images);
  if (imageBlocks.length === 0) {
    return NextResponse.json(
      { ok: false, error: "No readable photos found. Use JPG, PNG, or WebP." },
      { status: 400 },
    );
  }

  let client: Anthropic;
  try {
    client = getClient(analysisModel);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 500 },
    );
  }

  try {
    const deadline = Date.now() + ANALYZE_TIME_BUDGET_MS;
    const profile = await routeProfile(
      getClient(routerModel),
      imageBlocks,
      body.profile,
      routerModel,
      deadline,
    );
    const systemPrompt =
      buildProfiledAnalysisPrompt(profile) +
      (EBAY_MARKETPLACE_ID === "EBAY_DE"
        ? GERMAN_LISTING_PROMPT + INSCRIPTION_PROMPT + CLASSIFICATION_PROMPT
        : "");

    // One paid analysis attempt; never retry or upgrade models automatically.
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 1; attempt++) {
      const remaining = deadline - Date.now();
      if (remaining < MIN_CALL_MS) {
        lastErr =
          lastErr ??
          new Error("Analysis ran out of time — the API is slow right now.");
        break;
      }
      try {
        const resp = await measuredMessage(
          "analysis",
          client,
          {
            model: analysisModel,
            max_tokens: 5000,
            output_config: {
              format: { type: "json_schema", schema: AI_LISTING_SCHEMA },
            },
            // System prompt is large and identical across requests for the same
            // profile — cache it to cut cost and latency.
            system: [
              {
                type: "text",
                text: systemPrompt,
                cache_control: { type: "ephemeral" },
              },
            ],
            messages: [
              {
                role: "user",
                content: [
                  ...imageBlocks,
                  {
                    type: "text",
                    text: "Analyze these photos and return the listing JSON now.",
                  },
                ],
              },
            ],
          },
          {
            timeout: Math.min(ANALYSIS_CALL_TIMEOUT_MS, remaining),
            maxRetries: 0,
          },
        );
        const raw = parseModelJson<Record<string, unknown>>(firstText(resp));
        const specifics = Array.isArray(raw.specifics) ? raw.specifics : [];
        const supported = specifics.filter((s) =>
          acceptedPhotoFact(s, imageBlocks.length),
        );
        for (const f of supported) {
          if (
            f.basis === "estimate" &&
            /^(Scheibenhöhe|Glashöhe|Gläserhöhe|Gesamtbreite|Fassungsbreite|Rahmenbreite|Lichte Breite)$/i.test(
              f.name,
            )
          )
            f.value =
              String(
                Math.floor(
                  Number(f.value.replace(/\s*mm$/i, "").replace(",", ".")),
                ),
              ) + " mm";
        }
        let listing = parseListing({
          ...raw,
          item_specifics: Object.fromEntries(
            supported.map((s: any) => [s.name, s.value]),
          ),
        });
        if (isGlasses(listing)) {
          listing.eyewear = extractEyewear(supported);
          const grid = supported.filter(
            (f) =>
              f.basis === "estimate" &&
              /^(Scheibenhöhe|Glashöhe|Gläserhöhe|Gesamtbreite|Fassungsbreite|Rahmenbreite|Lichte Breite)$/i.test(
                f.name,
              ),
          );
          if (grid.length)
            listing.measurements = grid
              .map(
                (f) =>
                  f.name +
                  ": ca. " +
                  f.value.replace(/\s*mm$/i, "") +
                  " mm (Messfoto " +
                  f.photoIndices.join(", ") +
                  ")",
              )
              .join("\n");
          for (const f of supported) {
            if (
              /^(Modellnummer|Model Number)$/i.test(f.name) &&
              (parseBoxDimensions(f.value) ||
                Object.values(parseBoxDimensions(f.quote) ?? {}).includes(
                  f.value,
                ))
            )
              delete listing.item_specifics?.[f.name];
          }
          listing.eyewear.warnings.push(
            ...supported
              .filter((s) => s.name === "Prüfhinweis")
              .map((s) => s.value),
          );
          if (
            supported.some(
              (f) => f.basis === "label" && /\boptyl\b/i.test(f.quote),
            )
          ) {
            const evidence = supported.find(
              (f) => f.basis === "label" && /\boptyl\b/i.test(f.quote),
            )!;
            listing.eyewear.fields.material = {
              value: "Optyl",
              source: "label",
              quote: evidence.quote,
              photos: evidence.photoIndices,
            };
            listing.material = "Optyl";
            for (const key of Object.keys(listing.item_specifics ?? {})) {
              if (
                /^(material|fassungsmaterial|rahmenmaterial|frame material)$/i.test(
                  key,
                )
              )
                delete listing.item_specifics![key];
            }
            listing.item_specifics = {
              ...listing.item_specifics,
              Fassungsmaterial: "Optyl",
            };
          }
          if (listing.eyewear.fields.material?.source === "shop") {
            listing.material = listing.eyewear.fields.material.value;
            listing.item_specifics = {
              ...listing.item_specifics,
              Fassungsmaterial: listing.material,
            };
          }
        }
        listing.description = cleanGeneratedDescription(listing.description);
        listing.item_profile = profile;
        listing.evidence = Object.fromEntries(
          supported.map((s: any) => [s.name, s.photoIndices]),
        );
        listing.estimates = Object.fromEntries(
          supported.filter(isEstimate).map((s) => [s.name, s.confidence ?? 0]),
        );
        // Deterministic title cleanup happens HERE, before the seller reviews —
        // the title on the card is exactly the title that publishes.
        listing.title = optimizeTitle(listing);
        if (isGlasses(listing)) {
          listing = applyContentRules(listing);
          // Seller owns condition statements; free-form image prose must not invent wear.
          const facts = Object.entries(listing.eyewear?.fields ?? {})
            .filter(
              ([key, field]) =>
                field?.value &&
                [
                  "brand",
                  "modelNumber",
                  "modelName",
                  "lensWidth",
                  "bridgeWidth",
                  "templeLength",
                ].includes(key),
            )
            .map(
              ([key, field]) =>
                `${({ brand: "Marke", modelNumber: "Modellnummer", modelName: "Modellname", lensWidth: "Glasbreite", bridgeWidth: "Stegbreite", templeLength: "Bügellänge" } as Record<string, string>)[key]}: ${field!.value}`,
            );
          listing.description = ["Ungetragen ohne Etui", ...facts].join("\n");
          listing.key_features = [];
          listing = applyContentRules(listing);
          if (
            listing.eyewear_kind === "optical" &&
            supported.some(
              (f) =>
                /^Demoscheiben$/i.test(f.name) &&
                /^(nicht vorhanden|ohne|keine)$/i.test(f.value) &&
                (f.confidence ?? 0) >= 85,
            )
          )
            listing.condition_notes = "Ungetragen ohne Etui ohne Demoscheiben";
        }
        // Same principle for the optional storewide markup: applied pre-review,
        // so the price on the card is exactly the price that publishes.
        listing.suggested_price = applyPriceMarkup(
          listing.suggested_price,
          priceMarkupPercent(),
        );
        return NextResponse.json({ ok: true, listing, usage: currentUsage() });
      } catch (err) {
        if (isAiTerminal(err)) throw err;
        const fatal = anthropicAuthError(err);
        if (fatal) throw fatal; // auth/billing won't fix itself on retry
        lastErr = err;
      }
    }
    throw lastErr;
  } catch (e) {
    if (e instanceof AiProviderError)
      return NextResponse.json(
        { ok: false, error: e.message, usage: currentUsage() },
        { status: e.status >= 400 && e.status <= 599 ? e.status : 502 },
      );
    if (e instanceof AnthropicAuthError) {
      console.error("[analyze] auth/billing failure:", e.message);
      return NextResponse.json(
        { ok: false, error: e.message },
        { status: e.status },
      );
    }
    return safeErrorResponse(
      "analyze",
      e,
      "Something went wrong analyzing photos — please try again.",
    );
  }
}

export async function analyzePhotos(input: unknown) {
  const { result, usage } = await collectUsage(() => handle(input));
  if (!result.ok) {
    const data = await result.json();
    return NextResponse.json({ ...data, usage }, { status: result.status });
  }
  return result;
}
