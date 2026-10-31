import {withAccount} from "@/lib/accounts/server";
import { NextRequest, NextResponse } from "next/server";
import { guardApiRequest } from "@/lib/api-guard";
import { sellerAccessToken, EBAY_COOKIE } from "@/lib/ebay/session";
import { fetchTradingOptions } from "@/lib/ebay/trading-options";
import { withDeadline } from "@/lib/network";
async function handlePOST(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;
  return withDeadline(25_000, async () => {
    try {
      const token = await sellerAccessToken(
        req.cookies.get(EBAY_COOKIE)?.value,
      );
      if (!token)
        return NextResponse.json(
          {
            ok: false,
            error: "Connect eBay to choose policies and shipping origin.",
          },
          { status: 401 },
        );
      return NextResponse.json({
        ok: true,
        options: await fetchTradingOptions(token),
      });
    } catch (e) {
      return NextResponse.json(
        { ok: false, error: (e as Error).message },
        { status: 502 },
      );
    }
  });
}

export const POST=withAccount(handlePOST);
