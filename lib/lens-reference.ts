import type {ListingResult} from "./types";
import {parseBoxDimensions,parseLindbergDemoLens} from "./eyewear-inscriptions";
// A photo ID and a model-assigned source label do not establish a metric scale.
export function lensReference(listing:ListingResult) {
 const ref=listing.eyewear?.fields.lensWidth;
 if(!ref || !/^\d{2}(?:[.,]\d+)?(?:\s*mm)?$/i.test(ref.value.trim())) return;
 const mm=Number(ref.value.trim().replace(/\s*mm$/i,"").replace(",","."));
 if(mm<20 || mm>90) return;
 if(ref.source==="manual") return {...ref,source:"manual" as const,mm};
 if(ref.source!=="label" || !ref.quote?.trim() || !ref.photos?.some(n=>Number.isInteger(n) && n>0 && n<=24)) return;
 const box=parseBoxDimensions(ref.quote);
 if(box) return Number(box.lensWidth)===mm ? {...ref,source:"label" as const,mm} : undefined;
 const lindberg=[listing.brand,listing.item_specifics?.Marke,listing.eyewear?.fields.brand?.value].some(v=>/^lindberg$/i.test(v ?? "")) || /\blindberg\b/i.test(ref.quote);
 const demo=lindberg ? parseLindbergDemoLens(ref.quote) : undefined;
 if(demo) return Number(demo.lensWidth)===mm ? {...ref,source:"label" as const,mm} : undefined;
 const explicit=ref.quote.match(/(?:glasbreite|scheibenbreite|lens\s*(?:width|size))\s*[:=]?\s*(\d{2}(?:[.,]\d+)?)(?:\s*mm)?\b/i)
  ?? ref.quote.trim().match(/^(\d{2}(?:[.,]\d+)?)\s*mm$/i);
 return explicit && Number(explicit[1].replace(",","."))===mm ? {...ref,source:"label" as const,mm} : undefined;
}
