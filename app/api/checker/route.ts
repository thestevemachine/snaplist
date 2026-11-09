import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAccount } from "@/lib/accounts/server";
import { guardApiRequest, safeErrorResponse } from "@/lib/api-guard";
import { getClient, parseModelJson } from "@/lib/anthropic";
import { collectUsage, measuredMessage } from "@/lib/ai-usage";
import { labeledContent } from "@/lib/images";
import { DEFAULT_AI_MODEL } from "@/lib/ai-defaults";
import { resolveModel } from "@/lib/models";
import { CHECKER_PROMPT, checkerResultSchema } from "@/lib/checker";
export const maxDuration = 180;
const requestSchema = z.object({
  images: z
    .array(
      z.object({
        mediaType: z.literal("image/jpeg"),
        data: z
          .string()
          .min(1)
          .max(3000000)
          .regex(/^[A-Za-z0-9+/]+={0,2}$/),
      }),
    )
    .min(1)
    .max(12),
  notes: z.string().max(2000).default(""),
  model: z.string().max(64).optional(),
});
export const POST = withAccount(async (req: NextRequest) => {
  const denied = guardApiRequest(req);
  if (denied) return denied;
  const raw = await req.text();
  if (raw.length > 4000000)
    return NextResponse.json(
      { error: "Bitte weniger Fotos pro Artikel wählen." },
      { status: 413 },
    );
  let body;
  try {
    body = requestSchema.parse(JSON.parse(raw));
  } catch {
    return NextResponse.json(
      { error: "Ungültige Fotos oder Artikeldaten." },
      { status: 400 },
    );
  }
  try {
    const model = resolveModel(body.model, DEFAULT_AI_MODEL);
    const { result, usage } = await collectUsage(async () => {
      const message = await measuredMessage(
        "checker",
        getClient(model),
        {
          model,
          max_tokens: 2500,
          system: CHECKER_PROMPT,
          messages: [
            {
              role: "user",
              content: [
                ...labeledContent(body.images),
                {
                  type: "text",
                  text: JSON.stringify({ articleNotes: body.notes }),
                },
              ],
            },
          ],
        },
        { timeout: 140000, maxRetries: 0 },
      );
      if (message.stop_reason === "max_tokens")
        throw new Error("Incomplete response");
      return checkerResultSchema.parse(
        parseModelJson(
          message.content
            .filter((b) => b.type === "text")
            .map((b) => b.text)
            .join("\n"),
        ),
      );
    });
    return NextResponse.json({ result, usage, priceSource: "estimate" });
  } catch (error) {
    return safeErrorResponse(
      "checker",
      error,
      "Checker konnte keinen Entwurf erstellen. Bitte Modell und API-Schlüssel im SnapList-Konto prüfen. Ein erneuter Versuch kann KI-Kosten verursachen.",
    );
  }
});
