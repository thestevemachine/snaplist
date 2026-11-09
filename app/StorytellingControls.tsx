"use client";
import { useRef, useState } from "react";
import { apiPost } from "@/lib/api-client";
import type { ItemGroup, ListingResult, Photo } from "@/lib/types";

export function StorytellingControls({ group, photoById, onEdit, onGroupEdit }: {
  group: ItemGroup;
  photoById: (id: string) => Photo | undefined;
  onEdit: (patch: Partial<ListingResult>) => void;
  onGroupEdit: (patch: Partial<ItemGroup>) => void;
}) {
  const listing = group.listing!;
  const settings = listing.storytelling ?? { enabled: false, history: "" };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<{ text: string; source: string; base: string; notice: string }>();
  const current = useRef(group);
  current.current = group;
  const sourceKey = (item: ItemGroup) => JSON.stringify([
    item.listing?.title, item.listing?.description, item.listing?.category_id,
    item.listing?.item_specifics, item.listing?.condition_notes,
    item.listing?.estimates, item.listing?.storytelling?.history ?? "", item.photoIds,
  ]);
  const stale = preview && preview.source !== sourceKey(group);
  async function generate() {
    setBusy(true);
    setError("");
    setPreview(undefined);
    const source = sourceKey(group);
    const base = settings.appliedDescription === listing.description && settings.baseDescription
      ? settings.baseDescription : listing.description;
    try {
      const images = (group.evidencePhotoIds ?? group.photoIds).slice(0, 4)
        .map(photoById).filter((photo): photo is Photo => Boolean(photo))
        .map((photo) => ({ mediaType: photo.mediaType, data: photo.data }));
      const response = await apiPost("/api/storytelling", {
        listing: { ...listing, description: base },
        history: settings.history,
        ...(images.length ? { images } : {}),
        analysisModel: group.analysisModel,
      });
      const data = await response.json();
      if (data.usage?.length) onGroupEdit({ usage: [...(current.current.usage ?? []), ...data.usage] });
      if (!data.ok) throw Error(data.error || "Geschichte konnte nicht erstellt werden.");
      if (sourceKey(current.current) !== source) throw Error("Der Artikel wurde inzwischen geändert. Bitte neu erzeugen.");
      setPreview({ text: data.description, source, base, notice: data.notice });
    } catch (error) {
      setError(error instanceof Error ? error.message : "Geschichte konnte nicht erstellt werden.");
    } finally {
      setBusy(false);
    }
  }
  return <section className="storytelling-controls" aria-label="Optionale Geschichte">
    <label className="storytelling-toggle">
      <input type="checkbox" checked={settings.enabled} disabled={busy}
        onChange={(event) => {
          const enabled = event.target.checked;
          const restore = !enabled && settings.appliedDescription === listing.description && settings.baseDescription;
          onEdit({ ...(restore ? { description: settings.baseDescription! } : {}),
            storytelling: { enabled, history: settings.history } });
          setPreview(undefined);
        }} />
      Mit Geschichte beschreiben
    </label>
    {settings.enabled && <>
      <label>Was weißt du über die Geschichte dieses Artikels?
        <textarea rows={3} maxLength={3000} value={settings.history} disabled={busy}
          onChange={(event) => onEdit({ storytelling: { ...settings, history: event.target.value } })} />
      </label>
      <small>Zum Beispiel: Herkunft, eigener Gebrauch, besondere Erinnerungen oder warum du ihn abgibst. Bitte nur echte Angaben.</small>
      <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void generate()}>
        {busy ? <><span className="spinner small" aria-hidden="true" /> Geschichte wird erstellt …</> : "Beschreibungs-Vorschau erstellen"}
      </button>
      {error && <p role="alert" className="note note-error">{error}</p>}
      {preview && <>
        <p role="status">{preview.notice}</p>
        <label>Beschreibungsvorschau bearbeiten
          <textarea rows={9} maxLength={15000} value={preview.text}
            onChange={(event) => setPreview({ ...preview, text: event.target.value })} />
        </label>
        {stale && <small>Die Artikeldaten wurden geändert. Bitte eine neue Vorschau erstellen.</small>}
        <button type="button" className="btn btn-primary" disabled={busy || Boolean(stale) || !preview.text.trim()}
          onClick={() => {
            onEdit({ description: preview.text, storytelling: { ...settings,
              baseDescription: preview.base, appliedDescription: preview.text } });
            setPreview(undefined);
          }}>Vorschau als Beschreibung übernehmen</button>
      </>}
    </>}
  </section>;
}
