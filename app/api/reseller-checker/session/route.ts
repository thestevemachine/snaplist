import { resellerSameOrigin } from "@/lib/reseller-origin";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { rateLimitRequest } from "@/lib/api-guard";
import {
  createResellerSession,
  readResellerSession,
  RESELLER_COOKIE,
  RESELLER_TTL,
} from "@/lib/reseller-session";
export const dynamic = "force-dynamic";
const privateJson = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
export async function GET(req: NextRequest) {
  const session = await readResellerSession(
    req.cookies.get(RESELLER_COOKIE)?.value,
  );
  return privateJson({
    configured: Boolean(session),
    model: session?.model ?? null,
  });
}
export async function POST(req: NextRequest) {
  const limited = rateLimitRequest(req);
  if (limited) return limited;
  if (!resellerSameOrigin(req))
    return privateJson({ error: "Ungültige Anfrage." }, 403);
  const raw = await req.text();
  if (raw.length > 2000) return privateJson({ error: "Eingabe zu lang." }, 413);
  try {
    const { model, key } = z
      .object({
        model: z.string().max(64),
        key: z.string().trim().min(16).max(512),
      })
      .parse(JSON.parse(raw));
    const sealed = await createResellerSession(model, key);
    const res = privateJson({ ok: true, model });
    res.cookies.set(RESELLER_COOKIE, sealed, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/api/reseller-checker",
      maxAge: RESELLER_TTL,
    });
    return res;
  } catch {
    return privateJson(
      {
        error:
          "KI-Auswahl und API-Schlüssel prüfen. Es wurde kein kostenpflichtiger Verbindungstest gestartet.",
      },
      400,
    );
  }
}
export async function DELETE(req: NextRequest) {
  if (!resellerSameOrigin(req))
    return privateJson({ error: "Ungültige Anfrage." }, 403);
  const res = privateJson({ ok: true });
  res.cookies.set(RESELLER_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/api/reseller-checker",
    maxAge: 0,
  });
  return res;
}
