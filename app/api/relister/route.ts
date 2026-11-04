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
import { preview, processJob } from "@/lib/relister/jobs";
import { syncStep } from "@/lib/relister/sync";
import { realAdapter } from "@/lib/relister/runtime";
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
  const preparationOnly = process.env.RELISTER_PREPARATION_ONLY === "true";
  if (preparationOnly && !account.owner)
    return NextResponse.json(
      {
        ok: false,
        error:
          "Die erste Vorbereitung ist nur für das freigegebene Eigentümerkonto verfügbar.",
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
          preparationOnly,
          runner:
            preparationOnly && !backgroundReady() ? "browser" : "background",
          viewsNotice:
            "Aufrufe nicht verfügbar. Analytics-Berechtigung wurde nicht erweitert.",
        },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    if (!sameOrigin(req))
      return NextResponse.json({ ok: false }, { status: 403 });
    const body = await req.json();
    if (["load-item", "load-oldest"].includes(body.action) && preparationOnly) {
      if (
        body.action === "load-item" &&
        (typeof body.item !== "string" || !/^\d{6,20}$/.test(body.item))
      )
        return NextResponse.json(
          {
            ok: false,
            error: "Bitte eine gültige eBay-Artikelnummer eingeben.",
          },
          { status: 400 },
        );
      let stage = "seller-access";
      try {
        const ebay = await reader();
        const item =
          body.action === "load-oldest" ? await ebay.oldest() : body.item;
        stage = "item-check";
        const listing = await (
          await realAdapter(account, ebay.seller)
        ).read(item);
        stage = "catalog-read";
        const old = await catalog(account.id);
        stage = "catalog-save";
        await saveCatalog(account.id, ebay.seller, [
          ...(old?.seller === ebay.seller
            ? old.listings.filter((l) => l.id !== listing.id)
            : []),
          listing,
        ]);
        stage = "sync-pause";
        const paused = await accountDb()
          .from("relister_sync")
          .update({ pending: false, updated_at: new Date().toISOString() })
          .eq("account_id", account.id);
        if (paused.error) throw Error("Bestandsprüfung nicht pausiert.");
        return NextResponse.json({ ok: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        const codes = [...message.matchAll(/eBay (\d{1,12})/g)].map(
          (x) => x[1],
        );
        const detail =
          message === "Verkäufer/Marktplatz stimmt nicht überein."
            ? message
            : codes.length
              ? `eBay-Fehler ${[...new Set(codes)].join(", ")}.`
              : "Zugang, Artikelnummer und Serverkonfiguration prüfen.";
        console.warn("relister-source-check", { stage, ebayCodes: codes });
        return NextResponse.json(
          {
            ok: false,
            error: `Einzelprüfung fehlgeschlagen (${stage}): ${detail}`,
          },
          { status: 400 },
        );
      }
    }
    if (body.action === "advance" && preparationOnly) {
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
      if (!Array.isArray(body.ids) || body.ids.length > 200)
        throw Error("Ungültige Auswahl.");
      if (preparationOnly && c.seller !== "SIMULATION") {
        if (body.ids.length !== 1)
          return NextResponse.json(
            {
              ok: false,
              error:
                "Freigegeben ist die Vorbereitung genau eines echten Angebots. Bitte nur ein Angebot auswählen; ein Wechsel benötigt eine weitere Freigabe.",
            },
            { status: 400 },
          );
      }
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
      if (preparationOnly && c.seller !== "SIMULATION") {
        const bound = await accountDb().rpc("relister_bind_preparation", {
          p_account: account.id,
          p_seller: c.seller,
          p_item: body.ids[0],
        });
        if (bound.error || bound.data !== true)
          return NextResponse.json(
            {
              ok: false,
              error:
                "Die Freigabe ist bereits an ein anderes Angebot gebunden. Ein Wechsel benötigt eine weitere Freigabe.",
            },
            { status: 409 },
          );
      }
      // Real listings remain read-only until separately approved.
      const job = preview(account.id, c.seller, selected, body.percent);
      if (c.seller !== "SIMULATION") {
        job.mode = "dry-run";
        job.confirmed = true;
      }
      await insert(job);
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
          if (preparationOnly || process.env.RELISTER_LIVE_ENABLED !== "true")
            throw Error("Live-Pilot nicht freigegeben.");
          const activated = await accountDb().rpc("relister_activate", {
            p_job: job.id,
            p_account: account.id,
            p_digest: body.digest,
          });
          if (activated.error) throw Error("Pilotfreigabe fehlt.");
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
