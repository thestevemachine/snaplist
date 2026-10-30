import {accountsEnabled} from "@/lib/accounts/context";
import {withAccount} from "@/lib/accounts/server";
import { DEFAULT_AI_MODEL } from "@/lib/ai-defaults";
import { NextResponse } from "next/server";
import { getClient } from "@/lib/anthropic";
import { isAllowedModel } from "@/lib/models";
import type { ModelInfo } from "@anthropic-ai/sdk/resources/models.js";
import { AI_MODELS } from "@/lib/ai-catalog";
import { providerConfigured } from "@/lib/ai-providers";

// Haiku is excluded from the listing-generation selector: it materially worsens
// listing quality compared to every other available model.
const ANALYSIS_EXCLUDED = /^claude-haiku/;

const DESCRIPTIONS: Record<string, string> = {
  "claude-fable-5":
    "Most capable model — best for rare or complex items. Premium pricing.",
  "claude-opus-4-8":
    "Excellent quality. Recommended for detailed listing generation.",
  "claude-opus-4-7":
    "High quality with strong reasoning. Good all-around choice.",
  "claude-opus-4-6": "Solid quality and great value.",
  "claude-sonnet-4-6":
    "Fast and capable. Great for sorting; works well for most listings.",
  "claude-haiku-4-5":
    "Fastest and most affordable. Best for photo sorting only.",
};

const SORT_DEFAULT = DEFAULT_AI_MODEL;
const ANALYSIS_DEFAULT = DEFAULT_AI_MODEL;

export interface ModelOption {
  recommended?:boolean;
  provider?: string;
  configured?: boolean;
  id: string;
  displayName: string;
  description: string;
  isDefault: boolean;
}

interface ModelsPayload {
  sortModels: ModelOption[];
  analysisModels: ModelOption[];
}

// Hardcoded fallback when the Anthropic models API call fails.
const FALLBACK: ModelsPayload = {
  sortModels: [
    {
      id: "claude-opus-4-8",
      displayName: "Claude Opus 4.8",
      description: DESCRIPTIONS["claude-opus-4-8"],
      isDefault: false,
    },
    {
      id: "claude-sonnet-4-6",
      displayName: "Claude Sonnet 4.6",
      description: DESCRIPTIONS["claude-sonnet-4-6"],
      isDefault: true,
    },
    {
      id: "claude-haiku-4-5",
      displayName: "Claude Haiku 4.5",
      description: DESCRIPTIONS["claude-haiku-4-5"],
      isDefault: false,
    },
  ],
  analysisModels: [
    {
      id: "claude-opus-4-8",
      displayName: "Claude Opus 4.8",
      description: DESCRIPTIONS["claude-opus-4-8"],
      isDefault: true,
    },
    {
      id: "claude-sonnet-4-6",
      displayName: "Claude Sonnet 4.6",
      description: DESCRIPTIONS["claude-sonnet-4-6"],
      isDefault: false,
    },
  ],
};

let cache: ModelsPayload | null = null;
let cacheAt = 0;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

function toOption(m: ModelInfo): ModelOption {
  return {
    id: m.id,
    displayName: m.display_name,
    description: DESCRIPTIONS[m.id] ?? "Model available from Anthropic.",
    isDefault: false, // set below
  };
}

function buildPayload(raw: ModelInfo[]): ModelsPayload {
  // Only offer models the call routes will actually accept (lib/models.ts) — this
  // keeps the premium "fable" tier out of the selector so the UI never shows a
  // model the server would reject.
  const vision = raw.filter((m) => isAllowedModel(m.id));
  if (vision.length === 0) return FALLBACK;

  const sortModels = vision.map((m) => ({
    ...toOption(m),
    isDefault: m.id === SORT_DEFAULT,
  }));
  const analysisModels = vision
    .filter((m) => !ANALYSIS_EXCLUDED.test(m.id))
    .map((m) => ({ ...toOption(m), isDefault: m.id === ANALYSIS_DEFAULT }));

  // If the default wasn't in the list, mark the first entry as default.
  if (sortModels.length && !sortModels.some((m) => m.isDefault))
    sortModels[0].isDefault = true;
  if (analysisModels.length && !analysisModels.some((m) => m.isDefault))
    analysisModels[0].isDefault = true;

  return { sortModels, analysisModels };
}

async function claudeModels() {
  const now = Date.now();
  if (!accountsEnabled() && cache && now - cacheAt < CACHE_TTL) {
    return NextResponse.json(cache);
  }

  try {
    const client = getClient();
    const page = await client.models.list();
    const payload=buildPayload(page.data);
    if(!accountsEnabled()) cache=payload;
    cacheAt = now;
    return NextResponse.json(payload);
  } catch {
    return NextResponse.json(FALLBACK);
  }
}

async function handleGET() {
  const response = await claudeModels();
  const payload = (await response.json()) as ModelsPayload;
  const extras = AI_MODELS.map((m) => ({
    id: m.id,
    displayName: m.name,
    provider: m.provider,
    configured: providerConfigured(m.provider),
    isDefault: m.id === DEFAULT_AI_MODEL,
    description: `Bilderkennung · Standardpreis pro 1 Mio. Token: $${m.input} Eingabe / $${m.output} Ausgabe. Stand ${m.priceDate}${m.priceUntil ? `, Aktionspreis bis ${m.priceUntil}` : ""}.`,
  }));
  const annotate = (m: ModelOption) => ({
    ...m,
    provider: "anthropic",
    isDefault: false,
    configured: providerConfigured("anthropic"),
  });
  return NextResponse.json(
    {
      sortModels: [...payload.sortModels.map(annotate), ...extras.map(m=>({...m,recommended:m.id==="gpt-6-luna"}))],
      analysisModels: [...payload.analysisModels.map(annotate), ...extras.map(m=>({...m,recommended:m.id==="gpt-6.1-terra"}))],
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export const GET=withAccount(handleGET);
