import { DEFAULT_AI_MODEL } from "../ai-defaults";
import { getClient, parseModelJson } from "../anthropic";
import { measuredMessage } from "../ai-usage";

const clean = (value: string) => value.replace(/\s+/g, " ").trim();
const words = (value: string) => clean(value).split(" ").filter(Boolean);
const comparable = (value: string) => value.normalize("NFKC").toLocaleLowerCase("de-DE").replace(/[^\p{L}\p{N}]+/gu, "");

function editDistanceAtMostOne(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length === b.length && i + 1 < a.length && a[i] === b[i + 1] && a[i + 1] === b[i]) { i += 2; j += 2; }
    else if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return edits + Number(i < a.length || j < b.length) <= 1;
}

function safeSuffix(original: string[], candidate: string[]): boolean {
  if (candidate.length !== original.length) return false;
  const remaining = original.map(comparable);
  for (const word of candidate) {
    const token = comparable(word);
    if (!token) return false;
    let index = remaining.indexOf(token);
    if (index < 0) {
      // Never allow AI to alter identifiers, sizes, quantities, or model codes.
      if (/\d/.test(token) || token.length < 5) return false;
      index = remaining.findIndex((source) => !/\d/.test(source) && source.length >= 5 && editDistanceAtMostOne(source, token));
    }
    if (index < 0) return false;
    remaining.splice(index, 1);
  }
  return remaining.length === 0;
}

/** Conservatively edit only words after the exact five-word title prefix. */
export async function improveRelistTitle(value: string): Promise<string> {
  const original = clean(value);
  const parts = words(original);
  if (parts.length < 6 || original.length > 80) return original;
  const prefix = parts.slice(0, 5);
  const suffix = parts.slice(5);
  try {
    const response = await measuredMessage("relister_title", getClient(DEFAULT_AI_MODEL), {
      model: DEFAULT_AI_MODEL,
      max_tokens: 220,
      temperature: 0,
      system: "Du redigierst deutsche eBay-Titel konservativ. Erfinde keine Eigenschaften und übersetze nichts. Die ersten fünf Wörter sind unveränderlich und werden dir nicht mitgegeben. Korrigiere nur eindeutige Rechtschreibfehler im Rest und ordne vorhandene Restwörter bei Bedarf leicht um. Gib dieselbe Anzahl Wörter zurück. Behalte alle Zahlen, Größen, Marken- und Modellcodes exakt. Antworte ausschließlich mit JSON: {\"suffix\":\"...\"}.",
      messages: [{ role: "user", content: `Titelrest: ${suffix.join(" ")}` }],
    });
    const text = response.content.find((part) => part.type === "text")?.text ?? "";
    const parsed = parseModelJson<{ suffix?: unknown }>(text);
    if (typeof parsed.suffix !== "string") return original;
    const revised = words(parsed.suffix);
    if (!safeSuffix(suffix, revised)) return original;
    const result = `${prefix.join(" ")} ${revised.join(" ")}`;
    if (result.length > 80 || result === original) return original;
    return result;
  } catch {
    // Title polish is optional: a provider error must never block a listing.
    return original;
  }
}
