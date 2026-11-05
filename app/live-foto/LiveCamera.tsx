"use client";

import { useEffect, useRef, useState } from "react";
import { base64, convert, exposure } from "@/lib/live-foto/camera";
import { type DraftRow, liveRequest, retryDelay } from "@/lib/live-foto/client";
import {
  type Article,
  type Journal,
  type LocalPhoto,
  newArticle,
  newJournal,
  persist,
  read,
} from "@/lib/live-foto/local";
import { MAX_PHOTOS } from "@/lib/live-foto/policy";
import { photoZip } from "@/lib/live-foto/zip";
import styles from "./live.module.css";

type Task = { attempt: number; after: number; error?: string };
const label: Record<string, string> = {
  queued: "KI wartet",
  running: "KI arbeitet",
  succeeded: "Entwurf bereit",
  failed: "KI fehlgeschlagen",
};

function Thumb({ id }: { id: string }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let current = true,
      object = "";
    void read<LocalPhoto>("photos", id)
      .then((photo) => {
        if (current && photo) {
          object = URL.createObjectURL(photo.thumb);
          setUrl(object);
        }
      })
      .catch(() => {});
    return () => {
      current = false;
      if (object) URL.revokeObjectURL(object);
    };
  }, [id]);
  return url ? <img src={url} alt="" /> : null;
}

export function LiveCamera() {
  const [journal, setJournal] = useState<Journal>();
  const j = useRef<Journal>(undefined);
  const mutations = useRef(Promise.resolve());
  const [error, setError] = useState("");
  const [network, setNetwork] = useState("");
  const [status, setStatus] = useState<DraftRow[]>([]);
  const [code, setCode] = useState("");
  const [stream, setStream] = useState<MediaStream>();
  const camera = useRef<MediaStream>(undefined);
  const mounted = useRef(false);
  const [zoom, setZoom] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [opening, setOpening] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const shutter = useRef(false);
  const [capturing, setCapturing] = useState(false);
  const [replacement, setReplacement] = useState("");
  const [metric, setMetric] = useState("");
  const tasks = useRef(new Map<string, Task>());
  const active = useRef(new Set<string>());
  const [, setActivity] = useState(0);
  const initialized = useRef<Promise<unknown> | undefined>(undefined);
  const opened = useRef(new Map<string, Promise<{ inherited?: string[] }>>());
  const update = (
    fn: (old: Journal) => Journal,
    photo?: LocalPhoto,
    remove?: string,
  ) => {
    const next = mutations.current
      .catch(() => {})
      .then(async () => {
        const value = fn(j.current!);
        await persist(value, photo, remove);
        j.current = value;
        setJournal(value);
      });
    mutations.current = next;
    return next;
  };
  useEffect(() => {
    mounted.current = true;
    let disposed = false;
    let unlock: () => void = () => {};
    async function restore() {
      const value = (await read<Journal>("journal", "current")) ?? newJournal();
      if (disposed) return;
      await persist(value);
      if (disposed) return;
      j.current = value;
      setJournal(value);
    }
    async function start() {
      if (!navigator.locks) {
        setError(
          "Dieser Browser unterstützt keine sichere Fotositzung über mehrere Tabs.",
        );
        return;
      }
      await navigator.locks.request(
        "snaplist-live-foto",
        { ifAvailable: true },
        async (lock) => {
          if (!lock) {
            if (!disposed)
              setError("Live-Foto ist bereits in einem anderen Tab geöffnet.");
            return;
          }
          await restore();
          if (!disposed)
            await new Promise<void>((resolve) => {
              unlock = resolve;
            });
        },
      );
    }
    void start().catch(() => {
      if (!disposed) setError("Lokaler Fotospeicher ist nicht verfügbar.");
    });
    return () => {
      mounted.current = false;
      disposed = true;
      // Keep the writer lock until in-flight journal transactions have finished.
      void Promise.allSettled([mutations.current, ...running.current]).then(
        unlock,
      );
      camera.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    if (video.current) video.current.srcObject = stream ?? null;
  }, [stream]);

  function establish(session: string) {
    initialized.current ??= liveRequest({ action: "authorize" })
      .then(() => liveRequest({ action: "session", session }))
      .catch((e) => {
        initialized.current = undefined;
        throw e;
      });
    return initialized.current;
  }
  function ensureOpen(session: string, article: Article) {
    const { batch, id, revision, parent } = article;
    if (!opened.current.has(batch))
      opened.current.set(
        batch,
        establish(session)
          .then(() =>
            liveRequest<{ inherited?: string[] }>({
              action: "open",
              session,
              batch,
              article: id,
              revision,
              parent,
            }),
          )
          .catch((e) => {
            opened.current.delete(batch);
            throw e;
          }),
      );
    return opened.current.get(batch);
  }

  const running = useRef(new Set<Promise<unknown>>());
  useEffect(() => {
    if (!journal) return;
    let stopped = false,
      polling = false;
    const tick = () => {
      if (stopped || !navigator.onLine || !j.current) return;
      const { session, closed, current } = j.current;
      for (const article of [...closed, current]) {
        if (article.submitted) continue;
        const work = article.ids.filter((id) => !article.uploaded.includes(id));
        const keys = work.length ? work : article.sealed ? ["seal"] : [];
        for (const photo of keys) {
          if (active.current.size >= 2) return;
          const key = `${article.batch}:${photo}`;
          if (
            active.current.has(key) ||
            (tasks.current.get(key)?.after ?? 0) > Date.now()
          )
            continue;
          active.current.add(key);
          setActivity((n) => n + 1);
          const operation = (async () => {
            const start = performance.now();
            const opened = await ensureOpen(session, article);
            if (photo === "seal") {
              await liveRequest({
                action: "seal",
                session,
                batch: article.batch,
                sku: article.sku,
                photoIds: article.ids,
              });
            } else if (!opened?.inherited?.includes(photo)) {
              const saved = await read<LocalPhoto>("photos", photo);
              if (!saved)
                throw new Error("Lokale Fotodatei fehlt. Bitte neu aufnehmen.");
              const started = performance.now();
              const receipt = await liveRequest<{
                timings?: {
                  validateMs: number;
                  storeMs: number;
                  confirmMs: number;
                };
              }>({
                action: "upload",
                session,
                batch: article.batch,
                photo,
                data: await base64(saved.blob),
              });
              if (!stopped)
                setMetric(
                  `Letztes Foto: ${saved.blob.size} Byte · Anfrage bis Serverbestätigung ${Math.round(performance.now() - started)} ms · inkl. Sitzungsaufbau ${Math.round(performance.now() - start)} ms` +
                    (receipt.timings
                      ? ` · Server: prüfen ${Math.round(receipt.timings.validateMs)} ms, Speichertransfer ${Math.round(receipt.timings.storeMs)} ms, Empfangsprüfung ${Math.round(receipt.timings.confirmMs)} ms`
                      : ""),
                );
            }
            await update((old) => {
              const mark = (a: Article) =>
                a.batch !== article.batch
                  ? a
                  : photo === "seal"
                    ? { ...a, submitted: true }
                    : a.ids.includes(photo)
                      ? { ...a, uploaded: [...new Set([...a.uploaded, photo])] }
                      : a;
              return {
                ...old,
                current: mark(old.current),
                closed: old.closed.map(mark),
              };
            });
            tasks.current.delete(key);
            if (!stopped) setNetwork("");
          })()
            .catch((e: Error) => {
              const attempt = (tasks.current.get(key)?.attempt ?? 0) + 1;
              tasks.current.set(key, {
                attempt,
                after: Date.now() + retryDelay(e, attempt),
                error: e.message,
              });
              if (!stopped) setNetwork(e.message);
            })
            .finally(() => {
              active.current.delete(key);
              running.current.delete(operation);
              if (!stopped) setActivity((n) => n + 1);
            });
          running.current.add(operation);
        }
      }
    };
    const poll = async () => {
      if (
        stopped ||
        polling ||
        !navigator.onLine ||
        !j.current?.closed.some((a) => a.submitted)
      )
        return;
      polling = true;
      try {
        const data = await liveRequest<{ drafts: DraftRow[] }>({
          action: "list",
          session: j.current.session,
        });
        if (!stopped) setStatus(data.drafts);
      } catch (e) {
        if (!stopped) setNetwork((e as Error).message);
      } finally {
        polling = false;
      }
    };
    tick();
    void poll();
    const timer = setInterval(tick, 350),
      poller = setInterval(poll, 4000);
    const offline = () =>
      setNetwork("Offline – neue Fotos bleiben lokal gespeichert.");
    const online = () => {
      tasks.current.clear();
      setNetwork("");
      tick();
      void poll();
    };
    window.addEventListener("offline", offline);
    window.addEventListener("online", online);
    return () => {
      stopped = true;
      clearInterval(timer);
      clearInterval(poller);
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", online);
    };
  }, [journal?.session]);

  useEffect(() => {
    if (!fullscreen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", escape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", escape);
    };
  }, [fullscreen]);

  function closeCamera() {
    camera.current?.getTracks().forEach((track) => track.stop());
    camera.current = undefined;
    setStream(undefined);
    setFullscreen(false);
  }

  async function startCamera() {
    setError("");
    setOpening(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error();
      const value = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 2560 },
          height: { ideal: 1920 },
        },
      });
      if (!mounted.current) {
        value.getTracks().forEach((track) => track.stop());
        return;
      }
      camera.current = value;
      setStream(value);
      setZoom(1);
    } catch {
      setError(
        "Kamera nicht verfügbar. Prüfe Berechtigung und HTTPS oder nutze den Datei-Upload.",
      );
    } finally {
      setOpening(false);
    }
  }

  async function capture(source: () => Promise<Blob>) {
    if (shutter.current || !j.current) return;
    const article = j.current.current,
      replace = replacement;
    if (article.ids.length >= MAX_PHOTOS && !replace) return;
    const id = crypto.randomUUID();
    shutter.current = true;
    setCapturing(true);
    setError("");
    try {
      const start = performance.now();
      const converted = await convert(await source());
      if (!mounted.current) return;
      const captureMs = performance.now() - start,
        storage = performance.now();
      try {
        await update(
          (old) => {
            if (old.current.batch !== article.batch)
              throw new Error("Artikel gewechselt.");
            const ids = replace
              ? old.current.ids.map((p) => (p === replace ? id : p))
              : [...old.current.ids, id];
            return {
              ...old,
              current: {
                ...old.current,
                ids,
                uploaded: old.current.uploaded.filter((p) => p !== replace),
              },
            };
          },
          { id, ...converted, captureMs },
          replace && !j.current?.closed.some((a) => a.ids.includes(replace))
            ? replace
            : undefined,
        );
      } catch {
        throw new Error(
          "Foto nicht gespeichert. Prüfe den freien Browserspeicher und nimm es erneut auf.",
        );
      }
      setMetric(
        `Aufnahme und Aufbereitung ${Math.round(captureMs)} ms · lokal gespeichert in ${Math.round(performance.now() - storage)} ms`,
      );
      setReplacement("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      shutter.current = false;
      setCapturing(false);
    }
  }

  async function finish() {
    if (shutter.current || !j.current?.current.ids.length) return;
    shutter.current = true;
    setCapturing(true);
    try {
      await update((old) => ({
        ...old,
        closed: [
          ...old.closed,
          {
            ...old.current,
            sealed: true,
            sku: old.current.sku.trim() || `LF-${old.current.id}`.slice(0, 39),
          },
        ],
        current: newArticle(),
      }));
      setReplacement("");
    } catch {
      setError("Artikel konnte nicht lokal abgeschlossen werden.");
    } finally {
      shutter.current = false;
      setCapturing(false);
    }
  }

  async function exportPhotos(articles: Article[]) {
    try {
      const files = [];
      for (const article of articles) {
        for (const [index, id] of article.ids.entries()) {
          const photo = await read<LocalPhoto>("photos", id);
          const blob =
            photo?.blob ??
            (await liveRequest<Blob>(
              {
                action: "image",
                session: j.current!.session,
                batch: article.batch,
                photo: id,
              },
              true,
            ));
          const sku = (article.sku || "Brille").replace(/[^a-zA-Z0-9_-]/g, "_");
          files.push({
            name: `${sku}-${article.id.slice(0, 8)}-R${article.revision}/${String(index + 1).padStart(2, "0")}.jpg`,
            blob,
          });
        }
      }
      const url = URL.createObjectURL(await photoZip(files));
      const link = document.createElement("a");
      link.href = url;
      link.download = "snaplist-fotos.zip";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function switchSession(id?: string) {
    if (
      !j.current ||
      shutter.current ||
      j.current.current.ids.length ||
      j.current.current.sku ||
      j.current.closed.some((a) => !a.submitted)
    )
      return;
    shutter.current = true;
    setCapturing(true);
    try {
      const old = j.current;
      const next = id ? await read<Journal>("journal", id) : newJournal();
      if (!next) throw new Error("Sitzung ist lokal nicht verfügbar.");
      const history = [
        ...(old.history ?? []).filter((a) => a.id !== next.session),
        { id: old.session, createdAt: old.createdAt ?? Date.now() },
      ];
      await update(() => ({ ...next, history }));
      initialized.current = undefined;
      opened.current.clear();
      tasks.current.clear();
      setCode("");
      setStatus([]);
      setNetwork("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      shutter.current = false;
      setCapturing(false);
    }
  }

  const current = journal?.current;
  const visibleClosed =
    journal?.closed.filter(
      (a, _, all) => !all.some((b) => b.id === a.id && b.revision > a.revision),
    ) ?? [];
  return (
    <main className={`wrap ${styles.page}`} lang="de">
      <h1>Live-Foto</h1>
      <p>
        Fotografiere eine Brille nach der anderen. Die Entwürfe prüfst und
        veröffentlichst du später in Snaplist.
      </p>
      {error && !fullscreen && <p role="alert">{error}</p>}
      {network && <p role="status">{network}</p>}
      {!current && !error && <p>Lokalen Fotospeicher öffnen …</p>}
      {current && (
        <>
          <section className={styles.camera} aria-label="Kamera">
            <div
              className={fullscreen ? styles.fullscreen : styles.viewfinder}
              hidden={!stream}
            >
              <div className={styles.cameraHeader}>
                <button
                  className="btn"
                  aria-pressed={fullscreen}
                  onClick={() => setFullscreen((value) => !value)}
                >
                  {fullscreen ? "Vollbild verlassen" : "Vollbild"}
                </button>
                <button
                  className="btn"
                  disabled={capturing}
                  onClick={closeCamera}
                >
                  Kamera schließen
                </button>
              </div>
              <div className={styles.preview}>
                <video
                  ref={video}
                  autoPlay
                  playsInline
                  muted
                  style={{
                    transform: `scale(${zoom})`,
                    clipPath: `inset(${(1 - 1 / zoom) * 50}%)`,
                  }}
                />
              </div>
              <div className={styles.cameraControls}>
                <p role="status">
                  {current.sku.trim() || "Aktueller Artikel"} ·{" "}
                  {current.ids.length} Fotos
                </p>
                {fullscreen && error && <p role="alert">{error}</p>}
                <label className={styles.zoom}>
                  Zoom · {zoom.toFixed(1)}×
                  <input
                    aria-label="Kamera-Zoom"
                    type="range"
                    min={1}
                    max={3}
                    step={0.1}
                    value={zoom}
                    disabled={capturing}
                    onChange={(event) => setZoom(Number(event.target.value))}
                  />
                </label>
                <div className={styles.cameraButtons}>
                  <button
                    className={styles.shutter}
                    disabled={
                      capturing ||
                      (current.ids.length >= MAX_PHOTOS && !replacement)
                    }
                    onClick={() => {
                      if (stream && video.current)
                        void capture(() =>
                          exposure(video.current!, stream, zoom),
                        );
                    }}
                  >
                    Foto aufnehmen
                  </button>
                  <button
                    className="btn"
                    disabled={capturing || !current.ids.length}
                    onClick={() => void finish()}
                  >
                    Artikel fertig → nächster
                  </button>
                </div>
              </div>
            </div>
            {!stream && (
              <button
                className="btn"
                disabled={opening}
                onClick={() => void startCamera()}
              >
                Kamera öffnen
              </button>
            )}
            <label>
              Datei-Upload (Fallback){" "}
              <input
                type="file"
                accept="image/*"
                disabled={
                  capturing ||
                  (current.ids.length >= MAX_PHOTOS && !replacement)
                }
                onChange={(e) => {
                  const file = e.currentTarget.files?.[0];
                  e.currentTarget.value = "";
                  if (file) void capture(async () => file);
                }}
              />
            </label>
          </section>
          <label>
            SKU (optional){" "}
            <input
              key={current.batch}
              defaultValue={current.sku}
              maxLength={50}
              disabled={capturing}
              onChange={(e) => {
                const sku = e.target.value,
                  batch = current.batch;
                void update((old) =>
                  old.current.batch === batch
                    ? { ...old, current: { ...old.current, sku } }
                    : old,
                ).catch(() => setError("SKU konnte nicht gespeichert werden."));
              }}
            />
          </label>
          <p>
            {current.ids.length} / {MAX_PHOTOS} Fotos ·{" "}
            {current.uploaded.length} auf dem Server gesichert
          </p>
          {replacement && (
            <p>
              Nächste Aufnahme ersetzt das ausgewählte Foto.{" "}
              <button onClick={() => setReplacement("")}>Abbrechen</button>
            </p>
          )}
          <ul className={styles.thumbs}>
            {current.ids.map((id, index) => {
              const key = `${current.batch}:${id}`;
              return (
                <li key={id}>
                  <Thumb id={id} />
                  <small>
                    {current.uploaded.includes(id)
                      ? "Auf Server gesichert"
                      : active.current.has(key)
                        ? "Wird hochgeladen"
                        : tasks.current.has(key)
                          ? "Upload fehlgeschlagen · lokal gespeichert"
                          : "Lokal gespeichert"}
                  </small>
                  <button
                    disabled={capturing}
                    aria-label={`Foto ${index + 1} ersetzen`}
                    onClick={() => setReplacement(id)}
                  >
                    Ersetzen
                  </button>
                  <button
                    disabled={capturing}
                    aria-label={`Foto ${index + 1} entfernen`}
                    onClick={() => {
                      if (replacement === id) setReplacement("");
                      void update(
                        (old) => ({
                          ...old,
                          current: {
                            ...old.current,
                            ids: old.current.ids.filter((p) => p !== id),
                            uploaded: old.current.uploaded.filter(
                              (p) => p !== id,
                            ),
                          },
                        }),
                        undefined,
                        j.current?.closed.some((a) => a.ids.includes(id))
                          ? undefined
                          : id,
                      ).catch(() =>
                        setError("Foto konnte nicht entfernt werden."),
                      );
                    }}
                  >
                    Entfernen
                  </button>
                </li>
              );
            })}
          </ul>
          <div className={styles.actions}>
            {!stream && (
              <button
                className="btn"
                disabled={capturing || !current.ids.length}
                onClick={() => void finish()}
              >
                Artikel fertig → nächster
              </button>
            )}
            <button
              className="btn btn-ghost"
              onClick={() => {
                tasks.current.clear();
                setNetwork("");
                setActivity((n) => n + 1);
              }}
            >
              Uploads erneut versuchen
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => void exportPhotos([...visibleClosed, current])}
            >
              Fotos der Sitzung exportieren
            </button>
          </div>
          <p>
            <small>{metric}</small>
          </p>
          <p>
            <small>
              Beim Sperren oder Schließen können Uploads pausieren. Öffne diese
              Seite erneut, um fortzufahren. Exportiere wichtige Fotos;
              Browserspeicher ist kein Archiv.
            </small>
          </p>
          <div className={styles.actions}>
            <button
              disabled={
                capturing ||
                Boolean(
                  current.ids.length ||
                  current.sku ||
                  journal.closed.some((a) => !a.submitted),
                )
              }
              onClick={() => void switchSession()}
            >
              Neue Fotositzung
            </button>
            {!!journal.history?.length && (
              <label>
                Frühere Sitzung{" "}
                <select
                  value=""
                  disabled={
                    capturing ||
                    Boolean(
                      current.ids.length ||
                      current.sku ||
                      journal.closed.some((a) => !a.submitted),
                    )
                  }
                  onChange={(e) => {
                    if (e.target.value) void switchSession(e.target.value);
                  }}
                >
                  <option value="">Sitzung wählen</option>
                  {journal.history.map((a) => (
                    <option key={a.id} value={a.id}>
                      {new Date(a.createdAt).toLocaleString("de-DE")} ·{" "}
                      {a.id.slice(0, 6)}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <h2>Abgeschlossene Brillen</h2>
          <p>
            <small>
              Fotos in Entwürfen werden derzeit auch nach einer Veröffentlichung
              aufbewahrt. Entfernte, nicht verwendete Aufnahmen können nach
              sieben Tagen für die Bereinigung vorgemerkt werden.
            </small>
          </p>
          <ul className={styles.list}>
            {visibleClosed.map((article) => {
              const row = status.find((s) => s.batch === article.batch);
              return (
                <li key={article.batch}>
                  <strong>{article.sku}</strong> · Revision {article.revision} ·{" "}
                  {row
                    ? (label[row.status] ?? row.status)
                    : article.submitted
                      ? "KI wartet"
                      : `${article.uploaded.length}/${article.ids.length} auf Server gesichert`}
                  {article.ids.some((p) =>
                    tasks.current.has(`${article.batch}:${p}`),
                  ) && (
                    <small> · Upload fehlgeschlagen, lokal gespeichert</small>
                  )}
                  {tasks.current.has(`${article.batch}:seal`) && (
                    <small> · Übergabe noch nicht bestätigt</small>
                  )}
                  {row?.processingMs !== undefined && (
                    <small>
                      {" "}
                      · Auftrag bis Entwurf:{" "}
                      {Math.round(row.processingMs / 1000)} s
                    </small>
                  )}{" "}
                  <button onClick={() => void exportPhotos([article])}>
                    Fotos herunterladen
                  </button>
                  {row?.status === "failed" && (
                    <button
                      onClick={() =>
                        void liveRequest({
                          action: "retry",
                          session: journal.session,
                          batch: article.batch,
                        }).catch((e) => setError(e.message))
                      }
                    >
                      KI erneut versuchen
                    </button>
                  )}
                  <button
                    disabled={
                      capturing ||
                      current.ids.length > 0 ||
                      current.sku.length > 0
                    }
                    onClick={() =>
                      void update((old) => {
                        if (old.current.ids.length || old.current.sku)
                          return old;
                        return {
                          ...old,
                          current: {
                            ...article,
                            batch: crypto.randomUUID(),
                            revision: article.revision + 1,
                            parent: article.submitted
                              ? article.batch
                              : undefined,
                            uploaded: [],
                            sealed: false,
                            submitted: false,
                          },
                        };
                      }).catch(() =>
                        setError("Revision konnte nicht angelegt werden."),
                      )
                    }
                  >
                    Neue Revision
                  </button>
                </li>
              );
            })}
          </ul>
          <div className={styles.actions}>
            <a href={`/?liveSession=${journal.session}`}>
              Entwürfe in Snaplist öffnen
            </a>
            <button
              onClick={() =>
                void establish(journal.session)
                  .then(() =>
                    liveRequest<{ code: string }>({
                      action: "code",
                      session: journal.session,
                    }),
                  )
                  .then((d) => setCode(d.code))
                  .catch((e) => setError(e.message))
              }
            >
              Computer koppeln
            </button>
          </div>
          {code && (
            <label>
              Kopplungscode · 10 Minuten gültig{" "}
              <input readOnly value={code} onFocus={(e) => e.target.select()} />
            </label>
          )}
        </>
      )}
    </main>
  );
}
