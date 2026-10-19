// Public metadata only. USD / million tokens, standard synchronous APIs.
// Official sources and review notes: docs/AI-PROVIDERS.md (2026-10-19).
export type AiProvider = "anthropic" | "google" | "openai";
export interface AiModel {
  id: string;
  name: string;
  provider: AiProvider;
  input: number;
  output: number;
  cached: number;
  cacheWrite?: number;
  priceDate: string;
  priceUntil?: string;
  laterRates?: [number, number, number];
}
export const AI_MODELS: AiModel[] = [
  {
    id: "gemini-3.8-flash",
    name: "Gemini 3.8 Flash",
    provider: "google",
    input: 0.75,
    output: 3.75,
    cached: 0.075,
    priceDate: "2026-10-19",
    priceUntil: "2026-12-31",
    laterRates: [1.5, 7.5, 0.15],
  },
  {
    id: "gemini-3.5-flash-lite",
    name: "Gemini 3.5 Flash-Lite",
    provider: "google",
    input: 0.3,
    output: 2.5,
    cached: 0.03,
    priceDate: "2026-10-19",
  },
  {
    id: "gemini-2.5-flash-lite",
    name: "Gemini 2.5 Flash-Lite · Sparmodell",
    provider: "google",
    input: 0.1,
    output: 0.4,
    cached: 0.01,
    priceDate: "2026-10-19",
  },
  {
    id: "gpt-6-luna",
    name: "OpenAI GPT-6 Luna · Sparmodell",
    provider: "openai",
    input: 0.1,
    output: 0.5,
    cached: 0.01,
    cacheWrite: 0.125,
    priceDate: "2026-10-19",
  },
  {
    id: "gpt-5.4-mini",
    name: "OpenAI GPT-5.4 mini",
    provider: "openai",
    input: 0.75,
    output: 4.5,
    cached: 0.075,
    priceDate: "2026-10-19",
  },
];
export function aiModel(id: string) {
  return AI_MODELS.find((m) => m.id === id);
}
export function providerFor(id: string): AiProvider {
  return aiModel(id)?.provider ?? "anthropic";
}
export function modelRates(
  id: string,
  date = new Date().toISOString().slice(0, 10),
) {
  const m = aiModel(id);
  if (!m) return undefined;
  if (m.priceUntil && date > m.priceUntil && m.laterRates) {
    return {
      ...m,
      input: m.laterRates[0],
      output: m.laterRates[1],
      cached: m.laterRates[2],
    };
  }
  return m;
}
