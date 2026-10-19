"use client";
import { useEffect, useRef, useState } from "react";
import type { ItemGroup } from "@/lib/types";
import type { ModelOption } from "@/app/api/models/route";
import { apiPost } from "@/lib/api-client";
import { loadPhoto } from "@/lib/draft-store";
import { AiUsageSummary } from "./AiUsageSummary";
import { analysisImages } from "@/lib/analysis-images";
export function ModelComparison({
  group,
  onEdit,
}: {
  group: ItemGroup;
  onEdit: (id: string, patch: Partial<ItemGroup>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const latest = useRef(group);
  latest.current = group;
  useEffect(() => {
    if (!open || models.length) return;
    let active = true;
    fetch("/api/models")
      .then((r) => r.json())
      .then((d) => {
        if (active) setModels(d.analysisModels ?? []);
      })
      .catch(() => {
        if (active) setError("Modellliste konnte nicht geladen werden.");
      });
    return () => {
      active = false;
    };
  }, [open, models.length]);
  async function compare() {
    if (
      busy ||
      !model ||
      !window.confirm(
        `Neue kostenpflichtige Vergleichsanalyse mit ${model} starten? Der bestehende Entwurf bleibt erhalten. Keine automatische Wiederholung.`,
      )
    )
      return;
    setBusy(true);
    setError("");
    const photoIds = [
      ...(group.evidencePhotoIds ?? group.analysisPhotoIds ?? group.photoIds),
    ];
    const snapshot = {
      id: crypto.randomUUID(),
      model,
      createdAt: Date.now(),
      photoIds,
      usage: [],
    };
    try {
      const photos = await Promise.all(photoIds.map((id) => loadPhoto(id)));
      if (photos.some((p) => !p?.data))
        throw new Error(
          "Ein Originalfoto fehlt. Bitte die Fotos zunächst wiederherstellen.",
        );
      const response = await apiPost("/api/analyze", {
        profile: "auto",
        analysisModel: model,
        images: group.cloudBatchId
          ? photos.map((p) => ({ mediaType: p!.mediaType, data: p!.data }))
          : analysisImages(photos.map((p) => p!)),
      });
      const data = await response.json();
      onEdit(group.id, {
        comparisons: [
          ...(latest.current.comparisons ?? []),
          {
            ...snapshot,
            usage: data.usage ?? [],
            ...(data.ok && data.listing
              ? { listing: data.listing }
              : { error: data.error || "Vergleich fehlgeschlagen." }),
          },
        ],
      });
      if (!data.ok) setError(data.error || "Vergleich fehlgeschlagen.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Vergleich fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="note" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Modelle vergleichen · Entwurf bleibt erhalten</summary>
      <p>
        Gleiche gespeicherte Analysefotos, gleiche Listing-Regeln. Jede Variante
        wird separat gespeichert. Kostenpflichtig nur nach Bestätigung.
        Qualitätsprüfung durch dich.
      </p>
      <label>
        Vergleichsmodell{" "}
        <select value={model} onChange={(e) => setModel(e.target.value)}>
          <option value="">Modell auswählen</option>
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.displayName}
              {m.configured === false ? " · Schlüssel fehlt" : ""}
            </option>
          ))}
        </select>
      </label>
      <button type="button" disabled={busy || !model} onClick={compare}>
        {busy ? "Vergleich läuft…" : "Kostenpflichtigen Vergleich starten"}
      </button>
      {error && <p role="alert">{error}</p>}
      <p>
        <strong>Aktueller Entwurf:</strong> {group.listing?.title}
      </p>
      {(group.comparisons ?? []).map((c) => (
        <details key={c.id}>
          <summary>
            {c.model} · {new Date(c.createdAt).toLocaleString("de-DE")}
            {c.error ? " · Fehler" : ""}
          </summary>
          {c.error && <p>{c.error}</p>}
          {c.listing && (
            <>
              <p>
                <strong>Titel:</strong> {c.listing.title}
              </p>
              <p>
                <strong>Beschreibung:</strong> {c.listing.description}
              </p>
              <p>
                <strong>Preisvorschlag:</strong> {c.listing.suggested_price}
              </p>
              <pre style={{ whiteSpace: "pre-wrap" }}>
                {JSON.stringify(c.listing.item_specifics, null, 2)}
              </pre>
            </>
          )}
          <AiUsageSummary rows={c.usage} label="Vergleichskosten" />
        </details>
      ))}
    </details>
  );
}
