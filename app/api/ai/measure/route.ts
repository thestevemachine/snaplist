import {readMeasurementPhotos} from "@/lib/measurement-photos";
import {lensReference} from "@/lib/lens-reference";
import {withAccount} from "@/lib/accounts/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { guardApiRequest } from "@/lib/api-guard";
import { imageSchema, parseListing } from "@/lib/validation";
import { isAllowedModel } from "@/lib/models";
import { collectUsage, measuredMessage } from "@/lib/ai-usage";
import { getClient, parseModelJson } from "@/lib/anthropic";
import { toImageBlock } from "@/lib/images";
import { imageSize } from "@/lib/image-size";
import { AI_LISTING_SCHEMA } from "@/lib/ai-schema";
import {
  calculateFrontMeasurement,
  FRONT_MEASUREMENT_PROMPT,
} from "@/lib/front-measurements";
import { AiProviderError } from "@/lib/ai-providers";
export const runtime = "nodejs";
export const maxDuration = 90;
const requestSchema = z.object({
  confirmed: z.literal(true),
  measurementPhoto:z.boolean().optional(),
  model: z.string(),
  photoIndex: z.number().int().min(1).max(24),
  image: imageSchema,
  listing: z.unknown(),
});
async function handlePOST(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;
  const headers = { "Cache-Control": "no-store" };
  let body: z.infer<typeof requestSchema>,
    listing: ReturnType<typeof parseListing>;
  try {
    body = requestSchema.parse(await req.json());
    listing = parseListing(body.listing);
    if (!isAllowedModel(body.model)) throw Error();
    if (!lensReference(listing) && !body.measurementPhoto)
      return NextResponse.json(
        {
          ok: false,
          error:
            "Scheibenbreite fehlt. Demoscheiben-/Bügelaufdruck prüfen oder die Breite manuell bestätigen.",
        },
        { status: 400, headers },
      );
    if (!imageSize(body.image.data)) throw Error();
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Frontfoto und Modell auswählen und die einmalige Maßanalyse bestätigen.",
      },
      { status: 400, headers },
    );
  }
  const { result, usage } = await collectUsage(async () => {
    try {
      const response = await measuredMessage(
        "front-measurement",
        getClient(body.model),
        {
          model: body.model,
          max_tokens: 2600,
          system: FRONT_MEASUREMENT_PROMPT,
          output_config: {
            format: {
              type: "json_schema",
              schema: {
                type: "object",
                additionalProperties: false,
                properties: {
                  front_geometry: AI_LISTING_SCHEMA.properties.front_geometry,
                  measurement_photos: AI_LISTING_SCHEMA.properties.measurement_photos,
                },
                required: ["front_geometry","measurement_photos"],
              },
            },
          },
          messages: [
            {
              role: "user",
              content: [
                toImageBlock(body.image)!,
                {
                  type: "text",
                  text: "This is the seller-selected front or measurement photo, photoIndex=1. If a readable caliper or identifiable millimetre grid is present return measurement_photos; otherwise return an empty array. Return contour geometry only. Locate both inner lens openings and all outer extremities. If angled or partly obscured, return the best visible contours with uncertainty flags; do not substitute zero coordinates. No title, description or other listing fields.",
                },
              ],
            },
          ],
        },
        { maxRetries: 0, timeout: 75000 },
      );
      const block = response.content.find((b) => b.type === "text");
      if (!block || block.type !== "text") throw Error();
      const raw = parseModelJson<{ front_geometry: unknown;measurement_photos?:unknown }>(block.text);
      const photoMeasurements=readMeasurementPhotos(raw.measurement_photos,[imageSize(body.image.data)]).map(m=>({...m,photoIndex:body.photoIndex}));
      const measurement = calculateFrontMeasurement(
        raw.front_geometry,
        [imageSize(body.image.data)],
        {...listing,measurementPhotos:[...(listing.measurementPhotos ?? []).filter(m=>m.photoIndex!==body.photoIndex),...photoMeasurements]},
      );
      measurement.photoIndex = body.photoIndex;
      if (measurement.observation)
        measurement.observation.photoIndex = body.photoIndex;
      return { ok: true, measurement,measurementPhotos:photoMeasurements };
    } catch (e) {
      return {
        ok: false,
        error:
          e instanceof AiProviderError
            ? e.message
            : "Maßanalyse fehlgeschlagen. Kein automatischer neuer Versuch; der Entwurf bleibt erhalten.",
      };
    }
  });
  return NextResponse.json(
    { ...result, usage },
    { status: result.ok ? 200 : 502, headers },
  );
}

export const POST=withAccount(handlePOST);
