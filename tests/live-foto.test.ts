import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { scheduledDeletion } from "@/lib/live-foto/policy";
import { sweepOrphans } from "@/lib/live-foto/cleanup";
import { cleanJpeg } from "@/lib/live-foto/image";
import { newOwner, OWNER_COOKIE } from "@/lib/cloud/store";
import { POST } from "@/app/api/live-foto/route";
import { generateDraft } from "@/lib/cloud/worker";

const state = vi.hoisted(() => ({
  tables: new Map<string, Record<string, any>[]>(),
  objects: new Map<string, Buffer>(),
  events: vi.fn(async () => {}),
  analyze: vi.fn(async () =>
    Response.json({ ok: true, listing: { title: "Testbrille" } }),
  ),
  prepare: vi.fn(async () =>
    Response.json({ ok: true, listing: { title: "Geprüfter Testentwurf" } }),
  ),
  research: vi.fn(async () => Response.json({ ok: true })),
  failInfo: false,
}));

vi.mock("@/lib/services/analyze", () => ({ analyzePhotos: state.analyze }));
vi.mock("@/lib/services/prepare", () => ({ prepareListing: state.prepare }));
vi.mock("@/lib/services/research", () => ({ researchListing: state.research }));
vi.mock("@/lib/cloud/inngest", () => ({
  inngest: {
    send: state.events,
    createFunction: (_: unknown, handler: unknown) => handler,
  },
}));

vi.mock("@/lib/cloud/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/cloud/store")>();
  const value = (row: Record<string, any>, key: string) =>
    key.split("->>").reduce((obj: any, part) => obj?.[part], row);
  class Query {
    filters: ((row: Record<string, any>) => boolean)[] = [];
    input: Record<string, any> | undefined;
    action = "select";
    conflict = "";
    constructor(readonly name: string) {}
    select() {
      return this;
    }
    order() {
      return this;
    }
    limit() {
      return this;
    }
    eq(key: string, v: unknown) {
      this.filters.push((row) => String(value(row, key)) === String(v));
      return this;
    }
    neq(key: string, v: unknown) {
      this.filters.push((row) => value(row, key) !== v);
      return this;
    }
    in(key: string, vs: unknown[]) {
      this.filters.push((row) => vs.includes(value(row, key)));
      return this;
    }
    insert(input: Record<string, any>) {
      this.action = "insert";
      this.input = input;
      return this;
    }
    upsert(input: Record<string, any>, opts: { onConflict: string }) {
      this.action = "upsert";
      this.input = input;
      this.conflict = opts.onConflict;
      return this;
    }
    update(input: Record<string, any>) {
      this.action = "update";
      this.input = input;
      return this;
    }
    run() {
      const rows = state.tables.get(this.name) ?? [];
      state.tables.set(this.name, rows);
      if (this.action === "insert" || this.action === "upsert") {
        if (
          this.conflict &&
          rows.some((row) =>
            this.conflict
              .split(",")
              .every((key) => row[key] === this.input?.[key]),
          )
        )
          return [];
        const row = {
          id: randomUUID(),
          status: this.name === "lister_batches" ? "draft" : "queued",
          attempts: 0,
          state: "pending",
          created_at: new Date().toISOString(),
          ...this.input,
        };
        rows.push(row);
        return [row];
      }
      const matches = rows.filter((r) => this.filters.every((p) => p(r)));
      if (this.action === "update")
        matches.forEach((row) => Object.assign(row, this.input));
      return matches.map((r) => structuredClone(r));
    }
    async single() {
      const rows = this.run();
      return { data: rows[0] ?? null, error: rows.length !== 1 };
    }
    async maybeSingle() {
      return { data: this.run()[0] ?? null, error: null };
    }
    then(resolve: (v: unknown) => unknown) {
      return Promise.resolve({ data: this.run(), error: null }).then(resolve);
    }
  }
  return {
    ...original,
    db: () => ({
      from: (name: string) => new Query(name),
      storage: {
        from: (bucket: string) => ({
          async upload(path: string, bytes: Buffer) {
            const key = bucket + "/" + path;
            if (state.objects.has(key)) return { error: "Duplicate" };
            state.objects.set(key, Buffer.from(bytes));
            return { error: null };
          },
          async info(path: string) {
            if (state.failInfo) {
              state.failInfo = false;
              return { error: "Disconnected" };
            }
            return {
              error: state.objects.has(bucket + "/" + path) ? null : "Missing",
              data: {},
            };
          },
          async download(path: string) {
            const bytes = state.objects.get(bucket + "/" + path);
            return {
              error: bytes ? null : "Missing",
              data: new Blob(bytes ? [Uint8Array.from(bytes)] : []),
            };
          },
        }),
      },
    }),
  };
});

const generated = async () =>
  (
    await sharp({
      create: { width: 64, height: 48, channels: 3, background: "red" },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer()
  ).toString("base64");
let counter = 0;
const request = (body: object, cookie = "", secret = "local-test") =>
  POST(
    new NextRequest("http://localhost/api/live-foto", {
      method: "POST",
      body: JSON.stringify(body),
      headers: {
        cookie,
        "x-app-secret": secret,
        "x-forwarded-for": `test-${counter++}`,
      },
    }),
  );
beforeEach(() => {
  state.tables.clear();
  state.objects.clear();
  state.failInfo = false;
  vi.clearAllMocks();
  for (const [name, value] of Object.entries({
    APP_SECRET: "local-test",
    CLOUD_BATCH_ENABLED: "true",
    LIVE_FOTO_ENABLED: "true",
    SESSION_SECRET: "test-only-key",
    SUPABASE_URL: "https://invalid.test",
    SUPABASE_SECRET_KEY: "unused",
    INNGEST_EVENT_KEY: "unused",
    INNGEST_SIGNING_KEY: "unused",
  }))
    vi.stubEnv(name, value);
});

describe("Live-Foto service rehearsal (storage and AI simulated)", () => {
  it("isolates devices, verifies receipts and reuses the real cloud draft pipeline once per revision", async () => {
    const session = randomUUID(),
      article = randomUUID(),
      batch = randomUUID(),
      photo = randomUUID();
    expect((await request({ action: "session", session })).status).toBe(401);
    const authorized = await request({ action: "authorize" });
    const cookie = authorized.headers.get("set-cookie")!.split(";")[0];
    expect((await request({ action: "session", session }, cookie)).status).toBe(
      200,
    );
    expect((await request({ action: "session", session }, cookie)).status).toBe(
      200,
    );
    const foreign = OWNER_COOKIE + "=" + newOwner().cookie;
    const fields = { session, batch };
    const open = { ...fields, action: "open", article, revision: 1 };
    expect((await request(open, foreign)).status).toBe(404);
    expect((await request(open, cookie, "bad")).status).toBe(401);
    expect((await request(open, cookie)).status).toBe(200);
    const seal = {
      ...fields,
      action: "seal",
      photoIds: [photo],
      sku: "DEMO-01",
    };
    expect((await request(seal, cookie)).status).toBe(409);
    expect(state.events).not.toHaveBeenCalled();

    const upload = {
      ...fields,
      action: "upload",
      photo,
      data: await generated(),
    };
    expect(
      (await request({ ...upload, data: "not-a-jpeg" }, cookie)).status,
    ).toBe(422);
    state.failInfo = true;
    expect((await request(upload, cookie)).status).toBe(503);
    expect((await request(seal, cookie)).status).toBe(409);
    expect((await request(upload, cookie)).status).toBe(200);
    expect((await request(upload, cookie)).status).toBe(200);
    expect(state.objects.size).toBe(1);
    expect(
      (await request({ ...seal, photoIds: [photo, photo] }, cookie)).status,
    ).toBe(409);
    expect((await request(seal, cookie)).status).toBe(200);
    expect((await request(seal, cookie)).status).toBe(200);
    expect((await request({ ...seal, sku: "DIFFERENT" }, cookie)).status).toBe(
      409,
    );
    expect(state.tables.get("lister_jobs")).toHaveLength(1);
    expect(state.events.mock.calls[0]).toEqual(state.events.mock.calls[1]);
    const jobId = state.tables.get("lister_jobs")![0].id;
    const worker = generateDraft as unknown as (
      args: object,
    ) => Promise<unknown>;
    const run = () =>
      worker({
        event: { data: { jobId } },
        step: { run: (_: string, fn: () => Promise<unknown>) => fn() },
      });
    await run();
    await run();
    expect(state.analyze).toHaveBeenCalledTimes(1);
    expect(state.prepare).toHaveBeenCalledTimes(1);
    expect(state.research).toHaveBeenCalledTimes(1);
    const { code } = await (
      await request({ action: "code", session }, cookie)
    ).json();
    const paired = await request({ action: "pair", code });
    const reader = paired.headers.get("set-cookie")!.split(";")[0];
    expect((await request({ action: "list", session }, foreign)).status).toBe(
      404,
    );
    expect((await request(seal, reader)).status).toBe(404);
    expect(
      (await (await request({ ...fields, action: "result" }, reader)).json())
        .prepared.listing.title,
    ).toBe("Geprüfter Testentwurf");
    expect(
      (
        await request({ ...fields, action: "image", photo }, reader)
      ).headers.get("content-type"),
    ).toBe("image/jpeg");
    expect(
      (
        await request(
          { ...fields, action: "image", photo: randomUUID() },
          reader,
        )
      ).status,
    ).toBe(404);

    const revision = randomUUID();
    expect(
      (
        await request(
          { ...open, batch: revision, revision: 2, parent: batch },
          cookie,
        )
      ).status,
    ).toBe(200);
    expect((await request({ ...seal, batch: revision }, cookie)).status).toBe(
      200,
    );
    expect(state.objects.size).toBe(1);
    const reused = await request(
      { ...fields, batch: revision, action: "image", photo },
      reader,
    );
    expect(reused.headers.get("content-type")).toBe("image/jpeg");
    expect(
      (await request({ ...fields, action: "result" }, reader)).status,
    ).toBe(409);
    expect(
      (
        await (await request({ action: "list", session }, reader)).json()
      ).drafts.map((r: any) => r.revision),
    ).toEqual([2]);
  });

  it("strips metadata, rotates the original dimensions and rejects fake JPEGs", async () => {
    const image = await sharp(await cleanJpeg(await generated())).metadata();
    expect([image.width, image.height]).toEqual([48, 64]);
    expect(image.exif).toBeUndefined();
    await expect(
      cleanJpeg(Buffer.from([255, 216, 0, 1, 2]).toString("base64")),
    ).rejects.toThrow();
  });
});

it("publication evidence, holds and references determine eligibility without touching eBay", () => {
  const proof = {
    result: "success" as const,
    independentlyVerified: true,
    verifiedAt: 1000,
    ebayOwnsAllImages: true,
    activeReferences: 0,
  };
  expect(scheduledDeletion(proof)).toBe(86401000);
  expect(scheduledDeletion({ ...proof, retainUntil: 7 * 86400_000 })).toBe(
    7 * 86400_000,
  );
  expect(scheduledDeletion({ ...proof, result: "failed" })).toBeNull();
  expect(scheduledDeletion({ ...proof, result: "unknown" })).toBeNull();
  expect(
    scheduledDeletion({ ...proof, independentlyVerified: false }),
  ).toBeNull();
  expect(scheduledDeletion({ ...proof, ebayOwnsAllImages: false })).toBeNull();
  expect(scheduledDeletion({ ...proof, activeReferences: 1 })).toBeNull();
});

it("orphan dry run changes nothing; a storage failure leaves the reference for retry", async () => {
  const rows = [
    { id: "abandoned", object_path: "unreferenced" },
    { id: "shared", object_path: "used" },
  ];
  const store = {
    claim: vi.fn(async (id: string) => id !== "shared"),
    remove: vi
      .fn<(_: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(undefined),
    forget: vi.fn(async (_: string) => {}),
  };
  expect((await sweepOrphans(rows, store)).candidates).toEqual([
    "abandoned",
    "shared",
  ]);
  expect(store.claim).not.toHaveBeenCalled();
  expect((await sweepOrphans(rows, store, true)).failed).toBe(1);
  expect(store.forget).not.toHaveBeenCalled();
  expect((await sweepOrphans(rows, store, true)).removed).toBe(1);
  expect(store.forget).toHaveBeenCalledExactlyOnceWith("abandoned");
});
