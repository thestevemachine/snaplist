import {accountsEnabled,currentAccount} from "@/lib/accounts/context";
import {withAccount} from "@/lib/accounts/server";
import { NextRequest, NextResponse } from "next/server";
import { rateLimitRequest } from "@/lib/api-guard";
import { isEbayConfigured } from "@/lib/ebay/config";
import { EBAY_COOKIE, openConnection } from "@/lib/ebay/session";
import { isSharedEbayConfigured } from "@/lib/ebay/shared-connection";

export const dynamic = "force-dynamic";

// Lightweight check the UI calls on load: is eBay set up + connected?
// Returns booleans only, so it stays outside the access code — but not
// outside the rate limiter.
async function handleGET(req: NextRequest) {
  const limited = rateLimitRequest(req);
  if (limited) return limited;

  const configured = isEbayConfigured();
  const conn = await openConnection(accountsEnabled() ? currentAccount()?.secrets.ebay : req.cookies.get(EBAY_COOKIE)?.value);
  return NextResponse.json(
    {
      configured,
      accountMode: accountsEnabled(),
      personalConnectionReady: !accountsEnabled() || Boolean(process.env.SNAPLIST_EBAY_RU_NAME),
      connected: isSharedEbayConfigured() || Boolean(conn),
      sharedConfigured: isSharedEbayConfigured(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export const GET=withAccount(handleGET);
