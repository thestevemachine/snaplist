"use client";
import type { AiUsage } from "@/lib/ai-usage";
import { usageTotals } from "@/lib/ai-costs";
export function AiUsageSummary({
  rows,
  label,
}: {
  rows: AiUsage[];
  label: string;
}) {
  if (!rows.length) return null;
  const totals = usageTotals(rows);
  const models = [
    ...new Set(totals.rows.map((r) => r.requestedModel ?? r.model)),
  ];
  return (
    <details className="note">
      <summary>
        {label}: ${totals.usd.toFixed(4)} (berechnet)
        {totals.unknown ? " + nicht erfasste Kosten möglich" : ""}
      </summary>
      <p>
        Tatsächliche Anbieter-Token, soweit gemeldet; Kosten = Token ×
        Listenpreis in USD, keine Rechnung und keine Euro-Umrechnung. Fehlende
        Nutzung ist unbekannt, nicht kostenlos. Ziel: unter $0,03 als Richtwert;
        Qualitätsvergleich erforderlich.
      </p>
      <table>
        <thead>
          <tr>
            <th>Modell</th>
            <th>Eingabe inkl. Cache</th>
            <th>Ausgabe inkl. Denken</th>
            <th>Berechnete USD</th>
          </tr>
        </thead>
        <tbody>
          {models.map((model) => {
            const t = usageTotals(
              totals.rows.filter(
                (r) => (r.requestedModel ?? r.model) === model,
              ),
            );
            return (
              <tr key={model}>
                <td>{model}</td>
                <td>{t.input}</td>
                <td>{t.output}</td>
                <td>
                  ${t.usd.toFixed(5)}
                  {t.unknown ? " + unbekannt" : ""}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </details>
  );
}
