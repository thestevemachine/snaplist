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
export const relisterTick = inngest.createFunction(
  {
    id: "relister-durable-tick",
    concurrency: 1,
    retries: 3,
    triggers: [{ cron: "*/15 * * * *" }, { event: "relister/work.requested" }],
  },
  async ({ step }) => {
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
