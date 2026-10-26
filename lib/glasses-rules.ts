import { cleanListingText } from "./listing-content-rules";
import type { ListingResult } from "./types";
import type { AspectMeta } from "./ebay/taxonomy";
import { isSunglasses } from "./category-selection";
import { matchAllowed } from "./ebay/aspects";

export const GLASSES_RULES_VERSION = 4;
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
  /farbe|material|^stil$/i.test(name);
// The localized category field wins over an old English duplicate, including a seller-cleared value.
export function germanAspects(
  l: ListingResult,
  aspects: Record<string, string[]>,
  meta: AspectMeta[],
) {
  const lensShape = ["Glasform", "Scheibenform", "Lens Shape"]
    .map((k) => l.item_specifics?.[k])
    .find(Boolean);
  if (lensShape && /^(rund|round)$/i.test(lensShape.trim())) {
    for (const m of meta.filter((m) =>
      /^(Brillenform|Rahmenform|Fassungsform|Form)$/i.test(m.name),
    )) {
      const round = m.values.find((v) => /^rund$/i.test(v));
      if (round) aspects[m.name] = [round];
    }
  }
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
  for (const m of meta.filter((m) =>
    /^(Rahmenfarbe|Fassungsfarbe|Farbe)$/i.test(m.name),
  )) {
    if (new Set(aspects[m.name] ?? []).size > 2) {
      const multi = m.values.find((v) => /^mehrfarbig$/i.test(v));
      if (multi) aspects[m.name] = [multi];
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
  for (const field of meta.filter((m) =>
    /^(Charakter|Charakter Familie|Besonderheiten|Stil|Fassungsart|Rahmentyp)$/i.test(
      m.name,
    ),
  )) {
    for (const raw of (l.item_specifics?.[field.name] ?? "").split(" | ")) {
      const value = field.values.find(
        (v) => v.toLowerCase() === raw.toLowerCase(),
      );
      if (value && !/^(nein|ja|keine|nicht zutreffend|unbekannt)$/i.test(value))
        result.push(value);
    }
  }
  const country = fact(l, [
    "Herstellungsland und -region",
    "Herstellungsland",
    "Ursprungsland",
    "Country/Region of Manufacture",
    "Country of Origin",
  ]);
  if (
    country &&
    l.estimates?.[country.key] === undefined &&
    !/unbekannt|nicht zutreffend|unknown/i.test(country.value)
  ) {
    const countries: Record<string, string> = {
      denmark: "Dänemark",
      germany: "Deutschland",
      italy: "Italien",
      japan: "Japan",
      france: "Frankreich",
      austria: "Österreich",
    };
    result.unshift(countries[country.value.toLowerCase()] ?? country.value);
  }
  // Specific identifiers and physical features outrank generic marketing adjectives.
  const weak =
    /^(leichtgewicht(?:ig)?|leicht|lightweight|komfortabel|bequem|elegant|klassisch|modern|stylisch)$/i;
  const strong = result.filter((v) => !weak.test(v));
  if (
    result.some((v) => /^(leichtgewicht(?:ig)?|leicht|lightweight)$/i.test(v))
  )
    strong.push("leicht");
  return [...new Set(strong)];
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
  let color = categoryTitleValue(l, meta, [
    "Rahmenfarbe",
    "Fassungsfarbe",
    "Farbe",
  ]);
  const colorField = meta.find((m) =>
    /^(Rahmenfarbe|Fassungsfarbe|Farbe)$/i.test(m.name),
  );
  const rawColors = Array.isArray(l.color)
    ? l.color
    : (l.color ?? "").split(/\s*[|;,]\s*/);
  const knownColors = [
    ...new Set(
      rawColors
        .map((v) =>
          matchAllowed(
            translations[v.toLowerCase()] ?? v,
            colorField?.values ?? [],
          ),
        )
        .filter(Boolean),
    ),
  ];
  const selectedColors = colorField
    ? (l.item_specifics?.[colorField.name] ?? "").split(" | ").filter(Boolean)
    : [];
  if (
    selectedColors.length > 2 ||
    selectedColors.some((v) => /^mehrfarbig$/i.test(v))
  )
    color = "Mehrfarbig";
  else if (knownColors.length === 2) color = knownColors.join(" ");
  else if (knownColors.length > 2) color = "Mehrfarbig";
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
  const shape = [
    ...new Set(
      shapeRaw.split(" | ").map((v) => translations[v.toLowerCase()] ?? v),
    ),
  ].join(" ");
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
  const colorCode = fact(l, [
    "Farbcode",
    "Color Code",
    "Herstellerfarbe",
    "Manufacturer Color",
  ]);
  const provenColorCode =
    colorCode && l.estimates?.[colorCode.key] === undefined
      ? colorCode.value
      : l.eyewear?.fields.colorCode?.value || "";
  const extras = [
    extraModelName,
    provenColorCode,
    ...verifiedTitleKeywords(l, meta).filter((v) => v !== "leicht"),
    width !== undefined && width > 0 && width < 47 ? "kleine Gläser" : "",
    total !== undefined && total > 139 ? "groß L XL" : "",
    ...verifiedTitleKeywords(l, meta).filter((v) => v === "leicht"),
  ];
  const type = isSunglasses(l) ? "Sonnenbrille" : "Brille";
  const parts = [
    brand,
    type,
    sex,
    ...(round ? [shapeText, color] : [color, shapeText]),
    material,
    modelText,
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
  // Fit each useful keyword independently: a long keyword must not discard shorter ones.
  for (const extra of extras) {
    const word = cleanListingText(extra).trim();
    if (!word || parts.join(" ").toLowerCase().includes(word.toLowerCase()))
      continue;
    if ([...parts, word].join(" ").length <= 80) parts.push(word);
  }
  return cleanListingText(parts.join(" ").replace(/\s+/g, " ")).slice(0, 80);
}
export const GERMAN_LISTING_PROMPT = `\n For eyewear: MPN/Herstellernummer is not the model number; leave it empty unless explicitly identified as a manufacturer part number. Default Abteilung to Unisex Erwachsene when unclear; Vintage to Nein when uncertain. Sonnenbrillen have Produktart Sonnenbrille. Determine shape from the LENS outline: round lenses mean Rund even in a rectangular outer frame. Temple length includes mm. For eBay.de write title, description, condition_notes, search terms, keywords, and item-specific names and values in German. Keep JSON keys and enum values unchanged. For eyewear use Marke, Modellnummer, Fassungsfarbe, Fassungsmaterial, Form, Abteilung, Glasbreite, Gesamtbreite. Brand/model identifiers and dimensions must be read from a label with an exact quote, never inferred. A lens width is not total frame width. Use Herren, Damen or Herren Damen in the title, never unisex, never xy. Title order: Marke Brille (or Sonnenbrille) Geschlecht Farbe Form Material (if supported) Modellnummer/model name keywords; round frames use Rund Panto before Farbe. Maximum 80 characters, prioritize brand and model. Prioritize exact model number, model name and manufacturer color code/name over generic adjectives. Read country of manufacture from inscriptions; never infer it from brand nationality. Prefer concise useful search terms shared across German and English when accurate (Pilot, Oval, Panto); no invented translations or arbitrary extra shapes. Avoid filler adjectives; use leicht only as a last-priority replacement for Leichtgewicht. For Besonderheiten supply every matching visible feature and at least one when supported. Randlos is not Halbrand: nylon-mounted semi-rimless frames may use Halbrand/Halbrahmen; do not label rimless frames Vollrand or Halbrand. Rectangular frames may also be Eckig. For Thema AND Charakter suggest five relevant style associations each when the category allows multiple values and free text; derive original descriptive associations from visible shape, color and design, e.g. Retro, Panto, Minimalistisch, Y2K, 80er-Stil, 90er-Stil, 2000er-Stil or 2010er-Stil only when visually compatible; decade themes (70er, 80er, 90er) describe style only, never the production year. Do not add incompatible themes just to reach five. Extract visible rim construction (Randlos, Halbrand, Vollrand) and all genuinely matching style/character values. Use multiple relevant values when supported; never invent licensed fictional characters, brand affiliations or actual production years; Charakter may describe a style persona, not a claimed affiliation. Standard colors (Tortoise becomes Braun). Inspect the colors of both front and temples, even when one is metal and another acetate: two colors must be two separate standard words/values, e.g. Grün | Gold, not Grün-Gold. More than two distinct frame colors become Mehrfarbig. Do not count lens color as frame color. Only add kleine Gläser for a proven lens width below 47 mm; groß L XL only for proven total width above 139 mm. Seller default: unworn without case, in German Ungetragen ohne Etui. Do not infer or describe condition from photos; use only the seller-provided condition. Do not add a generic sales template; that is supplied by the seller settings.`;
