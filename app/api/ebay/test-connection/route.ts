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

export async function POST(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) {
    denied.headers.set("Cache-Control", "no-store");
    return denied;
  }
  try {
    await withDeadline(45_000, testSharedEbayConnection);
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
