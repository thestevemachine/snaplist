"use client";

import { useEffect, useState } from "react";
import {
  getAnalysisModel,
  getSortModel,
  saveAnalysisModel,
  saveSortModel,
} from "@/lib/model-preferences";
import type { ModelOption } from "@/app/api/models/route";
import { apiPost } from "@/lib/api-client";
import { AiUsageSummary } from "./AiUsageSummary";
import type { AiUsage } from "@/lib/ai-usage";

interface ModelsPayload {
  sortModels: ModelOption[];
  analysisModels: ModelOption[];
}

export function ModelSelector() {
  const [testing, setTesting] = useState(false);
  const [testMessage, setTestMessage] = useState("");
  const [testUsage, setTestUsage] = useState<AiUsage[]>([]);
  useEffect(() => {
    try {
      setTestUsage(
        JSON.parse(localStorage.getItem("listing-writer:ai-tests") || "[]"),
      );
    } catch {}
  }, []);
  async function test(model: string) {
    if (
      testing ||
      !model ||
      !window.confirm(
        `Kostenpflichtigen Verbindungstest mit ${model} starten? Ein kurzer Textaufruf, kein automatischer Modellwechsel oder Neuversuch.`,
      )
    )
      return;
    setTesting(true);
    setTestMessage("");
    try {
      const r = await apiPost("/api/ai/test", { model, confirmed: true });
      const d = await r.json();
      setTestMessage(d.message || d.error || "Test fehlgeschlagen.");
      setTestUsage((prev) => {
        const next = [...prev, ...(d.usage ?? [])];
        try {
          localStorage.setItem("listing-writer:ai-tests", JSON.stringify(next));
        } catch {}
        return next;
      });
    } catch {
      setTestMessage(
        "Verbindungstest unterbrochen. Bitte bewusst erneut versuchen.",
      );
    } finally {
      setTesting(false);
    }
  }
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<ModelsPayload | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [sortModel, setSortModel] = useState("");
  const [analysisModel, setAnalysisModel] = useState("");

  useEffect(() => {
    const savedSort = getSortModel();
    const savedAnalysis = getAnalysisModel();

    fetch("/api/models")
      .then((r) => r.json())
      .then((data: ModelsPayload) => {
        setModels(data);

        const defaultSort =
          data.sortModels.find((m) => m.isDefault)?.id ??
          data.sortModels[0]?.id ??
          "";
        setSortModel(savedSort || defaultSort);
        if (!savedSort && defaultSort) saveSortModel(defaultSort);

        const defaultAnalysis =
          data.analysisModels.find((m) => m.isDefault)?.id ??
          data.analysisModels[0]?.id ??
          "";
        setAnalysisModel(savedAnalysis || defaultAnalysis);
        if (!savedAnalysis && defaultAnalysis) saveAnalysisModel(defaultAnalysis);
      })
      .catch(() => {
        setLoadError(true);
        setSortModel(savedSort ?? "");
        setAnalysisModel(savedAnalysis ?? "");
      });
  }, []);

  const handleSortChange = (id: string) => {
    setSortModel(id);
    saveSortModel(id);
  };

  const handleAnalysisChange = (id: string) => {
    setAnalysisModel(id);
    saveAnalysisModel(id);
  };

  const sortDesc = models?.sortModels.find(
    (m) => m.id === sortModel,
  )?.description;
  const analysisDesc = models?.analysisModels.find(
    (m) => m.id === analysisModel,
  )?.description;

  return (
    <>
      <button
        type="button"
        className="btn btn-ghost model-settings-btn"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="model-settings-body"
      >
        ⚙ KI-Einstellungen <span aria-hidden="true">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div id="model-settings-body" className="model-settings-body">
          {loadError && (
            <p
              className="note note-error"
              style={{ margin: 0, gridColumn: "1 / -1" }}
            >
              Modellliste nicht verfügbar. Die gespeicherte Wahl bleibt
              erhalten; es erfolgt kein automatischer Wechsel.
            </p>
          )}

          <div className="field">
            <label htmlFor="sort-model">KI für die Fotosortierung</label>
            {models ? (
              <select
                id="sort-model"
                value={sortModel}
                onChange={(e) => handleSortChange(e.target.value)}
                className="model-select"
              >
                {sortModel &&
                  !models.sortModels.some((m) => m.id === sortModel) && (
                    <option value={sortModel}>
                      {sortModel} · nicht mehr verfügbar, bitte neu auswählen
                    </option>
                  )}
                {models.sortModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName}
                    {m.isDefault ? " (Standard)" : ""}
                    {m.configured === false ? " · API-Schlüssel fehlt" : ""}
                  </option>
                ))}
              </select>
            ) : (
              <select disabled className="model-select">
                <option>Wird geladen…</option>
              </select>
            )}
            {sortDesc && (
              <span className="field-hint model-hint">{sortDesc}</span>
            )}
            <button
              type="button"
              className="btn-ghost"
              disabled={testing || !sortModel}
              onClick={() => test(sortModel)}
            >
              Sortiermodell: Verbindung testen (kostenpflichtig)
            </button>
          </div>

          <div className="field">
            <label htmlFor="analysis-model">
              KI für die Angebotserstellung
            </label>
            {models ? (
              <select
                id="analysis-model"
                value={analysisModel}
                onChange={(e) => handleAnalysisChange(e.target.value)}
                className="model-select"
              >
                {analysisModel &&
                  !models.analysisModels.some(
                    (m) => m.id === analysisModel,
                  ) && (
                    <option value={analysisModel}>
                      {analysisModel} · nicht mehr verfügbar, bitte neu
                      auswählen
                    </option>
                  )}
                {models.analysisModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName}
                    {m.isDefault ? " (Standard)" : ""}
                    {m.configured === false ? " · API-Schlüssel fehlt" : ""}
                  </option>
                ))}
              </select>
            ) : (
              <select disabled className="model-select">
                <option>Wird geladen…</option>
              </select>
            )}
            {analysisDesc && (
              <span className="field-hint model-hint">{analysisDesc}</span>
            )}
            <button
              type="button"
              className="btn-ghost"
              disabled={testing || !analysisModel}
              onClick={() => test(analysisModel)}
            >
              Listingmodell: Verbindung testen (kostenpflichtig)
            </button>
          </div>
          <p className="note">
            Einrichtung: Vercel → Projekt snaplist → Settings → Environment
            Variables. GEMINI_API_KEY (Google AI Studio) und OPENAI_API_KEY
            (OpenAI API, separates API-Guthaben) als Secret für Production
            speichern und neu bereitstellen. Claude verwendet weiterhin
            ANTHROPIC_API_KEY. Auswahl bleibt auf diesem Gerät gespeichert.
            Keine Schlüssel hier eingeben.
          </p>
          {testMessage && <p role="status">{testMessage}</p>}
          <AiUsageSummary
            rows={testUsage}
            label="Verbindungstests · separat von Listings"
          />
        </div>
      )}
    </>
  );
}
