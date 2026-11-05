import { NextRequest, NextResponse } from "next/server";
import { withAccount, sameOrigin, accountDb } from "@/lib/accounts/server";
import { currentAccount, accountsEnabled } from "@/lib/accounts/context";
import { guardApiRequest } from "@/lib/api-guard";
import {
  enabled,
  catalog,
  saveCatalog,
  jobs,
  insert,
  getJob,
  command,
  repository,
} from "@/lib/relister/store";
import { preview, processJob } from "@/lib/relister/jobs";
import { reader } from "@/lib/relister/ebay";
import { syncStep } from "@/lib/relister/sync";
import { exclusions, reducedPrice } from "@/lib/relister/domain";
import { sampleListing } from "@/lib/relister/simulation";
import { backgroundReady, wakeRelister } from "@/lib/relister/worker";
export const maxDuration = 300;
async function handle(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;
  if (!enabled() || !accountsEnabled())
    return NextResponse.json(
      {
        ok: false,
        error:
          "Re-Lister benötigt freigeschaltete Konten und die geprüfte Datenbankmigration.",
      },
      { status: 503 },
    );
  const account = currentAccount()!;
  if (!account.owner)
    return NextResponse.json(
      {
        ok: false,
        error: "Der Re-Lister ist nur für das Eigentümerkonto verfügbar.",
      },
      { status: 403 },
    );
  try {
    if (req.method === "GET")
      return NextResponse.json(
        {
          ok: true,
          catalog: await catalog(account.id),
          jobs: await jobs(account.id),
          sync: (
            await accountDb()
              .from("relister_sync")
              .select("document,pending")
              .eq("account_id", account.id)
              .maybeSingle()
          ).data,
          mode: "dry-run",
          runner: backgroundReady() ? "background" : "browser",
          viewsNotice:
            "Aufrufe nicht verfügbar. Analytics-Berechtigung wurde nicht erweitert.",
        },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    if (!sameOrigin(req))
      return NextResponse.json({ ok: false }, { status: 403 });
    const body = await req.json();
    if (body.action === "advance") {
      if (backgroundReady()) {
        await wakeRelister();
        return NextResponse.json({ ok: true });
      }
      await syncStep(account.id);
      const next = (await jobs(account.id)).find(
        (j) =>
          j.confirmed &&
          !j.paused &&
          j.mode !== "live" &&
          j.rows.some(
            (r) =>
              !["completed", "review", "skipped"].includes(r.phase) &&
              !(j.mode === "dry-run" && r.phase === "ready"),
          ),
      );
      if (next) await processJob(next.id);
      return NextResponse.json({ ok: true });
    }
    if (body.action === "sync") {
      const ebay = await reader();
      const queued = await accountDb()
        .from("relister_sync")
        .upsert({
          account_id: account.id,
          seller: ebay.seller,
          document: { stage: "pages", page: 1, items: [], cursor: 0 },
          pending: true,
        });
      if (queued.error) throw Error("Sync-Auftrag nicht gespeichert.");
      await wakeRelister();
      return NextResponse.json({ ok: true });
    }
    if (body.action === "demo") {
      await saveCatalog(
        account.id,
        "SIMULATION",
        Array.from({ length: 205 }, (_, i) =>
          sampleListing(String(100000000000 + i)),
        ),
      );
      return NextResponse.json({ ok: true });
    }
    if (body.action === "preview") {
      const c = await catalog(account.id);
      if (!c) throw Error("Zuerst synchronisieren.");
      if (!Array.isArray(body.ids) || body.ids.length > 100)
        throw Error("Ungültige Auswahl.");
      const selected = body.ids.map((id: string) =>
        c.listings.find((l) => l.id === id),
      );
      if (selected.some((l: unknown) => !l))
        throw Error("Auswahl nicht im Verkäuferbestand.");
      const conflicts = selected.flatMap((listing: any) =>
        exclusions(
          listing,
          c.seller,
          reducedPrice(listing.priceCents, body.percent),
        ).map((reason) => `${listing.id}: ${reason}`),
      );
      if (conflicts.length)
        return NextResponse.json(
          { ok: false, error: conflicts.join("; ") },
          { status: 400 },
        );
      const job = preview(account.id, c.seller, selected, body.percent);
      if (c.seller !== "SIMULATION") {
        job.mode = "dry-run";
        job.confirmed = true;
      }
      await insert(job);
      await wakeRelister();
      return NextResponse.json({ ok: true, job });
    }
    if (body.action === "retry-review") {
      if (typeof body.id !== "string" || !Array.isArray(body.itemIds))
        throw Error("Auftrag oder Angebote fehlen.");
      if (body.itemIds.length < 1 || body.itemIds.length > 100)
        throw Error("1 bis 100 Angebote erneut prüfen.");
      const job = await getJob(account.id, body.id);
      const requested = new Set(body.itemIds);
      if (
        requested.size !== body.itemIds.length ||
        job.mode !== "dry-run" ||
        !job.confirmed ||
        job.paused ||
        job.seller === "SIMULATION"
      )
        throw Error("Nur bestätigte Prüfungen eines echten Angebotsbatches können wiederholt werden.");
      const rows = job.rows.filter((row) => requested.has(row.id));
      if (rows.length !== requested.size)
        throw Error("Ein Angebot gehört nicht zu diesem Auftrag.");
      const unsafePhases = new Set(["end_requested", "ended", "create_requested", "created", "completed"]);
      for (const row of rows) {
        if (
          row.phase !== "review" ||
          !row.backup?.images?.length ||
          row.newId ||
          row.createAttempted ||
          row.history.some((entry) => unsafePhases.has(entry.phase))
        )
          throw Error("Mindestens ein Angebot kann nicht gefahrlos erneut geprüft werden.");
      }
      for (const row of rows) {
        row.phase = "selected";
        row.outgoing = undefined;
        row.feeCents = undefined;
        row.verifiedAt = undefined;
        row.error = undefined;
        row.nextAttemptAt = undefined;
        row.attempts = 0;
        row.history.push({
          at: new Date().toISOString(),
          phase: "selected",
          note: "Erneute Sicherungs- und Vorprüfung angefordert; kein Angebot wird beendet oder eingestellt.",
        });
      }
      await repository(account.id).save(job);
      await wakeRelister();
      return NextResponse.json({ ok: true, job });
    }
    if (["confirm", "pause", "resume"].includes(body.action)) {
      if (typeof body.id !== "string") throw Error("Auftrag fehlt.");
      const job = await getJob(account.id, body.id);
      if (body.action === "confirm") {
        if (body.digest !== job.previewDigest)
          throw Error("Vorschau stimmt nicht überein.");
        if (job.mode === "dry-run") {
          if (process.env.RELISTER_LIVE_ENABLED !== "true")
            throw Error("Live-Erstellung ist derzeit nicht freigegeben.");
          if (
            job.rows.length < 1 ||
            job.rows.length > 100 ||
            job.rows.some(
              (row) =>
                row.phase !== "ready" ||
                !row.backup ||
                !row.outgoing ||
                row.feeCents !== 0,
            )
          )
            throw Error(
              "Nicht alle ausgewählten Angebote sind fertig geprüft.",
            );
          const grants = job.rows.map((row) => ({
            job_id: job.id,
            item_id: row.listing.id,
            account_id: account.id,
            seller: job.seller,
            snapshot_digest: job.previewDigest,
            target_cents: row.targetCents,
            // This approval is bound to this immutable, user-confirmed job.
            // It remains valid across background retries and pauses.
            expires_at: "9999-12-31T23:59:59.999Z",
          }));
          const stored = await accountDb()
            .from("relister_approvals")
            .upsert(grants, { onConflict: "job_id,item_id" });
          if (stored.error)
            throw Error("Auftragsfreigabe konnte nicht gespeichert werden.");
          const activated = await accountDb().rpc("relister_activate", {
            p_job: job.id,
            p_account: account.id,
            p_digest: body.digest,
          });
          if (activated.error)
            throw Error(
              "Auftragsfreigabe fehlgeschlagen. Bitte Vorschau erneut laden.",
            );
          await wakeRelister();
          return NextResponse.json({ ok: true });
        }
        if (job.mode !== "simulation")
          throw Error("Auftrag bereits bestätigt.");
        job.confirmed = true;
      } else job.paused = body.action === "pause";
      await command(account.id, job.id, body.action);
      if (body.action !== "pause") await wakeRelister();
      return NextResponse.json({ ok: true, job });
    }
    return NextResponse.json(
      { ok: false, error: "Unbekannte Aktion." },
      { status: 400 },
    );
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Re-Lister-Anfrage fehlgeschlagen. Auswahl, Konto und Konfiguration prüfen.",
      },
      { status: 400 },
    );
  }
}
export const GET = withAccount(handle);
export const POST = withAccount(handle);
