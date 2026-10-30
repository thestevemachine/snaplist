"use client";
import { useState, useEffect } from "react";
import type { AccountOptions } from "@/lib/ebay/publish";
import type { ItemGroup } from "@/lib/types";
import { loadAccountOptions } from "@/lib/account-options-client";
import {
  emptyPreferences,
  policyFields,
  readShopPreferences,
  saveShopPreferences,
  validPolicyDefaults,
  type ShopPreferences,
} from "@/lib/shop-preferences";
import { glassesTemplate } from "@/lib/glasses-template";

export function ShopSettings({
  groups,
  disabled,
  onApply,
}: {
  groups: ItemGroup[];
  disabled: boolean;
  onApply: (settings: ShopPreferences, options: AccountOptions) => number;
}) {
  const [options, setOptions] = useState<AccountOptions>();
  const [settings, setSettings] = useState(emptyPreferences);
  const [saved, setSaved] = useState(emptyPreferences);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function load() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const next = await loadAccountOptions(true);
      if (!next.sellerKey)
        throw new Error(
          "eBay-Konto konnte nicht eindeutig erkannt werden. Bitte erneut laden.",
        );
      setOptions(next);
      const stored = readShopPreferences(next.sellerKey);
      setSettings(stored);
      setSaved(stored);
      setLoaded(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    let active = true;
    const restore = async () => {
      setLoaded(false);
      setOptions(undefined);
      try {
        const status = await (
          await fetch("/api/ebay/status", { cache: "no-store" })
        ).json();
        if (!status.connected) return;
        const next = await loadAccountOptions();
        if (!active || !next.sellerKey) return;
        const stored = readShopPreferences(next.sellerKey);
        setOptions(next);
        setSettings(stored);
        setSaved(stored);
        setLoaded(true);
      } catch {
        if (active)
          setError(
            "Gespeicherte Vorgaben konnten nicht bestätigt werden. Bitte Konto und Vorgaben laden.",
          );
      }
    };
    void restore();
    window.addEventListener("ebay-connection-changed", restore);
    return () => {
      active = false;
      window.removeEventListener("ebay-connection-changed", restore);
    };
  }, []);
  function validate() {
    if (!options?.sellerKey)
      throw new Error("Bitte zuerst das eBay-Konto laden.");
    const valid = validPolicyDefaults(settings, options);
    if (policyFields.some(([, key]) => !valid[key]))
      throw new Error(
        "Bitte alle drei Rahmenbedingungen und den Artikelstandort auswählen.",
      );
    return options;
  }
  function action(apply: boolean) {
    setError("");
    setMessage("");
    try {
      const account = validate();
      if (apply) {
        const count = onApply(settings, account);
        setMessage(
          `Vorgaben auf ${count} unveröffentlichte Entwürfe angewendet. Bitte die Detailkarten prüfen.`,
        );
      } else {
        saveShopPreferences(account.sellerKey!, settings);
        setSaved(settings);
        setMessage(
          "Vorgaben für künftige Batches auf diesem Gerät gespeichert. Bestehende Karten bleiben unverändert.",
        );
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <>
      <details
        className="panel saved-shop-summary"
        aria-label="Gespeicherte Shop-Vorgaben"
        style={{ marginBottom: "1rem" }}
      >
        <summary><strong>
          {loaded
            ? "Gespeicherte Vorgaben für " +
              (options?.sellerName || "dieses Konto")
            : (error || "Shop-Vorgaben noch nicht bestätigt – Konto wird geprüft.")}
        </strong></summary>
        {loaded && options && (
          <>
            <p>
              {policyFields.every(
                ([, key]) => validPolicyDefaults(saved, options)[key],
              )
                ? "Rahmenbedingungen gespeichert – für neue Angebote musst du sie nicht erneut auswählen."
                : "Rahmenbedingungen noch unvollständig oder nicht mehr verfügbar – bitte unten ergänzen."}
            </p>
            <dl>
              {policyFields.map(([kind, key, label]) => (
                <div key={key}>
                  <dt>{label}</dt>
                  <dd>
                    {options[kind].find((o) => o.id === saved.shipping[key])
                      ?.name || "Nicht voreingestellt"}
                  </dd>
                </div>
              ))}
            </dl>
            <p>
              Beschreibungsvorlage:{" "}
              <strong>
                {saved.descriptionTemplate.trim()
                  ? "Gespeichert"
                  : "Noch nicht hinterlegt"}
              </strong>
            </p>
            <small>
              Gilt für neue Angebote. Bestehende Karten behalten ihre eigenen
              Einstellungen.
            </small>
          </>
        )}
      </details>
      <details className="panel shop-settings" style={{ marginBottom: "1rem" }}>
        <summary>
          <strong>Shop- und Batch-Vorgaben</strong>
        </summary>
        <p>
          Einmal auswählen, für künftige Angebote verwenden. Gespeichert pro
          eBay-Konto in diesem Browser; Änderungen bleiben in jeder Detailkarte
          möglich.
        </p>
        <fieldset disabled={disabled || busy}>
          <button
            className="btn btn-ghost"
            type="button"
            onClick={() => void load()}
          >
            eBay-Konto und Vorgaben laden
          </button>
          {options && (
            <>
              <p>
                Verbundenes eBay-Konto: <strong>{options.sellerName}</strong>
              </p>
              <p className="note">
                Ein anderer Verkäufer benötigt seinen eigenen eBay-Zugang. Diese
                Einstellungen wechseln das verbundene Konto nicht.
              </p>
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => {
                  const saved = groups.find((g) =>
                    policyFields.every(([, key]) => g.shipping?.[key]),
                  );
                  if (!saved) {
                    setError(
                      "Keine Karte mit vollständig ausgewählten Rahmenbedingungen vorhanden.",
                    );
                    return;
                  }
                  setSettings((s) => ({
                    ...s,
                    shipping: validPolicyDefaults(
                      { ...s, shipping: saved.shipping! },
                      options,
                    ),
                  }));
                }}
              >
                Rahmenbedingungen aus vorhandener Karte übernehmen
              </button>
              {policyFields.map(([kind, key, label]) => (
                <label
                  key={key}
                  style={{ display: "block", marginTop: ".7rem" }}
                >
                  {label} als Standard
                  <select
                    aria-label={`${label} als Standard`}
                    value={settings.shipping[key] ?? ""}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        shipping: { ...s.shipping, [key]: e.target.value },
                      }))
                    }
                  >
                    <option value="">Bitte auswählen…</option>
                    {settings.shipping[key] &&
                      !options[kind].some(
                        (o) => o.id === settings.shipping[key],
                      ) && (
                        <option value={settings.shipping[key]}>
                          Nicht mehr verfügbar – neu auswählen
                        </option>
                      )}
                    {options[kind].map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              <p>
                <strong>Vorgaben für neue Brillen:</strong> Neu ohne Etikett ·
                EAN: Nicht zutreffend. In jeder Karte änderbar.
              </p>
              <label style={{ display: "block" }}>
                Beschreibungsvorlage (Deutsch / Englisch)
                <textarea
                  aria-label="Beschreibungsvorlage"
                  rows={12}
                  maxLength={10000}
                  style={{ width: "100%" }}
                  value={settings.descriptionTemplate}
                  onChange={(e) =>
                    setSettings((s) => ({
                      ...s,
                      descriptionTemplate: e.target.value,
                    }))
                  }
                />
              </label>
              <p className="note">
                Leer lassen für den individuellen Text. Mit {"{{beschreibung}}"}{" "}
                fügst du den individuellen Text ein, mit {"{{titel}}"} den
                Titel. Ohne Platzhalter wird nur deine Vorlage verwendet. Die
                fertige Beschreibung ist in der Karte vollständig editierbar.
              </p>
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() =>
                  setSettings((s) => ({
                    ...s,
                    descriptionTemplate: glassesTemplate,
                  }))
                }
              >
                Stefans DE/EN-Brillentext einsetzen
              </button>
              <p>
                <button
                  className="btn btn-ghost"
                  type="button"
                  onClick={() => action(false)}
                >
                  Als Standard für künftige Batches speichern
                </button>
              </p>
              <p>
                Die folgende Aktion ersetzt Zustand, EAN und ausgewählte
                Rahmenbedingungen in allen unveröffentlichten Karten. Eine
                ausgefüllte Beschreibungsvorlage wird ebenfalls übernommen.
                Bereits veröffentlichte Angebote bleiben unverändert.
              </p>
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => action(true)}
              >
                Vorgaben auf aktuellen Batch anwenden
              </button>
            </>
          )}
        </fieldset>
        {message && <p role="status">{message}</p>}
        {error && (
          <p role="alert" className="note-error">
            {error}
          </p>
        )}
      </details>
    </>
  );
}
