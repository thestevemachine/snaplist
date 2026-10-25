import { timingSafeEqual } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function reply(status: number, ok: boolean) {
  return Response.json({ ok }, { status, headers: { "Cache-Control": "no-store" } });
}

// Read-only health check: never fetch, decrypt, refresh or write OAuth tokens.
// Three tiny uncached reads per daily run provide real database activity.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 32) return reply(503, false);
  const expected = Buffer.from(`Bearer ${secret}`);
  const supplied = Buffer.from(request.headers.get("authorization") ?? "");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied))
    return reply(401, false);

  try {
    const base = new URL(process.env.SUPABASE_EU_URL?.trim() ?? "");
    const key = process.env.SUPABASE_EU_SECRET_KEY?.trim();
    if (base.origin !== "https://xeiqskpmclvavojhxgay.supabase.co" ||
        base.username || base.password || !key) return reply(503, false);
    const url = new URL("/rest/v1/ebay_oauth_tokens?select=id&id=eq.1&limit=1", base);
    const headers: Record<string, string> = { apikey: key };
    if (!key.startsWith("sb_secret_")) headers.Authorization = `Bearer ${key}`;

    for (let read = 0; read < 3; read++) {
      const response = await fetch(url, {
        method: "GET", headers, cache: "no-store", redirect: "error",
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) return reply(503, false);
      const rows: unknown = await response.json();
      if (!Array.isArray(rows) || rows.length !== 1 || rows[0]?.id !== 1)
        return reply(503, false);
    }
    return reply(200, true);
  } catch {
    // Never expose upstream bodies, URLs, errors, keys or database contents.
    return reply(503, false);
  }
}
