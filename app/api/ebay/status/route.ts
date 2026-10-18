import { NextRequest, NextResponse } from "next/server";
import { rateLimitRequest } from "@/lib/api-guard";
import { isEbayConfigured } from "@/lib/ebay/config";
import { EBAY_COOKIE, openConnection } from "@/lib/ebay/session";
import { isSharedEbayConfigured } from "@/lib/ebay/shared-connection";

export const dynamic = "force-dynamic";

// Lightweight check the UI calls on load: is eBay set up + connected?
// Returns booleans only, so it stays outside the access code — but not
// outside the rate limiter.
export async function GET(req: NextRequest) {
  const limited = rateLimitRequest(req);
  if (limited) return limited;

  const configured = isEbayConfigured();
  const conn = await openConnection(req.cookies.get(EBAY_COOKIE)?.value);
  return NextResponse.json(
    {
      configured,
      connected: Boolean(conn),
      sharedConfigured: isSharedEbayConfigured(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
