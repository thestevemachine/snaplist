import {accountsEnabled,currentAccount} from "@/lib/accounts/context";
import {saveCredentials} from "@/lib/accounts/server";
import {withAccount} from "@/lib/accounts/server";
import { NextRequest, NextResponse } from "next/server";
import { exchangeCode } from "@/lib/ebay/oauth";
import { guardApiRequest } from "@/lib/api-guard";
import {
  EBAY_COOKIE,
  EBAY_COOKIE_MAX_AGE,
  connectionFromToken,
  sealConnection,
} from "@/lib/ebay/session";

export const dynamic = "force-dynamic";

// Manual connect: the user pastes the URL (or code) from eBay's success page.
// Mirrors the Python script's copy-the-redirect-URL flow, which is immune to
// eBay's redirect-URL configuration quirks.
function extractCode(input: string): string | null {
  const raw = (input || "").trim();
  if (!raw) return null;
  // Full URL → read ?code=
  try {
    const u = new URL(raw);
    const c = u.searchParams.get("code");
    if (c) return c;
  } catch {
    /* not a full URL */
  }
  // A bare query string or "...&code=..." fragment.
  const m = raw.match(/[?&]code=([^&\s]+)/);
  if (m) return decodeURIComponent(m[1]);
  // Looks like just the code itself (eBay codes start with "v^1").
  if (raw.startsWith("v^")) return raw;
  return null;
}

async function handlePOST(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;

  let body: { url?: string; code?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  if(accountsEnabled()) return NextResponse.json({ok:false,error:"Bitte eBay über den Anmeldeknopf verbinden und automatisch zu SNAPLIST zurückkehren."},{status:400});
  const code = body.code?.trim() || extractCode(body.url || "");
  if (!code) {
    return NextResponse.json(
      { ok: false, error: "Couldn't find an authorization code in what you pasted." },
      { status: 400 }
    );
  }

  try {
    const token = await exchangeCode(code);
    if (!token.refresh_token) {
      throw new Error("eBay didn't return a refresh token (the code may have expired — try again).");
    }
    const sealed = await sealConnection(
      connectionFromToken(token.refresh_token, token.refresh_token_expires_in)
    );
    const res = NextResponse.json({ ok: true });
    if(accountsEnabled()) await saveCredentials({...currentAccount()!.secrets,ebay:sealed});
    else res.cookies.set(EBAY_COOKIE, sealed, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: EBAY_COOKIE_MAX_AGE,
    });
    return res;
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 502 }
    );
  }
}

export const POST=withAccount(handlePOST);
