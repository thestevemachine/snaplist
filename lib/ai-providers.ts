import {accountsEnabled,providerKey} from "./accounts/context";
// Server-only provider adapters. Reuse the existing image/prompt/schema pipeline.
import "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { aiModel, providerFor } from "./ai-catalog";
import { boundedFetch } from "./network";

export class AiProviderError extends Error {
  readonly aiTerminal = true;
  constructor(
    message: string,
    public status = 502,
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}
export function isAiTerminal(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "aiTerminal" in error &&
    error.aiTerminal,
  );
}
export function providerConfigured(provider: string) {
  return Boolean(providerKey(provider));
}
type Params = Anthropic.MessageCreateParamsNonStreaming;
type Block = Anthropic.ContentBlockParam;
function systemText(params: Params) {
  return typeof params.system === "string"
    ? params.system
    : (params.system ?? []).map((b) => b.text).join("\n");
}
function blocks(content: string | Block[]): Block[] {
  return typeof content === "string"
    ? [{ type: "text", text: content }]
    : content;
}
function imageUrl(b: Anthropic.ImageBlockParam) {
  if (b.source.type === "base64")
    return `data:${b.source.media_type};base64,${b.source.data}`;
  if (b.source.type === "url") return b.source.url;
  throw new AiProviderError("Nicht unterstütztes Bildformat.", 400);
}
function count(n: unknown) {
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : 0;
}
export type ProviderMessage = Anthropic.Message & {
  usageReported?: boolean;
  reasoningTokens?: number;
  cacheWriteTokens?: number;
};
function normalized(
  model: string,
  text: string,
  input: number,
  output: number,
  cached: number,
  stop: string,
  reported: boolean,
  reasoning = 0,
  writes = 0,
): ProviderMessage {
  return {
    id: "provider-response",
    type: "message",
    role: "assistant",
    model,
    content: [{ type: "text", text }],
    stop_reason:
      stop === "length" || stop === "MAX_TOKENS" ? "max_tokens" : "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: Math.max(0, input - cached - writes),
      output_tokens: output,
      cache_read_input_tokens: cached,
      cache_creation_input_tokens: writes,
    },
    usageReported: reported,
    reasoningTokens: reasoning,
    cacheWriteTokens: writes,
  } as ProviderMessage;
}
export async function providerMessage(
  params: Params,
  timeout = 120_000,
): Promise<ProviderMessage> {
  const meta = aiModel(params.model);
  if (!meta)
    throw new AiProviderError("Dieses Modell ist nicht freigegeben.", 400);
  const provider = providerFor(params.model);
  const key=providerKey(provider).trim();
  if (!key)
    throw new AiProviderError(
      accountsEnabled() ? "Bitte deinen eigenen API-Schlüssel unter Mein Konto hinterlegen." : `${provider === "google" ? "GEMINI_API_KEY" : "OPENAI_API_KEY"} fehlt. Bitte in Vercel → snaplist → Settings → Environment Variables als Secret hinterlegen.`,
      503,
    );
  const schema =
    params.output_config?.format?.type === "json_schema"
      ? params.output_config.format.schema
      : undefined;
  let endpoint: string;
  let headers: Record<string, string>;
  let body: Record<string, unknown>;
  if (provider === "openai") {
    endpoint = "https://api.openai.com/v1/chat/completions";
    headers = {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    };
    body = {
      model: params.model,
      store: false,
      service_tier: "default",
      reasoning_effort: "none",
      max_completion_tokens: params.max_tokens,
      messages: [
        {
          role: "system",
          content: systemText(params) + "\nReturn one JSON object only.",
        },
        ...params.messages.map((m) => ({
          role: m.role,
          content: blocks(m.content as string | Block[]).map((b) => {
            if (b.type === "text") return { type: "text", text: b.text };
            if (b.type === "image")
              return {
                type: "image_url",
                image_url: { url: imageUrl(b), detail: "high" },
              };
            throw new AiProviderError(
              "Nicht unterstützter Nachrichteninhalt.",
              400,
            );
          }),
        })),
      ],
      response_format: schema
        ? {
            type: "json_schema",
            json_schema: { name: "snaplist", strict: true, schema },
          }
        : { type: "json_object" },
    };
  } else {
    endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${params.model}:generateContent`;
    headers = { "x-goog-api-key": key, "Content-Type": "application/json" };
    body = {
      systemInstruction: {
        parts: [
          { text: systemText(params) + "\nReturn one JSON object only." },
        ],
      },
      contents: params.messages.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: blocks(m.content as string | Block[]).map((b) => {
          if (b.type === "text") return { text: b.text };
          if (b.type === "image" && b.source.type === "base64")
            return {
              inlineData: {
                mimeType: b.source.media_type,
                data: b.source.data,
              },
            };
          // No server-side downloading of untrusted image URLs.
          throw new AiProviderError(
            "Für Gemini bitte die gespeicherten Originalfotos verwenden.",
            400,
          );
        }),
      })),
      generationConfig: {
        maxOutputTokens: params.max_tokens,
        responseMimeType: "application/json",
        ...(schema ? { responseJsonSchema: schema } : {}),
      },
    };
  }
  let response: Response;
  try {
    response = await boundedFetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(timeout),
    });
  } catch {
    throw new AiProviderError(
      `${meta.name}: Anfrage unterbrochen. Kein automatischer Neuversuch; bitte bewusst erneut starten.`,
    );
  }
  if (!response.ok)
    throw new AiProviderError(
      `${meta.name}: Anbieter meldet HTTP ${response.status}. API-Schlüssel, Modellfreigabe, Guthaben oder Rate-Limit prüfen. Es wurde kein anderes Modell verwendet.`,
      response.status,
    );
  let data: any;
  try {
    data = await response.json();
  } catch {
    throw new AiProviderError(`${meta.name}: ungültige Anbieterantwort.`);
  }
  if (provider === "openai") {
    const choice = data.choices?.[0];
    const u = data.usage;
    const result = normalized(
      data.model || params.model,
      typeof choice?.message?.content === "string"
        ? choice.message.content
        : "",
      count(u?.prompt_tokens),
      count(u?.completion_tokens),
      count(u?.prompt_tokens_details?.cached_tokens),
      choice?.finish_reason,
      Boolean(
        u &&
        Number.isFinite(u.prompt_tokens) &&
        Number.isFinite(u.completion_tokens),
      ),
      count(u?.completion_tokens_details?.reasoning_tokens),
      count(u?.prompt_tokens_details?.cache_write_tokens),
    );
    return result;
  }
  const candidate = data.candidates?.[0];
  const u = data.usageMetadata;
  const text = (candidate?.content?.parts ?? [])
    .filter((p: any) => typeof p.text === "string" && !p.thought)
    .map((p: any) => p.text)
    .join("\n");
  return normalized(
    data.modelVersion || params.model,
    text,
    count(u?.promptTokenCount),
    count(u?.candidatesTokenCount) + count(u?.thoughtsTokenCount),
    count(u?.cachedContentTokenCount),
    candidate?.finishReason,
    Boolean(
      u &&
      Number.isFinite(u.promptTokenCount) &&
      Number.isFinite(u.candidatesTokenCount),
    ),
    count(u?.thoughtsTokenCount),
  );
}

// A small compatibility boundary keeps Claude and all existing prompt/parsing
// code intact. These adapters implement only the messages.create operation used.
export function externalClient(model: string): Anthropic {
  if (!providerConfigured(providerFor(model))) {
    throw new AiProviderError(
      `${providerFor(model) === "google" ? "GEMINI_API_KEY" : "OPENAI_API_KEY"} ist noch nicht eingerichtet.`,
      503,
    );
  }
  return {
    messages: {
      create: (params: Params, options?: { timeout?: number }) =>
        providerMessage(params, options?.timeout),
    },
  } as unknown as Anthropic;
}
