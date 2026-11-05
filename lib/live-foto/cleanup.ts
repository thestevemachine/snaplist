import { checked, db, environment } from "@/lib/cloud/store";
import { LIVE, orphanCandidates } from "./policy";

export type OrphanStore = {
  claim: (id: string) => Promise<boolean>;
  remove: (path: string) => Promise<void>;
  forget: (id: string) => Promise<void>;
};

export async function sweepOrphans(
  entries: { id: string; object_path: string }[],
  store: OrphanStore,
  apply = false,
) {
  const report = {
    candidates: entries.map((p) => p.id),
    removed: 0,
    failed: 0,
  };
  if (!apply) return report;
  for (const p of entries) {
    try {
      if (!(await store.claim(p.id))) continue;
      await store.remove(p.object_path + "/upload.jpg");
      await store.forget(p.id);
      report.removed++;
    } catch {
      report.failed++;
    }
  }
  return report;
}

// The sealed manifest is immutable, and photos have unique bucket/object paths.
// Only photos outside that manifest can be marked deleted. A new revision
// uploads under a new batch path, so it cannot acquire this reference.
export async function cleanupLivePhotos(now = Date.now()) {
  const env = environment();
  const client = db();
  const cutoff = new Date(now - 7 * 86400_000).toISOString();
  const rows = checked(
    await client
      .from("lister_photos")
      .select(
        "id,batch_id,client_id,created_at,bucket_id,object_path,lister_batches!inner(environment,status,settings,updated_at)",
      )
      .eq("lister_batches.environment", env)
      .eq("lister_batches.settings->>source", LIVE)
      .eq("lister_batches.status", "running")
      .lt("lister_batches.updated_at", cutoff)
      .lt("created_at", cutoff)
      .order("id")
      .limit(1000),
  );
  const abandonedReview = checked(
    await client
      .from("lister_batches")
      .select("id")
      .eq("environment", env)
      .eq("settings->>source", LIVE)
      .eq("status", "draft")
      .lt("updated_at", new Date(now - 30 * 86400_000).toISOString())
      .order("updated_at")
      .limit(50),
  ).map((r) => r.id);
  if (!rows.length)
    return { candidates: [], abandonedReview, removed: 0, failed: 0 };
  const ids = [...new Set(rows.map((r) => r.batch_id))];
  const items = checked(
    await client
      .from("lister_items")
      .select("batch_id,draft")
      .in("batch_id", ids),
  );
  const candidates = rows
    .filter((row) => {
      const item = items.find((i) => i.batch_id === row.batch_id);
      return (
        item &&
        Array.isArray(item.draft.photoIds) &&
        orphanCandidates([row], item.draft.photoIds, now).length
      );
    })
    .slice(0, 50);
  const result = await sweepOrphans(
    candidates,
    {
      claim: async (id) => {
        const row = candidates.find((r) => r.id === id)!;
        const item = checked(
          await client
            .from("lister_items")
            .select("draft")
            .eq("batch_id", row.batch_id)
            .single(),
        );
        if (
          !Array.isArray(item.draft.photoIds) ||
          item.draft.photoIds.includes(row.client_id)
        )
          return false;
        return Boolean(
          checked(
            await client
              .from("lister_photos")
              .update({ state: "deleted" })
              .eq("id", id)
              .eq("batch_id", row.batch_id)
              .select("id")
              .maybeSingle(),
          ),
        );
      },
      remove: async (path) => {
        const row = candidates.find(
          (r) => r.object_path + "/upload.jpg" === path,
        )!;
        checked(await client.storage.from(row.bucket_id).remove([path]));
      },
      forget: async (id) => {
        checked(
          await client
            .from("lister_photos")
            .delete()
            .eq("id", id)
            .eq("state", "deleted"),
        );
      },
    },
    env !== "production" && process.env.LIVE_FOTO_ORPHAN_SWEEP === "apply",
  );
  return { ...result, abandonedReview };
}
