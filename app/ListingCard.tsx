"use client";

import { isGlasses } from "@/lib/glasses-rules";
import { DraftControls } from "./DraftControls";
import { draftIssues } from "@/lib/client-review";
import { useEffect, useMemo, useState } from "react";
import { SIZE_REQUIRED_CATEGORIES } from "@/lib/categories";
import type { ItemGroup, ListingResult, Photo } from "@/lib/types";

const TITLE_LIMIT = 80;

// eBay's pre-owned condition tiers, matching the values the model returns.
const CONDITIONS: { value: string; label: string }[] = [
  { value: "NEW_WITH_TAGS", label: "Neu mit Etikett" },
  { value: "NEW_NO_TAGS", label: "Neu ohne Etikett" },
  { value: "EXCELLENT", label: "Gebraucht · ausgezeichnet" },
  { value: "VERY_GOOD", label: "Gebraucht · sehr gut" },
  { value: "GOOD", label: "Gebraucht · gut" },
  { value: "FAIR", label: "Gebraucht · akzeptabel" },
  { value: "FOR_PARTS_OR_NOT_WORKING", label: "Defekt / Ersatzteile" },
];

function formatPrice(value: ListingResult["suggested_price"]): string {
  const n = typeof value === "string" ? parseFloat(value) : value;
  if (n === undefined || Number.isNaN(n)) return "0,00 €";
  return `${n.toFixed(2)} €`;
}

function priceToInput(value: ListingResult["suggested_price"]): string {
  const n = typeof value === "string" ? parseFloat(value) : value;
  return n === undefined || Number.isNaN(n) ? "" : String(n);
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <button
      type="button"
      className="btn-ghost"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
        } catch {
          /* clipboard blocked */
        }
      }}
    >
      {copied ? "✓ Kopiert" : `📋 ${label} kopieren`}
    </button>
  );
}

interface ListingCardProps {
  group: ItemGroup;
  photoById: (id: string) => Photo | undefined;
  ebayConnected: boolean;
  onGroupEdit: (id: string, patch: Partial<ItemGroup>) => void;
  onEdit: (groupId: string, patch: Partial<ListingResult>) => void;
  onRenameSku: (groupId: string, sku: string) => void;
  onRetry: (groupId: string) => void;
  onSaveDraft: () => Promise<void>;
  onPost: (groupId: string, mode?: "verify" | "publish") => void;
}

export function ListingCard({
  group,
  photoById,
  ebayConnected,
  onEdit,
  onGroupEdit,
  onRenameSku,
  onRetry,
  onPost,
  onSaveDraft,
}: ListingCardProps) {
  const [open, setOpen] = useState(true);
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftNotice, setDraftNotice] = useState("");
  useEffect(
    () => setDraftNotice(""),
    [group.listing, group.shipping, group.sku, group.photoIds],
  );
  const save = async () => {
    setSavingDraft(true);
    setDraftNotice("");
    try {
      await onSaveDraft();
      setDraftNotice(
        "Entwurf auf diesem Gerät gespeichert. Nicht an eBay übertragen.",
      );
    } catch {
      setDraftNotice(
        "Speichern fehlgeschlagen. Bitte diesen Tab offen lassen und erneut versuchen.",
      );
    } finally {
      setSavingDraft(false);
    }
  };
  const listing = group.listing;
  const cover = photoById(group.photoIds[0]);

  const specifics = useMemo(() => {
    const entries = Object.entries(listing?.item_specifics ?? {});
    return entries.filter(
      ([k, v]) => v && String(v).trim() !== "" && !k.startsWith("---"),
    );
  }, [listing?.item_specifics]);

  const titleLen = listing?.title?.length ?? 0;

  // eBay's size standardization blocks apparel/footwear listings that are
  // missing a Size, so flag those for the seller before they post.
  const sizeRequired = SIZE_REQUIRED_CATEGORIES.has(listing?.category ?? "");
  const sizeMissing = sizeRequired && !(listing?.size ?? "").trim();

  // Publishing refuses a missing/zero price (no more invented defaults), so
  // flag it here the same way size is flagged — before the seller hits Post.
  const priceNum =
    typeof listing?.suggested_price === "string"
      ? parseFloat(listing.suggested_price)
      : listing?.suggested_price;
  const priceMissing =
    group.status === "done" &&
    (priceNum === undefined || Number.isNaN(priceNum) || priceNum <= 0);

  return (
    <article className={`listing-card status-${group.status}`}>
      <header className="listing-card-head" onClick={() => setOpen((o) => !o)}>
        {cover && (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="listing-cover" src={cover.previewUrl} alt="" />
        )}
        <div className="listing-card-title">
          <strong>
            {group.sku && <span className="sku-tag">{group.sku}</span>}
            {listing?.title || group.name}
          </strong>
          <span className="listing-card-sub">
            {group.status === "writing" && (
              <>
                <span className="spinner small" aria-hidden="true" /> Wird
                erstellt…
              </>
            )}
            {group.status === "done" &&
              (priceMissing ? (
                <span style={{ color: "var(--color-danger)" }}>
                  ⚠️ Preis fehlt
                </span>
              ) : (
                <>
                  {formatPrice(listing?.suggested_price)} ·{" "}
                  {group.postStatus === "posted"
                    ? "Bei eBay veröffentlicht"
                    : draftIssues(group).length
                      ? "Bitte prüfen"
                      : "Bereit"}
                </>
              ))}
            {group.status === "error" && (
              <span style={{ color: "var(--color-danger)" }}>
                ⚠️ {group.error || "Failed"}
              </span>
            )}
            {group.status === "idle" && "Wartet…"}
          </span>
        </div>
        {group.status === "error" ? (
          <button
            type="button"
            className="btn-ghost"
            onClick={(e) => {
              e.stopPropagation();
              onRetry(group.id);
            }}
          >
            ↻ Erneut versuchen
          </button>
        ) : (
          <span className="chevron" aria-hidden="true">
            {open ? "▾" : "▸"}
          </span>
        )}
      </header>

      {open && listing && group.status === "done" && (
        <fieldset
          className="listing-card-body"
          disabled={
            savingDraft ||
            group.postStatus === "posted" ||
            group.postStatus === "posting"
          }
        >
          <div className="result-field">
            <label>
              Titel
              <span className={`count${titleLen > TITLE_LIMIT ? " over" : ""}`}>
                {titleLen}/{TITLE_LIMIT}
              </span>
            </label>
            <input
              type="text"
              className="title-input"
              value={listing.title}
              onChange={(e) => onEdit(group.id, { title: e.target.value })}
            />
            <div className="copy-row">
              <CopyButton text={listing.title} label="Titel" />
            </div>
          </div>

          <div className="meta-row">
            {/* SKU stays editable up until the item is posted, so a SKU fix
                never requires going back and re-writing listings (issue #30). */}
            <div className="stat editable">
              <label className="k" htmlFor={`sku-${group.id}`}>
                SKU
              </label>
              <input
                id={`sku-${group.id}`}
                type="text"
                className="size-input"
                value={group.sku}
                disabled={group.postStatus === "posted"}
                onChange={(e) => onRenameSku(group.id, e.target.value)}
              />
            </div>
            <div
              className={`stat editable${priceMissing ? " needs-attention" : ""}`}
            >
              <label className="k" htmlFor={`price-${group.id}`}>
                Preis
              </label>
              <div className="price-input">
                <span aria-hidden="true">€</span>
                <input
                  id={`price-${group.id}`}
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={priceToInput(listing.suggested_price)}
                  onChange={(e) =>
                    onEdit(group.id, {
                      suggested_price:
                        e.target.value === "" ? "" : Number(e.target.value),
                    })
                  }
                />
              </div>
              {group.comps?.ok && group.comps.median !== undefined && (
                <span className="comps-line" title={group.comps.basis}>
                  Markt: {group.comps.count} ähnliche aktive Angebote, €
                  {group.comps.low?.toFixed(0)}–€{group.comps.high?.toFixed(0)}
                  {" · "}
                  <button
                    type="button"
                    className="comps-use"
                    onClick={() =>
                      onEdit(group.id, {
                        suggested_price:
                          group.comps!.listPrice ?? group.comps!.median,
                      })
                    }
                  >
                    {/* listPrice = median + the deployment's storewide markup */}
                    {group.comps.listPrice !== undefined
                      ? `use €${group.comps.listPrice.toFixed(2)} (median + markup)`
                      : `use median €${group.comps.median.toFixed(2)}`}
                  </button>
                </span>
              )}
            </div>
            <div className="stat editable">
              <label className="k" htmlFor={`cond-${group.id}`}>
                Zustand
              </label>
              <select
                id={`cond-${group.id}`}
                value={listing.condition ?? "GOOD"}
                onChange={(e) =>
                  onEdit(group.id, {
                    condition: e.target.value,
                    ebay_condition: "",
                  })
                }
              >
                {/* Keep an unexpected model value selectable rather than losing it. */}
                {listing.condition &&
                  !CONDITIONS.some((c) => c.value === listing.condition) && (
                    <option value={listing.condition}>
                      {listing.condition.replace(/_/g, " ")}
                    </option>
                  )}
                {CONDITIONS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            {listing.brand && (
              <div className="stat">
                <div className="k">Marke</div>
                <div className="v">{listing.brand}</div>
              </div>
            )}
            {(sizeRequired || listing.size) &&
              (!isGlasses(listing) ||
                group.preparation?.aspects.some((a) => a.name === "Größe")) && (
                <div
                  className={`stat editable${sizeMissing ? " needs-attention" : ""}`}
                >
                  <label className="k" htmlFor={`size-${group.id}`}>
                    Größe
                  </label>
                  <input
                    id={`size-${group.id}`}
                    type="text"
                    className="size-input"
                    value={listing.size ?? ""}
                    placeholder={sizeRequired ? "e.g. M, 32x34, 10.5" : "—"}
                    onChange={(e) => onEdit(group.id, { size: e.target.value })}
                  />
                </div>
              )}
          </div>

          {sizeMissing && (
            <p className="size-warning" role="alert">
              ⚠️ No size found on the tag. eBay now blocks apparel listings
              without a standard size — check the photos or measure the item,
              then fill in Size above before posting.
            </p>
          )}

          {priceMissing && (
            <p className="size-warning" role="alert">
              ⚠️ No price yet — the analysis couldn&rsquo;t estimate one for
              this item. Set a price above before posting
              {group.comps?.ok ? " (see the market check under Price)" : ""}.
            </p>
          )}

          {group.postStatus === "posted" && (
            <p className="note">
              Dieses Angebot wurde bereits veröffentlicht. Änderungen jetzt
              direkt bei eBay vornehmen; Shop-Vorgaben ändern dieses Angebot
              nicht.
            </p>
          )}
          <div className="result-field">
            <label htmlFor={`description-${group.id}`}>Beschreibung</label>
            <textarea
              id={`description-${group.id}`}
              value={listing.description}
              onChange={(e) =>
                onEdit(group.id, { description: e.target.value })
              }
              rows={8}
            />
            <div className="copy-row">
              <CopyButton text={listing.description} label="Beschreibung" />
            </div>
          </div>

          <button type="button" onClick={() => onRetry(group.id)}>
            Ausgewählte Fotos neu analysieren (ersetzt diesen Entwurf)
          </button>
          <DraftControls
            group={group}
            photoById={photoById}
            onGroupEdit={onGroupEdit}
          />
          {group.postStatus !== "posted" && (
            <div className="draft-save-row">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={save}
                disabled={savingDraft || group.postStatus === "posting"}
              >
                {savingDraft ? "Wird gespeichert…" : "Entwurf speichern"}
              </button>
              <p className="post-hint">
                In SNAPLIST auf diesem Gerät. Änderungen werden auch automatisch
                gespeichert.
              </p>
              {draftNotice && <p role="status">{draftNotice}</p>}
            </div>
          )}
          {/* eBay posting */}
          {group.postStatus === "posted" ? (
            <>
              <p className="post-result ok">
                ✅ Bei eBay veröffentlicht
                {group.listingId ? (
                  <>
                    {" "}
                    ·{" "}
                    <a
                      href={`https://www.ebay.de/itm/${group.listingId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Angebot bei eBay öffnen ↗
                    </a>
                  </>
                ) : null}
              </p>
              {(group.postWarnings ?? []).map((w) => (
                <p className="post-result warn" key={w}>
                  ⚠️ {w}
                </p>
              ))}
            </>
          ) : ebayConnected ? (
            <div className="post-row">
              <button
                type="button"
                className="btn-ghost"
                onClick={() => onPost(group.id, "verify")}
                disabled={
                  group.postStatus === "posting" ||
                  draftIssues(group).length > 0
                }
              >
                Bei eBay prüfen · nicht veröffentlichen
              </button>
              {group.verificationMessage && (
                <p role="status">{group.verificationMessage}</p>
              )}
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => onPost(group.id)}
                disabled={
                  group.postStatus === "posting" ||
                  draftIssues(group).length > 0
                }
              >
                {group.postStatus === "posting" ? (
                  <>
                    <span className="spinner" aria-hidden="true" /> eBay-Anfrage
                    läuft…
                  </>
                ) : (
                  "Auf eBay.de veröffentlichen…"
                )}
              </button>
              {group.postStatus === "error" && group.postError && (
                <p className="post-result err">⚠️ {group.postError}</p>
              )}
            </div>
          ) : (
            <p className="post-hint">
              Verbinde oben dein eBay-Konto, um dieses Angebot zu
              veröffentlichen.
            </p>
          )}
        </fieldset>
      )}
    </article>
  );
}
