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
} from "@/lib/relister/store";
import { reader } from "@/lib/relister/ebay";
import { preview } from "@/lib/relister/jobs";
import { exclusions, reducedPrice } from "@/lib/relister/domain";
import { sampleListing } from "@/lib/relister/simulation";
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
          viewsNotice:
            "Aufrufe nicht verfügbar. Analytics-Berechtigung wurde nicht erweitert.",
        },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    if (!sameOrigin(req))
      return NextResponse.json({ ok: false }, { status: 403 });
    const body = await req.json();
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
      if (!Array.isArray(body.ids) || body.ids.length > 200)
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
      // Real listings remain read-only until management/promotions are positively proven.
      const job = preview(account.id, c.seller, selected, body.percent);
      if (c.seller !== "SIMULATION") {
        job.mode = "dry-run";
        job.confirmed = true;
      }
      await insert(job);
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
            throw Error("Live-Pilot nicht freigegeben.");
          const activated = await accountDb().rpc("relister_activate", {
            p_job: job.id,
            p_account: account.id,
            p_digest: body.digest,
          });
          if (activated.error) throw Error("Pilotfreigabe fehlt.");
          return NextResponse.json({ ok: true });
        }
        if (job.mode !== "simulation")
          throw Error("Auftrag bereits bestätigt.");
        job.confirmed = true;
      } else job.paused = body.action === "pause";
      await command(account.id, job.id, body.action);
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
