import type { ListingResult } from "./types";
import type { AspectMeta } from "./ebay/taxonomy";

// Seller-requested style associations, not evidence of age, brand or licensed characters.
// Apply once per draft so later seller edits/clears survive reloading and preparation.
export function eyewearStyleTagsPatch(
  listing: ListingResult,
  meta: AspectMeta[],
): Partial<ListingResult> | undefined {
  if (listing.style_tags_version === 1) return;
  const fields = meta.filter((m) => /^(Thema|Charakter)$/i.test(m.name));
  if (!fields.length) return;
  const text = [
    listing.title,
    listing.color,
    listing.material,
    ...Object.entries(listing.item_specifics ?? {})
      .filter(([k]) =>
        /farbe|form|material|stil|rahmentyp|fassungsart/i.test(k),
      )
      .map(([, v]) => v),
  ].join(" ");
  const candidates: string[] = [];
  if (/rund|round|panto/i.test(text))
    candidates.push("Rund", "Panto", "Retro", "Intellektuell", "Klassisch");
  if (/rechteck|eckig|square|quadratisch/i.test(text))
    candidates.push(
      "Geometrisch",
      "Minimalistisch",
      "Modern",
      "Business",
      "Y2K",
    );
  if (/oval/i.test(text))
    candidates.push("Oval", "Retro", "90er-Stil", "Minimalistisch", "Y2K");
  if (/cateye|cat.eye|katzen/i.test(text))
    candidates.push("Cat-Eye", "Retro", "Elegant", "Glamour", "Ausdrucksstark");
  if (/schwarz|black/i.test(text))
    candidates.push("Schwarz", "Monochrom", "Minimalistisch", "Klassisch");
  if (/gold/i.test(text)) candidates.push("Gold", "Elegant", "Glamour");
  if (/silber|silver|titan|metall|metal/i.test(text))
    candidates.push("Metall-Look", "Minimalistisch", "Modern");
  if (/braun|havana|havanna|tortoise/i.test(text))
    candidates.push("Havanna-Look", "Naturtöne", "Klassisch", "Retro");
  if (/blau|grün|rot|rosa|lila|gelb|mehrfarbig/i.test(text))
    candidates.push("Farbenfroh", "Ausdrucksstark", "Modern");
  candidates.push("Mode", "Alltag", "Zeitlos", "Urban", "Eyewear");
  const specifics = { ...listing.item_specifics };
  const estimates = { ...listing.estimates };
  const evidence = { ...listing.evidence };
  for (const field of fields) {
    const current = (specifics[field.name] ?? "")
      .split(" | ")
      .map((v) => v.trim())
      .filter(Boolean);
    const limit = field.cardinality === "MULTI" ? 5 : 1;
    const options = candidates.flatMap((v) => {
      const allowed = field.values.find(
        (choice) => choice.toLowerCase() === v.toLowerCase(),
      );
      return allowed
        ? [allowed]
        : field.mode === "FREE_TEXT" && v.length <= (field.maxLength ?? 65)
          ? [v]
          : [];
    });
    const next = [...new Set([...current, ...options])].slice(0, limit);
    if (next.join(" | ") !== current.join(" | ")) {
      specifics[field.name] = next.join(" | ");
      // The whole field contains stylistic suggestions, not a verified photo fact.
      delete estimates[field.name];
      delete evidence[field.name];
    }
  }
  return {
    style_tags_version: 1,
    item_specifics: specifics,
    estimates,
    evidence,
  };
}
