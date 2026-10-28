import {withAccount} from "@/lib/accounts/server";
import { withDeadline } from "@/lib/network";
import { validationMessage } from "@/lib/validation";
import { NextRequest, NextResponse } from "next/server";
import { EBAY_COOKIE, sellerAccessToken } from "@/lib/ebay/session";
import { guardApiRequest } from "@/lib/api-guard";
import { submitTradingListing } from "@/lib/ebay/trading-publish";
import type { PublishInput } from "@/lib/ebay/publish";

// Photos are uploaded separately. Verification precedes the single Trading Add.
export const maxDuration = 300;

async function handle(req: NextRequest) {
  // Check access + rate limit BEFORE parsing the (potentially large) body.
  const denied = guardApiRequest(req);
  if (denied) return denied;

  let body: PublishInput & { confirmed?: boolean };
  try {
    body = (await req.json()) as PublishInput;
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid request." },
      { status: 400 },
    );
  }

  if (!body || body.confirmed !== true)
    return NextResponse.json(
      {
        success: false,
        error:
          "Die Veröffentlichung dieses einzelnen Angebots muss ausdrücklich bestätigt werden.",
      },
      { status: 400 },
    );

  const hasImages = Array.isArray(body.images) && body.images.length > 0;
  const hasImageUrls =
    Array.isArray(body.imageUrls) && body.imageUrls.length > 0;
  if (!body.sku || !body.listing || (!hasImages && !hasImageUrls)) {
    return NextResponse.json(
      { success: false, error: "Missing SKU, listing, or photos." },
      { status: 400 },
    );
  }

  // Use the shared shop connection, or the existing seller cookie.
  let accessToken: string | null;
  try {
    accessToken = await sellerAccessToken(req.cookies.get(EBAY_COOKIE)?.value);
  } catch (e) {
    return NextResponse.json(
      { success: false, error: validationMessage(e) },
      { status: 500 },
    );
  }
  if (!accessToken) {
    return NextResponse.json(
      {
        success: false,
        error: "eBay isn't connected. Connect your account and try again.",
      },
      { status: 401 },
    );
  }

  try {
    const result = await submitTradingListing(accessToken, body, "publish");
    return NextResponse.json(result, { status: result.success ? 200 : 422 });
  } catch (e) {
    return NextResponse.json(
      { success: false, sku: body.sku, error: validationMessage(e) },
      { status: 422 },
    );
  }
}

async function handlePOST(req: NextRequest) {
  return withDeadline(240_000, () => handle(req));
}

export const POST=withAccount(handlePOST);
