import { resellerSameOrigin } from "@/lib/reseller-origin";
import { NextRequest, NextResponse } from "next/server";
import { accountScope, accountsEnabled } from "@/lib/accounts/context";
import { providerFor } from "@/lib/ai-catalog";
import { readResellerSession, RESELLER_COOKIE } from "@/lib/reseller-session";
import { handleChecker } from "@/lib/services/checker";
export const maxDuration = 180;
export async function POST(req: NextRequest) {
  // Never enter legacy providerKey mode: it would read deployment-owner keys.
  if (!accountsEnabled())
    return NextResponse.json(
      { error: "Der separate Checker ist noch nicht freigeschaltet." },
      { status: 503 },
    );
  if (!resellerSameOrigin(req))
    return NextResponse.json({ error: "Ungültige Anfrage." }, { status: 403 });
  const session = await readResellerSession(
    req.cookies.get(RESELLER_COOKIE)?.value,
  );
  if (!session)
    return NextResponse.json(
      {
        error:
          "Bitte zuerst deinen API-Schlüssel in den KI-Einstellungen speichern.",
      },
      { status: 401 },
    );
  const provider = providerFor(session.model);
  const response = await accountScope.run(
    {
      id: `reseller:${session.id}`,
      email: "",
      owner: false,
      secrets: { [provider]: session.key },
    },
    () => handleChecker(req, session.model),
  );
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
