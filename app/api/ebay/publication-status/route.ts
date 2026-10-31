import {withAccount} from "@/lib/accounts/server";
import { NextRequest, NextResponse } from "next/server";
import { guardApiRequest } from "@/lib/api-guard";
import { sellerAccessToken, EBAY_COOKIE } from "@/lib/ebay/session";
import {
  inspectPublication,
  repairPublication,
} from "@/lib/ebay/publication-identity";
import { validationMessage, skuSchema } from "@/lib/validation";
export const maxDuration = 120;
async function handlePOST(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;
  try {
    const body = await req.json();
    const token = await sellerAccessToken(req.cookies.get(EBAY_COOKIE)?.value);
    if (!token) throw new Error("Bitte zuerst eBay verbinden.");
    const sku = skuSchema.parse(body.sku);
    const data =
      body.action === "repair"
        ? await repairPublication(token, { ...body, sku })
        : await inspectPublication(token, sku, body.publicationId);
    return NextResponse.json(
      { success: true, ...data },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { success: false, error: validationMessage(error) },
      { status: 422 },
    );
  }
}

export const POST=withAccount(handlePOST);
