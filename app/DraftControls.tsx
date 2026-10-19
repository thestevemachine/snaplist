"use client";
import { isGlasses, controlledGlassesAspect } from "@/lib/glasses-rules";
import { isSunglasses } from "@/lib/category-selection";
import { useState, useRef, useEffect } from "react";
import type { ItemGroup, Photo } from "@/lib/types";
import type { AccountOptions } from "@/lib/ebay/publish";
import { requestText } from "@/lib/text-dialog";
import { loadAccountOptions } from "@/lib/account-options-client";
import { apiPost } from "@/lib/api-client";
import { draftIssues } from "@/lib/client-review";
import { isStandardSizeAspect } from "@/lib/ebay/aspects";
interface Props {
  group: ItemGroup;
  photoById: (id: string) => Photo | undefined;
  onGroupEdit: (id: string, patch: Partial<ItemGroup>) => void;
}
export function DraftControls({ group: g, photoById, onGroupEdit }: Props) {
  const [busy, setBusy] = useState(false);
  const [options, setOptions] = useState<AccountOptions>();
  const [error, setError] = useState("");
  const latest = useRef(g);
  latest.current = g;
  const defaultsRequested = useRef(false);
  useEffect(() => {
    if (g.listing && !defaultsRequested.current) {
      defaultsRequested.current = true;
      void loadOptions();
    }
  }, [Boolean(g.listing)]);
  if (!g.listing) return null;
  const l = g.listing;
  const edit = (patch: Partial<typeof l>) => {
    const next = { ...l, ...patch };
    if (patch.item_specifics) {
      for (const [key, field] of [
        ["Brand", "brand"],
        ["Marke", "brand"],
        ["Fassungsmaterial", "material"],
        ["Size", "size"],
        ["Material", "material"],
        ["Type", "item_type"],
      ] as const)
        if (key in patch.item_specifics)
          next[field] = patch.item_specifics[key];
      next.evidence = {};
      next.estimates = Object.fromEntries(
        Object.entries(l.estimates ?? {}).filter(
          ([k]) =>
            !(k in patch.item_specifics!) ||
            patch.item_specifics![k] === l.item_specifics?.[k],
        ),
      );
    }
    onGroupEdit(g.id, {
      listing: next,
      compsStatus: "stale",
      comps: undefined,
    });
  };
  const specifics = l.item_specifics ?? {};
  const names = [
    ...new Set([
      ...(g.preparation?.aspects ?? [])
        .filter((a) => a.required || a.usage === "RECOMMENDED")
        .map((a) => a.name),
      ...Object.keys(specifics),
    ]),
  ];
  async function prepare() {
    setBusy(true);
    setError("");
    try {
      const images = (g.analysisPhotoIds ?? g.photoIds)
        .map(photoById)
        .filter((p): p is Photo => Boolean(p) && p!.analysisSelected !== false)
        .map((p) => ({ mediaType: p.mediaType, data: p.data }));
      const r = await apiPost("/api/ebay/prepare", {
        listing: l,
        images,
        enrich: !g.preparation,
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error);
      if (latest.current.listing !== l)
        throw new Error(
          "Der Entwurf wurde während der Vorbereitung geändert. Bitte erneut vorbereiten; deine Änderungen bleiben erhalten.",
        );
      onGroupEdit(g.id, {
        listing: d.listing,
        preparation: d.preparation,
        preparationError: undefined,
        usage: [...(g.usage ?? []), ...(d.usage ?? [])],
        comps: undefined,
        compsStatus: "stale",
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function loadOptions(refresh = false) {
    setBusy(true);
    setError("");
    try {
      const options = await loadAccountOptions(refresh);
      setOptions(options);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function research() {
    setBusy(true);
    setError("");
    onGroupEdit(g.id, { compsStatus: "loading", comps: undefined });
    try {
      const r = await apiPost("/api/ebay/comps", { listing: l });
      const d = await r.json();
      if (latest.current.listing !== l) return;
      onGroupEdit(g.id, {
        comps: d.comps,
        compsStatus: d.comps?.ok ? "ready" : "unavailable",
      });
      if (!d.ok) throw new Error(d.error);
    } catch (e) {
      setError((e as Error).message);
      onGroupEdit(g.id, { compsStatus: "unavailable" });
    } finally {
      setBusy(false);
    }
  }
  return (
    <fieldset
      disabled={busy || g.postStatus === "posted" || g.postStatus === "posting"}
      className="draft-controls"
    >
      <legend>eBay-Details prüfen</legend>
      {!isGlasses(l) && (
        <label>
          Bekleidungsabteilung
          <select
            aria-label="Bekleidungsabteilung"
            value={
              l.category?.startsWith("womens_")
                ? "Women"
                : l.category?.startsWith("mens_")
                  ? "Men"
                  : ""
            }
            onChange={(e) => {
              const family = (l.category || "clothing").replace(
                /^(womens|mens)_/,
                "",
              );
              edit({
                category: e.target.value
                  ? (e.target.value === "Women" ? "womens_" : "mens_") + family
                  : "accessory",
                category_id: "",
                ebay_condition: "",
                item_specifics: { ...specifics, Department: e.target.value },
              });
            }}
          >
            <option value="">Nicht festgelegt / Sonstiges</option>
            <option>Women</option>
            <option>Men</option>
          </select>
        </label>
      )}
      {!!g.preparation?.suggestions?.length && (
        <label>
          Vorgeschlagene Kategorie
          <select
            value={l.category_id || ""}
            onChange={(e) =>
              edit({ category_id: e.target.value, ebay_condition: "" })
            }
          >
            {g.preparation.suggestions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.path}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        Kategorie-ID{" "}
        <input
          aria-label="Kategorie-ID"
          value={l.category_id ?? ""}
          onChange={(e) =>
            edit({ category_id: e.target.value, ebay_condition: "" })
          }
        />
      </label>
      <button type="button" onClick={prepare}>
        {busy
          ? "Wird vorbereitet…"
          : isSunglasses(l)
            ? "Sonnenbrillen: Herren + Damen vorbereiten"
            : "Kategorie und Merkmale vorbereiten"}
      </button>
      {g.preparation && <p>{g.preparation.categoryName}</p>}
      {g.preparation?.secondaryCategoryId && (
        <p>
          Zweitkategorie: {g.preparation.secondaryCategoryName} (
          {g.preparation.secondaryCategoryId})
        </p>
      )}
      {isSunglasses(l) && (
        <p className="note">
          Ein Angebot in beiden Kategorien: Herren und Damen. eBay kann für die
          zweite Kategorie zusätzliche Gebühren berechnen.
        </p>
      )}
      {(error || g.preparationError) && (
        <p role="alert">{error || g.preparationError}</p>
      )}
      {g.preparation && (
        <label>
          eBay-Zustand{" "}
          <select
            aria-label="eBay-Zustand"
            value={l.ebay_condition ?? ""}
            onChange={(e) =>
              edit({
                ebay_condition: e.target.value,
                condition:
                  e.target.value === "NEW_OTHER"
                    ? "NEW_NO_TAGS"
                    : e.target.value.startsWith("NEW")
                      ? "NEW_WITH_TAGS"
                      : e.target.value === "FOR_PARTS_OR_NOT_WORKING"
                        ? "FOR_PARTS_OR_NOT_WORKING"
                        : "GOOD",
              })
            }
          >
            <option value="">Zustand auswählen</option>
            {g.preparation.conditions.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        Zustand und Hinweise
        <textarea
          value={l.condition_notes ?? ""}
          onChange={(e) => edit({ condition_notes: e.target.value })}
        />
      </label>
      <details open>
        <summary>
          Artikelmerkmale bearbeiten – KI-Schätzungen bitte vor dem
          Veröffentlichen prüfen
        </summary>
        {names.map((name) => {
          const meta = g.preparation?.aspects.find((a) => a.name === name);
          return (
            <label key={name} className="specific-edit">
              {name}
              {l.evidence?.[name]?.length
                ? ` (KI verweist auf Foto ${l.evidence[name]
                    .map((n) => {
                      const id = g.evidencePhotoIds?.[n - 1];
                      return id ? g.photoIds.indexOf(id) + 1 : n;
                    })
                    .join(", ")}; bitte prüfen)`
                : ""}
              {l.estimates?.[name] ? (
                <span className="estimate-tag">
                  {" "}
                  KI-Schätzung · {l.estimates[name]}% sicher
                </span>
              ) : null}
              {meta?.required ? " *" : ""}
              {meta &&
              (meta.mode === "SELECTION_ONLY" ||
                isStandardSizeAspect(meta) ||
                (isGlasses(l) &&
                  controlledGlassesAspect(meta.name) &&
                  meta.values.length > 0)) &&
              meta.cardinality !== "MULTI" ? (
                <select
                  aria-label={name}
                  value={specifics[name] ?? ""}
                  onChange={(e) =>
                    edit({
                      item_specifics: { ...specifics, [name]: e.target.value },
                    })
                  }
                >
                  <option value="">Unbekannt – leer lassen</option>
                  {meta.values.map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              ) : (
                <input
                  aria-label={name}
                  value={specifics[name] ?? ""}
                  placeholder={
                    meta?.cardinality === "MULTI"
                      ? "Mehrere Werte mit | trennen"
                      : "Unbekannt – leer lassen"
                  }
                  onChange={(e) =>
                    edit({
                      item_specifics: { ...specifics, [name]: e.target.value },
                    })
                  }
                />
              )}
            </label>
          );
        })}
        <button
          type="button"
          onClick={async () => {
            const name = await requestText(
              "Name des Merkmals, zum Beispiel Modell",
            );
            if (name?.trim())
              edit({ item_specifics: { ...specifics, [name.trim()]: "" } });
          }}
        >
          Merkmal hinzufügen
        </button>
      </details>
      <details>
        <summary>Fotos und Analysebelege ({g.photoIds.length})</summary>
        <p>
          Alle Artikelfotos werden beim Veröffentlichen übertragen. Wähle die
          Fotos für die KI-Analyse einschließlich Beschriftungen und Mängeln.
          Originale bleiben auf diesem Gerät.
        </p>
        {g.photoIds.map((id, i) => {
          const p = photoById(id);
          return p ? (
            <div key={id}>
              <label>
                <input
                  type="checkbox"
                  checked={(g.analysisPhotoIds ?? g.photoIds).includes(id)}
                  onChange={(e) =>
                    onGroupEdit(g.id, {
                      analysisPhotoIds: e.target.checked
                        ? [...(g.analysisPhotoIds ?? g.photoIds), id]
                        : (g.analysisPhotoIds ?? g.photoIds).filter(
                            (x) => x !== id,
                          ),
                    })
                  }
                />
                Foto verwenden: {i + 1} für die Analyse
              </label>
              <img src={p.previewUrl} width={80} alt={`Artikelfoto ${i + 1}`} />
              {p.original && (
                <button
                  type="button"
                  onClick={() => {
                    const u = URL.createObjectURL(p.original!);
                    const a = document.createElement("a");
                    a.href = u;
                    a.download = `${g.sku}-${i + 1}-original`;
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(u), 1000);
                  }}
                >
                  Original speichern
                </button>
              )}
            </div>
          ) : null;
        })}
      </details>
      <details open>
        <summary>Versand und Rückgabe</summary>
        <p className="note">
          Gespeicherte Shop-Vorgaben werden für neue Angebote verwendet. Hier
          kannst du sie für diese Brille ändern.
        </p>
        {options && options.returns.length === 0 && (
          <p className="note-error">
            Keine Rückgaberegel gefunden. Bitte deine eBay-Rahmenbedingungen
            prüfen und erneut laden.
          </p>
        )}
        <button type="button" onClick={() => void loadOptions(true)}>
          Meine eBay-Rahmenbedingungen laden
        </button>
        {(
          [
            ["fulfillment", "fulfillmentPolicyId", "Versandregel"],
            ["payment", "paymentPolicyId", "Zahlungsregel"],
            ["returns", "returnPolicyId", "Rückgaberegel"],
            ["locations", "locationKey", "Artikelstandort"],
          ] as const
        ).map(([kind, key, label]) => (
          <label key={key}>
            {label}
            <select
              aria-label={label}
              value={g.shipping?.[key] ?? ""}
              onChange={(e) =>
                onGroupEdit(g.id, {
                  shipping: { ...g.shipping, [key]: e.target.value },
                })
              }
            >
              <option value="">Auswählen…</option>
              {!options && g.shipping?.[key] && (
                <option value={g.shipping[key]}>
                  {g.shipping[key]} (gespeichert)
                </option>
              )}
              {options?.[kind].map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
        ))}
        {!options?.locations.length && options && (
          <p>
            Bitte die eBay-Kontoadresse prüfen und die Rahmenbedingungen erneut
            laden.
          </p>
        )}
      </details>
      <button type="button" onClick={research}>
        Vergleichspreise aktualisieren
      </button>
      {g.compsStatus && g.compsStatus !== "ready" && (
        <p>
          Preisvergleich:{" "}
          {g.compsStatus === "loading"
            ? "wird geladen"
            : g.compsStatus === "stale"
              ? "veraltet"
              : "nicht verfügbar"}
          . Der KI-Preis ist eine ungeprüfte Schätzung.
        </p>
      )}
      {g.comps?.sources && (
        <details>
          <summary>Vergleichsangebote ansehen · {g.comps.matchBasis}</summary>
          <p>
            Geprüft am {g.comps.checkedAt}. Dies sind Angebotspreise, keine
            Verkaufspreise. Bitte Artikel, Zustand und Zubehör vergleichen.
          </p>
          {g.comps.sources.map((s) => (
            <p key={s.id}>
              <a href={s.url} target="_blank" rel="noreferrer">
                {s.title}
              </a>{" "}
              — {s.price.toFixed(2)} € +{" "}
              {s.shipping === undefined
                ? "Versand unbekannt"
                : `${s.shipping.toFixed(2)} € Versand`}
            </p>
          ))}
        </details>
      )}
      {!!g.usage?.length && (
        <p>
          Bisherige KI-Nutzung:{" "}
          {g.usage
            .reduce((n, u) => n + u.input + u.cacheRead + u.cacheWrite, 0)
            .toLocaleString()}{" "}
          Eingabe-Token ·{" "}
          {g.usage.reduce((n, u) => n + u.output, 0).toLocaleString()} Ausgabe ·
          geschätzt $
          {g.usage.reduce((n, u) => n + (u.estimatedUsd ?? 0), 0).toFixed(4)}{" "}
          (erfasste Aufrufe; Sortierung separat).
        </p>
      )}
      {draftIssues(g).length > 0 && (
        <ul aria-label="Noch zu prüfen">
          {draftIssues(g).map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}
