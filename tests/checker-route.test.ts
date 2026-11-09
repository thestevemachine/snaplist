import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  message: vi.fn(),
  client: vi.fn(),
}));
vi.mock("../lib/accounts/server", () => ({
  withAccount: (handler: unknown) => handler,
}));
vi.mock("../lib/api-guard", () => ({
  guardApiRequest: mocks.guard,
  safeErrorResponse: () =>
    NextResponse.json({ error: "Erstellung fehlgeschlagen" }, { status: 500 }),
}));
vi.mock("../lib/anthropic", async () => ({
  getClient: mocks.client,
  parseModelJson: JSON.parse,
}));
vi.mock("../lib/ai-usage", () => ({
  collectUsage: async (fn: () => Promise<unknown>) => ({
    result: await fn(),
    usage: [],
  }),
  measuredMessage: mocks.message,
}));
import { POST } from "../app/api/checker/route";
const valid = {
  images: [{ mediaType: "image/jpeg", data: "YWJj" }],
  notes: "Größe M",
};
const result = {
  title: "Hemd",
  description: "Blaues Hemd",
  price: 15,
  priceReason: "Schätzung",
  uncertainties: [],
};
const request = (body: unknown) =>
  new NextRequest("http://localhost/api/checker", {
    method: "POST",
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.guard.mockReturnValue(null);
  mocks.client.mockReturnValue({});
  mocks.message.mockResolvedValue({
    content: [{ type: "text", text: JSON.stringify(result) }],
    stop_reason: "end_turn",
  });
});
describe("Checker API", () => {
  it("denies access before processing any images", async () => {
    mocks.guard.mockReturnValue(
      NextResponse.json({ error: "Denied" }, { status: 401 }),
    );
    expect((await POST(request(valid))).status).toBe(401);
    expect(mocks.message).not.toHaveBeenCalled();
  });
  it("rejects missing, invalid and oversized inputs before billing", async () => {
    for (const body of [
      { images: [] },
      { images: [{ mediaType: "text/html", data: "YWJj" }] },
      { ...valid, notes: "x".repeat(2001) },
    ])
      expect((await POST(request(body))).status).toBe(400);
    expect((await POST(request({ notes: "x".repeat(4000001) }))).status).toBe(
      413,
    );
    expect(mocks.message).not.toHaveBeenCalled();
  });
  it("returns validated output marked as an estimate with exactly one model call", async () => {
    const response = await POST(request(valid));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      result,
      priceSource: "estimate",
    });
    expect(mocks.message).toHaveBeenCalledTimes(1);
  });
  it("does not retry malformed or truncated model responses", async () => {
    mocks.message.mockResolvedValueOnce({
      content: [{ type: "text", text: "{}" }],
      stop_reason: "end_turn",
    });
    expect((await POST(request(valid))).status).toBe(500);
    expect(mocks.message).toHaveBeenCalledTimes(1);
    mocks.message.mockResolvedValueOnce({
      content: [{ type: "text", text: JSON.stringify(result) }],
      stop_reason: "max_tokens",
    });
    expect((await POST(request(valid))).status).toBe(500);
    expect(mocks.message).toHaveBeenCalledTimes(2);
  });
});
