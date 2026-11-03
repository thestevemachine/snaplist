import { syncStep } from "./sync";
import { inngest } from "../cloud/inngest";
import { accountDb } from "../accounts/server";
import { processJob } from "./jobs";
export const relisterTick = inngest.createFunction(
  {
    id: "relister-durable-tick",
    concurrency: 1,
    retries: 3,
    triggers: { cron: "*/1 * * * *" },
  },
  async ({ step }) => {
    const syncIds = await step.run("pending-syncs", async () => {
      const { data, error } = await accountDb()
        .from("relister_sync")
        .select("account_id")
        .eq("pending", true)
        .order("updated_at")
        .limit(10);
      if (error) throw Error("Sync-Warteschlange nicht verfügbar.");
      return (data ?? []).map((r) => r.account_id);
    });
    for (const id of syncIds) await step.run(`sync-${id}`, () => syncStep(id));
    const ids = await step.run("pending-jobs", async () => {
      const { data, error } = await accountDb()
        .from("relister_jobs")
        .select("id")
        .eq("pending", true)
        .order("updated_at", { ascending: true })
        .limit(50);
      if (error) throw Error("Auftragsliste nicht verfügbar.");
      return (data ?? []).map((r) => r.id);
    });
    for (const id of ids) await step.run(`job-${id}`, () => processJob(id));
    return { checked: ids.length };
  },
);
