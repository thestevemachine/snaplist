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
  materials?: {
    part: "front" | "temples";
    value: string;
    source: "label" | "estimate";
    quote: string;
    photos: number[];
    confidence?: number;
  }[];
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
  lensWidth: ["Glasbreite", "Gläserbreite", "Glasdurchmesser", "Scheibenbreite", "Scheibengröße", "Lens Width", "Lens Size"],
  bridgeWidth: ["Stegbreite", "Brückenbreite", "Stegweite", "Bridge Width", "Bridge Size"],
  templeLength: ["Bügellänge", "Temple Length"],
  totalWidth: [
    "Gesamtbreite",
    "Rahmenbreite",
    "Fassungsbreite",
    "Total Frame Width",
    "Frame Width",
  ],
};
export function parseBoxDimensions(text: string) {
  const normalized=text.normalize("NFKC");
  const separated=/(?<![\p{L}\d])([1-9]\d)\s*(?:[□◻▢☐◽▫▯/×xX-]|\[\s*\])\s*([1-9]\d)(?:\s*(?:[-/]\s*|\s+)([1-9]\d{2}))?(?![\p{L}\d])/gu;
  const plain=/(?<![\p{L}\d])([1-9]\d)\s+([1-9]\d)\s+([1-9]\d{2})(?![\p{L}\d])/gu;
  const candidates=[...normalized.matchAll(separated),...normalized.matchAll(plain)]
    .filter(m=>Number(m[1])>=30 && Number(m[1])<=75 && Number(m[2])>=5 && Number(m[2])<=35 && (!m[3] || (Number(m[3])>=100 && Number(m[3])<=180)))
    .map(m=>({lensWidth:m[1],bridgeWidth:m[2],...(m[3]?{templeLength:m[3]}:{})}));
  const distinct=[...new Map(candidates.map(value=>[JSON.stringify(value),value])).values()];
  return distinct.length===1 ? distinct[0] : undefined;
}
// Lindberg demo lenses can print model + lens width without a box/bridge separator.
export function parseLindbergDemoLens(text: string) {
  const matches=[...text.matchAll(/(?<![\p{L}\d])(\d{4})(?:\s+|\s*[/·]\s*)([3-6]\d|7[0-5])(?:\s*mm)?(?![\p{L}\d])/gu)];
  if(matches.length !== 1) return;
  return {modelNumber:matches[0][1],lensWidth:matches[0][2]};
}
const materialName = (v: string) =>
  v
    .replace(/\boptyl\b/gi, "Optyl")
    .replace(/\btitan(?:ium)?\b/gi, "Titan")
    .replace(/\bacetat(?:e)?\b/gi, "Acetat")
    .replace(/\bmetal\b/gi, "Metall")
    .replace(/\bplastic\b/gi, "Kunststoff");
// Called only on fresh photo analysis. Category preparation never re-applies the shop assumption.
export function extractEyewear(facts: PhotoFact[]): EyewearData {
  const data: EyewearData = { fields: {}, warnings: [] };
  const set = (key: EyewearKey, value: string, fact: PhotoFact) => {
    if(["lensWidth","bridgeWidth","templeLength","totalWidth"].includes(key)) value=value.trim().replace(/\s*mm$/i, "");
    const previous = data.fields[key];
    if (key === "material" && previous?.quote === fact.quote) {
      // One printed compound (e.g. TITANIUM ACETATE) is not a conflict
      // when its individual material words are encountered again below.
      value = [
        ...new Set([...previous.value.split(" | "), ...value.split(" | ")]),
      ].join(" | ");
    }
    if (
      previous &&
      previous.value !== value &&
      !(key === "material" && previous.quote === fact.quote)
    ) {
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
  const lindberg = facts.some(f => f.basis === "label" &&
    ((/^(Marke|Brand)$/i.test(f.name) && /^lindberg$/i.test(f.value.trim())) || /\blindberg\b/i.test(f.quote)));

  for (const fact of facts.filter((f) => f.basis === "label")) {
    const quotedDimensions = parseBoxDimensions(fact.quote);
    const valueDimensions = /^(Größe|Kastenmaß|Kastenmass|Size|Bügelaufdruck|Brückenaufdruck)$/i.test(fact.name) ? parseBoxDimensions(fact.value) : undefined;
    const dimensions = quotedDimensions && valueDimensions && quotedDimensions.lensWidth===valueDimensions.lensWidth && quotedDimensions.bridgeWidth===valueDimensions.bridgeWidth
      ? {...valueDimensions,...quotedDimensions} : quotedDimensions ?? valueDimensions;
    if (lindberg && /^(Scheibenaufdruck|Demoscheibenaufdruck|Glasaufdruck|Lens Inscription)$/i.test(fact.name)) {
      const lens = parseLindbergDemoLens(fact.quote);
      if(lens) {set("modelNumber",lens.modelNumber,fact);set("lensWidth",lens.lensWidth,fact);}
    }
    if (dimensions)
      for (const [key, value] of Object.entries(dimensions))
        set(key as EyewearKey, value, fact);
    for (const key of Object.keys(names) as EyewearKey[]) {
      if (!names[key].some((n) => n.toLowerCase() === fact.name.replace(/\s*\(mm\)\s*$/i, "").trim().toLowerCase()))
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
        key === "material" ? materialName(fact.value) : key === "lensWidth" ? fact.value.replace(/\s*mm$/i, "") : fact.value,
        fact,
      );
    }
    const component =
      /^(Bügelmaterial|Material Bügel|Temple Material|Frontmaterial|Material Front|Frame Front Material)$/i.test(
        fact.name,
      );
    const printed =
      !component &&
      fact.quote.match(/\b(optyl|titanium|titan|acetate|acetat)\b/i);
    if (printed)
      set(
        "material",
        materialName(printed[0])
          .replace(/^titan$/i, "Titan")
          .replace(/^acetat$/i, "Acetat")
          .replace(/^optyl$/i, "Optyl"),
        fact,
      );
  }
  const components = facts.filter(
    (f) =>
      (f.basis === "label" ||
        (Number.isFinite(f.confidence) && f.confidence! >= 60)) &&
      /^(Bügelmaterial|Material Bügel|Temple Material|Frontmaterial|Material Front|Frame Front Material)$/i.test(
        f.name,
      ),
  );
  if (components.length) {
    data.materials = components.map((f) => ({
      part: /bügel|temple/i.test(f.name)
        ? ("temples" as const)
        : ("front" as const),
      value: materialName(f.value),
      source: f.basis === "label" ? ("label" as const) : ("estimate" as const),
      quote: f.quote,
      photos: f.photoIndices,
      confidence: f.confidence,
    }));
    const labeled = components.filter((f) => f.basis === "label");
    const values = [
      ...new Set([
        ...(data.fields.material?.source === "label"
          ? data.fields.material.value.split(" | ")
          : []),
        ...labeled.flatMap((f) => materialName(f.value).split(" | ")),
      ]),
    ].filter((v) => /^(Titan|Acetat|Metall|Kunststoff|Stahl|Optyl)$/i.test(v));
    if (values.length && labeled.length)
      data.fields.material = {
        value: values.join(" | "),
        source: "label",
        quote: [data.fields.material?.quote, ...labeled.map((f) => f.quote)]
          .filter(Boolean)
          .join("; "),
        photos: [
          ...new Set([
            ...(data.fields.material?.photos ?? []),
            ...labeled.flatMap((f) => f.photoIndices),
          ]),
        ],
      };
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
        names[key].some(name=>name.toLowerCase()===m.name.replace(/\s*\(mm\)\s*$/i,"").toLowerCase()) ||
        (key === "modelNumber" && m.name === "Modell"),
    )) {
      if (
        key === "material" &&
        (field.source === "label" || overwriteKey === "material")
      ) {
        const parts = overwriteKey ? [] : (l.eyewear?.materials ?? []);
        const proven = field.value.split(" | ").map(materialName);
        const supportedParts = parts.flatMap((p) => p.value.split(" | "));

        const previous =
          aspects[m.name] ??
          (l.item_specifics?.[m.name] ?? "").split(" | ").filter(Boolean);
        const all = [
          ...new Set([
            ...proven,
            ...supportedParts,
            ...(overwriteKey ? [] : previous),
          ]),
        ]
          .filter(
            (value) => !(proven.includes("Optyl") && /^acetat$/i.test(value)),
          );
        const mapped = all
          .flatMap((value) => {
            if (
              /^optyl$/i.test(value) &&
              !m.values.some((v) => /^optyl$/i.test(v))
            )
              value = "Kunststoff";
            const choice = m.values.find(
              (v) => v.toLowerCase() === value.toLowerCase(),
            );
            return choice
              ? [choice]
              : !m.values.length && m.mode === "FREE_TEXT"
                ? [value]
                : [];
          })
          .slice(0, m.cardinality === "MULTI" ? 5 : 1);
        if (mapped.length) {
          aspects[m.name] = mapped;
          l.material = mapped.join(" | ");
          const estimatedParts = parts.filter(
            (p) =>
              p.source === "estimate" &&
              p.value.split(" | ").some((value) => mapped.includes(value)),
          );
          if (estimatedParts.length)
            l.estimates = {
              ...l.estimates,
              [m.name]: Math.min(
                ...estimatedParts.map((p) => p.confidence ?? 60),
              ),
            };
          l.evidence = {
            ...l.evidence,
            [m.name]: [
              ...new Set([
                ...(l.evidence?.[m.name] ?? []),
                ...(field.photos ?? []),
                ...parts.flatMap((p) => p.photos),
              ]),
            ],
          };
        }
        continue;
      }
      if (
        !overwriteKey &&
        field.value !== "Optyl" &&
        Object.hasOwn(l.item_specifics ?? {}, m.name)
      )
        continue;
      let value = field.value;
      if (key === "templeLength" && /^\d+$/.test(value)) value += " mm";
      if (
        key === "material" &&
        /^optyl$/i.test(value) &&
        m.values.length &&
        !m.values.some((v) => /^optyl$/i.test(v))
      )
        value = "Kunststoff";
      const dimension = ["lensWidth", "bridgeWidth"].includes(key);
      // Respect selection-only choices; explicitly confirmed free-text dimensions remain editable.
      if (dimension && !m.values.length && !((overwriteKey === key || field.source === "manual" || field.source === "label") && m.mode === "FREE_TEXT")) continue;
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
          (dimension && !((overwriteKey === key || field.source === "manual" || field.source === "label") && m.mode === "FREE_TEXT")) ||
          m.mode === "SELECTION_ONLY" ||
          /material|farbe/i.test(m.name)
        )
          continue;
      }
      if(m.dataType === "NUMBER" && ["lensWidth","bridgeWidth","templeLength","totalWidth"].includes(key)) value=value.replace(/\s*mm$/i,"");
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
      !new RegExp(`\\b${word}\\b`, "i").test(material) &&
      !(word === "Metall" && /\b(Titan|Stahl)\b/i.test(material))
    )
      warnings.push(
        `Titel/Material: ${word} prüfen.`,
      );
  }
  if (/\btitan(?:ium)?\b/i.test(material) && !/\btitan(?:ium)?\b/i.test(l.title))
    warnings.push("Titel/Material: Titan prüfen.");
  return [...new Set(warnings)];
}
export const INSCRIPTION_PROMPT = `\nNever infer titanium from the brand ic! berlin (or any brand), a rimless design or a metallic appearance. Only an explicit TITAN/TITANIUM material inscription establishes titanium; otherwise describe visibly metallic parts generically as Metall, not a specific alloy. For Lindberg, the DEMO LENS inscription is a primary source for the horizontal lens width, not just for branding. Transcribe its complete legible print as Scheibenaufdruck (label fact with exact quote and photo index), even when the temples contain no size. A model identifier (often four digits) followed by a separate two-digit number, e.g. 1257 46, means model 1257 and horizontal groove-to-groove lens width 46 mm, excluding the frame rim. Emit separate label facts Modellnummer=1257 and Glasbreite=46 only if that complete print is legible and unambiguous; preserve the exact quote and photo index. A four-digit model code is never a width. Never infer a missing width or treat a color code as a width. Inspect printed words on BOTH demo lenses as well as temples, bridge and front. Read a clear TITAN/TITANIUM material marking on a demo lens as positive titanium evidence; a demo-lens material marking is not just branding to ignore. Return the exact quote and photo index. Titanium is Titan, not merely Metall. Distinguish the FRONT material from the TEMPLE material: emit Frontmaterial and Bügelmaterial facts separately when identifiable, e.g. an acetate front and titanium temples means Fassungsmaterial Titan | Acetat, not Metall alone. Do not infer that the whole frame is titanium or acetate from a single component label. Visual front material is an estimate with actual confidence; do not call it a label unless printed. Do not transfer colors or materials from display stands, blue holders, background objects or demo-lens tint to the frame. The word TITANIUM in a model name alone is not component-specific proof. Optyl printed on a lens or frame identifies Optyl plastic, NOT Acetat. Return a label fact Fassungsmaterial=Optyl with the exact quote and photo index. For eyewear transcribe all legible temple/bridge inscriptions as specifics named Bügelaufdruck (basis label, value and quote exact, photoIndices). Also classify separately Marke, Modellnummer, Modellname, Farbcode, Fassungsmaterial. Example fictitious Lindberg Air Titanium 1234 C02 52□18 140: brand Lindberg, model name Air Titanium, model number 1234, color code C02. Never label 52/18/140 as model. Inspect every photo for size markings on the bridge (Brücke/Steg), including its underside and inner surface, as well as temples and frame front. Size markings are NOT restricted to the temples. A bridge inscription such as 53-18 (for example on Bogner) means Glasbreite 53 mm and Stegbreite 18 mm; transcribe it exactly as a label fact named Brückenaufdruck with its photo index. Do not interpret it as a model number or infer temple length from it. Box dimensions are parsed deterministically from the exact inscription, never invent missing digits or infer total width. For unclear characters add a specific Prüfhinweis with a German review note and basis estimate, confidence 100, relevant photoIndices; do not invent readable values. Distinguish material assertions from model names. Preserve exact quotes for all label facts. Herstellernummer/MPN is NOT Modellnummer; omit MPN unless explicitly identified as a manufacturer part number. Bügellänge must include mm.`;

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
  return eyewearWarnings({ ...l, eyewear: l.eyewear ? { ...l.eyewear, warnings: [] } : undefined });
}

// Reuse already stored, label-proven evidence without another paid photo call.
// Seller-edited material has source=manual and is never automatically replaced.
export function printedMaterialPatch(
  l: ListingResult,
  meta: AspectMeta[],
): Partial<ListingResult> | undefined {
  const field = l.eyewear?.fields.material;
  if (field?.source !== "label") return;
  const next: ListingResult = {
    ...l,
    evidence: { ...l.evidence },
    eyewear: { ...l.eyewear, fields: { material: field }, warnings: [] },
  };
  const aspects = Object.fromEntries(
    Object.entries(l.item_specifics ?? {}).map(([k, v]) => [
      k,
      v.split(" | ").filter(Boolean),
    ]),
  );
  mapEyewear(next, aspects, meta);
  const changed = meta
    .filter((m) => names.material.includes(m.name))
    .some(
      (m) =>
        (aspects[m.name] ?? []).join(" | ") !==
        (l.item_specifics?.[m.name] ?? ""),
    );
  if (!changed && (next.material === undefined || next.material === l.material))
    return;
  return {
    material: next.material,
    evidence: next.evidence,
    estimates: next.estimates,
    item_specifics: {
      ...l.item_specifics,
      ...Object.fromEntries(
        meta
          .filter((m) => names.material.includes(m.name) && aspects[m.name])
          .map((m) => [m.name, aspects[m.name].join(" | ")]),
      ),
    },
  };
}
