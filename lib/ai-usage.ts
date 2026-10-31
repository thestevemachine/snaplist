import { AsyncLocalStorage } from "node:async_hooks";
import type Anthropic from "@anthropic-ai/sdk";
import { modelRates, providerFor } from "./ai-catalog";
import type { ProviderMessage } from "./ai-providers";
export interface AiUsage {
  id?: string;
  provider?: string;
  requestedModel?: string;
  recordedAt?: string;
  usageReported?: boolean;
  reasoning?: number;
  pricingBasis?: string;
  estimatedAllocation?: boolean;
  stage: string;
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  ms: number;
  ok: boolean;
  estimatedUsd?: number;
}
const scope = new AsyncLocalStorage<AiUsage[]>();
export async function collectUsage<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; usage: AiUsage[] }> {
  const usage: AiUsage[] = [];
  return scope.run(usage, async () => ({ result: await fn(), usage }));
}
export function currentUsage(): AiUsage[] {
  return scope.getStore() ?? [];
}
export async function measuredMessage(
  stage: string,
  client: Anthropic,
  params: Anthropic.MessageCreateParamsNonStreaming,
  options?: Parameters<Anthropic["messages"]["create"]>[1],
): Promise<Anthropic.Message> {
  const start = Date.now();
  let row: AiUsage = {
    id: crypto.randomUUID(),
    provider: providerFor(params.model),
    requestedModel: params.model,
    recordedAt: new Date().toISOString(),
    usageReported: false,
    stage,
    model: params.model,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    ms: 0,
    ok: false,
  };
  try {
    const r = await client.messages.create(params, options);
    const u = r.usage ?? { input_tokens: 0, output_tokens: 0 };
    row = {
      ...row,
      model: r.model || params.model,
      input: u.input_tokens,
      output: u.output_tokens,
      cacheRead: u.cache_read_input_tokens ?? 0,
      cacheWrite: u.cache_creation_input_tokens ?? 0,
      ok: true,
      usageReported: (r as ProviderMessage).usageReported ?? Boolean(r.usage),
      reasoning: (r as ProviderMessage).reasoningTokens ?? 0,
    };
    // Estimates use standard global list rates; raw counts are authoritative.
    const rates: Record<string, [number, number]> = {
      "claude-sonnet-4-6": [3, 15],
      "claude-opus-4-8": [5, 25],
      "claude-opus-4-7": [5, 25],
      "claude-opus-4-6": [5, 25],
      "claude-haiku-4-5": [1, 5],
    };
    const rate = rates[params.model];
    if (rate && row.usageReported)
      row.estimatedUsd =
        (row.input * rate[0] +
          row.output * rate[1] +
          row.cacheRead * rate[0] * 0.1 +
          row.cacheWrite * rate[0] * 1.25) /
        1e6;
    const externalRates = modelRates(params.model);
    if (externalRates && row.usageReported) {
      const long =
        params.model === "gpt-6-luna" &&
        row.input + row.cacheRead + row.cacheWrite > 272000;
      row.estimatedUsd =
        (row.input * externalRates.input * (long ? 2 : 1) +
          row.cacheRead * externalRates.cached * (long ? 2 : 1) +
          row.cacheWrite *
            (externalRates.cacheWrite ?? externalRates.input * 1.25) *
            (long ? 2 : 1) +
          row.output * externalRates.output * (long ? 1.5 : 1)) /
        1e6;
    }
    row.pricingBasis =
      "Anbieter-Token × Standard-Listenpreis (USD), Rechnung kann abweichen";
    if (r.stop_reason === "max_tokens")
      throw new Error(
        "AI output was truncated. Retry with fewer requested fields.",
      );
    if (!r.content.some((b) => b.type === "text" && b.text.trim()))
      throw new Error(
        "Das Modell hat keinen verwendbaren Text geliefert. Bitte bewusst erneut starten.",
      );
    return r;
  } finally {
    row.ms = Date.now() - start;
    scope.getStore()?.push(row);
    console.info(JSON.stringify({ event: "ai_usage", ...row }));
  }
}
