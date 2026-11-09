"use client";
import { useEffect, useRef, useState } from "react";
import { CameraCapture } from "../CameraCapture";
import { resizeImage } from "@/lib/resize";
import { apiPost } from "@/lib/api-client";
import { getAnalysisModel } from "@/lib/model-preferences";
import { checkerResultSchema, type CheckerResult } from "@/lib/checker";
import type { AiUsage } from "@/lib/ai-usage";
import "./checker.css";
type Photo = { id: string; file: File; preview: string; data: string };
type Item = {
  id: string;
  photos: Photo[];
  notes: string;
  status: "queued" | "working" | "ready" | "error";
  result?: CheckerResult;
  error?: string;
  usage?: AiUsage[];
};
export default function Checker() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const pending = useRef<Photo[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const queue = useRef(Promise.resolve());
  const alive = useRef(true);
  const running = useRef(new Set<string>());
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  function updatePending(next: Photo[]) {
    pending.current = next;
    setPhotos(next);
  }
  async function add(file: File) {
    if (pending.current.length >= 12)
      throw Error("Maximal zwölf Fotos pro Artikel.");
    const image = await resizeImage(file);
    if (!alive.current) return;
    if (pending.current.length >= 12)
      throw Error("Maximal zwölf Fotos pro Artikel.");
    const photo = {
      id: crypto.randomUUID(),
      file,
      preview: image.previewUrl,
      data: image.data,
    };
    updatePending([...pending.current, photo]);
    return photo.id;
  }
  async function upload(files: File[]) {
    setLoading(true);
    setNotice("");
    try {
      for (const file of files) await add(file);
    } catch (e) {
      setNotice(
        e instanceof Error ? e.message : "Foto konnte nicht gelesen werden.",
      );
    } finally {
      setLoading(false);
    }
  }
  function run(item: Item) {
    if (running.current.has(item.id)) return;
    running.current.add(item.id);
    const model = getAnalysisModel() ?? undefined;
    queue.current = queue.current.then(async () => {
      if (!alive.current) {
        running.current.delete(item.id);
        return;
      }
      setItems((old) =>
        old.map((i) =>
          i.id === item.id ? { ...i, status: "working", error: undefined } : i,
        ),
      );
      try {
        const response = await apiPost("/api/checker", {
          images: item.photos.map((p) => ({
            mediaType: "image/jpeg",
            data: p.data,
          })),
          notes: item.notes,
          model,
        });
        const body = await response.json();
        if (!response.ok)
          throw Error(body.error ?? "Erstellung fehlgeschlagen.");
        const result = checkerResultSchema.parse(body.result);
        if (alive.current)
          setItems((old) =>
            old.map((i) =>
              i.id === item.id
                ? { ...i, status: "ready", result, usage: body.usage }
                : i,
            ),
          );
      } catch (e) {
        if (alive.current)
          setItems((old) =>
            old.map((i) =>
              i.id === item.id
                ? {
                    ...i,
                    status: "error",
                    error:
                      e instanceof Error
                        ? e.message
                        : "Erstellung fehlgeschlagen.",
                  }
                : i,
            ),
          );
      } finally {
        running.current.delete(item.id);
      }
    });
  }
  function finish() {
    if (loading || !pending.current.length) return false;
    const item: Item = {
      id: crypto.randomUUID(),
      photos: [...pending.current],
      notes,
      status: "queued",
    };
    setItems((old) => [...old, item]);
    updatePending([]);
    setNotes("");
    run(item);
    return true;
  }
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice("Kopiert.");
    } catch {
      setNotice(
        "Kopieren nicht verfügbar. Bitte Text im Feld markieren und kopieren.",
      );
    }
  }
  async function save(list: Photo[]) {
    try {
      const files = list.map((p) => p.file);
      if (navigator.canShare?.({ files })) {
        await navigator.share({ files });
        setNotice(
          "Im Teilen-Menü ‚Bilder sichern‘ wählen, sofern dein Gerät dies anbietet.",
        );
      } else {
        for (const p of list) {
          const url = URL.createObjectURL(p.file);
          const a = document.createElement("a");
          a.href = url;
          a.download = p.file.name;
          document.body.append(a);
          a.click();
          a.remove();
          window.setTimeout(() => URL.revokeObjectURL(url), 60000);
        }
        setNotice(
          "Download gestartet. Falls mehrere Downloads blockiert werden, Fotos einzeln speichern.",
        );
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError"))
        setNotice(
          "Speichern nicht möglich. Bitte die einzelnen Foto-Buttons verwenden.",
        );
    }
  }
  function previews(list: Photo[], removable = false) {
    return (
      <div className="checker-photos">
        {list.map((p, index) => (
          <figure key={p.id}>
            <img src={p.preview} alt={`Artikelfoto ${index + 1}`} />
            <button className="btn btn-ghost" onClick={() => void save([p])}>
              Foto {index + 1} speichern
            </button>
            {removable && (
              <button
                className="btn btn-ghost"
                disabled={loading}
                onClick={() =>
                  updatePending(pending.current.filter((x) => x.id !== p.id))
                }
              >
                Entfernen
              </button>
            )}
          </figure>
        ))}
      </div>
    );
  }
  function edit(
    id: string,
    field: "title" | "description" | "price",
    value: string,
  ) {
    setItems((old) =>
      old.map((i) =>
        i.id === id && i.result
          ? {
              ...i,
              result: {
                ...i.result,
                [field]:
                  field === "price"
                    ? value === ""
                      ? null
                      : Number(value)
                    : value,
              },
            }
          : i,
      ),
    );
  }
  return (
    <main className="checker">
      <header>
        <p>SNAPLIST · Privater Verkauf</p>
        <h1>Checker</h1>
        <p>Fotografieren. Artikel abschließen. Für Vinted kopieren.</p>
      </header>
      <section className="checker-card">
        <h2>Aktueller Artikel</h2>
        <p>
          Wähle bis zu zwölf Fotos desselben Artikels. Bei mehreren Produkten
          jeden Artikel einzeln abschließen.
        </p>
        <label className="checker-field">
          Fotos auswählen
          <input
            type="file"
            accept="image/*"
            multiple
            disabled={loading || photos.length >= 12}
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              void upload(files);
            }}
          />
        </label>
        <CameraCapture
          articleLabel="Artikel"
          remaining={12 - photos.length}
          disabled={loading}
          onCapture={add}
          onFinishArticle={() => finish()}
          onClose={() => {}}
          draftProgress={{
            ready: items.filter((i) => i.status === "ready").length,
            total: items.length,
          }}
        />
        {previews(photos, true)}
        <label className="checker-field">
          Angaben zum Artikel (optional)
          <textarea
            value={notes}
            maxLength={2000}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Zum Beispiel Größe, Marke, Zustand und bekannte Mängel"
          />
        </label>
        <button
          className="btn btn-primary"
          disabled={loading || !photos.length}
          onClick={() => finish()}
        >
          Artikel fertig → Entwurf erstellen
        </button>
        <p>
          Pro Artikel startet ein KI-Aufruf mit deinem SnapList-Modell; dabei
          entstehen Anbieter-Kosten. Du kannst währenddessen den nächsten
          Artikel fotografieren.
        </p>
        <p>
          Fotos und Ergebnisse bleiben nur in diesem geöffneten Reiter erhalten.
          Vor Verlassen speichern oder kopieren. Zur Erstellung werden
          verkleinerte Fotos an deinen KI-Anbieter übertragen.
        </p>
      </section>
      <p role="status" aria-live="polite">
        {notice}
      </p>
      <section aria-label="Ergebnisse">
        <h2>Deine Artikel ({items.length})</h2>
        {items.map((item, index) => (
          <article key={item.id} className="checker-card">
            <h3>Artikel {index + 1}</h3>
            {item.photos.length > 0 && (
              <>
                {previews(item.photos)}
                <button className="btn btn-ghost" onClick={() => void save(item.photos)}>
                  Alle Bilder speichern / teilen
                </button>
                {item.status === "ready" && (
                  <button
                    className="btn btn-ghost"
                    onClick={() => {
                      setItems((previous) => previous.map((entry) =>
                        entry.id === item.id ? { ...entry, photos: [] } : entry,
                      ));
                      setNotice("Fotos dieses Artikels aus dem Checker entfernt.");
                    }}
                  >
                    Bilder aus Checker entfernen
                  </button>
                )}
              </>
            )}
            {item.status === "queued" && (
              <p role="status">Wartet auf Erstellung…</p>
            )}
            {item.status === "working" && (
              <p role="status">Vinted-Entwurf wird erstellt…</p>
            )}
            {item.status === "error" && (
              <>
                <p role="alert">{item.error}</p>
                <button
                  className="btn"
                  onClick={() => {
                    setItems((old) =>
                      old.map((i) =>
                        i.id === item.id ? { ...i, status: "queued" } : i,
                      ),
                    );
                    run(item);
                  }}
                >
                  Erneut versuchen (KI-Kosten)
                </button>
              </>
            )}
            {item.result && (
              <>
                <label className="checker-field">
                  Titel
                  <input
                    value={item.result.title}
                    maxLength={100}
                    onChange={(e) => edit(item.id, "title", e.target.value)}
                  />
                </label>
                <button
                  className="btn"
                  onClick={() => void copy(item.result!.title)}
                >
                  Titel kopieren
                </button>
                <label className="checker-field">
                  Beschreibung
                  <textarea
                    rows={6}
                    value={item.result.description}
                    maxLength={4000}
                    onChange={(e) =>
                      edit(item.id, "description", e.target.value)
                    }
                  />
                </label>
                <button
                  className="btn"
                  onClick={() => void copy(item.result!.description)}
                >
                  Beschreibung kopieren
                </button>
                <label className="checker-field">
                  Preisvorschlag in € · geschätzt
                  <input
                    type="number"
                    min="0.01"
                    max="100000"
                    step="0.01"
                    value={item.result.price ?? ""}
                    onChange={(e) => edit(item.id, "price", e.target.value)}
                  />
                </label>
                <button
                  className="btn"
                  disabled={
                    !item.result.price ||
                    !Number.isFinite(item.result.price) ||
                    item.result.price <= 0 ||
                    item.result.price > 100000
                  }
                  onClick={() =>
                    void copy(
                      item.result!.price!.toLocaleString("de-DE", {
                        maximumFractionDigits: 2,
                      }),
                    )
                  }
                >
                  Preis kopieren
                </button>
                <p>{item.result.priceReason}</p>
                <p>
                  Geschätzter Wiederverkaufspreis · keine Live-Vinted-Abfrage.
                </p>
                {item.result.uncertainties.length > 0 && (
                  <>
                    <h4>Bitte vor dem Einstellen prüfen</h4>
                    <ul>
                      {item.result.uncertainties.map((v, n) => (
                        <li key={n}>{v}</li>
                      ))}
                    </ul>
                  </>
                )}
                {item.usage?.length ? (
                  <details>
                    <summary>KI-Verbrauch</summary>
                    {item.usage.map((u, n) => (
                      <p key={n}>
                        {u.model}:{" "}
                        {u.usageReported
                          ? `${u.input} Eingabe- / ${u.output} Ausgabe-Token`
                          : "Verbrauch nicht gemeldet"}
                      </p>
                    ))}
                  </details>
                ) : null}
              </>
            )}
          </article>
        ))}
      </section>
    </main>
  );
}
