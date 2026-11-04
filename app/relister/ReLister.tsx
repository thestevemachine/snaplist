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
    [sort, setSort] = useState<Sort>("oldest"),
    [percent, setPercent] = useState("0"),
    [selection, setSelection] = useState<string[]>([]),
    [jobs, setJobs] = useState<Job[]>([]),
    [preview, setPreview] = useState<Job>(),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [page, setPage] = useState(0),
    [synced, setSynced] = useState(""),
    [sync, setSync] = useState<any>(),
    [preparationOnly, setPreparationOnly] = useState(false);
  const advancing = useRef(false);
  const rows = useMemo(
    () => filtered(items, query, sort),
    [items, query, sort],
  );
  const pages = Math.max(1, Math.ceil(rows.length / 25)),
    current = Math.min(page, pages - 1);
  async function load() {
    const response = await fetch("/api/relister", { cache: "no-store" });
    const data = await response.json();
    if (!data.ok) throw Error(data.error);
    setItems(data.catalog?.listings ?? []);
    setSeller(data.catalog?.seller ?? "");
    setSynced(data.catalog?.synced_at ?? "");
    setJobs(data.jobs ?? []);
    setSync(data.sync);
    setPreparationOnly(Boolean(data.preparationOnly));
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
          ? "Probelauf bestätigt. Hintergrundverarbeitung übernimmt."
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
    <main className="container">
      <h1>Re-Lister</h1>
      <p>
        <strong>
          {jobs.some((j) => j.mode === "live")
            ? "Separat freigegebener Live-Auftrag vorhanden. Fortschritt unten prüfen."
            : "Probelauf: keine echten Angebote werden beendet, neu erstellt oder im Preis geändert."}
        </strong>
      </p>
      <p>
        Neue Artikelnummern garantieren keinen Rankingvorteil. Beobachter und
        Angebotsgeschichte werden nicht automatisch übertragen. Neue Angebote
        können Gebühren und Kontingent verbrauchen. Webinterpret beendet laut
        deiner Erfahrung verbundene Auslandsangebote; die erneute Übernahme und
        Preisweitergabe sind noch ungeprüft.
      </p>
      {preparationOnly && (
        <p>
          Erste Vorbereitung: Bitte genau ein echtes Angebot auswählen und diese
          Seite während der Verarbeitung geöffnet lassen. Gespeicherter
          Fortschritt wird beim nächsten Öffnen fortgesetzt.
        </p>
      )}
      <section className="panel">
        <h2>Verkäuferbestand</h2>
        <p>
          Konto: {seller || "Noch nicht synchronisiert"} · Datenstand:{" "}
          {synced
            ? new Date(synced).toLocaleString("de-DE")
            : "Nicht verfügbar"}
        </p>
        <button disabled={busy} onClick={() => action("sync")}>
          Angebote synchronisieren
        </button>{" "}
        <button disabled={busy} onClick={() => action("demo")}>
          Generalprobe: Testdaten laden
        </button>
        <p>
          {sync?.pending
            ? `Synchronisierung läuft: ${sync.document.stage}, ${sync.document.cursor} Details geprüft.`
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
        <p>
          Auswahl über alle {rows.length} gefilterten Angebote, einschließlich
          weiterer Seiten:
        </p>
        <div>
          {[1, 5, 20, 25, 50, 100, 200].map((n) => (
            <button
              key={n}
              onClick={() => setSelection(quickSelect(rows, seller, n))}
            >
              Erste {n} auswählen
            </button>
          ))}
          <button onClick={() => setSelection([])}>Auswahl aufheben</button>
        </div>
        <p>{selection.length} Angebote ausgewählt.</p>
        <fieldset>
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
        <div style={{ overflowX: "auto" }}>
          <table>
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
              {rows.slice(current * 25, current * 25 + 25).map((l) => {
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
                    <td>{reasons.join("; ") || "Geeignet für Generalprobe"}</td>
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
                simulierte Neuerstellung mit gesicherten Testbildern.
                Produktiver Pilot noch gesperrt.
              </p>
              <button
                disabled={busy}
                onClick={() =>
                  action("confirm", {
                    id: preview.id,
                    digest: preview.previewDigest,
                  })
                }
              >
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
                  ? "Probelauf ohne Veröffentlichung"
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
                  disabled={busy}
                  onClick={() =>
                    action("confirm", { id: j.id, digest: j.previewDigest })
                  }
                >
                  Geprüften Auftrag bestätigen (gesonderte Pilotfreigabe
                  erforderlich)
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
