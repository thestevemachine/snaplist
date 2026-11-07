import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAccount, sameOrigin } from "@/lib/accounts/server";
import { guardApiRequest, safeErrorResponse } from "@/lib/api-guard";
import { getClient, parseModelJson } from "@/lib/anthropic";
import { collectUsage, measuredMessage } from "@/lib/ai-usage";
import { DEFAULT_AI_MODEL } from "@/lib/ai-defaults";
import { resolveModel } from "@/lib/models";
import { imagesSchema, listingSchema } from "@/lib/validation";
import { toImageBlock } from "@/lib/images";
import { usesEyewearDefaults } from "@/lib/listing-mode";
import {
  STORY_PROMPT, storyFacts, storyOutputSchema, validateStory, composeStoryDescription,
} from "@/lib/storytelling";

export const maxDuration = 120;
const requestSchema = z.object({
  listing: listingSchema,
  history: z.string().max(3000).default(""),
  images: imagesSchema.optional(),
  analysisModel: z.string().max(150).optional(),
});

async function handle(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;
  if (!sameOrigin(req)) return NextResponse.json({ ok: false }, { status: 403 });
  const parsed = requestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json(
    { ok: false, error: "Bitte Artikel und gültige Fotos für die Beschreibung auswählen." }, { status: 400 },
  );
  const { listing, history, images } = parsed.data;
  if (usesEyewearDefaults(listing)) return NextResponse.json(
    { ok: false, error: "Die Geschichte ist im allgemeinen Artikelmodus verfügbar." }, { status: 400 },
  );
  if (!listing.title.trim() || !listing.description.trim()) return NextResponse.json(
    { ok: false, error: "Bitte zuerst die sachliche Artikelbeschreibung erstellen." }, { status: 400 },
  );
  try {
    const model = resolveModel(parsed.data.analysisModel, DEFAULT_AI_MODEL);
    const { result, usage } = await collectUsage(async () => {
      const response = await measuredMessage("storytelling", getClient(model), {
        model,
        max_tokens: 800,
        system: STORY_PROMPT,
        output_config: { format: { type: "json_schema", schema: {
          type: "object", additionalProperties: false,
          properties: { paragraph: { type: "string" } }, required: ["paragraph"],
        } } },
        messages: [{ role: "user", content: [
          ...(images ?? []).slice(0, 4).flatMap((image) => {
            const block = toImageBlock(image);
            return block ? [block] : [];
          }),
          { type: "text", text: JSON.stringify({
            titel: listing.title,
            kategorie: listing.category_hint || listing.category || listing.item_type,
            eigenschaften: storyFacts(listing),
            zustand: listing.condition_notes || "Gebraucht",
            lieferumfang: listing.item_specifics?.Lieferumfang ?? "",
            geschichte: history.trim(),
            beschreibung: listing.description,
          }) },
        ] }],
      }, { timeout: 90000, maxRetries: 0 });
      const text = response.content.find((block) => block.type === "text");
      if (!text || text.type !== "text") throw Error("Keine Textantwort erhalten.");
      const output = storyOutputSchema.parse(parseModelJson(text.text));
      const paragraph = validateStory(output.paragraph, history);
      return {
        paragraph,
        description: composeStoryDescription(listing.description, paragraph),
        notice: paragraph ? "Bitte die Vorschau vor der Übernahme prüfen."
          : "Die vorhandenen Angaben tragen keine sinnvolle Geschichte. Die sachliche Beschreibung wird verwendet.",
      };
    });
    return NextResponse.json({ ok: true, ...result, usage });
  } catch (error) {
    return safeErrorResponse("storytelling", error, "Geschichte konnte nicht erstellt werden. Bitte Angaben und Modellzugang prüfen.");
  }
}
export const POST = withAccount(handle);
