import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { guardApiRequest } from "@/lib/api-guard";
import {
  bucket,
  checked,
  cloudEnabled,
  db,
  environment,
  newOwner,
  owner,
  OWNER_COOKIE,
} from "@/lib/cloud/store";
import { EBAY_COOKIE } from "@/lib/ebay/session";
import { issue, READ_COOKIE, verify } from "@/lib/live-foto/pairing";
import { cleanJpeg } from "@/lib/live-foto/image";
import {
  hasCompleteManifest,
  LIVE,
  MAX_PHOTOS,
  RETAIN,
  sameManifest,
  SESSION,
} from "@/lib/live-foto/policy";

export const maxDuration = 60;
const uuid = z.string().uuid();
const authCookie = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/",
};
class Fault extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
const missing = () =>
  new Fault("Fotositzung oder Artikel nicht verfügbar.", 404);

export async function POST(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;
  if (
    !process.env.APP_SECRET ||
    !cloudEnabled() ||
    process.env.LIVE_FOTO_ENABLED !== "true"
  )
    return NextResponse.json(
      { ok: false, error: "Live-Foto ist auf dieser Instanz nicht aktiviert." },
      { status: 503 },
    );
  try {
    const declaredBytes = Number(req.headers.get("content-length") ?? 0);
    if (declaredBytes > 2_700_000)
      throw new Fault("Anfrage überschreitet die Größenbegrenzung.", 413);
    const requestStarted = performance.now();
    const b = z
      .object({ action: z.string().max(32) })
      .loose()
      .parse(await req.json()) as Record<string, any>;
    const client = db();
    const env = environment();
    const workspace = owner(req);
    const batches = () => client.from("lister_batches");
    const respond = (data: object = {}) =>
      NextResponse.json(
        { ok: true, ...data },
        { headers: { "Cache-Control": "no-store" } },
      );
    if (b.action === "authorize") {
      const res = respond();
      if (!workspace)
        res.cookies.set(OWNER_COOKIE, newOwner().cookie, {
          ...authCookie,
          maxAge: 365 * 86400,
        });
      return res;
    }
    const find = async (id: string) =>
      checked(
        await batches()
          .select("id,workspace_id,status,settings,updated_at")
          .eq("id", id)
          .eq("environment", env)
          .maybeSingle(),
      );
    const pairing = b.action === "pair";
    const sessionId = pairing
      ? verify(z.string().max(200).parse(b.code), "pair")
      : uuid.parse(b.session);
    if (!sessionId)
      throw new Fault("Kopplungscode ungültig oder abgelaufen.", 403);
    let session = await find(sessionId);
    if (b.action === "session" && !session) {
      // Establish the cookie before creating any durable session. A lost first
      // response must not leave a saved session tied to a cookie never received.
      if (!workspace) throw new Fault("Browser zuerst autorisieren.", 401);
      checked(
        await batches().upsert(
          {
            id: sessionId,
            workspace_id: workspace,
            environment: env,
            settings: { source: SESSION },
            expires_at: RETAIN,
          },
          { onConflict: "id", ignoreDuplicates: true },
        ),
      );
      session = await find(sessionId);
    }
    if (!session || session.settings.source !== SESSION) throw missing();
    if (pairing) {
      const res = respond({ session: sessionId });
      res.cookies.set(READ_COOKIE, issue(sessionId, "read"), {
        ...authCookie,
        maxAge: 12 * 3600,
      });
      return res;
    }
    const owns = workspace === session.workspace_id;
    const reading = ["list", "image", "result"].includes(b.action);
    if (
      !owns &&
      !(
        reading &&
        verify(req.cookies.get(READ_COOKIE)?.value, "read") === sessionId
      )
    )
      throw missing();
    if (b.action === "session") return respond();
    if (b.action === "code") return respond({ code: issue(sessionId, "pair") });
    const itemRows = () =>
      batches()
        .select("id,status,settings")
        .eq("workspace_id", session!.workspace_id)
        .eq("environment", env)
        .eq("settings->>source", LIVE)
        .eq("settings->>session", sessionId);
    if (b.action === "list") {
      const rows = checked(
        await itemRows()
          .neq("status", "draft")
          .order("created_at", { ascending: false })
          .limit(250),
      );
      const latest = new Map<string, (typeof rows)[number]>();
      for (const row of rows) {
        const old = latest.get(row.settings.article);
        if (!old || old.settings.revision < row.settings.revision)
          latest.set(row.settings.article, row);
      }
      const ids = [...latest.values()].map((r) => r.id);
      if (!ids.length) return respond({ drafts: [] });
      const items = checked(
        await client
          .from("lister_items")
          .select("id,batch_id,draft")
          .in("batch_id", ids),
      );
      const jobs = items.length
        ? checked(
            await client
              .from("lister_jobs")
              .select("item_id,status,created_at,updated_at")
              .in(
                "item_id",
                items.map((i) => i.id),
              )
              .eq("stage", "analyze"),
          )
        : [];
      return respond({
        drafts: items.map((item) => {
          const job = jobs.find((j) => j.item_id === item.id);
          const { photoSources: _photoSources, ...draft } = item.draft;
          return {
            batch: item.batch_id,
            ...draft,
            status: job?.status ?? "queued",
            processingMs:
              job?.status === "succeeded"
                ? Date.parse(job.updated_at) - Date.parse(job.created_at)
                : undefined,
          };
        }),
      });
    }
    const batchId = uuid.parse(b.batch);
    let batch = await find(batchId);
    if (b.action === "open" && !batch) {
      const article = uuid.parse(b.article);
      const revision = z.number().int().min(1).max(1000).parse(b.revision);
      const parent = b.parent ? await find(uuid.parse(b.parent)) : null;
      if (
        b.parent &&
        (!parent ||
          parent.workspace_id !== session.workspace_id ||
          parent.status === "draft" ||
          parent.settings.source !== LIVE ||
          parent.settings.session !== sessionId ||
          parent.settings.article !== article ||
          parent.settings.revision !== revision - 1)
      )
        throw missing();
      checked(
        await batches().upsert(
          {
            id: batchId,
            workspace_id: session.workspace_id,
            environment: env,
            expires_at: RETAIN,
            settings: {
              source: LIVE,
              session: sessionId,
              article,
              revision,
              parent: parent?.id,
            },
            sealed_connection: req.cookies.get(EBAY_COOKIE)?.value ?? null,
          },
          { onConflict: "id", ignoreDuplicates: true },
        ),
      );
      batch = await find(batchId);
    }
    if (
      !batch ||
      batch.workspace_id !== session.workspace_id ||
      batch.settings.source !== LIVE ||
      batch.settings.session !== sessionId
    )
      throw missing();
    const photos = () =>
      client
        .from("lister_photos")
        .select("client_id,state,object_path")
        .eq("batch_id", batchId);
    const objects = client.storage.from(bucket());
    if (b.action === "open") {
      if (
        batch.settings.article !== b.article ||
        batch.settings.revision !== b.revision
      )
        throw missing();
      const parent = batch.settings.parent;
      const previous = parent
        ? checked(
            await client
              .from("lister_items")
              .select("draft")
              .eq("batch_id", parent)
              .single(),
          )
        : null;
      return respond({ inherited: previous?.draft.photoIds ?? [] });
    }
    if (b.action === "upload") {
      const photo = uuid.parse(b.photo);
      const existing = checked(
        await photos().eq("client_id", photo).maybeSingle(),
      );
      if (existing?.state === "uploaded") return respond();
      if (batch.status !== "draft" || existing?.state === "deleted")
        throw missing();
      let clean: Buffer;
      try {
        clean = await cleanJpeg(z.string().parse(b.data));
      } catch {
        throw new Fault(
          "Foto ist kein gültiges JPEG oder überschreitet die Größenbegrenzung.",
          422,
        );
      }
      const objectPath = `${session.workspace_id}/${batchId}/${photo}`;
      checked(
        await client.from("lister_photos").upsert(
          {
            batch_id: batchId,
            client_id: photo,
            bucket_id: bucket(),
            object_path: objectPath,
          },
          { onConflict: "batch_id,client_id", ignoreDuplicates: true },
        ),
      );
      const path = objectPath + "/upload.jpg";
      // A retry after a lost response finds the same immutable object.
      const transferStarted = performance.now();
      await objects.upload(path, clean, {
        contentType: "image/jpeg",
        upsert: false,
      });
      const confirmationStarted = performance.now();
      checked(await objects.info(path));
      checked(
        await client
          .from("lister_photos")
          .update({ state: "uploaded" })
          .eq("batch_id", batchId)
          .eq("client_id", photo)
          .eq("state", "pending"),
      );
      return respond({
        timings: {
          validateMs: transferStarted - requestStarted,
          storeMs: confirmationStarted - transferStarted,
          confirmMs: performance.now() - confirmationStarted,
        },
      });
    }
    const itemQuery = () =>
      client
        .from("lister_items")
        .select("id,draft,revision")
        .eq("batch_id", batchId);
    if (b.action === "seal") {
      const photoIds = z.array(uuid).min(1).max(MAX_PHOTOS).parse(b.photoIds);
      const sku = z.string().trim().min(1).max(50).parse(b.sku);
      const rows = checked(
        await photos().in("client_id", photoIds).eq("state", "uploaded"),
      );
      const parent = batch.settings.parent;
      const previous = parent
        ? checked(
            await client
              .from("lister_items")
              .select("draft")
              .eq("batch_id", parent)
              .single(),
          )
        : null;
      const own = new Set(rows.map((r) => r.client_id));
      const inherited = new Set<string>(previous?.draft.photoIds ?? []);
      if (!hasCompleteManifest(photoIds, [...own, ...inherited]))
        throw new Fault("Fotos fehlen noch.", 409);
      const photoSources = Object.fromEntries(
        photoIds
          .filter((p) => !own.has(p))
          .map((p) => [p, previous!.draft.photoSources?.[p] ?? parent]),
      );
      const { article, revision } = batch.settings;
      const draft = {
        id: article,
        revision,
        sku,
        name: "Brille",
        photoIds,
        photoSources,
      };
      if (batch.status === "draft")
        checked(
          await client.from("lister_items").upsert(
            {
              batch_id: batchId,
              client_id: article,
              sku,
              draft,
              revision,
            },
            { onConflict: "batch_id,client_id", ignoreDuplicates: true },
          ),
        );
      const item = checked(await itemQuery().single());
      if (!sameManifest(draft, item.draft))
        throw new Fault("Diese Revision ist bereits abgeschlossen.", 409);
      checked(
        await client
          .from("lister_jobs")
          .upsert(
            { item_id: item.id, revision, stage: "analyze" },
            { onConflict: "item_id,revision,stage", ignoreDuplicates: true },
          ),
      );
      checked(
        await batches()
          .update({ status: "running", updated_at: new Date().toISOString() })
          .eq("id", batchId)
          .eq("status", "draft"),
      );
      // The existing durable dispatcher recovers delivery if the response or fast dispatch is lost.
      const job = checked(
        await client
          .from("lister_jobs")
          .select("id,attempts,status")
          .eq("item_id", item.id)
          .eq("stage", "analyze")
          .single(),
      );
      if (job.status === "queued") {
        const { inngest } = await import("@/lib/cloud/inngest");
        await inngest
          .send({
            name: "lister/draft.requested",
            id: `${job.id}-${job.attempts}`,
            data: { jobId: job.id },
          })
          .catch(() => {});
      }
      return respond();
    }
    const item = checked(await itemQuery().maybeSingle());
    if (!item || batch.status === "draft") throw missing();
    if (b.action === "image") {
      const photo = uuid.parse(b.photo);
      if (!item.draft.photoIds.includes(photo)) throw missing();
      const source = item.draft.photoSources?.[photo] ?? batchId;
      const row = checked(
        await client
          .from("lister_photos")
          .select("object_path")
          .eq("batch_id", source)
          .eq("client_id", photo)
          .eq("state", "uploaded")
          .single(),
      );
      const blob = checked(
        await objects.download(row.object_path + "/upload.jpg"),
      );
      return new Response(blob, {
        headers: {
          "Content-Type": "image/jpeg",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    if (b.action === "retry") {
      const job = checked(
        await client
          .from("lister_jobs")
          .select("id,attempts,status")
          .eq("item_id", item.id)
          .eq("stage", "analyze")
          .single(),
      );
      if (job.status === "failed")
        checked(
          await client
            .from("lister_jobs")
            .update({
              status: "queued",
              attempts: job.attempts + 1,
              error: null,
            })
            .eq("id", job.id)
            .eq("status", "failed")
            .eq("attempts", job.attempts),
        );
      return respond();
    }
    if (b.action === "result") {
      const siblings = checked(
        await itemRows()
          .neq("status", "draft")
          .eq("settings->>article", item.draft.id),
      );
      if (siblings.some((r) => r.settings.revision > item.revision))
        throw new Fault(
          "Eine neuere Revision ist verfügbar. Bitte neu laden.",
          409,
        );
      const job = checked(
        await client
          .from("lister_jobs")
          .select("result")
          .eq("item_id", item.id)
          .eq("revision", item.revision)
          .eq("stage", "analyze")
          .eq("status", "succeeded")
          .maybeSingle(),
      );
      if (!job?.result?.prepared)
        throw new Fault("Entwurf ist noch nicht bereit.", 409);
      const { prepared, analysis, research } = job.result;
      const { photoSources: _photoSources, ...draft } = item.draft;
      return respond({
        draft,
        prepared,
        usage: [...(analysis?.usage ?? []), ...(prepared.usage ?? [])],
        comps: research?.comps,
      });
    }
    throw new Fault("Unbekannte Aktion.", 400);
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error:
          e instanceof Fault
            ? e.message
            : e instanceof z.ZodError || e instanceof SyntaxError
              ? "Ungültige Anfrage."
              : "Live-Foto ist vorübergehend nicht erreichbar.",
      },
      {
        status:
          e instanceof Fault
            ? e.status
            : e instanceof z.ZodError || e instanceof SyntaxError
              ? 400
              : 503,
      },
    );
  }
}
