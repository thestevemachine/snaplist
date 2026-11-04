import { randomUUID } from "node:crypto";
import { digest, advance } from "./engine";
import {
  reducedPrice,
  exclusions,
  percentUnits,
  type Job,
  type Listing,
} from "./domain";
import { accountDb } from "../accounts/server";
import { bucket, repository } from "./store";
import { backgroundAccount, realAdapter } from "./runtime";
import { Simulation } from "./simulation";
export function preview(
  account: string,
  seller: string,
  listings: Listing[],
  percent: unknown,
): Job {
  percentUnits(percent);
  if (
    !listings.length ||
    listings.length > 100 ||
    new Set(listings.map((l) => l.id)).size !== listings.length
  )
    throw Error("1 bis 100 verschiedene Angebote auswählen.");
  const rows = listings.map((listing) => {
    const target = reducedPrice(listing.priceCents, percent);
    const reasons = exclusions(listing, seller, target);
    if (reasons.length) throw Error(`${listing.id}: ${reasons.join("; ")}`);
    return {
      id: randomUUID(),
      listing,
      originalCents: listing.priceCents,
      percent: String(percent),
      targetCents: target,
      phase: "selected" as const,
      uuid: randomUUID().replaceAll("-", "").toUpperCase(),
      attempts: 0,
      history: [],
    };
  });
  return {
    id: randomUUID(),
    account,
    seller,
    rows,
    confirmed: false,
    paused: false,
    mode: "simulation",
    createdAt: new Date().toISOString(),
    previewDigest: digest(rows),
  };
}
export async function processJob(id: string) {
  const db = accountDb(),
    owner = randomUUID();
  const claim = await db.rpc("relister_claim", { p_job: id, p_owner: owner });
  if (claim.error) throw Error("Hintergrundsperre nicht verfügbar.");
  if (!claim.data) return;
  try {
    const { data, error } = await db
      .from("relister_jobs")
      .select("document")
      .eq("id", id)
      .single();
    if (error || !data) throw Error("Auftrag nicht verfügbar.");
    const job = data.document as Job;
    // Background workers never borrow the owner's eBay identity.
    if (job.mode === "live" && process.env.RELISTER_LIVE_ENABLED !== "true")
      throw Error("Live-Pilot nicht freigegeben.");
    const repo = repository(job.account, owner);
    let adapter;
    try {
      adapter =
        job.mode !== "simulation"
          ? await realAdapter(await backgroundAccount(job.account), job.seller)
          : new Simulation(job.rows, async (path, bytes) => {
              const r = await db.storage.from(bucket).upload(path, bytes, {
                contentType: "image/png",
                upsert: true,
              });
              if (r.error) throw Error("Bildsicherung fehlgeschlagen.");
              const downloaded = await db.storage.from(bucket).download(path);
              if (
                downloaded.error ||
                !downloaded.data ||
                downloaded.data.size !== bytes.length
              )
                throw Error("Bildsicherung nicht bestätigt.");
            });
    } catch {
      await repo.pause?.(job);
      job.paused = true;
      const row = job.rows.find(
        (r) => !["completed", "review", "skipped"].includes(r.phase),
      );
      if (row)
        row.error =
          "Kontozugang nicht verfügbar. Auftrag pausiert; bereits beendete Artikel bleiben sichtbar.";
      await repo.save(job);
      return;
    }
    if (job.mode === "live") {
      const skuRows = job.rows.filter(
        (r) => !["completed", "review", "skipped"].includes(r.phase),
      );
      const lastCheck = Date.parse(job.skuPreflightAt ?? "");
      if (
        skuRows.length &&
        (!Number.isFinite(lastCheck) || Date.now() - lastCheck > 5 * 60 * 1000)
      ) {
        try {
          if (!adapter.assertSkusAvailable)
            throw Error("Aktueller SKU-Abgleich nicht verfügbar.");
          const conflicts = await adapter.assertSkusAvailable(
            skuRows.map((r) => ({
              id: r.listing.id,
              sku: r.backup?.listing.sku ?? r.listing.sku,
            })),
          );
          job.skuPreflightAt = new Date().toISOString();
          for (const row of skuRows) {
            const ids = conflicts[row.listing.id];
            if (!ids?.length) continue;
            row.phase = "review";
            row.error = `Neuerstellung gestoppt: aktives Angebot mit derselben SKU gefunden (${ids.join(", ")}).`;
            row.history.push({
              at: job.skuPreflightAt,
              phase: "review",
              note: row.error,
            });
          }
          await repo.save(job);
        } catch {
          await repo.pause?.(job);
          job.paused = true;
          const row = skuRows[0];
          if (row)
            row.error =
              "Aktueller Gesamtbestand konnte nicht auf gleiche SKUs geprüft werden. Auftrag pausiert; es wird kein neues Angebot erstellt.";
          await repo.save(job);
          return;
        }
      }
    }
    // One article per invocation bounds runtime; the cron picks up remaining rows.
    const row = job.rows.find(
      (r) =>
        !["completed", "review", "skipped"].includes(r.phase) &&
        !(job.mode === "dry-run" && r.phase === "ready") &&
        (!job.paused ||
          ["end_requested", "ended", "create_requested", "created"].includes(
            r.phase,
          )) &&
        (!r.nextAttemptAt || r.nextAttemptAt <= Date.now()),
    );
    if (row) await advance(job, row, adapter, repo);
  } finally {
    await db
      .from("relister_claims")
      .delete()
      .eq("job_id", id)
      .eq("lease_owner", owner);
  }
}
