import { afterEach, expect, it, vi } from "vitest";
import { AI_LISTING_SCHEMA } from "@/lib/ai-schema";
import { frontObservationSchema } from "@/lib/front-measurements";
import { analyzePhotos } from "@/lib/services/analyze";

// Emulate the provider's rejection of raw schema keywords. Most existing
// adapter fixtures return success regardless of whether a schema is supported.
function assertClaudeCompatible(schema: unknown) {
  if (!schema || typeof schema !== "object") return;
  for (const [key, value] of Object.entries(schema)) {
    if (["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minLength", "maxLength", "maxItems"].includes(key))
      throw new Error(`Unsupported Claude schema keyword: ${key}`);
    assertClaudeCompatible(value);
  }
}
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it("rejects the production-breaking schema fixture and accepts every nested listing contour", () => {
  expect(() => assertClaudeCompatible({ properties: { x: { type: "number", minimum: 0, maximum: 1 } } })).toThrow("Unsupported Claude");
  expect(() => assertClaudeCompatible(AI_LISTING_SCHEMA)).not.toThrow();
  const contour = { left: { x: 0.2, y: 0.4 }, right: { x: 0.4, y: 0.4 }, top: { x: 0.3, y: 0.2 }, bottom: { x: 0.3, y: 0.6 } };
  const geometry = { photoIndex: 1, leftLens: contour, rightLens: contour, outerLeft: {x: 0, y: 0.4}, outerRight: {x: 1, y: 0.4}, frontal: true, groovesVisible: true, complete: true, samePlane: true, confidence: 90, note: "" };
  expect(frontObservationSchema.safeParse(geometry).success).toBe(true);
  for (const x of [-0.01, 1.01])
    expect(frontObservationSchema.safeParse({...geometry, outerLeft: {x, y: 0.4}}).success).toBe(false);
});
it("runs the native Claude analysis request with provider-compatible geometry schema and no automatic repeat", async () => {
  vi.stubEnv("ANTHROPIC_API_KEY", "fake-test-key");
  const raw = { title: "Camera", description: "Camera", item_type: "Camera", brand: "Canon", condition: "GOOD", specifics: [], eyewear_kind: "not_eyewear" };
  const fetchMock = vi.fn(async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    assertClaudeCompatible(body.output_config.format.schema);
    return Response.json({ id: "msg_test", type: "message", role: "assistant", model: "claude-sonnet-4-6", content: [{type: "text", text: JSON.stringify(raw)}], stop_reason: "end_turn", stop_sequence: null, usage: {input_tokens: 100, output_tokens: 20} });
  });
  vi.stubGlobal("fetch", fetchMock);
  const response = await analyzePhotos({ profile: "hard_goods", images: [{mediaType: "image/jpeg", data: "AAAA"}], analysisModel: "claude-sonnet-4-6" });
  expect(response.status).toBe(200);
  expect((await response.json()).listing.brand).toBe("Canon");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
