import type { ListingResult } from "./types";
import type { PhotoFact } from "./photo-facts";
import type { AspectMeta } from "./ebay/taxonomy";

export const eyewearLabels = {
  brand: "Marke",
  modelNumber: "Modellnummer",
  modelName: "Modellname",
  colorCode: "Farbcode",
  material: "Material",
  lensWidth: "Glasbreite",
  bridgeWidth: "Stegbreite",
  templeLength: "Bügellänge",
  totalWidth: "Gesamtbreite",
} as const;
export type EyewearKey = keyof typeof eyewearLabels;
export interface EyewearData {
  fields: Partial<
    Record<
      EyewearKey,
      {
        value: string;
        source: "label" | "shop" | "manual";
        quote?: string;
        photos?: number[];
      }
    >
  >;
  warnings: string[];
}
const names: Record<EyewearKey, string[]> = {
  brand: ["Marke", "Brand"],
  modelNumber: ["Modellnummer", "Model Number"],
  modelName: ["Modellname", "Model Name", "Modell", "Model"],
  colorCode: ["Farbcode", "Color Code"],
  material: [
    "Fassungsmaterial",
    "Rahmenmaterial",
    "Material",
    "Frame Material",
  ],
  lensWidth: ["Glasbreite", "Gläserbreite", "Glasdurchmesser", "Lens Width"],
  bridgeWidth: ["Stegbreite", "Brückenbreite", "Bridge Width"],
  templeLength: ["Bügellänge", "Temple Length"],
  totalWidth: [
    "Gesamtbreite",
    "Fassungsbreite",
    "Total Frame Width",
    "Frame Width",
  ],
};
export function parseBoxDimensions(text: string) {
  const match = text.match(
    /(?<![\p{L}\d])([1-9]\d)\s*[□◻▢/\-]\s*([1-9]\d)(?:\s*(?:[-/]\s*|\s+)([1-9]\d{2}))?(?![\p{L}\d])/u,
  );
  return match
    ? {
        lensWidth: match[1],
        bridgeWidth: match[2],
        ...(match[3] ? { templeLength: match[3] } : {}),
      }
    : undefined;
}
const materialName = (v: string) =>
  v
    .replace(/\btitanium\b/gi, "Titan")
    .replace(/\bacetate\b/gi, "Acetat")
    .replace(/\bmetal\b/gi, "Metall")
    .replace(/\bplastic\b/gi, "Kunststoff");
// Called only on fresh photo analysis. Category preparation never re-applies the shop assumption.
export function extractEyewear(facts: PhotoFact[]): EyewearData {
  const data: EyewearData = { fields: {}, warnings: [] };
  const set = (key: EyewearKey, value: string, fact: PhotoFact) => {
    const previous = data.fields[key];
    if (previous && previous.value !== value) {
      data.warnings.push(
        `${eyewearLabels[key]}: widersprüchliche Aufdrucke (${previous.value} / ${value}). Bitte prüfen.`,
      );
      delete data.fields[key];
      blocked.add(key);
      return;
    }
    if (!blocked.has(key))
      data.fields[key] = {
        value,
        source: "label",
        quote: fact.quote,
        photos: fact.photoIndices,
      };
  };
  const blocked = new Set<EyewearKey>();
  for (const fact of facts.filter((f) => f.basis === "label")) {
    const dimensions = parseBoxDimensions(fact.quote);
    if (dimensions)
      for (const [key, value] of Object.entries(dimensions))
        set(key as EyewearKey, value, fact);
    for (const key of Object.keys(names) as EyewearKey[]) {
      if (!names[key].some((n) => n.toLowerCase() === fact.name.toLowerCase()))
        continue;
      if (
        key === "modelNumber" &&
        (parseBoxDimensions(fact.value) ||
          Object.values(dimensions ?? {}).includes(fact.value))
      ) {
        data.warnings.push(
          "Modellnummer könnte eine Maßangabe sein. Bitte prüfen.",
        );
        continue;
      }
      set(
        key,
        key === "material" ? materialName(fact.value) : fact.value,
        fact,
      );
    }
    const printed = fact.quote.match(/\b(titanium|titan|acetate|acetat)\b/i);
    if (printed)
      set(
        "material",
        materialName(printed[0])
          .replace(/^titan$/i, "Titan")
          .replace(/^acetat$/i, "Acetat"),
        fact,
      );
  }
  const ranges: Partial<Record<EyewearKey, number[]>> = {
    lensWidth: [35, 65],
    bridgeWidth: [12, 28],
    templeLength: [120, 155],
  };
  for (const [key, range] of Object.entries(ranges)) {
    const value = Number(
      data.fields[key as EyewearKey]?.value.replace(/\s*mm$/i, ""),
    );
    if (value && (value < range[0] || value > range[1]))
      data.warnings.push(
        `${eyewearLabels[key as EyewearKey]} außerhalb des üblichen Bereichs – bei Vintage möglich; bitte prüfen.`,
      );
  }
  if (/^lindberg$/i.test(data.fields.brand?.value ?? "")) {
    const material = data.fields.material;
    const other = facts
      .filter((f) => names.material.includes(f.name))
      .map((f) => materialName(f.value));
    if (
      blocked.has("material") ||
      (material && material.value !== "Titan") ||
      other.some((v) => v !== "Titan")
    ) {
      data.warnings.push(
        "Lindberg-Shop-Vorgabe Titan widerspricht den erkannten Materialangaben. Material bitte kontrollieren.",
      );
    } else if (!material)
      data.fields.material = { value: "Titan", source: "shop" };
  }
  return data;
}
export function mapEyewear(
  l: ListingResult,
  aspects: Record<string, string[]>,
  meta: AspectMeta[],
  overwriteKey?: EyewearKey,
) {
  for (const [rawKey, field] of Object.entries(l.eyewear?.fields ?? {})) {
    const key = rawKey as EyewearKey;
    if (!field || (overwriteKey && key !== overwriteKey)) continue;
    for (const m of meta.filter(
      (m) =>
        names[key].includes(m.name) ||
        (key === "modelNumber" && m.name === "Modell"),
    )) {
      if (!overwriteKey && Object.hasOwn(l.item_specifics ?? {}, m.name))
        continue;
      let value = field.value;
      const dimension = ["lensWidth", "bridgeWidth"].includes(key);
      // Only eBay's enumerated sizes are transferred, never a newly invented choice.
      if (dimension && !m.values.length) continue;
      if (m.values.length) {
        const allowed = m.values.find(
          (v) =>
            v.toLowerCase() === value.toLowerCase() ||
            (/Width|Length|breite|länge/.test(key + m.name) &&
              v.replace(/\s*mm$/i, "").trim() ===
                value.replace(/\s*mm$/i, "").trim()),
        );
        if (allowed) value = allowed;
        else if (
          dimension ||
          m.mode === "SELECTION_ONLY" ||
          /material|farbe/i.test(m.name)
        )
          continue;
      }
      aspects[m.name] = value ? [value] : [];
    }
  }
}
export function eyewearWarnings(l: ListingResult) {
  const warnings = [...(l.eyewear?.warnings ?? [])];
  const material = Object.entries(l.item_specifics ?? {})
    .filter(([k]) => names.material.includes(k))
    .map(([, v]) => v)
    .join(" | ");
  for (const word of ["Titan", "Acetat", "Metall", "Kunststoff", "Stahl"]) {
    if (
      new RegExp(`\\b${word}(?:ium)?\\b`, "i").test(l.title) &&
      !new RegExp(`\\b${word}\\b`, "i").test(material)
    )
      warnings.push(
        `Titel nennt ${word}, das Material-Artikelmerkmal stimmt damit noch nicht überein. Bitte prüfen.`,
      );
  }
  return [...new Set(warnings)];
}
export const INSCRIPTION_PROMPT = `\nFor eyewear transcribe all legible temple/bridge inscriptions as specifics named Bügelaufdruck (basis label, value and quote exact, photoIndices). Also classify separately Marke, Modellnummer, Modellname, Farbcode, Fassungsmaterial. Example fictitious Lindberg Air Titanium 1234 C02 52□18 140: brand Lindberg, model name Air Titanium, model number 1234, color code C02. Never label 52/18/140 as model. Box dimensions are parsed deterministically from the exact inscription, never invent missing digits or infer total width. For unclear characters add a specific Prüfhinweis with a German review note and basis estimate, confidence 100, relevant photoIndices; do not invent readable values. Distinguish material assertions from model names. Preserve exact quotes for all label facts.`;

export function syncManualEyewear(
  previous: ListingResult,
  next: ListingResult,
) {
  if (!previous.eyewear) return;
  next.eyewear = {
    ...previous.eyewear,
    fields: { ...previous.eyewear.fields },
  };
  for (const [rawKey, aliases] of Object.entries(names)) {
    const changed = aliases.find(
      (name) =>
        Object.hasOwn(next.item_specifics ?? {}, name) &&
        next.item_specifics?.[name] !== previous.item_specifics?.[name],
    );
    if (changed) {
      const key =
        changed === "Modell" && previous.eyewear.fields.modelNumber
          ? "modelNumber"
          : (rawKey as EyewearKey);
      next.eyewear.fields[key] = {
        value: next.item_specifics![changed],
        source: "manual",
      };
    }
  }
}
export function materialTitleIssues(l: ListingResult) {
  return l.eyewear
    ? eyewearWarnings({ ...l, eyewear: { ...l.eyewear, warnings: [] } })
    : [];
}
