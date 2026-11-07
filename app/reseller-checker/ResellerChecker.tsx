"use client";
import { useEffect, useState } from "react";
import Checker from "../checker/Checker";
import { DEFAULT_AI_MODEL } from "@/lib/ai-defaults";
import {
  RESELLER_MODELS,
  RESELLER_PROVIDER_LABELS,
} from "@/lib/reseller-options";
export default function ResellerChecker() {
  const [model, setModel] = useState(DEFAULT_AI_MODEL),
    [key, setKey] = useState(""),
    [saved, setSaved] = useState<string | null>(null),
    [busy, setBusy] = useState(true),
    [message, setMessage] = useState("");
  const [revision, setRevision] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const provider =
    RESELLER_MODELS.find((m) => m.id === model)?.provider ?? "google";
  useEffect(() => {
    let active = true;
    fetch("/api/reseller-checker/session", { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw Error();
        return r.json();
      })
      .then((d) => {
        if (active && d.configured) {
          setSaved(d.model);
          setModel(d.model);
          setSettingsOpen(false);
        } else if (active) {
          setSettingsOpen(true);
        }
      })
      .catch(() => {
        if (active)
          setMessage(
            "KI-Einstellungen konnten nicht geladen werden. Bitte Seite neu laden.",
          );
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, []);
  async function save() {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch("/api/reseller-checker/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, key }),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setKey("");
      setSaved(model);
      setRevision((v) => v + 1);
      setSettingsOpen(false);
      setMessage(
        "KI-Zugang gespeichert. Er wird erst beim Erstellen eines Entwurfs verwendet.",
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Speichern fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }
  async function disconnect() {
    if (busy) return;
    setBusy(true);
    try {
      const r = await fetch("/api/reseller-checker/session", {
        method: "DELETE",
      });
      if (!r.ok) throw Error();
      setSaved(null);
      setSettingsOpen(true);
      setKey("");
      setMessage("KI-Zugang aus diesem Browser entfernt.");
    } catch {
      setMessage("Entfernen fehlgeschlagen. Bitte erneut versuchen.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Checker
        standalone
        enabled={Boolean(saved) && !busy}
        connectionVersion={`${saved ?? ""}:${revision}`}
      />
      <section
        id="ki-einstellungen"
        className="checker reseller-settings"
        aria-label="KI-Einstellungen"
      >
        <div className="checker-card">
          <details
            open={settingsOpen}
            onToggle={(e) => setSettingsOpen(e.currentTarget.open)}
          >
            <summary>
              KI-Einstellungen {saved ? "ändern" : "einrichten"}
            </summary>
            <h2>Eine KI für alle Aufgaben</h2>
            <p>
              Wähle eine KI und trage den passenden API-Schlüssel ein. Ein Link
              allein gibt niemandem Zugriff auf einen hinterlegten
              SnapList-Schlüssel.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              <label className="checker-field">
                KI-Modell
                <select
                  value={model}
                  disabled={busy}
                  onChange={(e) => {
                    setModel(e.target.value);
                    setKey("");
                  }}
                >
                  {RESELLER_MODELS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="checker-field">
                API-Schlüssel für {RESELLER_PROVIDER_LABELS[provider]}
                <input
                  type="password"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  minLength={16}
                  maxLength={512}
                  required
                  disabled={busy}
                />
              </label>
              <button
                className="btn btn-primary"
                disabled={busy || key.trim().length < 16}
              >
                {busy ? "Bitte warten…" : "KI-Zugang speichern"}
              </button>
            </form>
            {saved && (
              <>
                <button
                  className="btn btn-ghost"
                  disabled={busy}
                  onClick={() => void disconnect()}
                >
                  KI-Zugang entfernen
                </button>
              </>
            )}
            <p>
              Der Schlüssel wird verschlüsselt für höchstens 30 Tage in diesem
              Browser hinterlegt und danach nicht angezeigt. Auf einem anderen
              Gerät ist eine erneute Eingabe nötig. Personen mit Zugriff auf
              diesen Browser können den gespeicherten Zugang nutzen. Ein
              geteilter API-Schlüssel wird weiterhin über das Guthaben seines
              Besitzers abgerechnet.
            </p>
          </details>
          {saved && (
            <p role="status">
              Eingerichtet:{" "}
              {RESELLER_MODELS.find((m) => m.id === saved)?.name ?? saved}
            </p>
          )}
          <p role="status">{message}</p>
        </div>
      </section>
    </>
  );
}
