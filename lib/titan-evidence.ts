import type { ListingResult } from "./types";

const titanium = /\btitan(?:ium)?\b/i;
const materialKey = /^(Material|Fassungsmaterial|Rahmenmaterial|Frame Material|Bügelmaterial|Frontmaterial)$/i;
// Brand recognition and metal appearance do not establish the alloy.
export function titanEvidencePatch(l: ListingResult): Partial<ListingResult> | undefined {
  const field = l.eyewear?.fields.material;
  const brand = l.brand || l.item_specifics?.Marke || l.eyewear?.fields.brand?.value || "";
  const proven = (field?.source === "manual" && titanium.test(field.value)) ||
    (field?.source === "label" && titanium.test(field.value) && titanium.test(field.quote || "") && Boolean(field.photos?.length)) ||
    Boolean(l.eyewear?.materials?.some(part => part.source === "label" && titanium.test(part.value) && titanium.test(part.quote) && part.photos.length)) ||
    (field?.source === "shop" && titanium.test(field.value) && /^lindberg$/i.test(brand.trim()));
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
