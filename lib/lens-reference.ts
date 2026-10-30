import {photoMeasurement} from "./measurement-photos";
import type {ListingResult} from "./types";
import {parseBoxDimensions,parseLindbergDemoLens} from "./eyewear-inscriptions";
// A photo ID and a model-assigned source label do not establish a metric scale.
export function lensReference(listing:ListingResult) {
 const ref=listing.eyewear?.fields.lensWidth;
 const measured=photoMeasurement(listing,"lensWidth");
 if(ref?.source!=="manual" && !listing.manual_measurement_fields?.includes("Glasbreite") && measured && (!ref?.value || Number(ref.value.replace(/\s*mm$/i,""))===measured.mm)) return {value:String(measured.mm),mm:measured.mm,source:"measurement" as const,quote:`Messfoto: ${measured.evidence.method==="caliper" ? "Messschieber "+measured.evidence.reading : "Millimeterpapier"}`,photos:[measured.evidence.photoIndex]};
 if(!ref || !/^\d{2}(?:[.,]\d+)?(?:\s*mm)?$/i.test(ref.value.trim())) return;
 const mm=Number(ref.value.trim().replace(/\s*mm$/i,"").replace(",","."));
 if(mm<20 || mm>90) return;
 if(ref.source==="manual") return {...ref,source:"manual" as const,mm};
 if(ref.source!=="label") return;
 // Older drafts may retain the number's short quote but the full box on another field.
 const candidates=Object.values(listing.eyewear?.fields ?? {}).filter(f=>f?.source==="label" && f.quote && f.photos?.some(n=>Number.isInteger(n) && n>0 && n<=24)).flatMap(f=>{const box=parseBoxDimensions(f!.quote!);return box ? [{...f!,value:box.lensWidth,mm:Number(box.lensWidth)}] : []});
 const widths=new Set(candidates.map(f=>f.mm));
 if(widths.size===1 && candidates[0].mm===mm) return {...candidates[0],source:"label" as const};
 if(!ref.quote?.trim() || !ref.photos?.some(n=>Number.isInteger(n) && n>0 && n<=24)) return;
 const box=parseBoxDimensions(ref.quote);
 if(box) return Number(box.lensWidth)===mm ? {...ref,source:"label" as const,mm} : undefined;
 const lindberg=[listing.brand,listing.item_specifics?.Marke,listing.eyewear?.fields.brand?.value].some(v=>/^lindberg$/i.test(v ?? "")) || /\blindberg\b/i.test(ref.quote);
 const demo=lindberg ? parseLindbergDemoLens(ref.quote) : undefined;
 if(demo) return Number(demo.lensWidth)===mm ? {...ref,source:"label" as const,mm} : undefined;
 const explicit=ref.quote.match(/(?:glasbreite|scheibenbreite|lens\s*(?:width|size))\s*[:=]?\s*(\d{2}(?:[.,]\d+)?)(?:\s*mm)?\b/i)
  ?? ref.quote.trim().match(/^(\d{2}(?:[.,]\d+)?)(?:\s*mm)?$/i);
 return explicit && Number(explicit[1].replace(",","."))===mm ? {...ref,source:"label" as const,mm} : undefined;
}
