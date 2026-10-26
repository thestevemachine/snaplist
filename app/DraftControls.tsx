"use client";
import { issueField, focusReviewField } from "@/lib/review-navigation";
import { lindbergLensWidthPatch } from "@/lib/lindberg-lens-width";
import { titanEvidencePatch, titanMetalPatch } from "@/lib/titan-evidence";
import { eyewearStyleTagsPatch } from "@/lib/eyewear-style-tags";
import { recalculateStoredMeasurement } from "@/lib/front-measurements";
import { frontMeasurementFields } from "@/lib/front-measurement-fields";
import {
  changeEyewearKind,
  FIXED_CONDITION_NOTES,
} from "@/lib/listing-content-rules";
import {
  syncManualEyewear,
  printedMaterialPatch,
} from "@/lib/eyewear-inscriptions";
import { isGlasses, controlledGlassesAspect } from "@/lib/glasses-rules";
import { isSunglasses } from "@/lib/category-selection";
import { useState, useRef, useEffect } from "react";
import { ModelComparison } from "./ModelComparison";
import { AiUsageSummary } from "./AiUsageSummary";
import type { ItemGroup, Photo } from "@/lib/types";
import type { AccountOptions } from "@/lib/ebay/publish";
import { loadAccountOptions } from "@/lib/account-options-client";
import { apiPost } from "@/lib/api-client";
import { draftIssues } from "@/lib/client-review";
import { isStandardSizeAspect } from "@/lib/ebay/aspects";
import {
  isMeasurementAspect as isMeasurement,
  formatMeasurement,
  eyewearFeatureDefaultPatch,
} from "@/lib/ebay/category-fields";
interface Props {
  group: ItemGroup;
  photoById: (id: string) => Photo | undefined;
  onGroupEdit: (id: string, patch: Partial<ItemGroup>) => void;
}
export function DraftControls({ group: g, photoById, onGroupEdit }: Props) {
  const [busy, setBusy] = useState(false);
  const [shippingOpen, setShippingOpen] = useState(false);
  const [options, setOptions] = useState<AccountOptions>();
  const [error, setError] = useState("");
  const latest = useRef(g);
  latest.current = g;
  const defaultsRequested = useRef(false);
  useEffect(() => setShippingOpen(false), [g.id]);
  useEffect(() => {
    if (g.listing && !defaultsRequested.current) {
      defaultsRequested.current = true;
      void loadOptions();
    }
  }, [Boolean(g.listing)]);
  useEffect(() => {
    if (
      !g.listing ||
      !g.preparation ||
      !isGlasses(g.listing) ||
      g.postStatus === "posted" ||
      g.postStatus === "posting"
    )
      return;
    const lensPatch = lindbergLensWidthPatch(g.listing,g.preparation.aspects);
    if(lensPatch) {onGroupEdit(g.id,{listing:{...g.listing,...lensPatch}});return;}
    const titanPatch = titanEvidencePatch(g.listing);
    if (titanPatch) {
      onGroupEdit(g.id, {listing:{...g.listing,...titanPatch}});
      return;
    }
    const featurePatch = eyewearFeatureDefaultPatch(
      g.listing,
      g.preparation.aspects,
    );
    const materialPatch = printedMaterialPatch(
      { ...g.listing, ...featurePatch },
      g.preparation.aspects,
    );
    const withFeatures = { ...g.listing, ...featurePatch, ...materialPatch };
    const stylePatch = eyewearStyleTagsPatch(
      withFeatures,
      g.preparation.aspects,
    );
    const updated = {
      ...g.listing,
      ...featurePatch,
      ...materialPatch,
      ...stylePatch,
      item_specifics: {
        ...g.listing.item_specifics,
        ...featurePatch?.item_specifics,
        ...materialPatch?.item_specifics,
        ...stylePatch?.item_specifics,
      },
    };
    const metalPatch = titanMetalPatch(updated, g.preparation.aspects);
    if (metalPatch) Object.assign(updated, metalPatch);
    const recalculated = recalculateStoredMeasurement(updated);
    const geometryChanged = recalculated && JSON.stringify(recalculated) !== JSON.stringify(updated.frontMeasurement);
    if (geometryChanged) updated.frontMeasurement = recalculated;
    const measurementPatch = frontMeasurementFields(
      updated,
      g.preparation.aspects,
    );
    if (featurePatch || materialPatch || stylePatch || measurementPatch || metalPatch || geometryChanged)
      onGroupEdit(g.id, { listing: { ...updated, ...measurementPatch } });
  }, [g.id, g.listing, g.preparation, g.postStatus, onGroupEdit]);
  if (!g.listing) return null;
  const l = g.listing;
  const edit = (patch: Partial<typeof l>) => {
    const next = { ...l, ...patch };
    if (patch.item_specifics) {
      next.manual_measurement_fields = [
        ...new Set([
          ...(l.manual_measurement_fields ?? []),
          ...Object.keys(patch.item_specifics).filter(
            (name) =>
              isMeasurement(name) &&
              patch.item_specifics![name] !== l.item_specifics?.[name],
          ),
        ]),
      ];
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
      syncManualEyewear(l, next);
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
    ...new Set([...(g.preparation?.aspects ?? []).map((a) => a.name), "EAN"]),
  ];
  async function prepare() {
    if (
      !g.preparation &&
      !window.confirm(
        "Kategorie mit kostenpflichtiger KI-Merkmalsprüfung vorbereiten? Der ausgewählte Anbieter wird verwendet; keine automatische Wiederholung.",
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      const images = (g.analysisPhotoIds ?? g.photoIds)
        .map(photoById)
        .filter((p): p is Photo => Boolean(p) && p!.analysisSelected !== false)
        .map((p) => ({ mediaType: p.mediaType, data: p.data }));
      const r = await apiPost("/api/ebay/prepare", {
        listing: l,
        analysisModel:
          g.analysisModel ??
          g.usage?.filter((u) => u.stage === "analysis").at(-1)?.requestedModel,
        images,
        enrich: !g.preparation,
      });
      const d = await r.json();
      if (!d.ok) {
        onGroupEdit(g.id, {
          usage: [...(latest.current.usage ?? []), ...(d.usage ?? [])],
        });
        throw new Error(d.error);
      }
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
      {isGlasses(l) && (
        <label>
          Brillenart
          <select
            aria-label="Brillenart"
            value={
              l.eyewear_kind ?? (isSunglasses(l) ? "sunglasses" : "optical")
            }
            onChange={(e) =>
              onGroupEdit(g.id, {
                listing: changeEyewearKind(
                  l,
                  e.target.value as "optical" | "sunglasses" | "uncertain",
                ),
                preparation: undefined,
                preparationError: undefined,
                verificationMessage: undefined,
              })
            }
          >
            <option value="optical">Korrektionsfassung / Brille</option>
            <option value="sunglasses">Sonnenbrille</option>
            <option value="uncertain">Unklar – bitte prüfen</option>
          </select>
        </label>
      )}
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
      <div className="category-fields">
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
        <label className="category-id-field">
          <span>Kategorie-ID</span>
          <input
            aria-label="Kategorie-ID" data-review-field="Kategorie"
            value={l.category_id ?? ""}
            onChange={(e) =>
              edit({ category_id: e.target.value, ebay_condition: "" })
            }
          />
        </label>
      </div>
      <button type="button" onClick={prepare}>
        {busy
          ? "Wird vorbereitet…"
          : isSunglasses(l)
            ? "Sonnenbrillen: Herren + Damen vorbereiten"
            : "Kategorie und Merkmale vorbereiten"}
      </button>
      {g.preparation && !g.preparation.suggestions?.length && (
        <small>{g.preparation.categoryName}</small>
      )}
      {g.preparation?.secondaryCategoryId && (
        <p>
          Zweitkategorie: {isSunglasses(l) ? "Damen" : g.preparation.secondaryCategoryName?.split(">").pop()?.trim()} · {g.preparation.secondaryCategoryId}
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
            data-review-field="eBay-Zustand"
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
          rows={2}
          aria-label="Zustand und Hinweise"
          value={
            l.condition_notes ?? (isGlasses(l) ? FIXED_CONDITION_NOTES : "")
          }
          onChange={(e) => edit({ condition_notes: e.target.value })}
        />
      </label>
      <details open className="specifics-details">
        <summary>
          Artikelmerkmale
        </summary>
        {!g.preparation && (
          <p>
            Die Artikelmerkmale erscheinen nach dem Laden der eBay-Kategorie.
          </p>
        )}
        {g.preparation?.aspects.some((a) => /^Besonderheiten$/i.test(a.name)) &&
          !l.item_specifics?.Besonderheiten?.trim() && (
            <p className="note-error">
              Besonderheiten fehlen: bitte mindestens ein zutreffendes Merkmal
              auswählen.
            </p>
          )}
        {names.map((name) => {
          const meta = g.preparation?.aspects.find((a) => a.name === name);
          const noPattern =
            /^Muster$/i.test(name) &&
            !(specifics[name] ?? "")
              .split(" | ")
              .some(
                (value) =>
                  value.trim() &&
                  !/^(einfarbig|unifarben|ohne muster|kein muster|unbekannt|nicht zutreffend|nicht angegeben)$/i.test(
                    value.trim(),
                  ),
              );
          if (
            (/^(Anzahl der Einheiten|Maßeinheit|Produktlinie|Herstellernummer|MPN)$/i.test(name) ||
              (isSunglasses(l) && /^(Vergrößerungsstärke|Vergrößerung|Dioptrien|Magnification Strength)$/i.test(name)) ||
              noPattern) &&
            !meta?.required
          )
            return null;
          const field = (
            <div
              key={name}
              className="specific-edit"
              data-review-field={name}
              role="group"
              aria-label={`Artikelmerkmal ${name}`}
            >
              <div className="specific-name" id={`aspect-name-${g.id}-${name}`}>
                {name}
                {meta?.required ? " *" : ""}
              </div>
              {meta?.cardinality === "MULTI" && meta.values.length > 0 ? (
                <details className="aspect-choices">
                  <summary aria-label={`${name}: Auswahl bearbeiten`}>
                    {(specifics[name] ?? "")
                      .split(" | ")
                      .filter(Boolean)
                      .map((v) => `✓ ${v}`)
                      .join(" · ") || "Keine Auswahl"}
                  </summary>
                  <div
                    className="aspect-options"
                    role="group"
                    aria-label={name}
                  >
                    {[
                      ...new Set([
                        ...meta.values,
                        ...(meta.mode === "FREE_TEXT"
                          ? (specifics[name] ?? "").split(" | ").filter(Boolean)
                          : []),
                      ]),
                    ]
                      .sort(
                        (a, b) =>
                          Number(
                            (specifics[name] ?? "").split(" | ").includes(b),
                          ) -
                          Number(
                            (specifics[name] ?? "").split(" | ").includes(a),
                          ),
                      )
                      .map((value) => {
                        const selected = (specifics[name] ?? "")
                          .split(" | ")
                          .filter(Boolean);
                        const checked = selected.includes(value);
                        return (
                          <label key={value}>
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={!checked && selected.length >= 5}
                              onChange={(event) =>
                                edit({
                                  item_specifics: {
                                    ...specifics,
                                    [name]: (event.target.checked
                                      ? [...selected, value]
                                      : selected.filter((v) => v !== value)
                                    ).join(" | "),
                                  },
                                })
                              }
                            />
                            {value}
                          </label>
                        );
                      })}
                    {meta.mode === "FREE_TEXT" &&
                      /^(Thema|Charakter)$/i.test(name) && (
                        <label className="custom-style-tags">
                          Eigene Stilbegriffe (mit | trennen)
                          <input
                            aria-label={`${name}: eigene Stilbegriffe`}
                            value={specifics[name] ?? ""}
                            onChange={(e) =>
                              edit({
                                item_specifics: {
                                  ...specifics,
                                  [name]: e.target.value,
                                },
                              })
                            }
                            onBlur={(e) =>
                              edit({
                                item_specifics: {
                                  ...specifics,
                                  [name]: e.target.value
                                    .split("|")
                                    .map((v) => v.trim())
                                    .filter(Boolean)
                                    .slice(0, 5)
                                    .join(" | "),
                                },
                              })
                            }
                          />
                        </label>
                      )}
                    <small>
                      Mehrere Werte können ausgewählt werden (höchstens 5).
                    </small>
                  </div>
                </details>
              ) : meta &&
                (meta.mode === "SELECTION_ONLY" ||
                  isStandardSizeAspect(meta) ||
                  (isGlasses(l) &&
                    (controlledGlassesAspect(meta.name) ||
                      /glasbreite|gläserbreite|glasdurchmesser|stegbreite|brückenbreite/i.test(
                        meta.name,
                      )) &&
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
                    <option key={v} value={v}>
                      {formatMeasurement(name, v)}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="measurement-input">
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
                        item_specifics: {
                          ...specifics,
                          [name]: e.target.value,
                        },
                      })
                    }
                  />
                  {isMeasurement(name) &&
                    !/mm\s*$/i.test(specifics[name] ?? "") && <span>mm</span>}
                </div>
              )}
              {isMeasurement(name) &&
                /rahmenbreite|fassungsbreite|gesamtbreite|glashöhe|scheibenhöhe/i.test(
                  name,
                ) &&
                !specifics[name]?.trim() && (
                  <small className="measurement-missing">
                    {l.frontMeasurement?.reasons?.join(" ") ||
                      "Maß fehlt – unter ‚Maße berechnen‘ prüfen."}
                  </small>
                )}
              {l.evidence?.[name]?.length ||
              l.estimates?.[name] ||
              (/^(Thema|Charakter)$/i.test(name) && l.style_tags_version) ? (
                <details className="aspect-evidence">
                  <summary>Analysehinweise</summary>
                  {/^(Thema|Charakter)$/i.test(name) && (
                    <small className="style-tag-note">
                      Stilvorschläge aus Form, Farbe und Design · keine Angabe
                      zum Herstellungsjahr.
                      {meta?.mode === "SELECTION_ONLY" &&
                        " Nur von eBay angebotene passende Werte sind möglich."}
                    </small>
                  )}
                  <div>
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
                  </div>
                </details>
              ) : null}
              {isSunglasses(l) &&
                /^(gläsermaterial|glasmaterial|linsenmaterial)$/i.test(
                  name,
                ) && (
                  <p className="note">
                    Vorgabe für Sonnenbrillen: Kunststoff. Bitte für diese
                    Brille prüfen und bei Bedarf ändern.
                  </p>
                )}
              {isSunglasses(l) && /^UV[- ]?Schutz$/i.test(name) && (
                <p className="note">
                  Shop-Vorgabe: UV400. Bitte für diese Brille prüfen; die
                  Fotoanalyse misst keinen UV-Schutz.
                </p>
              )}
            </div>
          );
          return field;
        })}
      </details>
      <details data-review-field="Fotos">
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
      <details open={shippingOpen} onToggle={event=>setShippingOpen(event.currentTarget.open)} className="shipping-details" data-review-field="Versand">
        <summary
          onClick={(event) => {
            event.preventDefault();
            setShippingOpen((open) => !open);
          }}
        >
          Versand und Rückgabe
        </summary>
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
      <details>
        <summary>Preisrecherche und KI-Analyse</summary>
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
      </details>
      {g.usage?.some((u) => u.stage === "analysis") && (
        <p className="note">
          Verwendetes Analysemodell:{" "}
          {g.usage.filter((u) => u.stage === "analysis").at(-1)?.model}
        </p>
      )}
      <AiUsageSummary
        rows={g.usage ?? []}
        label="Diese Brille · Listing und Vorbereitung (ohne gemeinsame Sortierung)"
      />
      <ModelComparison group={g} onEdit={onGroupEdit} />
      {draftIssues(g).length > 0 && (
        <ul aria-label="Noch zu prüfen">
          {draftIssues(g).map((i) => (
            <li key={i}>{issueField(i,[...names,"Glasbreite"]) ? (
              <button type="button" className="issue-link" onClick={event=>{
                const card=event.currentTarget.closest<HTMLElement>(".listing-card");
                const field=issueField(i,[...names,"Glasbreite"]);
                if(field === "Versand") setShippingOpen(true);
                if(card && field) focusReviewField(card,field);
              }}>{i}</button>
            ) : i}</li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}
