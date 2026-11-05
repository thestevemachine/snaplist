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
} from "@/lib/relister/domain";
const eur = (c: number) =>
  (c / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
const dateTime = (value?: string) => {
  if (!value || !Number.isFinite(Date.parse(value))) return "Zeitpunkt nicht verfügbar";
  return new Date(value).toLocaleString("de-DE", {
    dateStyle: "medium",
    timeStyle: "short",
  });
};
const completedRelist = (jobs: Job[], listingId: string) =>
  jobs
    .flatMap((job) => job.rows)
    .find(
      (row) =>
        row.listing.id === listingId &&
        row.phase === "completed" &&
        Boolean(row.newId),
    );
const phaseLabel: Record<Job["rows"][number]["phase"], string> = {
  selected: "Wartet auf Bearbeitung",
  backed_up: "Bilder gesichert",
  verified: "Vorprüfung erfolgreich",
  ready: "Bereit zum Neueinstellen",
  end_requested: "Altes Angebot wird beendet",
  ended: "Altes Angebot beendet",
  create_requested: "Neues Angebot wird erstellt",
  created: "Neues Angebot wird geprüft",
  completed: "Neu eingestellt",
  review: "Prüfung nötig",
  skipped: "Übersprungen",
};

function ProgressRing() {
  return <span className="spinner" aria-hidden="true" style={{
    display: "inline-block", borderColor: "currentColor",
    borderRightColor: "transparent", verticalAlign: "middle", marginInlineEnd: 6,
  }} />;
}

export default function ReLister() {
  const [items, setItems] = useState<Listing[]>([]),
    [seller, setSeller] = useState(""),
    [query, setQuery] = useState(""),
    [percent, setPercent] = useState("0"),
    [selection, setSelection] = useState<string[]>([]),
    [jobs, setJobs] = useState<Job[]>([]),
    [preview, setPreview] = useState<Job>(),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [starting, setStarting] = useState(false),
    [startError, setStartError] = useState(""),
    [startedJob, setStartedJob] = useState<Job>(),
    [retryingJob, setRetryingJob] = useState<string>(),
    [synced, setSynced] = useState(""),
    [sync, setSync] = useState<any>();
  const advancing = useRef(false);
  const currentJob = startedJob
    ? jobs.find((job) => job.id === startedJob.id) ?? startedJob
    : jobs.find((job) =>
        job.mode === "live" && job.confirmed &&
        job.rows.some((row) => !["completed", "review", "skipped"].includes(row.phase)),
      );
  const jobFinished = currentJob?.rows.filter(
    (row) => ["completed", "review", "skipped"].includes(row.phase),
  ).length ?? 0;
  const rows = useMemo(() => filtered(items, query, "oldest"), [items, query]);
  const syncing = Boolean(sync?.pending);
  const selectedItems = selection
    .map((id) => items.find((item) => item.id === id))
    .filter((item): item is Listing => Boolean(item));
  async function load() {
    const response = await fetch("/api/relister", { cache: "no-store" });
    const data = await response.json();
    if (!data.ok) throw Error(data.error);
    const listings = filtered(data.catalog?.listings ?? [], "", "oldest").slice(0, 25);
    const listingIds = new Set(listings.map((listing) => listing.id));
    setItems(listings);
    setSelection((current) => current.filter((id) => listingIds.has(id)));
    setSeller(data.catalog?.seller ?? "");
    setSynced(data.catalog?.synced_at ?? "");
    setJobs(data.jobs ?? []);
    setSync(data.sync);
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
  async function confirmJob(job: Job, ready = job.rows) {
    if (job.mode === "simulation") {
      if (
        !window.confirm(
          `Den Probelauf mit ${job.rows.length} Testangebot(en) starten? Es werden keine echten eBay-Angebote verändert.`,
        )
      )
        return;
    } else if (
      !window.confirm(
        `Jetzt genau diese ${ready.length} geprüften deutschen Angebote beenden und als neue eBay-Festpreisangebote erstellen?\n\n` +
          `Die alten Angebote werden beendet. Die neuen Artikel erhalten neue Artikelnummern und übernehmen die gesicherten Bilder, Angaben sowie Versand-, Rückgabe- und Zahlungsrichtlinien. Das sind echte neue Angebote, keine eBay-Wiedereinstellungen.\n\n` +
          `Einstellgebühr laut Vorprüfung: 0 €. Verkaufskosten und Kontingent können anfallen. Die Shop-Kategorie wird übernommen; Snaplist ändert keine Gutscheine oder Werbung.`,
      )
    ) {
      return;
    }
    await action("confirm", { id: job.id, digest: job.previewDigest, itemIds: ready.map(row => row.id) });
  }

  async function action(action: string, extra: Record<string, unknown> = {}) {
    setBusy(true);
    if (action === "start") {
      setStarting(true);
      setStartError("");
    }
    if (action === "retry-review" && typeof extra.id === "string") setRetryingJob(extra.id);
    setMessage("");
    try {
      const response = await apiPost("/api/relister", { action, ...extra });
      const data = await response.json();
      if (!data.ok) throw Error(data.error);
      if (action === "preview") setPreview(data.job);
      else if (action === "confirm") setPreview(undefined);
      if (action === "start") {
        setStartedJob(data.job);
        setSelection([]);
        return;
      }
      await load();
      setMessage(
        action === "confirm" || action === "start"
          ? "Auftrag ausdrücklich freigegeben. Die Hintergrundverarbeitung übernimmt."
          : "Gespeichert.",
      );
    } catch (e) {
      const message = e instanceof SyntaxError
        ? "Der Server hat keine lesbare Antwort geliefert."
        : e instanceof Error ? e.message : "Anfrage fehlgeschlagen.";
      if (action === "start") setStartError(message);
      else setMessage(message);
    } finally {
      setBusy(false);
      setStarting(false);
      setRetryingJob(undefined);
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
              j.mode === "live" && j.confirmed && !j.paused &&
              j.rows.some(
                (r) => !["completed", "review", "skipped"].includes(r.phase),
              ),
          )
            ? "Ein bestätigter Auftrag läuft im Hintergrund. Fortschritt unten prüfen."
            : "Snaplist sichert und prüft die ausgewählten Angebote. Nach bestandener Prüfung beendet Snaplist das jeweilige Original und erstellt das neue eBay-Angebot."}
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
          {synced
            ? new Date(synced).toLocaleString("de-DE")
            : "Nicht verfügbar"}
          {syncing ? " · Abgleich im Hintergrund läuft" : ""}
        </p>
        <div className="relister-toolbar">
          <button
            className="relister-primary"
            disabled={busy || syncing}
            onClick={() => action("sync")}
          >
            Die 25 ältesten Angebote aktualisieren
          </button>
          <button disabled={busy || syncing} onClick={() => action("demo")}>
            Generalprobe: Testdaten laden
          </button>
        </div>
        <p>
          {syncing
            ? sync.document.stage === "pages"
              ? `Die ältesten Angebote werden geladen; ${sync.document.items?.length ?? 0} vorgemerkt. Die gespeicherte Liste bleibt sichtbar.`
              : `Prüfung der 25 ältesten Angebote: ${sync.document.cursor} von ${sync.document.items?.length ?? 0} geprüft. Die gespeicherte Liste bleibt sichtbar.`
            : (sync?.document.error ?? "")}
        </p>
        <p className="relister-safety-note">
          Der Katalog enthält nur die 25 ältesten Angebote und wird etwa alle 6
          Stunden im Hintergrund aktualisiert. Vor jedem Eingriff prüft
          Snaplist das ausgewählte Angebot direkt bei eBay: aktiv, unverkauft,
          Einzelstück und unveränderter Preis. Nach dem Beenden bestätigt es
          nochmals, dass das Original inaktiv und unverkauft ist. Bei
          Abweichungen oder unklarem Status wird die Neuerstellung gestoppt.
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
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <p className="relister-view-summary">
          {syncing
            ? `Es bleiben die zuletzt gespeicherten ältesten Angebote sichtbar (${rows.length} passend). Der Live-Abgleich ersetzt sie nach Abschluss.`
            : `Auswahl: die 25 ältesten aktiven Angebote (${rows.length} passend).`}
        </p>
        <div className="relister-selection-actions">
          {[1, 5, 20, 25].map((n) => (
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
              {rows.map((l) => {
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
        <p>
          <button
            className="relister-primary"
            disabled={busy || !selection.length || Boolean(percentError)}
            onClick={() => action(seller === "SIMULATION" ? "preview" : "start", { ids: selection, percent })}
          >
            {starting ? <><ProgressRing /> Auftrag wird gesendet …</>
              : seller === "SIMULATION" ? "Simulation vorbereiten"
              : "Ausgewählte Angebote jetzt neu einstellen"}
          </button>
        </p>
        {starting && <p role="status">Warte auf die Bestätigung von Snaplist …</p>}
        {startError && <p role="alert">Auftragsstart konnte nicht bestätigt werden. {startError}</p>}
        {currentJob && (
          <section className="relister-selected" aria-label="Fortschritt des Auftrags">
            <p role="status">
              {!currentJob.paused && jobFinished < currentJob.rows.length && <ProgressRing />}
              <strong>{currentJob.paused ? "Auftrag pausiert" : jobFinished === 0 &&
                currentJob.rows.every((row) => row.phase === "selected")
                ? "Auftrag angenommen · wartet auf Bearbeitung"
                : `${jobFinished} von ${currentJob.rows.length} bearbeitet`}</strong>
            </p>
            <progress aria-label="Bearbeitete Angebote" value={jobFinished} max={currentJob.rows.length} />
            <ul>
              {currentJob.rows.map((row) => (
                <li key={row.id}>
                  {row.listing.title} · {row.newId && row.phase === "review"
                    ? "Neu erstellt, Nachprüfung offen"
                    : row.phase === "ready" ? "Vorprüfung bestanden" : phaseLabel[row.phase]}
                  {row.newId && <> · <a href={`https://www.ebay.de/itm/${encodeURIComponent(row.newId)}`}>Neues Angebot</a></>}
                  {row.error && <> · {row.error}</>}
                </li>
              ))}
            </ul>
          </section>
        )}
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
        {jobs.length > 0 && (
          <p className="relister-history-note">
            Die letzten 14 Vorgänge, nach Datum sortiert. Zum Öffnen oder
            Einklappen den jeweiligen Batch anklicken.
          </p>
        )}
        {jobs.slice(0, 14).map((j, index) => {
          const completed = j.rows.filter((r) => r.phase === "completed").length;
          const completedEarlier = j.rows.filter(
            (r) => r.phase === "skipped" && Boolean(completedRelist(jobs, r.listing.id)),
          ).length;
          const needsReview = j.rows.filter((r) => r.phase === "review").length;
          const skipped = j.rows.filter(
            (r) => r.phase === "skipped" && !completedRelist(jobs, r.listing.id),
          ).length;
          const retrying = retryingJob === j.id;
          const ready = j.rows.filter(r => r.phase === "ready");
          const allReady = j.mode === "dry-run" && j.rows.length > 0 && j.rows.every((r) => r.phase === "ready");
          const running =
            j.confirmed && !j.paused &&
            j.rows.some(
              (r) =>
                !["completed", "review", "skipped"].includes(r.phase) &&
                !(j.mode === "dry-run" && r.phase === "ready"),
            );
          const mode =
            j.mode === "simulation"
              ? "Simulation"
              : j.mode === "dry-run"
                ? "Sicherung & Vorprüfung"
                : "Live";
          const retryable =
            j.mode !== "simulation" && j.confirmed && !j.paused
              ? j.rows.filter(
                  (r) =>
                    r.phase === "review" &&
                    !r.newId &&
                    !r.createAttempted &&
                    !r.history.some((h) =>
                      ["end_requested", "ended", "create_requested", "created", "completed"].includes(h.phase),
                    ),
                )
              : [];
          return (
            <details
              className="relister-batch"
              key={j.id}
              open={index === 0 || running}
            >
              <summary className="relister-batch-summary">
                <span className="relister-batch-date">{dateTime(j.createdAt)}</span>
                <span className="relister-batch-mode">{mode}</span>
                <span>
                  {j.mode === "dry-run" && `${j.rows.filter((r) => r.phase === "ready").length}/${j.rows.length} bereit · `}{completed} neu eingestellt · {completedEarlier} schon vorher erledigt · {needsReview} Prüfung nötig · {skipped} übersprungen
                </span>
                <span className={running ? "relister-batch-running" : "relister-batch-state"}>
                  {(running || retrying) && <ProgressRing />}
                  {retrying ? "Erneute Prüfung startet" : j.paused
                    ? "Pausiert"
                    : running
                      ? "Läuft"
                      : needsReview
                        ? "Prüfung nötig"
                        : skipped
                          ? "Teilweise übersprungen"
                          : allReady ? "Bereit zum Neueinstellen" : "Abgeschlossen"}
                </span>
              </summary>
              <article className="relister-batch-content">
                {(running || j.paused) && <button
                  disabled={busy}
                  onClick={() =>
                    action(j.paused ? "resume" : "pause", { id: j.id })
                  }
                >
                  {j.paused ? "Fortsetzen" : "Pausieren"}
                </button>}
                {retryable.length > 0 && (
                  <>
                    <p className="relister-history-note">
                      Die erneute Prüfung lädt die größten verfügbaren Bilder frisch von eBay. Angebote mit bestandener Vorprüfung kannst du separat neu einstellen.
                    </p>
                    <button
                      disabled={busy}
                      onClick={() =>
                        action("retry-review", {
                          id: j.id,
                          itemIds: retryable.map((r) => r.id),
                        })
                      }
                    >
                      {retrying ? <><ProgressRing /> Erneute Prüfung startet …</> : `Gesicherte Angebote erneut prüfen (${retryable.length})`}
                    </button>
                  </>
                )}
                {j.mode === "dry-run" && ready.length > 0 && !running && !j.paused && (
                    <button
                      className="relister-destructive"
                      disabled={busy}
                      onClick={() => void confirmJob(j, ready)}
                    >
                      {ready.length === 1 ? "Jetzt 1 geprüftes Angebot neu einstellen" : `Jetzt ${ready.length} geprüfte Angebote neu einstellen`}
                    </button>
                  )}
                {j.rows.map((r) => (
                  <article
                    className={`relister-history-row${r.phase === "completed" ? " is-completed" : ""}`}
                    key={r.id}
                  >
                    <div className="relister-history-preview">
                      {r.listing.thumbnail &&
                      /^https:\/\/i\.ebayimg\.com\//.test(r.listing.thumbnail) ? (
                        <img src={r.listing.thumbnail} alt="" width={72} height={72} />
                      ) : (
                        <div className="relister-history-placeholder" aria-hidden="true">—</div>
                      )}
                      <div className="relister-history-main">
                        <div className="relister-history-title-line">
                          <strong>{r.listing.title}</strong>
                          <span className={`relister-phase-badge${r.phase === "completed" ? " is-completed" : ""}`}>
                            {r.phase === "completed"
                              ? "Wieder eingestellt"
                              : r.phase === "skipped" && completedRelist(jobs, r.listing.id)
                                ? "Bereits abgeschlossen"
                                : r.phase === "review"
                                  ? "Prüfung nötig"
                                  : phaseLabel[r.phase]}
                          </span>
                        </div>
                        <div className="relister-history-meta">
                          <span>SKU {r.listing.sku || "—"}</span>
                          <span>Ursprünglich eingestellt: {dateTime(r.listing.started)}</span>
                          <span>{eur(r.originalCents)} → {eur(r.targetCents)}</span>
                        </div>
                        {r.phase === "completed" ? (
                          <div className="relister-history-result">
                            <strong>
                              Neu eingestellt am{" "}
                              {dateTime(r.history.slice().reverse().find((h) => h.phase === "completed")?.at)}
                            </strong>
                            {r.newId ? (
                              <a
                                href={`https://www.ebay.de/itm/${encodeURIComponent(r.newId)}`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Aktuelles Listing ansehen · {r.newId}
                              </a>
                            ) : (
                              <span>Neue Artikelnummer nicht verfügbar</span>
                            )}
                          </div>
                        ) : r.phase === "skipped" && completedRelist(jobs, r.listing.id) ? (
                          <div className="relister-history-result">
                            <strong>Dieser Artikel wurde bereits in einem anderen Auftrag neu eingestellt.</strong>
                            <a
                              href={`https://www.ebay.de/itm/${encodeURIComponent(completedRelist(jobs, r.listing.id)!.newId!)}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Aktuelles Listing ansehen · {completedRelist(jobs, r.listing.id)!.newId}
                            </a>
                          </div>
                        ) : (
                          <span className="relister-history-status">
                            {r.error === "Unveränderliche Sicherung bereits vorhanden."
                              ? "Erneute Prüfung fehlgeschlagen: Die vorhandene Bildsicherung wurde nicht wiederverwendet. Bitte nach dem Update erneut prüfen."
                              : r.error
                                ? r.error.includes("21919137") ? "eBay hat die Bildauflösung abgelehnt. Starte die erneute Bildprüfung." : `Fehler: ${r.error}`
                                : r.phase === "review"
                                  ? "Manuelle Prüfung erforderlich"
                                  : r.phase === "ready" && j.mode === "dry-run"
                                    ? "Vorprüfung bestanden. Das Originalangebot wurde in diesem Batch noch nicht beendet."
                                    : phaseLabel[r.phase]}
                          </span>
                        )}
                      </div>
                    </div>
                    <details className="relister-history-details">
                      <summary>Auftragsdetails und Verlauf</summary>
                      <p>Alt: {r.listing.id} · Neu: {r.newId ?? "Noch nicht erstellt"}</p>
                      <p>
                        Erste Erfassung: {dateTime(r.listing.firstSeen)}. Ausgangspreis{" "}
                        {eur(r.originalCents)}, Zielpreis {eur(r.targetCents)}.
                      </p>
                      <p>
                        Geschätzte Einstellgebühren:{" "}
                        {r.feeCents === undefined ? "Noch nicht geprüft" : eur(r.feeCents)}
                        . Verkaufskosten und Kontingent separat beachten.
                      </p>
                      {r.backup && (
                        <p>
                          Sicherung v{r.backup.version}: {r.backup.images.length} Bilddatei(en),
                          SHA256 {r.backup.digest}
                        </p>
                      )}
                      <ol>
                        {r.history.map((h, i) => (
                          <li key={i}>{dateTime(h.at)}: {h.note}</li>
                        ))}
                      </ol>
                    </details>
                  </article>
                ))}
              </article>
            </details>
          );
        })}
      </section>
      {message && <p role="status">{message}</p>}
    </main>
  );
}
