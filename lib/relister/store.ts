import { accountDb } from "../accounts/server";
import type { Job, Listing } from "./domain";
import type { Repository } from "./engine";
export const bucket = "snaplist-relister";
export const enabled = () => process.env.RELISTER_ENABLED === "true";
function check(error: unknown) {
  if (error) {
    const e = error as { code?: string; message?: string };
    const reason =
      e.code === "P0001" && e.message?.startsWith("immutable")
        ? e.message
        : "Migration/Konfiguration prüfen";
    throw Error(
      `Re-Lister-Speicher nicht verfügbar (${e.code ?? "unbekannt"}): ${reason}.`,
    );
  }
}
export async function catalog(account: string) {
  const { data, error } = await accountDb()
    .from("relister_catalog")
    .select("*")
    .eq("account_id", account)
    .maybeSingle();
  check(error);
  return data as {
    seller: string;
    listings: Listing[];
    synced_at: string;
  } | null;
}
export async function saveCatalog(
  account: string,
  seller: string,
  listings: Listing[],
) {
  const old = await catalog(account);
  const previous = new Map(old?.listings.map((l) => [l.id, l]));
  let lineageRows: {
    new_id: string;
    old_id: string;
    first_seen: string;
    renewed_at: string;
  }[] = [];
  if (listings.length) {
    const lineage = await accountDb()
      .from("relister_lineage")
      .select("new_id,old_id,first_seen,renewed_at")
      .eq("account_id", account)
      .eq("seller", seller)
      .in("new_id", listings.map((listing) => listing.id));
    if (lineage.error) throw Error("Angebotshistorie nicht verfügbar.");
    lineageRows = lineage.data ?? [];
  }
  for (const l of listings) {
    const ancestor = lineageRows.find((a) => a.new_id === l.id);
    if (ancestor) {
      l.firstSeen = ancestor.first_seen;
      l.lastRenewed = ancestor.renewed_at;
      l.predecessors = [
        ...new Set([
          ...(previous.get(ancestor.old_id)?.predecessors ?? []),
          ancestor.old_id,
        ]),
      ];
    }
    const p = previous.get(l.id);
    if (p) {
      l.firstSeen = p.firstSeen;
      l.predecessors = p.predecessors;
      l.lastRenewed = p.lastRenewed;
    }
  }
  const { error } = await accountDb().from("relister_catalog").upsert({
    account_id: account,
    seller,
    listings,
    synced_at: new Date().toISOString(),
  });
  check(error);
}
export async function jobs(account: string) {
  const { data, error } = await accountDb()
    .from("relister_jobs")
    .select("document")
    .eq("account_id", account)
    .order("created_at", { ascending: false })
    .limit(20);
  check(error);
  return (data ?? []).map((r) => r.document as Job);
}
export async function getJob(account: string, id: string) {
  const { data, error } = await accountDb()
    .from("relister_jobs")
    .select("document")
    .eq("account_id", account)
    .eq("id", id)
    .single();
  check(error);
  if (!data) throw Error("Auftrag nicht gefunden.");
  return data.document as Job;
}
export async function insert(job: Job) {
  const { error } = await accountDb().from("relister_jobs").insert({
    id: job.id,
    account_id: job.account,
    seller: job.seller,
    document: job,
    pending: job.confirmed,
  });
  check(error);
}
export function repository(account: string, leaseOwner?: string): Repository {
  return {
    async completed(job, row) {
      if (job.mode !== "live" || !row.newId) return;
      const { error } = await accountDb().from("relister_lineage").upsert(
        {
          account_id: account,
          seller: job.seller,
          old_id: row.listing.id,
          new_id: row.newId,
          job_id: job.id,
          first_seen: row.listing.firstSeen,
          renewed_at: new Date().toISOString(),
        },
        { onConflict: "seller,old_id" },
      );
      check(error);
    },
    async authorized(job, row) {
      if (leaseOwner) {
        const { data, error } = await accountDb()
          .from("relister_claims")
          .select("job_id")
          .eq("job_id", job.id)
          .eq("lease_owner", leaseOwner)
          .gt("lease_until", new Date().toISOString())
          .maybeSingle();
        if (error || !data) return false;
      }
      if (
        process.env.RELISTER_LIVE_ENABLED !== "true" ||
        !row.backup ||
        !row.outgoing
      )
        return false;
      const { data, error } = await accountDb()
        .from("relister_approvals")
        .select("job_id")
        .eq("job_id", job.id)
        .eq("item_id", row.listing.id)
        .eq("account_id", account)
        .eq("seller", job.seller)
        .eq("snapshot_digest", job.previewDigest)
        .eq("target_cents", row.targetCents)
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();
      return !error && Boolean(data);
    },
    async save(job) {
      if (job.account !== account) throw Error("Kontokonflikt.");
      const { error } = await accountDb().rpc(
        leaseOwner ? "relister_worker_save" : "relister_save",
        {
          p_job: job.id,
          p_account: account,
          p_document: job,
          ...(leaseOwner ? { p_owner: leaseOwner } : {}),
        },
      );
      check(error);
    },
    async pause(job) {
      await command(account, job.id, "pause");
    },
    async paused(job) {
      return (await getJob(account, job.id)).paused;
    },
    async lock(seller, item, job) {
      const { data, error } = await accountDb().rpc("relister_lock", {
        p_seller: seller,
        p_item: item,
        p_job: job,
      });
      check(error);
      return data === true;
    },
  };
}

export async function command(
  account: string,
  id: string,
  action: "confirm" | "pause" | "resume",
) {
  const { error } = await accountDb().rpc("relister_command", {
    p_job: id,
    p_account: account,
    p_action: action,
  });
  check(error);
}
