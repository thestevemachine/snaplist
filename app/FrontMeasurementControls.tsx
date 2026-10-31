"use client";
import { useEffect, useRef, useState } from "react";
import type { ItemGroup, Photo } from "@/lib/types";
import { isGlasses } from "@/lib/glasses-rules";
import { loadPhoto } from "@/lib/draft-store";
import { apiPost } from "@/lib/api-client";
import { getAnalysisModel } from "@/lib/model-preferences";
import { frontMeasurementFields } from "@/lib/front-measurement-fields";
export function FrontMeasurementControls({
  group,
  photoById,
  onEdit,
}: {
  group: ItemGroup;
  photoById: (id: string) => Photo | undefined;
  onEdit: (id: string, patch: Partial<ItemGroup>) => void;
}) {
  const [photoId, setPhotoId] = useState(
    group.photoIds[(group.listing?.frontMeasurement?.photoIndex || 1) - 1] ??
      group.photoIds[0] ??
      "",
  );
  const [measurementPhoto,setMeasurementPhoto]=useState(false);
  const [preview, setPreview] = useState<string>("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [preferredModel, setPreferredModel] = useState("");
  useEffect(() => setPreferredModel(getAnalysisModel() ?? ""), []);
  const latest = useRef(group);
  latest.current = group;
  if (!group.listing || !isGlasses(group.listing)) return null;
  const model =
    group.analysisModel ??
    group.usage?.find((u) => u.stage === "analysis")?.requestedModel ??
    preferredModel;
  async function measure(previewOnly = false) {
    if (
      !window.confirm(
        `Nur Maße mit ${model} kostenpflichtig berechnen? Ein vorhandenes Front- oder Messfoto wird analysiert. Titel, Beschreibung und manuelle Maße bleiben erhalten. Kein automatischer weiterer Versuch.`,
      )
    )
      return;
    const snapshot = latest.current.listing!;
    setBusy(true);
    setError("");
    setPreview("");
    try {
      const saved = await loadPhoto(photoId);
      const photo = saved ?? photoById(photoId);
      if (!photo?.data)
        throw Error(
          "Das gewählte Frontfoto ist nicht mehr auf diesem Gerät verfügbar.",
        );
      const response = await apiPost("/api/ai/measure", {
        confirmed: true,
        diagnostics: previewOnly,
        measurementPhoto,
        model,
        photoIndex: group.photoIds.indexOf(photoId) + 1,
        image: { mediaType: photo.mediaType, data: photo.data },
        listing: snapshot,
      });
      const data = await response.json();
      const usage = [...(latest.current.usage ?? []), ...(data.usage ?? [])];
      if (previewOnly) {
        setPreview(JSON.stringify({ measurement: data.measurement, diagnostics: data.diagnostics, usage: data.usage, error: data.error }, null, 2));
        return;
      }
      onEdit(group.id, { usage });
      if (!data.ok || !data.measurement)
        throw Error(data.error || "Keine Maßberechnung erhalten.");
      if (latest.current.listing !== snapshot)
        throw Error(
          "Der Entwurf wurde während der Maßanalyse geändert. Deine Änderungen bleiben erhalten; es wird nicht automatisch erneut analysiert.",
        );
      const listing = { ...snapshot, frontMeasurement: data.measurement,measurementPhotos:[...(snapshot.measurementPhotos ?? []).filter(m=>m.photoIndex!==group.photoIds.indexOf(photoId)+1),...(data.measurementPhotos ?? [])] };
      if (
        data.measurement.lensHeightMm &&
        (!listing.measurements ||
          /^Scheibenhöhe\/Gesamtbreite nicht zuverlässig berechenbar \(Frontfoto.*unsicher\)$/.test(
            listing.measurements,
          ))
      ) {
        listing.measurements = `Scheibenhöhe: ca. ${data.measurement.lensHeightMm} mm; Gesamtbreite: ca. ${data.measurement.totalWidthMm} mm (Frontfoto ${data.measurement.photoIndex}, ${data.measurement.status === "estimated" ? "Schätzung" : "unsicher"})`;
      }
      const patch = frontMeasurementFields(
        listing,
        latest.current.preparation?.aspects ?? [],
      );
      onEdit(group.id, {
        listing: { ...listing, ...patch },
        usage,
        verificationMessage: undefined,
      });
      if (data.measurement.status === "unavailable" && !data.measurementPhotos?.length)
        setError(data.measurement.reasons.join(" "));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Maßanalyse fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="measurement-controls">
      <summary>Maße berechnen</summary>
      <p>
        Front- oder Messfoto auswählen. Die aufgedruckte Scheibenbreite dient als
        Referenz. Berechnete Werte füllen leere Maßfelder als Schätzung;
        vorhandene manuelle Maße bleiben erhalten. Neuladen allein startet keine
        kostenpflichtige Erkennung.
      </p>
      <label>
        Frontfoto für Maßberechnung{" "}
        <select
          aria-label="Frontfoto für Maßberechnung"
          value={photoId}
          onChange={(e) => setPhotoId(e.target.value)}
        >
          {group.photoIds.slice(0, 24).map((id, i) => (
            <option key={id} value={id}>
              Foto {i + 1}
            </option>
          ))}
        </select>
      </label>
      <label><input type="checkbox" checked={measurementPhoto} onChange={e=>setMeasurementPhoto(e.target.checked)}/> Messfoto: Millimeterpapier oder Messschieber</label>
      {photoById(photoId)?.previewUrl && (
        <img
          src={photoById(photoId)!.previewUrl}
          alt="Gewähltes Frontfoto für Maße"
          style={{ maxWidth: "100%", maxHeight: 260, objectFit: "contain" }}
        />
      )}
      <p>
        Modell: {model}. Die API-Token und Kosten werden bei dieser Brille
        erfasst.
      </p>
      <button
        type="button"
        disabled={
          busy ||
          !photoId ||
          !model ||
          group.postStatus === "posted" ||
          group.postStatus === "posting"
        }
        onClick={() => measure()}
      >
        {busy
          ? "Maße werden berechnet…"
          : "Nur Maße berechnen (kostenpflichtig)"}
      </button>
      <button type="button" disabled={busy || !photoId || !model || group.postStatus === "posting"} onClick={() => measure(true)}>
        Messvorschau testen · Entwurf unverändert
      </button>
      {preview && <pre aria-label="Ergebnis der Messvorschau" style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{preview}</pre>}
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
