import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { getClient } from "@/lib/anthropic";
import { providerMessage } from "@/lib/ai-providers";
import { collectUsage, measuredMessage } from "@/lib/ai-usage";
import { isAllowedModel, resolveModel } from "@/lib/models";
import { modelRates } from "@/lib/ai-catalog";
import { usageTotals } from "@/lib/ai-costs";
import { analysisImages } from "@/lib/analysis-images";
import { POST as testConnection } from "@/app/api/ai/test/route";
import { analyzePhotos } from "@/lib/services/analyze";
import { GET as modelOptions } from "@/app/api/models/route";
import { AI_LISTING_SCHEMA } from "@/lib/ai-schema";
import type Anthropic from "@anthropic-ai/sdk";
let fetchMock: ReturnType<typeof vi.fn>;
const image = {
  type: "image",
  source: { type: "base64", media_type: "image/jpeg", data: "AAAA" },
} as const;
const params = (
  model = "gpt-6-luna",
): Anthropic.MessageCreateParamsNonStreaming => ({
  model,
  max_tokens: 5000,
  system: [{ type: "text", text: "Keep all existing listing rules." }],
  messages: [
    {
      role: "user",
      content: [image, { type: "text", text: "Inspect photo 1" }],
    },
  ],
  output_config: { format: { type: "json_schema", schema: AI_LISTING_SCHEMA } },
});
function openai(content = '{"ok":true}', overrides = {}) {
  return Response.json({
    model: "gpt-6-luna",
    choices: [{ message: { content }, finish_reason: "stop" }],
    usage: {
      prompt_tokens: 1000,
      prompt_tokens_details: { cached_tokens: 200 },
      completion_tokens: 100,
      completion_tokens_details: { reasoning_tokens: 30 },
    },
    ...overrides,
  });
}
beforeEach(() => {
  vi.stubEnv("GEMINI_API_KEY", "private-google-key");
  vi.stubEnv("OPENAI_API_KEY", "private-openai-key");
  vi.stubEnv("ANTHROPIC_API_KEY", undefined);
  vi.stubEnv("APP_SECRET", "test-access");
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it("offers only explicit providers and rejects unknown models instead of escalating", () => {
  for (const id of [
    "gpt-6-luna",
    "gpt-5.4-mini",
    "gemini-3.8-flash",
    "gemini-3.5-flash-lite",
    "gemini-2.5-flash-lite",
    "claude-sonnet-4-6",
  ])
    expect(isAllowedModel(id)).toBe(true);
  for (const id of ["qwen", "gpt-6-astra", "custom-host/model"])
    expect(isAllowedModel(id)).toBe(false);
  expect(() => resolveModel("unknown", "claude-opus-4-8")).toThrow(
    "kein automatischer",
  );
});
it("does not require a Claude key to use OpenAI or Gemini", () => {
  expect(getClient("gpt-6-luna")).toBeDefined();
  expect(getClient("gemini-3.5-flash-lite")).toBeDefined();
  expect(() => getClient()).toThrow("ANTHROPIC_API_KEY");
});
it("maps OpenAI images, all rules and strict listing schema without tools or storage", async () => {
  fetchMock.mockResolvedValue(openai());
  await providerMessage(params());
  const [url, init] = fetchMock.mock.calls[0];
  const body = JSON.parse(init.body);
  expect(url).toBe("https://api.openai.com/v1/chat/completions");
  expect(init.headers.Authorization).toBe("Bearer private-openai-key");
  expect(body.messages[0].content).toContain("Keep all existing listing rules");
  expect(body.messages[1].content[0].image_url).toEqual({
    url: "data:image/jpeg;base64,AAAA",
    detail: "high",
  });
  expect(body.response_format.json_schema.schema).toEqual(AI_LISTING_SCHEMA);
  expect(body.store).toBe(false);
  expect(body.service_tier).toBe("default");
  expect(body.tools).toBeUndefined();
  expect(init.redirect).toBe("error");
});
it("maps Gemini image bytes and schema and authenticates outside the URL", async () => {
  fetchMock.mockResolvedValue(
    Response.json({
      candidates: [
        { content: { parts: [{ text: '{"ok":true}' }] }, finishReason: "STOP" },
      ],
      usageMetadata: {
        promptTokenCount: 100,
        cachedContentTokenCount: 20,
        candidatesTokenCount: 30,
        thoughtsTokenCount: 10,
      },
    }),
  );
  const message = await providerMessage(params("gemini-3.5-flash-lite"));
  const [url, init] = fetchMock.mock.calls[0];
  const body = JSON.parse(init.body);
  expect(url).toBe(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent",
  );
  expect(url).not.toContain("private");
  expect(init.headers["x-goog-api-key"]).toBe("private-google-key");
  expect(body.contents[0].parts[0].inlineData.data).toBe("AAAA");
  expect(body.generationConfig.responseJsonSchema).toEqual(AI_LISTING_SCHEMA);
  expect(message.usage.input_tokens).toBe(80);
  expect(message.usage.output_tokens).toBe(40);
  expect(message.reasoningTokens).toBe(10);
});
it("calculates from actual tokens without double-counting cached input or reasoning output", async () => {
  fetchMock.mockResolvedValue(openai());
  const { usage } = await collectUsage(() =>
    measuredMessage("analysis", getClient("gpt-6-luna"), params()),
  );
  expect(usage[0].input).toBe(800);
  expect(usage[0].cacheRead).toBe(200);
  expect(usage[0].output).toBe(100);
  expect(usage[0].reasoning).toBe(30);
  expect(usage[0].estimatedUsd).toBeCloseTo(
    (800 * 0.1 + 200 * 0.01 + 100 * 0.5) / 1e6,
    10,
  );
  expect(usage[0].usageReported).toBe(true);
  expect(usageTotals([...usage, ...usage]).usd).toBe(usage[0].estimatedUsd);
});
it("keeps missing provider usage unknown instead of claiming zero cost", async () => {
  fetchMock.mockResolvedValue(openai('{"ok":true}', { usage: undefined }));
  const { usage } = await collectUsage(() =>
    measuredMessage("analysis", getClient("gpt-6-luna"), params()),
  );
  expect(usage[0].usageReported).toBe(false);
  expect(usage[0].estimatedUsd).toBeUndefined();
  expect(usageTotals(usage).unknown).toBe(true);
});
it("retains Claude's SDK request and reported cache accounting", async () => {
  const create = vi.fn().mockResolvedValue({
    model: "claude-sonnet-4-6",
    stop_reason: "end_turn",
    content: [{ type: "text", text: "{}" }],
    usage: {
      input_tokens: 100,
      output_tokens: 10,
      cache_read_input_tokens: 20,
      cache_creation_input_tokens: 30,
    },
  });
  const request = params("claude-sonnet-4-6");
  const client = { messages: { create } } as unknown as Anthropic;
  const { usage } = await collectUsage(() =>
    measuredMessage("analysis", client, request, { maxRetries: 0 }),
  );
  expect(create).toHaveBeenCalledWith(request, { maxRetries: 0 });
  expect(fetchMock).not.toHaveBeenCalled();
  expect(usage[0].estimatedUsd).toBeCloseTo(
    (100 * 3 + 10 * 15 + 20 * 0.3 + 30 * 3.75) / 1e6,
  );
});
it.each([401, 403, 429, 500])(
  "does not retry, change providers, or reveal upstream body on HTTP %i",
  async (status) => {
    fetchMock.mockResolvedValue(
      new Response("private-openai-key private-upstream", { status }),
    );
    await expect(providerMessage(params())).rejects.toMatchObject({
      aiTerminal: true,
      status,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    try {
      await providerMessage(params());
    } catch (e) {
      expect((e as Error).message).not.toContain("private");
    }
  },
);
it("requires a key before any paid call", async () => {
  vi.stubEnv("OPENAI_API_KEY", undefined);
  await expect(providerMessage(params())).rejects.toThrow("OPENAI_API_KEY");
  expect(fetchMock).not.toHaveBeenCalled();
});
it("expires Gemini promotional rates on the announced date", () => {
  expect(modelRates("gemini-3.8-flash", "2026-12-31")?.input).toBe(0.75);
  expect(modelRates("gemini-3.8-flash", "2027-01-01")?.input).toBe(1.5);
});
it("uses identical full-resolution last-photo selection for comparisons", () => {
  const photos = [
    { mediaType: "image/jpeg", data: "AAAA" },
    { mediaType: "image/jpeg", data: "BBBB", uploadData: "CCCC" },
  ];
  expect(analysisImages(photos)).toEqual([
    { mediaType: "image/jpeg", data: "AAAA" },
    { mediaType: "image/jpeg", data: "CCCC" },
  ]);
  expect(photos[1].data).toBe("BBBB");
});
function request(body: unknown, authenticated = true) {
  return new NextRequest("https://test.example/api/ai/test", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(authenticated ? { "x-app-secret": "test-access" } : {}),
    },
    body: JSON.stringify(body),
  });
}
it("requires authentication and explicit paid-test consent", async () => {
  expect(
    (
      await testConnection(
        request({ model: "gpt-6-luna", confirmed: true }, false),
      )
    ).status,
  ).toBe(401);
  expect((await testConnection(request({ model: "gpt-6-luna" }))).status).toBe(
    400,
  );
  expect(fetchMock).not.toHaveBeenCalled();
});
it("connection test returns measured usage, never credentials", async () => {
  fetchMock.mockResolvedValue(openai());
  const r = await testConnection(
    request({ model: "gpt-6-luna", confirmed: true }),
  );
  const data = await r.json();
  expect(data.ok).toBe(true);
  expect(data.usage).toHaveLength(1);
  expect(JSON.stringify(data)).not.toContain("private");
  expect(r.headers.get("Cache-Control")).toBe("no-store");
});
it("runs the existing analysis pipeline with OpenAI and preserves deterministic listing rules", async () => {
  const raw = {
    eyewear_kind: "not_eyewear",
    classification_note: "",
    title: "Vintage Camera",
    description: "Camera",
    category: "Camera",
    category_hint: "Camera",
    brand: "Canon",
    item_type: "Camera",
    color: [],
    size: "",
    material: "",
    condition: "GOOD",
    condition_notes: "",
    measurements: "",
    suggested_price: 20,
    search_terms: [],
    seo_keywords: [],
    key_features: [],
    specifics: [],
  };
  fetchMock.mockResolvedValue(openai(JSON.stringify(raw)));
  const response = await analyzePhotos({
    profile: "hard_goods",
    images: [{ mediaType: "image/jpeg", data: "AAAA" }],
    analysisModel: "gpt-6-luna",
  });
  const data = await response.json();
  expect(data.ok).toBe(true);
  expect(data.listing.brand).toBe("Canon");
  expect(data.usage).toHaveLength(1);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it("does not repeat a billable malformed analysis and returns the failed run's usage", async () => {
  fetchMock.mockResolvedValue(openai("broken JSON"));
  vi.spyOn(console, "error").mockImplementation(() => {});
  const response = await analyzePhotos({
    profile: "hard_goods",
    images: [{ mediaType: "image/jpeg", data: "AAAA" }],
    analysisModel: "gpt-6-luna",
  });
  const data = await response.json();
  expect(response.ok).toBe(false);
  expect(data.usage).toHaveLength(1);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("calculates front-photo dimensions in the same paid analysis, preserves inscription facts and never generates eBay measurements", async () => {
  const contour = (left: number, right: number) => ({
    left: { x: left, y: 0.4 },
    right: { x: right, y: 0.4 },
    top: { x: (left + right) / 2, y: 0.2 },
    bottom: { x: (left + right) / 2, y: 0.6 },
  });
  const raw = {
    title: "Test Brille",
    description: "",
    eyewear_kind: "optical",
    category_hint: "Brille",
    item_type: "Brille",
    suggested_price: 25,
    measurements: "",
    specifics: [
      {
        name: "Bügelaufdruck",
        value: "50□18 140",
        quote: "50□18 140",
        basis: "label",
        photoIndices: [2],
        confidence: 99,
      },
    ],
    front_geometry: {
      photoIndex: 1,
      leftLens: contour(0.205, 0.455),
      rightLens: contour(0.545, 0.795),
      outerLeft: { x: 0.05, y: 0.4 },
      outerRight: { x: 0.95, y: 0.4 },
      frontal: true,
      groovesVisible: true,
      complete: true,
      samePlane: true,
      confidence: 95,
      note: "",
    },
  };
  fetchMock.mockResolvedValue(openai(JSON.stringify(raw)));
  const image = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(image);
  image.write("IHDR", 12);
  image.writeUInt32BE(1000, 16);
  image.writeUInt32BE(500, 20);
  const response = await analyzePhotos({
    profile: "hard_goods",
    analysisModel: "gpt-6-luna",
    images: [
      { mediaType: "image/png", data: image.toString("base64") },
      { mediaType: "image/jpeg", data: "AAAA" },
    ],
  });
  const data = await response.json();
  expect(data.ok).toBe(true);
  expect(data.listing.frontMeasurement).toMatchObject({
    status: "estimated",
    lensHeightMm: 40,
    totalWidthMm: 180,
    referencePhotos: [2],
  });
  expect(data.listing.measurements).toContain("Pixelberechnung");
  expect(data.listing.item_specifics.Gesamtbreite).toBeUndefined();
  expect(data.listing.eyewear.fields.lensWidth.value).toBe("50");
  expect(data.usage).toHaveLength(1);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const request = JSON.parse(fetchMock.mock.calls[0][1].body);
  expect(request.messages[0].content).toContain("front_geometry");
});
it("uses Gemini Flash-Lite when no model was chosen and forwards a bounded seller correction hint", async () => {
  const raw = { title:"Sonnenbrille", description:"", eyewear_kind:"sunglasses", item_type:"Sonnenbrille", specifics:[] };
  fetchMock.mockResolvedValue(Response.json({candidates:[{content:{parts:[{text:JSON.stringify(raw)}]},finishReason:"STOP"}],usageMetadata:{promptTokenCount:100,candidatesTokenCount:30}}));
  const response = await analyzePhotos({profile:"hard_goods",images:[{mediaType:"image/jpeg",data:"AAAA"}],hint:"Das ist eine Sonnenbrille"});
  expect(response.status).toBe(200);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url,init]=fetchMock.mock.calls[0];
  expect(String(url)).toContain("gemini-3.5-flash-lite");
  expect(String(init.body)).toContain("Das ist eine Sonnenbrille");
  expect(String(url)).not.toContain("anthropic");
});

it("exposes Gemini Flash-Lite as the single default for both selectors without a Claude key", async () => {
  const data=await (await modelOptions()).json();
  for(const key of ["sortModels","analysisModels"]) {
    expect(data[key].filter((m: {isDefault:boolean}) => m.isDefault).map((m:{id:string})=>m.id)).toEqual(["gemini-3.5-flash-lite"]);
    expect(data[key].some((m:{id:string})=>m.id.startsWith("claude"))).toBe(true);
  }
  expect(fetchMock).not.toHaveBeenCalled();
});
