import type { AiUsage } from "./ai-usage";
export function usageTotals(rows: AiUsage[]) {
  const seen = new Set<string>();
  const unique = rows.filter(
    (r) => !r.id || (!seen.has(r.id) && Boolean(seen.add(r.id))),
  );
  return {
    input: unique.reduce((s, r) => s + r.input + r.cacheRead + r.cacheWrite, 0),
    output: unique.reduce((s, r) => s + r.output, 0),
    usd: unique.reduce((s, r) => s + (r.estimatedUsd ?? 0), 0),
    unknown: unique.some(
      (r) => r.usageReported === false || r.estimatedUsd === undefined,
    ),
    rows: unique,
  };
}
