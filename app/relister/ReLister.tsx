"use client";
import { useEffect, useMemo, useState, useRef } from "react";
import { apiPost } from "@/lib/api-client";
import {
  filtered,
  quickSelect,
  exclusions,
  reducedPrice,
  type Listing,
  type Job,
  type Sort,
} from "@/lib/relister/domain";
const eur = (c: number) =>
  (c / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
export default function ReLister() {
  const [items, setItems] = useState<Listing[]>([]),
    [seller, setSeller] = useState(""),
    [query, setQuery] = useState(""),
    [sort, setSort] = useState<Sort>("newest"),
    [percent, setPercent] = useState("0"),
    [selection, setSelection] = useState<string[]>([]),
    [jobs, setJobs] = useState<Job[]>([]),
    [preview, setPreview] = useState<Job>(),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [page, setPage] = useState(0),
    [synced, setSynced] = useState(""),
    [sync, setSync] = useState<any>();
  const advancing = useRef(false);
  const rows = useMemo(
    () => filtered(items, query, sort),
    [items, query, sort],
  );
  const displayRows = rows.slice(0, 200);
  const syncing = Boolean(sync?.pending);
  const selectedItems = selection
    .map((id) => items.find((item) => item.id === id))
    .filter((item): item is Listing => Boolean(item));
  const pages = Math.max(1, Math.ceil(displayRows.length / 25)),
    current = Math.min(page, pages - 1);
  async function load() {
    const response = await fetch("/api/relister", { cache: "no-store" });
    const data = await response.json();
    if (!data.ok) throw Error(data.error);
    setItems(data.sync?.pending ? [] : (data.catalog?.listings ?? []));
    setSeller(data.catalog?.seller ?? "");
    setSynced(data.catalog?.synced_at ?? "");
    setJobs(data.jobs ?? []);
    setSync(data.sync);
    if (data.sync?.pending) setSelection([]);
    const pending =
      data.sync?.pending ||
      (data.jobs ?? []).some(
        (j: Job) =>
          j.confirmed &&
          !j.paused &&
          j.mode !== "live" &&
          j.rows.some(
            (r) =>
              !["completed", "review", "skipped"].includes(r.phase) &&
              !(j.mode === "dry-run" && r.phase === "ready"),
          ),
      );
    if (data.runner === "browser" && pending && !advancing.current) {
      advancing.current = true;
      try {
        const response = await apiPost("/api/relister", { action: "advance" });
        const result = await response.json();
        if (!result.ok) throw Error(result.error);
      } finally {
        advancing.current = false;
      }
    }
  }
  useEffect(() => {
    let active = true;
    const refresh = () =>
      load().catch((e) => {
        if (active) setMessage(e.message);
      });
    void refresh();
    const timer = setInterval(refresh, 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  async function confirmJob(job: Job) {
    if (job.mode === "simulation") {
      if (
        !window.confirm(
          `Den Probelauf mit ${job.rows.length} Testangebot(en) starten? Es werden keine echten eBay-Angebote verändert.`,
        )
      )
        return;
    } else if (
      !window.confirm(
        `Jetzt genau diese ${job.rows.length} geprüften deutschen Angebote beenden und als neue eBay-Festpreisangebote erstellen?\n\n` +
          `Die alten Angebote werden beendet. Die neuen Artikel erhalten neue Artikelnummern und übernehmen die gesicherten Bilder, Angaben sowie Versand-, Rückgabe- und Zahlungsrichtlinien. Das sind echte neue Angebote, keine eBay-Wiedereinstellungen.\n\n` +
          `Einstellgebühr laut Vorprüfung: 0 €. Verkaufskosten und Kontingent können anfallen. Die Shop-Kategorie wird übernommen; Snaplist ändert keine Gutscheine oder Werbung.`,
      )
    ) {
      return;
    }
    await action("confirm", { id: job.id, digest: job.previewDigest });
  }

  async function action(action: string, extra: Record<string, unknown> = {}) {
    setBusy(true);
    setMessage("");
    try {
      const response = await apiPost("/api/relister", { action, ...extra });
      const data = await response.json();
      if (!data.ok) throw Error(data.error);
      if (action === "preview") setPreview(data.job);
      else if (action === "confirm") setPreview(undefined);
      await load();
      setMessage(
        action === "confirm"
          ? "Auftrag ausdrücklich freigegeben. Die Hintergrundverarbeitung übernimmt."
          : "Gespeichert.",
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Anfrage fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }
  let percentError = "";
  try {
    reducedPrice(4999, percent);
  } catch (e) {
    percentError = (e as Error).message;
  }
  return (
    <main className="container relister-page">
      <h1>Re-Lister</h1>
      <p>
        <strong className="relister-status">
          {jobs.some(
            (j) =>
              j.mode === "live" &&
              j.rows.some(
                (r) => !["completed", "review", "skipped"].includes(r.phase),
              ),
          )
            ? "Ein bestätigter Auftrag läuft im Hintergrund. Fortschritt unten prüfen."
            : "Jeder Auftrag wird zuerst vollständig gesichert und geprüft. Erst deine ausdrückliche Bestätigung startet die Änderung am eBay-Angebot."}
        </strong>
      </p>
      <p className="relister-intro">
        Neue Artikelnummern garantieren keinen Rankingvorteil. Beobachter und
        Angebotsgeschichte werden nicht automatisch übertragen. Neue Angebote
        können Verkaufsgebühren und Kontingent verbrauchen. Snaplist ändert
        bestehende Gutscheine und Werbung nicht.
      </p>
      <section className="panel relister-panel">
        <h2>Verkäuferbestand</h2>
        <p>
          Konto: {seller || "Noch nicht synchronisiert"} · Datenstand:{" "}
          {syncing
            ? "wird aktualisiert"
            : synced
              ? new Date(synced).toLocaleString("de-DE")
              : "Nicht verfügbar"}
        </p>
        <div className="relister-toolbar">
          <button
            className="relister-primary"
            disabled={busy}
            onClick={() => action("sync")}
          >
            Aktive Angebote vollständig synchronisieren
          </button>
          <button disabled={busy} onClick={() => action("demo")}>
            Generalprobe: Testdaten laden
          </button>
        </div>
        <p>
          {syncing
            ? sync.document.stage === "pages"
              ? `Aktive Angebote werden geladen: ${Math.max(0, Number(sync.document.page) - 1)} Seiten gelesen, ${sync.document.items?.length ?? 0} gefunden. Die Liste erscheint nach dem vollständigen Abgleich.`
              : `Sicherheitsprüfung läuft: ${sync.document.cursor} von ${sync.document.items?.length ?? 0} Angeboten geprüft. Die Liste erscheint nach dem vollständigen Abgleich.`
            : (sync?.document.error ?? "")}
        </p>
        <p>
          Aufrufe: Nicht verfügbar. Seitenaufrufe, Suchimpressionen und
          Beobachter werden nicht gleichgesetzt. Datumssortierung bleibt
          nutzbar.
        </p>
        <label>
          Suche nach Titel oder SKU{" "}
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
          />
        </label>
        <label>
          Sortierung{" "}
          <select
            value={sort}
            onChange={(e) => {
              setSort(e.target.value as Sort);
              setPage(0);
            }}
          >
            <option value="oldest">Einstelldatum: älteste zuerst</option>
            <option value="newest">Einstelldatum: neueste zuerst</option>
            <option
              value="viewsAsc"
              disabled={!items.some((l) => l.views !== null)}
            >
              Aufrufe aufsteigend (fehlende zuletzt)
            </option>
            <option
              value="viewsDesc"
              disabled={!items.some((l) => l.views !== null)}
            >
              Aufrufe absteigend (fehlende zuletzt)
            </option>
          </select>
        </label>
        <p className="relister-view-summary">
          {syncing
            ? "Der Verkäuferbestand wird aktualisiert. Die alte Testliste ist währenddessen ausgeblendet."
            : `Ansicht: bis zu 200 von ${rows.length} passenden Angeboten. Es werden die 200 zuletzt eingestellten zuerst angezeigt; über „Sortierung“ kannst du stattdessen die ältesten 200 ansehen.`}
        </p>
        <div className="relister-selection-actions">
          {[1, 5, 20, 25, 50, 100, 200].map((n) => (
            <button
              key={n}
              onClick={() => setSelection(quickSelect(displayRows, seller, n))}
            >
              Erste {n} auswählen
            </button>
          ))}
          <button onClick={() => setSelection([])}>Auswahl aufheben</button>
        </div>
        <p>{selection.length} Angebote ausgewählt.</p>
        {selectedItems.length > 0 && (
          <details className="relister-selected">
            <summary>Auswahl ansehen ({selectedItems.length})</summary>
            <ul>
              {selectedItems.map((item) => (
                <li key={item.id}>
                  {item.title} · {item.id} · {eur(item.priceCents)} ·{" "}
                  {item.started
                    ? new Date(item.started).toLocaleDateString("de-DE")
                    : "Datum fehlt"}{" "}
                  <button
                    type="button"
                    onClick={() =>
                      setSelection((current) =>
                        current.filter((id) => id !== item.id),
                      )
                    }
                  >
                    Entfernen
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )}
        <fieldset className="relister-price-options">
          <legend>Preis reduzieren um</legend>
          {[0, 2, 4, 6, 8, 10].map((n) => (
            <button
              key={n}
              aria-pressed={percent === String(n)}
              onClick={() => setPercent(String(n))}
            >
              {n} %
            </button>
          ))}
          <label>
            Eigener Prozentwert{" "}
            <input
              inputMode="decimal"
              value={percent}
              onChange={(e) => setPercent(e.target.value)}
            />
          </label>
          <p>
            Gewählt: {percent} % · Versandkosten bleiben erhalten. Spätere neue
            Erneuerungsaufträge reduzieren den dann aktuellen Preis erneut.
          </p>
          {percentError && <p role="alert">{percentError}</p>}
        </fieldset>
        <div className="relister-table-scroll">
          <table className="relister-table">
            <thead>
              <tr>
                <th>Auswahl</th>
                <th>Bild</th>
                <th>Titel / Artikel</th>
                <th>SKU</th>
                <th>Eingestellt</th>
                <th>Preis</th>
                <th>Aufrufe</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {displayRows.slice(current * 25, current * 25 + 25).map((l) => {
                const reasons = exclusions(l, seller);
                return (
                  <tr key={l.id}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`${l.title} auswählen`}
                        disabled={Boolean(reasons.length)}
                        checked={selection.includes(l.id)}
                        onChange={(e) =>
                          setSelection((v) =>
                            e.target.checked
                              ? [...v, l.id]
                              : v.filter((id) => id !== l.id),
                          )
                        }
                      />
                    </td>
                    <td>
                      {l.thumbnail &&
                      /^https:\/\/i\.ebayimg\.com\//.test(l.thumbnail) ? (
                        <img src={l.thumbnail} alt="" width={60} height={60} />
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      {l.title}
                      <br />
                      <a
                        href={`https://www.ebay.de/itm/${encodeURIComponent(l.id)}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {l.id}
                      </a>
                    </td>
                    <td>{l.sku}</td>
                    <td>
                      {l.started
                        ? new Date(l.started).toLocaleDateString("de-DE")
                        : "Nicht verfügbar"}
                    </td>
                    <td>{eur(l.priceCents)}</td>
                    <td>{l.views ?? "Nicht verfügbar"}</td>
                    <td>{reasons.join("; ") || "Für Prüfung geeignet"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <button disabled={current === 0} onClick={() => setPage(current - 1)}>
          Zurück
        </button>{" "}
        Seite {current + 1}/{pages}{" "}
        <button
          disabled={current + 1 >= pages}
          onClick={() => setPage(current + 1)}
        >
          Weiter
        </button>
        <p>
          <button
            className="relister-primary"
            disabled={busy || !selection.length || Boolean(percentError)}
            onClick={() => action("preview", { ids: selection, percent })}
          >
            Vorbereitung und Vorschau starten
          </button>
        </p>
      </section>
      {preview && (
        <section className="panel">
          <h2>
            {preview.mode === "simulation"
              ? "Unveränderliche Rabattvorschau – Simulation"
              : "Rabattvorschau – Sicherung und Vorprüfung laufen"}
          </h2>
          {preview.rows.map((r) => (
            <p key={r.id}>
              {r.listing.title}: {eur(r.originalCents)} − {r.percent} % ={" "}
              <strong>{eur(r.targetCents)}</strong> (−
              {eur(r.originalCents - r.targetCents)})
            </p>
          ))}
          {preview.mode === "simulation" ? (
            <>
              <p>
                Die Bestätigung gilt ausschließlich für simuliertes Beenden und
                simulierte Neuerstellung mit gesicherten Testbildern. Echte
                eBay-Angebote werden dabei nicht verändert.
              </p>
              <button disabled={busy} onClick={() => void confirmJob(preview)}>
                Geprüften Probelauf ausdrücklich bestätigen
              </button>
            </>
          ) : (
            <p>
              Es wird noch nichts beendet. Die endgültige Freigabe ist erst nach
              vollständiger Sicherung und Vorprüfung im Verlauf möglich.
            </p>
          )}
        </section>
      )}
      <section className="panel">
        <h2>Fortschritt und Verlauf</h2>
        {jobs.map((j) => (
          <article key={j.id}>
            <h3>
              {j.mode === "simulation"
                ? "Simulation"
                : j.mode === "dry-run"
                  ? "Sicherung & Vorprüfung"
                  : "Live"}{" "}
              · {j.rows.filter((r) => r.phase === "completed").length}/
              {j.rows.length} abgeschlossen
            </h3>
            <button
              disabled={busy}
              onClick={() =>
                action(j.paused ? "resume" : "pause", { id: j.id })
              }
            >
              {j.paused ? "Fortsetzen" : "Pausieren"}
            </button>
            {j.mode === "dry-run" &&
              j.rows.every((r) => r.phase === "ready") && (
                <button
                  className="relister-destructive"
                  disabled={busy}
                  onClick={() => void confirmJob(j)}
                >
                  {`Jetzt ${j.rows.length} geprüfte Angebote als neue Listings einstellen`}
                </button>
              )}
            {j.rows.map((r) => (
              <details key={r.id}>
                <summary>
                  {r.listing.title}: {r.phase}
                  {r.error ? ` – ${r.error}` : ""}
                </summary>
                <p>
                  Alt: {r.listing.id} · Neu: {r.newId ?? "Noch nicht erstellt"}
                </p>
                <p>
                  Erste Erfassung: {r.listing.firstSeen}. Ausgangspreis{" "}
                  {eur(r.originalCents)}, Zielpreis {eur(r.targetCents)}.
                </p>
                <p>
                  Geschätzte Einstellgebühren:{" "}
                  {r.feeCents === undefined
                    ? "Noch nicht geprüft"
                    : eur(r.feeCents)}
                  . Verkaufskosten und Kontingent separat beachten.
                </p>
                {r.backup && (
                  <p>
                    Sicherung v{r.backup.version}: {r.backup.images.length}{" "}
                    Bilddatei(en), SHA256 {r.backup.digest}
                  </p>
                )}
                <ol>
                  {r.history.map((h, i) => (
                    <li key={i}>
                      {h.at}: {h.note}
                    </li>
                  ))}
                </ol>
              </details>
            ))}
          </article>
        ))}
      </section>
      {message && <p role="status">{message}</p>}
    </main>
  );
}
