import {accountsEnabled,currentAccount} from "@/lib/accounts/context";
import {saveCredentials} from "@/lib/accounts/server";
import {withAccount} from "@/lib/accounts/server";
import { NextRequest, NextResponse } from "next/server";
import { guardApiRequest } from "@/lib/api-guard";
import { EBAY_COOKIE } from "@/lib/ebay/session";

export const dynamic = "force-dynamic";

// Forget the stored eBay connection.
async function handlePOST(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;

  if(accountsEnabled()) {const next={...currentAccount()!.secrets};delete next.ebay;await saveCredentials(next);}
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(EBAY_COOKIE);
  return res;
}

export const POST=withAccount(handlePOST);
