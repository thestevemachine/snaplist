import { NextRequest, NextResponse } from "next/server";
import { guardApiRequest } from "@/lib/api-guard";
import {
  SharedEbayError,
  testGermanEbayReadiness,
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
    const result = await withDeadline(45_000, testGermanEbayReadiness);
    const counts = result.policyCounts;
    return NextResponse.json(
      {
        ok: true,
        ...result,
        message: `eBay.de / Euro bestätigt. Trading API: Lesen erfolgreich. Richtlinien: ${counts.fulfillment} Versand, ${counts.payment} Zahlung, ${counts.return} Rücknahme. ${result.policiesAvailable ? "Alle drei Richtlinienarten sind vorhanden." : "Mindestens eine Richtlinienart fehlt noch."} Keine Angebote erstellt oder veröffentlicht. Ein einzelnes Angebot kann anschließend separat geprüft werden.`,
      },
      { headers },
    );
  } catch (error) {
    const known = error instanceof SharedEbayError;
    return NextResponse.json(
      {
        ok: false,
        code: known ? error.code : "READINESS_TEST_FAILED",
        error: known
          ? error.message
          : "Die erweiterte eBay-Prüfung ist fehlgeschlagen. Bitte erneut versuchen.",
      },
      { status: 502, headers },
    );
  }
}
