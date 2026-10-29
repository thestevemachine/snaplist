import {accountsEnabled,currentAccount} from "@/lib/accounts/context";
import {NextResponse} from "next/server";
import {withAccount} from "@/lib/accounts/server";
import { NextRequest } from "next/server";
import { guardApiRequest } from "@/lib/api-guard";
import { researchListing } from "@/lib/services/research";
export const maxDuration = 30;
async function handlePOST(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;
  if(accountsEnabled() && !currentAccount()?.owner) return NextResponse.json({ok:false,error:"Preisrecherche ist für die Mehrbenutzerversion noch nicht freigegeben. Bitte Preis selbst festlegen."},{status:409});
  return researchListing(await req.json().catch(() => ({})));
}

export const POST=withAccount(handlePOST);
