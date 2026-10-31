import {withAccount} from "@/lib/accounts/server";
import { NextRequest, NextResponse } from "next/server";
import { guardApiRequest } from "@/lib/api-guard";
import { withDeadline } from "@/lib/network";
import { validationMessage } from "@/lib/validation";
import { EBAY_COOKIE, sellerAccessToken } from "@/lib/ebay/session";
import { submitTradingListing } from "@/lib/ebay/trading-publish";

export const maxDuration = 120;
async function handlePOST(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;
  return withDeadline(100_000, async () => {
    try {
      const body = await req.json();
      const token = await sellerAccessToken(
        req.cookies.get(EBAY_COOKIE)?.value,
      );
      if (!token)
        return NextResponse.json(
          { success: false, error: "Bitte zuerst eBay verbinden." },
          { status: 401 },
        );
      const result = await submitTradingListing(token, body, "verify");
      return NextResponse.json(result, {
        headers: { "Cache-Control": "no-store" },
      });
    } catch (error) {
      return NextResponse.json(
        { success: false, error: validationMessage(error) },
        { status: 422 },
      );
    }
  });
}

export const POST=withAccount(handlePOST);
