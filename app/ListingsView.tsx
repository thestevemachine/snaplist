"use client";

import { useEffect, useRef, useState, Fragment } from "react";
import { planBatchSkus } from "@/lib/batch-sku";
import { draftIssues } from "@/lib/client-review";
import { ListingCard } from "./ListingCard";
import { downloadFile, listingsToCsv, listingsToJson } from "@/lib/export";
import {
  loadAccountOptions,
  clearAccountOptions,
} from "@/lib/account-options-client";
import type { AccountOptions } from "@/lib/ebay/publish";
import type { QueueProgress } from "@/lib/batch-queue";
import type { ItemGroup, ListingResult, Photo } from "@/lib/types";

interface ListingsViewProps {
  groups: ItemGroup[];
  photoById: (id: string) => Photo | undefined;
  ebayConnected: boolean;
  onGroupEdit: (id: string, patch: Partial<ItemGroup>) => void;
  onEdit: (groupId: string, patch: Partial<ListingResult>) => void;
  onRenameSku: (groupId: string, sku: string) => void;
  onNumberSkus: (first: string) => number;
  onRetry: (groupId: string) => void;
  onPost: (groupId: string, mode?: "verify" | "publish") => void;
  onSaveDraft: () => Promise<void>;
  onPostAll: (ids?: string[]) => void;
  onWriteAll: () => void;
  onResume: () => void;
  queue:
    | (QueueProgress & {
        kind: "write" | "post";
        running: boolean;
        paused: boolean;
      })
    | null;
  onPause: () => void;
  onBack: () => void;
}
const editable = (g: ItemGroup) =>
  g.status === "done" &&
  g.postStatus !== "posted" &&
  g.postStatus !== "posting";
export function ListingsView(props: ListingsViewProps) {
  const {
    groups,
    photoById,
    ebayConnected,
    onEdit,
    onGroupEdit,
    onRenameSku,
    onRetry,
    onPost,
    onPostAll,
    onBack,
    queue,
  } = props;
  const [firstSku, setFirstSku] = useState("");
  const [skuMessage, setSkuMessage] = useState("");
  let skuPreview = "";
  if (firstSku.trim()) {
    try {
      const rows = planBatchSkus(groups, firstSku);
      skuPreview = `${rows[0].sku} bis ${rows[rows.length - 1].sku} (${rows.length} offene Angebote)`;
    } catch (e) {
      skuPreview = (e as Error).message;
    }
  }
  const [table, setTable] = useState(groups.length > 1);
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [options, setOptions] = useState<AccountOptions>();
  const [optionsError, setOptionsError] = useState("");
  const [bulkShipping, setBulkShipping] = useState("");
  const [bulkCondition, setBulkCondition] = useState("");
  const [bulkNotice, setBulkNotice] = useState("");
  const latest = useRef(props);
  latest.current = props;
  useEffect(() => {
    let active = true;
    const load = async () => {
      setOptions(undefined);
      try {
        const value = await loadAccountOptions();
        if (active) {
          setOptions(value);
          setOptionsError("");
        }
      } catch (e) {
        if (active) setOptionsError((e as Error).message);
      }
    };
    if (ebayConnected) void load();
    else setOptions(undefined);
    const changed = () => {
      clearAccountOptions();
      void load();
    };
    window.addEventListener("ebay-connection-changed", changed);
    return () => {
      active = false;
      window.removeEventListener("ebay-connection-changed", changed);
    };
  }, [ebayConnected]);
  const issues = (g: ItemGroup) => {
    const result = draftIssues(g);
    if (groups.some((other) => other.id !== g.id && other.sku === g.sku))
      result.push("Diese SKU ist bereits bei einem anderen Artikel vergeben.");
    return result;
  };
  const ready = groups.filter((g) => editable(g) && !issues(g).length);
  const done = groups.filter((g) => g.status === "done").length;
  const posted = groups.filter((g) => g.postStatus === "posted").length;
  const active =
    Boolean(queue?.running) || groups.some((g) => g.postStatus === "posting");
  const remaining = groups.filter(
    (g) => !g.cloudBatchId && (g.status === "idle" || g.status === "error"),
  ).length;
  const visible = groups.filter(
    (g) =>
      filter === "all" ||
      (filter === "ready"
        ? ready.includes(g)
        : filter === "posted"
          ? g.postStatus === "posted"
          : g.postStatus !== "posted" &&
            (g.status === "error" ||
              g.postStatus === "error" ||
              (g.status === "done" && issues(g).length > 0))),
  );
  const lastPage = Math.max(0, Math.ceil(visible.length / 25) - 1);
  const currentPage = Math.min(page, lastPage);
  const rows = visible.slice(currentPage * 25, currentPage * 25 + 25);
  const chosen = groups.filter((g) => selected.has(g.id) && editable(g));
  const conditions = [
    ...new Map(
      groups
        .flatMap((g) => g.preparation?.conditions ?? [])
        .map((c) => [c.value, c]),
    ).values(),
  ];
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const card = (group: ItemGroup) => (
    <ListingCard
      key={group.id}
      group={group}
      photoById={photoById}
      ebayConnected={ebayConnected}
      onEdit={onEdit}
      onGroupEdit={onGroupEdit}
      onRenameSku={onRenameSku}
      onRetry={onRetry}
      onPost={onPost}
      onSaveDraft={props.onSaveDraft}
    />
  );
  return (
    <section className="panel" aria-labelledby="listings-heading">
      <div className="result-head">
        <h3 id="listings-heading">Deine Angebote</h3>
        <span className="badge">
          {done}/{groups.length} Entwürfe erstellt · {ready.length} bereit ·{" "}
          {posted} veröffentlicht
        </span>
      </div>
      <fieldset disabled={active} className="sku-sequence">
        <legend>Fortlaufende SKU für diesen Stapel</legend>
        <label htmlFor="first-batch-sku">Erste SKU</label>
        <input
          id="first-batch-sku"
          value={firstSku}
          placeholder="z. B. 5-23001"
          onChange={(e) => {
            setFirstSku(e.target.value);
            setSkuMessage("");
          }}
        />
        <p>
          Die Zahl am Ende wird für jedes offene Angebot um 1 erhöht, in der
          Reihenfolge des gesamten Stapels. Veröffentlichte oder bereits zur
          Veröffentlichung gesendete Artikel bleiben unverändert.
        </p>
        {skuPreview && <p>{skuPreview}</p>}
        <button
          className="btn btn-ghost"
          type="button"
          disabled={!firstSku.trim()}
          onClick={() => {
            try {
              const count = props.onNumberSkus(firstSku);
              setSkuMessage(`SKU für ${count} offene Angebote übernommen.`);
            } catch (e) {
              setSkuMessage((e as Error).message);
            }
          }}
        >
          SKU fortlaufend übernehmen
        </button>
        {skuMessage && <p role="status">{skuMessage}</p>}
      </fieldset>
      <div className="batch-toolbar">
        <button type="button" onClick={() => setTable(!table)}>
          {table ? "Detailkarten" : "Stapeltabelle"}
        </button>
        <label>
          Anzeigen{" "}
          <select
            aria-label="Anzeigen"
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setPage(0);
            }}
          >
            <option value="all">Alle Artikel</option>
            <option value="attention">Bitte prüfen</option>
            <option value="ready">Bereit zur Veröffentlichung</option>
            <option value="posted">Veröffentlicht</option>
          </select>
        </label>
        {remaining > 0 && (
          <button type="button" disabled={active} onClick={props.onWriteAll}>
            {remaining} verbleibende Entwürfe erstellen / erneut versuchen
          </button>
        )}
      </div>
      {queue && (
        <div className="batch-progress" aria-live="polite">
          <span>
            {queue.kind === "write" ? "Writing" : "Publishing"}:{" "}
            {queue.completed}/{queue.total} Versuche abgeschlossen ·{" "}
            {(queue.elapsedMs / 60000).toFixed(1)} min
            {queue.paused
              ? queue.running
                ? " · Pausing after active items finish"
                : " · Paused"
              : queue.running
                ? " · Running"
                : " · Finished"}
          </span>
          <progress
            value={queue.completed}
            max={queue.total}
            aria-label="Stapel-Fortschritt"
          />
          {queue.running ? (
            <button
              type="button"
              disabled={queue.paused}
              onClick={props.onPause}
            >
              Stapel pausieren
            </button>
          ) : (
            queue.paused && (
              <button type="button" onClick={props.onResume}>
                Stapel fortsetzen
              </button>
            )
          )}
          <small>
            Keep this tab open while processing. Saved unfinished drafts can be
            resumed after reopening.
          </small>
        </div>
      )}
      {optionsError && (
        <p className="note note-error">
          Policies: {optionsError}{" "}
          <button
            type="button"
            onClick={() =>
              void loadAccountOptions(true)
                .then((o) => {
                  setOptions(o);
                  setOptionsError("");
                })
                .catch((e) => setOptionsError(e.message))
            }
          >
            Rahmenbedingungen erneut laden
          </button>
        </p>
      )}
      {table && (
        <div className="batch-toolbar">
          <button
            type="button"
            onClick={() =>
              setSelected(new Set(visible.filter(editable).map((g) => g.id)))
            }
          >
            Alle {visible.filter(editable).length} angezeigten Artikel auswählen
          </button>
          <button type="button" onClick={() => setSelected(new Set())}>
            Auswahl aufheben
          </button>
          <span>{chosen.length} ausgewählt</span>
          <label>
            Versand für Auswahl{" "}
            <select
              aria-label="Versand für Auswahl"
              value={bulkShipping}
              onChange={(e) => setBulkShipping(e.target.value)}
            >
              <option value="">Versandregel auswählen</option>
              {options?.fulfillment.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={!chosen.length || !bulkShipping || active}
            onClick={() => {
              for (const g of chosen)
                onGroupEdit(g.id, {
                  shipping: {
                    ...g.shipping,
                    fulfillmentPolicyId: bulkShipping,
                  },
                });
              setBulkNotice(`Shipping updated for ${chosen.length} items.`);
            }}
          >
            Versand übernehmen
          </button>
          <label>
            Zustand für Auswahl{" "}
            <select
              aria-label="Zustand für Auswahl"
              value={bulkCondition}
              onChange={(e) => setBulkCondition(e.target.value)}
            >
              <option value="">Zustand auswählen</option>
              {conditions.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={!chosen.length || !bulkCondition || active}
            onClick={() => {
              let count = 0;
              for (const g of chosen)
                if (
                  g.preparation?.conditions.some(
                    (c) => c.value === bulkCondition,
                  )
                ) {
                  onEdit(g.id, { ebay_condition: bulkCondition });
                  count++;
                }
              setBulkNotice(
                `Condition updated for ${count} items. ${chosen.length - count} skipped because the category does not support it. Review descriptions for consistency.`,
              );
            }}
          >
            Zustand übernehmen
          </button>
        </div>
      )}
      {bulkNotice && <p aria-live="polite">{bulkNotice}</p>}
      {ebayConnected && ready.length > 0 && (
        <p>
          Für den ersten Test eine Brille in „Detailkarten“ öffnen, bei eBay
          prüfen und einzeln veröffentlichen.
        </p>
      )}
      {table ? (
        <div className="batch-table-scroll">
          <table className="batch-table">
            <thead>
              <tr>
                <th>Auswahl / Foto</th>
                <th>Titel / SKU</th>
                <th>Größe</th>
                <th>Zustand</th>
                <th>Preis</th>
                <th>Versand</th>
                <th>Status / Details</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((g) => {
                const l = g.listing,
                  locked = !editable(g),
                  problems = issues(g),
                  cover = photoById(g.photoIds[0]);
                return (
                  <Fragment key={g.id}>
                    <tr>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Auswahl ${g.sku}`}
                          checked={selected.has(g.id)}
                          disabled={locked}
                          onChange={() => toggle(g.id)}
                        />
                        {cover && (
                          <img
                            loading="lazy"
                            src={cover.previewUrl}
                            alt={g.name}
                            width="64"
                            height="64"
                          />
                        )}
                      </td>
                      <td>
                        {l ? (
                          <textarea
                            aria-label={`Titel ${g.sku}`}
                            value={l.title}
                            disabled={locked}
                            onChange={(e) =>
                              onEdit(g.id, { title: e.target.value })
                            }
                          />
                        ) : (
                          g.name
                        )}
                        <small>
                          {g.sku}
                          {l ? ` · ${l.title.length}/80` : ""}
                        </small>
                      </td>
                      <td>
                        <input
                          aria-label={`Größe ${g.sku}`}
                          value={l?.size ?? ""}
                          disabled={locked}
                          onChange={(e) =>
                            onEdit(g.id, { size: e.target.value })
                          }
                        />
                        <small>{l?.item_specifics?.["Size Type"]}</small>
                      </td>
                      <td>
                        <select
                          aria-label={`Zustand ${g.sku}`}
                          value={l?.ebay_condition ?? ""}
                          disabled={locked}
                          onChange={(e) =>
                            onEdit(g.id, { ebay_condition: e.target.value })
                          }
                        >
                          <option value="">Auswählen</option>
                          {g.preparation?.conditions.map((c) => (
                            <option key={c.value} value={c.value}>
                              {c.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          aria-label={`Preis ${g.sku}`}
                          inputMode="decimal"
                          value={l?.suggested_price ?? ""}
                          disabled={locked}
                          onChange={(e) =>
                            onEdit(g.id, { suggested_price: e.target.value })
                          }
                        />
                        <small>
                          {g.comps?.count
                            ? `${g.comps.count} asking-price matches`
                            : "Ungeprüfte Schätzung"}
                        </small>
                      </td>
                      <td>
                        <select
                          aria-label={`Versand ${g.sku}`}
                          value={g.shipping?.fulfillmentPolicyId ?? ""}
                          disabled={locked || !options}
                          onChange={(e) =>
                            onGroupEdit(g.id, {
                              shipping: {
                                ...g.shipping,
                                fulfillmentPolicyId: e.target.value,
                              },
                            })
                          }
                        >
                          <option value="">Auswählen</option>
                          {options?.fulfillment.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <strong>
                          {g.postStatus === "posted"
                            ? "Bei eBay veröffentlicht"
                            : g.postStatus === "posting"
                              ? "Wird veröffentlicht…"
                              : g.status === "writing"
                                ? "Wird erstellt…"
                                : g.status === "idle"
                                  ? "Waiting"
                                  : g.status === "error" ||
                                      g.postStatus === "error"
                                    ? "Fehlgeschlagen – erneut versuchen"
                                    : problems.length
                                      ? `${problems.length} to fix`
                                      : "Ready"}
                        </strong>
                        {g.error && <small>{g.error}</small>}
                        {g.postError && <small>{g.postError}</small>}
                        {g.status === "done" &&
                          g.postStatus !== "posted" &&
                          problems.length > 0 && <small>{problems[0]}</small>}
                        <button
                          type="button"
                          aria-expanded={expanded === g.id}
                          onClick={() =>
                            setExpanded(expanded === g.id ? null : g.id)
                          }
                        >
                          {expanded === g.id
                            ? "Details schließen"
                            : "Details prüfen"}
                        </button>
                      </td>
                    </tr>
                    {expanded === g.id && (
                      <tr>
                        <td colSpan={7}>{card(g)}</td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="listing-list">{rows.map(card)}</div>
      )}
      <div className="batch-toolbar">
        <button
          type="button"
          disabled={currentPage === 0}
          onClick={() => setPage(currentPage - 1)}
        >
          Previous 25
        </button>
        <span>
          {visible.length ? currentPage * 25 + 1 : 0}–
          {Math.min(visible.length, (currentPage + 1) * 25)} of {visible.length}
        </span>
        <button
          type="button"
          disabled={currentPage >= lastPage}
          onClick={() => setPage(currentPage + 1)}
        >
          Next 25
        </button>
      </div>
      <div className="result-actions">
        <button
          type="button"
          className="btn btn-ghost"
          disabled={active}
          onClick={onBack}
        >
          ← Back to items
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={!done}
          onClick={() =>
            downloadFile("ebay-listings.csv", listingsToCsv(groups), "text/csv")
          }
        >
          ⬇️ Download spreadsheet (CSV)
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!done}
          onClick={() =>
            downloadFile(
              "ebay-listings.json",
              listingsToJson(groups),
              "application/json",
            )
          }
        >
          ⬇️ Download all ({done})
        </button>
      </div>
      <p className="footnote">
        Ready means required fields are filled. Review accuracy before posting.
        Your usual defaults are applied automatically; change them for
        exceptions.
      </p>
    </section>
  );
}
