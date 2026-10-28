import {withAccount} from "@/lib/accounts/server";
import { NextRequest } from "next/server";
import { guardApiRequest } from "@/lib/api-guard";
import { prepareListing } from "@/lib/services/prepare";
import { EBAY_COOKIE } from "@/lib/ebay/session";
export const maxDuration = 180;
async function handlePOST(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;
  return prepareListing(
    await req.json().catch(() => null),
    req.cookies.get(EBAY_COOKIE)?.value,
  );
}

export const POST=withAccount(handlePOST);
