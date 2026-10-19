import { cleanListingText } from "./listing-content-rules";
import type { ListingResult } from "./types";
import type { AspectMeta } from "./ebay/taxonomy";
import { isSunglasses } from "./category-selection";
import { matchAllowed } from "./ebay/aspects";

export const GLASSES_RULES_VERSION = 2;
export function isGlasses(l: ListingResult) {
  return (
    (l.eyewear_kind !== undefined && l.eyewear_kind !== "not_eyewear") ||
    isSunglasses(l) ||
    /\b(brille[n]?|brillenfassung(?:en)?|eyeglasses|eyeglass|spectacles)\b/i.test(
      [l.title, l.item_type, l.category_hint].join(" "),
    )
  );
}
const aliases: Record<string, string[]> = {
  Marke: ["Brand"],
  Modell: ["Model", "Model Number", "Modellnummer"],
  Fassungsfarbe: ["Rahmenfarbe", "Frame Color", "Color", "Farbe"],
  Rahmenfarbe: ["Fassungsfarbe", "Frame Color", "Color", "Farbe"],
  Fassungsmaterial: ["Rahmenmaterial", "Frame Material", "Material"],
  Rahmenmaterial: ["Fassungsmaterial", "Frame Material", "Material"],
  Form: [
    "Brillenform",
    "Rahmenform",
    "Fassungsform",
    "Frame Shape",
    "Shape",
    "Style",
  ],
  Brillenform: [
    "Form",
    "Rahmenform",
    "Fassungsform",
    "Frame Shape",
    "Shape",
    "Style",
  ],
  Rahmenform: [
    "Form",
    "Brillenform",
    "Fassungsform",
    "Frame Shape",
    "Shape",
    "Style",
  ],
  Fassungsform: [
    "Form",
    "Brillenform",
    "Rahmenform",
    "Frame Shape",
    "Shape",
    "Style",
  ],
  Stil: ["Frame Shape", "Shape", "Form", "Style"],
  Abteilung: ["Department", "Gender", "Geschlecht"],
  Gläsermaterial: ["Lens Material"],
  Glasmaterial: ["Lens Material"],
  Linsenmaterial: ["Lens Material"],
  Glasbreite: ["Lens Width"],
  Stegbreite: ["Bridge Width"],
  Bügellänge: ["Temple Length"],
  Gesamtbreite: ["Frame Width", "Total Frame Width"],
};
const translations: Record<string, string> = {
  black: "Schwarz",
  brown: "Braun",
  tortoise: "Braun",
  tortoiseshell: "Braun",
  havana: "Braun",
  havanna: "Braun",
  gold: "Gold",
  "gold-tone": "Gold",
  silver: "Silber",
  grey: "Grau",
  gray: "Grau",
  blue: "Blau",
  green: "Grün",
  red: "Rot",
  pink: "Rosa",
  purple: "Lila",
  clear: "Transparent",
  transparent: "Transparent",
  white: "Weiß",
  yellow: "Gelb",
  polycarbonate: "Polycarbonat",
  glass: "Glas",
  acetate: "Acetat",
  metal: "Metall",
  titanium: "Titan",
  plastic: "Kunststoff",
  steel: "Stahl",
  round: "Rund",
  square: "Eckig",
  rectangular: "Rechteckig",
  oval: "Oval",
  aviator: "Pilot",
  flieger: "Pilot",
  men: "Herren",
  women: "Damen",
  male: "Herren",
  female: "Damen",
  unisex: "Unisex Erwachsene",
  "unisex adults": "Unisex Erwachsene",
};
export const controlledGlassesAspect = (name: string) =>
  /farbe|material/i.test(name);
// The localized category field wins over an old English duplicate, including a seller-cleared value.
export function germanAspects(
  l: ListingResult,
  aspects: Record<string, string[]>,
  meta: AspectMeta[],
) {
  for (const m of meta) {
    if (
      !Object.prototype.hasOwnProperty.call(aspects, m.name) &&
      Object.prototype.hasOwnProperty.call(l.item_specifics ?? {}, m.name)
    ) {
      aspects[m.name] = (l.item_specifics![m.name] || "")
        .split(" | ")
        .filter(Boolean);
    }
    const synonyms =
      aliases[m.name] ??
      (m.name === "Farbe"
        ? ["Fassungsfarbe", "Rahmenfarbe", "Color", "Frame Color"]
        : m.name === "Material"
          ? ["Fassungsmaterial", "Rahmenmaterial", "Frame Material"]
          : []);
    if (!Object.prototype.hasOwnProperty.call(aspects, m.name)) {
      const source = synonyms.find((k) => aspects[k]?.length);
      const fallback =
        m.name === "Marke"
          ? l.brand
          : /^(fassungsfarbe|rahmenfarbe|farbe)$/i.test(m.name)
            ? l.color
            : /^(fassungsmaterial|rahmenmaterial|material)$/i.test(m.name)
              ? l.material
              : undefined;
      if (source) {
        aspects[m.name] = aspects[source];
        if (l.evidence?.[source]) l.evidence[m.name] = l.evidence[source];
        if (l.estimates?.[source] !== undefined)
          l.estimates[m.name] = l.estimates[source];
      } else if (fallback)
        aspects[m.name] = Array.isArray(fallback) ? fallback : [fallback];
    }
    for (const key of synonyms)
      if (key !== m.name && !meta.some((a) => a.name === key))
        delete aspects[key];
    if (aspects[m.name] && m.values.length) {
      aspects[m.name] = aspects[m.name]
        .map(
          (v) =>
            matchAllowed(v, m.values) ??
            matchAllowed(translations[v.toLowerCase()] ?? "", m.values) ??
            (controlledGlassesAspect(m.name) || m.mode === "SELECTION_ONLY"
              ? ""
              : v),
        )
        .filter(Boolean);
    }
  }
  for (const [german, english] of Object.entries(aliases)) {
    if (
      meta.some((m) => m.name === german || english.includes(m.name)) ||
      (german === "Stil" && aspects.Form)
    )
      continue;
    const source = english.find(
      (k) => aspects[k]?.length && !meta.some((m) => m.name === k),
    );
    if (!source) continue;
    if (!aspects[german])
      aspects[german] = aspects[source].map(
        (v) => translations[v.toLowerCase()] ?? v,
      );
    if (l.evidence?.[source]) l.evidence[german] = l.evidence[source];
    if (l.estimates?.[source] !== undefined)
      l.estimates[german] = l.estimates[source];
    delete aspects[source];
  }
  if (aspects.Marke) l.brand = aspects.Marke.join(" | ");
}
function fact(l: ListingResult, keys: string[]) {
  const key = keys.find((k) => l.item_specifics?.[k]?.trim());
  return key ? { key, value: l.item_specifics![key].trim() } : undefined;
}
function measured(l: ListingResult, keys: string[]) {
  const f = fact(l, keys);
  if (!f || l.estimates?.[f.key] !== undefined) return undefined;
  // No top-level "size", photo scale guesses, or compound measurements.
  const match = f.value.match(/^(\d+(?:[.,]\d+)?)\s*(?:mm)?$/i);
  return match ? Number(match[1].replace(",", ".")) : undefined;
}
function categoryTitleValue(
  l: ListingResult,
  meta: AspectMeta[],
  names: string[],
) {
  const field = names
    .map((name) => meta.find((m) => m.name === name))
    .find((m) => m && Object.hasOwn(l.item_specifics ?? {}, m.name));
  if (!field) return "";
  return (l.item_specifics?.[field.name] ?? "")
    .split(" | ")
    .map((value) => {
      if (!field.values.length)
        return field.mode === "FREE_TEXT" ? value.trim() : "";
      return (
        matchAllowed(value, field.values) ??
        matchAllowed(translations[value.toLowerCase()] ?? "", field.values) ??
        ""
      );
    })
    .filter(Boolean)
    .join(" ");
}
function verifiedTitleKeywords(l: ListingResult, meta: AspectMeta[]) {
  const supported = meta.flatMap((m) =>
    (l.item_specifics?.[m.name] ?? "").split(" | "),
  );
  const keywords = ["Randlos", "Halbrand", "Vollrand", "Oversize"];
  const result = keywords.filter((k) =>
    supported.some(
      (v) =>
        v.toLowerCase() === k.toLowerCase() ||
        (k === "Oversize" && /^oversized$/i.test(v)),
    ),
  );
  const rawColor = Array.isArray(l.color) ? l.color.join(" ") : (l.color ?? "");
  if (
    /tortoise|havana|havanna/i.test(rawColor) &&
    /braun/i.test(
      categoryTitleValue(l, meta, ["Rahmenfarbe", "Fassungsfarbe", "Farbe"]),
    )
  )
    result.push("Havanna");
  return result;
}
export function glassesTitleHints(l: ListingResult, meta: AspectMeta[]) {
  const hints: string[] = [];
  if (!categoryTitleValue(l, meta, ["Rahmenfarbe", "Fassungsfarbe", "Farbe"]))
    hints.push(
      "Titelfarbe fehlt: bitte die Rahmenfarbe in den eBay-Merkmalen prüfen.",
    );
  const model = fact(l, [
    "Modellnummer",
    "Model Number",
    "Modell",
    "Modellname",
    "Model",
    "Model Name",
  ]);
  if (
    !(model && l.estimates?.[model.key] === undefined) &&
    !l.eyewear?.fields.modelNumber?.value &&
    !l.eyewear?.fields.modelName?.value
  )
    hints.push(
      "Modellnummer/-name nicht sicher erkannt: Bügelaufdruck prüfen oder ergänzen.",
    );
  return hints;
}
export function germanGlassesTitle(l: ListingResult, meta: AspectMeta[]) {
  const s = l.item_specifics ?? {};
  const brand = s.Marke ?? l.brand ?? "";
  const modelNumber = fact(l, ["Modellnummer", "Model Number"]);
  const modelName = fact(l, ["Modell", "Modellname", "Model", "Model Name"]);
  const numberText =
    modelNumber && l.estimates?.[modelNumber.key] === undefined
      ? modelNumber.value
      : l.eyewear?.fields.modelNumber?.value || "";
  const nameText =
    modelName && l.estimates?.[modelName.key] === undefined
      ? modelName.value
      : l.eyewear?.fields.modelName?.value || "";
  const modelText = numberText || nameText;
  const extraModelName =
    numberText &&
    nameText &&
    !numberText.toLowerCase().includes(nameText.toLowerCase()) &&
    !nameText.toLowerCase().includes(numberText.toLowerCase())
      ? nameText
      : "";
  const gender =
    fact(l, ["Abteilung", "Geschlecht", "Department", "Gender"])?.value ?? "";
  const sex = /unisex|herren.*damen|damen.*herren/i.test(gender)
    ? "Herren Damen"
    : /damen|women|female/i.test(gender)
      ? "Damen"
      : /herren|\bmen\b|\bmale\b/i.test(gender)
        ? "Herren"
        : "";
  const color = categoryTitleValue(l, meta, [
    "Rahmenfarbe",
    "Fassungsfarbe",
    "Farbe",
  ]);
  const shapeRaw =
    fact(l, [
      "Brillenform",
      "Rahmenform",
      "Fassungsform",
      "Form",
      "Stil",
      "Frame Shape",
      "Shape",
    ])?.value ?? "";
  const shape = translations[shapeRaw.toLowerCase()] ?? shapeRaw;
  const round = /^(rund|round|panto|rund panto)$/i.test(shape);
  const shapeText = round ? "Rund Panto" : shape;
  const material = categoryTitleValue(l, meta, [
    "Rahmenmaterial",
    "Fassungsmaterial",
    "Material",
  ]);
  const width =
    measured(l, ["Glasbreite", "Lens Width"]) ??
    Number(l.eyewear?.fields.lensWidth?.value.replace(/\s*mm$/i, "") || NaN);
  const total =
    measured(l, [
      "Gesamtbreite",
      "Fassungsbreite",
      "Total Frame Width",
      "Frame Width",
    ]) ??
    Number(l.eyewear?.fields.totalWidth?.value.replace(/\s*mm$/i, "") || NaN);
  const extras = [
    width !== undefined && width > 0 && width < 47 ? "kleine Gläser" : "",
    total !== undefined && total > 139 ? "groß L XL" : "",
    extraModelName,
    ...verifiedTitleKeywords(l, meta),
  ];
  const type = isSunglasses(l) ? "Sonnenbrille" : "Brille";
  const parts = [
    brand,
    type,
    sex,
    ...(round ? [shapeText, color] : [color, shapeText]),
    material,
    modelText,
    ...extras,
  ].filter(
    (part, index, all) =>
      Boolean(part) &&
      all.findIndex((p) => p.toLowerCase() === part.toLowerCase()) === index,
  );
  // Retain brand/model before optional keywords when the title reaches 80 characters.
  while (parts.join(" ").length > 80 && parts.length > 2) {
    let index = parts.length - 1;
    while (index > 1 && parts[index] === modelText) index--;
    if (index <= 1) break;
    parts.splice(index, 1);
  }
  return cleanListingText(parts.join(" ").replace(/\s+/g, " ")).slice(0, 80);
}
export const GERMAN_LISTING_PROMPT = `\nFor eBay.de write title, description, condition_notes, search terms, keywords, and item-specific names and values in German. Keep JSON keys and enum values unchanged. For eyewear use Marke, Modellnummer, Fassungsfarbe, Fassungsmaterial, Form, Abteilung, Glasbreite, Gesamtbreite. Brand/model identifiers and dimensions must be read from a label with an exact quote, never inferred. A lens width is not total frame width. Use Herren, Damen or Herren Damen in the title, never unisex, never xy. Title order: Marke Brille (or Sonnenbrille) Geschlecht Farbe Form Material (if supported) Modellnummer/model name keywords; round frames use Rund Panto before Farbe. Maximum 80 characters, prioritize brand and model. Standard colors (Tortoise becomes Braun). Only add kleine Gläser for a proven lens width below 47 mm; groß L XL only for proven total width above 139 mm. Seller default: unworn without case, in German Ungetragen ohne Etui. Do not infer or describe condition from photos; use only the seller-provided condition. Do not add a generic sales template; that is supplied by the seller settings.`;
