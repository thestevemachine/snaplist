import { syncStep } from "./sync";
import { inngest } from "../cloud/inngest";
import { accountDb } from "../accounts/server";
import { processJob } from "./jobs";
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
export const relisterTick = inngest.createFunction(
  {
    id: "relister-durable-tick",
    concurrency: 1,
    retries: 3,
    triggers: [{ cron: "*/15 * * * *" }, { event: "relister/work.requested" }],
  },
  async ({ step }) => {
    await step.run("schedule-stale-catalog-syncs", scheduleStaleCatalogSyncs);
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
    await step.sendEvent("continue-work", {
      name: "relister/work.requested",
      data: {},
    });
    return { continued: true };
  },
);
