import {withAccount} from "@/lib/accounts/server";
import { NextRequest } from "next/server";
import { guardApiRequest } from "@/lib/api-guard";
import { analyzePhotos } from "@/lib/services/analyze";
export const maxDuration = 300;
async function handlePOST(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;
  return analyzePhotos(await req.json().catch(() => null));
}

export const POST=withAccount(handlePOST);
