import type { AspectMeta } from "./ebay/taxonomy";
import type { ListingResult } from "./types";

const titanium = /\btitan(?:ium)?\b/i;
const materialKey = /^(Material|Fassungsmaterial|Rahmenmaterial|Frame Material|Bügelmaterial|Frontmaterial)$/i;
// Brand recognition and metal appearance do not establish the alloy.
export function titanEvidencePatch(l: ListingResult): Partial<ListingResult> | undefined {
  const field = l.eyewear?.fields.material;
  const brand = l.brand || l.item_specifics?.Marke || l.eyewear?.fields.brand?.value || "";
  const icBerlin = [l.brand,l.item_specifics?.Marke,l.item_specifics?.Brand,l.eyewear?.fields.brand?.value]
    .some(value => /^icberlin/i.test((value || "").replace(/[^a-z]/gi, "")));
  const manual = field?.source === "manual" && titanium.test(field.value);
  // Repeated OCR hallucinations: ic! berlin titanium needs seller confirmation.
  const proven = manual || (!icBerlin && (
    (field?.source === "label" && titanium.test(field.value) && titanium.test(field.quote || "") && Boolean(field.photos?.length)) ||
    Boolean(l.eyewear?.materials?.some(part => part.source === "label" && titanium.test(part.value) && titanium.test(part.quote) && part.photos.length)) ||
    (field?.source === "shop" && titanium.test(field.value) && /^lindberg$/i.test(brand.trim()))));
  if (proven) return;
  const replace = (value: string) => value.replace(/\btitan(?:ium)?\b/gi, "Metall");
  const materialValue = (value: string) => [...new Set(value.split(" | ").map(replace))].join(" | ");
  const specifics = Object.fromEntries(Object.entries(l.item_specifics ?? {}).map(([name,value]) => [name,materialKey.test(name) ? materialValue(value) : value]));
  const changed = titanium.test(l.material || "") || titanium.test(field?.value || "") ||
    Boolean(l.eyewear?.materials?.some(part => titanium.test(part.value))) ||
    Object.entries(l.item_specifics ?? {}).some(([name,value]) => materialKey.test(name) && titanium.test(value)) ||
    (!l.title_manually_edited && titanium.test(l.title));
  if (!changed) return;
  const eyewear = l.eyewear ? {...l.eyewear,fields:{...l.eyewear.fields},materials:l.eyewear.materials?.map(part => ({...part,value:materialValue(part.value)}))} : undefined;
  if (eyewear?.fields.material && titanium.test(eyewear.fields.material.value)) delete eyewear.fields.material;
  return {material:l.material ? materialValue(l.material) : l.material,item_specifics:specifics,
    title:l.title_manually_edited ? l.title : replace(l.title),eyewear};
}

// Titanium is also a metal; add the generic material where eBay permits both.
export function titanMetalPatch(l: ListingResult, meta: AspectMeta[]): Partial<ListingResult> | undefined {
 const specifics = {...l.item_specifics};
 let changed=false;
 for(const field of meta) {
  if(!materialKey.test(field.name) || field.cardinality !== "MULTI") continue;
  const values=(specifics[field.name] || "").split(" | ").filter(Boolean);
  if(!values.some(v=>titanium.test(v)) || values.some(v=>/^metall$/i.test(v))) continue;
  const metal=field.values.find(v=>/^metall$/i.test(v)) || (!field.values.length && field.mode === "FREE_TEXT" ? "Metall" : undefined);
  if(!metal) continue;
  specifics[field.name]=[...values,metal].join(" | ");changed=true;
 }
 return changed ? {item_specifics:specifics} : undefined;
}
