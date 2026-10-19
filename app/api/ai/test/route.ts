import { NextRequest, NextResponse } from "next/server";
import { guardApiRequest } from "@/lib/api-guard";
import { getClient } from "@/lib/anthropic";
import { isAllowedModel } from "@/lib/models";
import { collectUsage, measuredMessage } from "@/lib/ai-usage";
import { AiProviderError } from "@/lib/ai-providers";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const headers = { "Cache-Control": "no-store" };
  if (!isAllowedModel(body.model) || body.confirmed !== true)
    return NextResponse.json(
      {
        ok: false,
        error: "Modell auswählen und kostenpflichtigen Test bestätigen.",
      },
      { status: 400, headers },
    );
  const { result, usage } = await collectUsage(async () => {
    try {
      const message = await measuredMessage(
        "connection-test",
        getClient(body.model),
        {
          model: body.model,
          max_tokens: 128,
          messages: [
            { role: "user", content: 'Return this JSON exactly: {"ok":true}' },
          ],
        },
        { maxRetries: 0, timeout: 45_000 },
      );
      const text = message.content.find((b) => b.type === "text");
      if (!text || text.type !== "text" || !/"ok"\s*:\s*true/.test(text.text))
        throw new Error();
      return {
        ok: true,
        message:
          "Verbindung und Modellzugriff bestätigt. Bilderqualität bitte separat mit einer Vergleichsanalyse prüfen.",
      };
    } catch (e) {
      return {
        ok: false,
        error:
          e instanceof AiProviderError
            ? e.message
            : "Verbindungstest fehlgeschlagen. Zugang, Modellfreigabe und Guthaben beim Anbieter prüfen.",
      };
    }
  });
  return NextResponse.json(
    { ...result, usage },
    { status: result.ok ? 200 : 502, headers },
  );
}
