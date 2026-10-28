import {accountsEnabled,currentAccount} from "@/lib/accounts/context";
import {sellerAccessToken} from "@/lib/ebay/session";
import {fetchAccountOptions} from "@/lib/ebay/publish";
import {withAccount} from "@/lib/accounts/server";
import { NextRequest, NextResponse } from "next/server";
import { guardApiRequest } from "@/lib/api-guard";
import {
  SharedEbayError,
  testSharedEbayConnection,
} from "@/lib/ebay/shared-connection";
import { withDeadline } from "@/lib/network";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const headers = { "Cache-Control": "no-store" };

async function handlePOST(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) {
    denied.headers.set("Cache-Control", "no-store");
    return denied;
  }
  try {
    if(accountsEnabled() && !currentAccount()?.owner) {
      const token=await sellerAccessToken(undefined);
      if(!token) return NextResponse.json({ok:false,error:"Bitte zuerst deinen eigenen eBay-Zugang verbinden."},{status:400});
      await fetchAccountOptions(token);
    } else await withDeadline(45_000, testSharedEbayConnection);
    return NextResponse.json(
      {
        ok: true,
        tokenRefresh: true,
        accountRead: true,
        message:
          "eBay-Verbindung bestätigt: Zugang erneuert und Versandrichtlinien gelesen. Es wurden keine Angebote erstellt oder veröffentlicht.",
      },
      { headers },
    );
  } catch (error) {
    // Only explicitly curated errors may leave the server. Never log the
    // Supabase/eBay response, request headers, token, or arbitrary exception.
    const known = error instanceof SharedEbayError;
    return NextResponse.json(
      {
        ok: false,
        code: known ? error.code : "CONNECTION_TEST_FAILED",
        error: known
          ? error.message
          : "Der eBay-Verbindungstest ist fehlgeschlagen. Bitte erneut versuchen und die Server-Einstellungen prüfen.",
      },
      { status: 502, headers },
    );
  }
}

export const POST=withAccount(handlePOST);
