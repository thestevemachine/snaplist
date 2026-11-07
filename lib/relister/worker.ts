import { syncStep } from "./sync";
import { inngest } from "../cloud/inngest";
import { accountDb } from "../accounts/server";
import { processJob } from "./jobs";
import { bucket } from "./store";
export function backgroundReady() {
  return Boolean(
    process.env.INNGEST_EVENT_KEY && process.env.INNGEST_SIGNING_KEY,
  );
}
// The database remains authoritative; cron recovers failed notifications.
export async function wakeRelister() {
  if (!backgroundReady()) return;
  try {
    await inngest.send({ name: "relister/work.requested", data: {} });
  } catch {
    console.warn("relister-wakeup-deferred");
  }
}
async function scheduleStaleCatalogSyncs() {
  const db = accountDb();
  const cutoff = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  const { data: stale, error } = await db
    .from("relister_catalog")
    .select("account_id,seller,synced_at")
    .lt("synced_at", cutoff)
    .order("synced_at", { ascending: true })
    .limit(10);
  if (error) throw Error("Veraltete Verkäuferbestände nicht verfügbar.");

  for (const catalog of stale ?? []) {
    const { data: previous, error: lookupError } = await db
      .from("relister_sync")
      .select("pending,updated_at")
      .eq("account_id", catalog.account_id)
      .maybeSingle();
    if (lookupError) throw Error("Sync-Status nicht verfügbar.");
    if (
      previous?.pending ||
      (previous?.updated_at && previous.updated_at > cutoff)
    )
      continue;

    const document = { stage: "pages", page: 1, items: [], cursor: 0 };
    if (previous) {
      const { error: updateError } = await db
        .from("relister_sync")
        .update({
          seller: catalog.seller,
          document,
          pending: true,
          updated_at: new Date().toISOString(),
        })
        .eq("account_id", catalog.account_id)
        .eq("pending", false)
        .lt("updated_at", cutoff);
      if (updateError)
        throw Error("Automatischer Sync konnte nicht geplant werden.");
    } else {
      const { error: insertError } = await db.from("relister_sync").insert({
        account_id: catalog.account_id,
        seller: catalog.seller,
        document,
        pending: true,
      });
      // A manual sync can insert this row concurrently.
      if (insertError && insertError.code !== "23505")
        throw Error("Automatischer Sync konnte nicht geplant werden.");
    }
  }
}
async function cleanCompletedBackups() {
  const db = accountDb();
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: oldJobs, error } = await db
    .from("relister_jobs")
    .select("id,document,updated_at")
    .eq("pending", false)
    .lt("updated_at", cutoff)
    .order("updated_at", { ascending: true })
    .limit(20);
  if (error) throw Error("Ablauf alter Sicherungen nicht verfügbar.");

  for (const record of oldJobs ?? []) {
    const document = record.document as {
      rows?: { phase?: string; backup?: { images?: { path?: string }[] }; outgoing?: unknown }[];
    };
    const rows = document.rows ?? [];
    // Keep complete recovery material for any task that still needs review.
    if (!rows.length || rows.some((row) => row.phase !== "completed")) continue;
    if (rows.every((row) => !row.backup && !row.outgoing)) continue;
    const paths = [
      ...new Set(
        rows.flatMap((row) => {
          const images = row.backup?.images ?? [];
          const imagePaths = images
            .map((image) => image.path)
            .filter((path): path is string => Boolean(path));
          const firstImagePath = images[0]?.path;
          const manifest = firstImagePath?.match(/^(.*)\/image-\d+$/)?.[1];
          return manifest
            ? [...imagePaths, `${manifest}/backup.json`]
            : imagePaths;
        }),
      ),
    ];
    for (let i = 0; i < paths.length; i += 500) {
      const { error: removeError } = await db.storage
        .from(bucket)
        .remove(paths.slice(i, i + 500));
      if (removeError) throw Error("Alte Bildsicherungen konnten nicht entfernt werden.");
    }

    const compact = {
      ...document,
      rows: rows.map(({ backup: _backup, outgoing: _outgoing, ...row }) => row),
    };
    const { data: updated, error: updateError } = await db
      .from("relister_jobs")
      .update({ document: compact, updated_at: new Date().toISOString() })
      .eq("id", record.id)
      .eq("pending", false)
      .eq("updated_at", record.updated_at)
      .select("id")
      .maybeSingle();
    if (updateError) throw Error("Abgelaufene Sicherungen konnten nicht bereinigt werden.");
    if (!updated) console.warn("relister-retention-raced", record.id);
  }
}
export const relisterTick = inngest.createFunction(
  {
    id: "relister-durable-tick",
    concurrency: 1,
    retries: 3,
    triggers: [{ cron: "*/15 * * * *" }, { event: "relister/work.requested" }],
  },
  async ({ step }) => {
    await step.run("schedule-stale-catalog-syncs", scheduleStaleCatalogSyncs);
    await step.run("clean-completed-backups", cleanCompletedBackups);
    for (let round = 0; round < 20; round++) {
      const syncIds = await step.run(`pending-syncs-${round}`, async () => {
        const { data, error } = await accountDb()
          .from("relister_sync")
          .select("account_id")
          .eq("pending", true)
          .order("updated_at")
          .limit(10);
        if (error) throw Error("Sync-Warteschlange nicht verfügbar.");
        return (data ?? []).map((r) => r.account_id);
      });
      for (const id of syncIds)
        await step.run(`sync-${round}-${id}`, () => syncStep(id));
      const ids = await step.run(`pending-jobs-${round}`, async () => {
        const { data, error } = await accountDb()
          .from("relister_jobs")
          .select("id")
          .eq("pending", true)
          .order("updated_at", { ascending: true })
          .limit(50);
        if (error) throw Error("Auftragsliste nicht verfügbar.");
        return (data ?? []).map((r) => r.id);
      });
      if (!syncIds.length && !ids.length) return { idle: true };
      for (const id of ids)
        await step.run(`job-${round}-${id}`, () => processJob(id));
      await step.sleep(`pace-${round}`, "30s");
    }
    if (!backgroundReady()) return { continued: false };
    await step.sendEvent("continue-work", {
      name: "relister/work.requested",
      data: {},
    });
    return { continued: true };
  },
);
