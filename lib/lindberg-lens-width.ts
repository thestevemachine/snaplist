import type {AspectMeta} from "./ebay/taxonomy";
import type { ListingResult } from "./types";
import {parseLindbergDemoLens} from "./eyewear-inscriptions";
import {calculateFrontMeasurement, type ImageSize} from "./front-measurements";
// Reuse stored inscription evidence and geometry; no provider call or photo upload.
export function lindbergLensWidthPatch(l: ListingResult, meta: AspectMeta[] = []): Partial<ListingResult> | undefined {
 if (![l.brand,l.item_specifics?.Marke,l.eyewear?.fields.brand?.value].some(v=>/^lindberg$/i.test(v || ""))) return;
 const old=l.eyewear?.fields.lensWidth;
 if(old?.source === "manual" || old?.value.trim() || l.manual_measurement_fields?.some(k=>/^(Glasbreite|Scheibenbreite|Scheibengröße|Gläserbreite|Lens Width|Lens Size)$/i.test(k))) return;
 const candidates=Object.values(l.eyewear?.fields ?? {}).flatMap(f=> {
  if(f?.source !== "label" || !f.quote || !f.photos?.length) return [];
  const pair=parseLindbergDemoLens(f.quote);
  return pair ? [{value:pair.lensWidth,source:"label" as const,quote:f.quote,photos:f.photos}] : [];
 });
 if(new Set(candidates.map(c=>c.value)).size !== 1) return;
 const eyewear={...l.eyewear!,fields:{...l.eyewear?.fields,lensWidth:candidates[0]}};
 const specifics={...l.item_specifics};
 for(const field of meta) {
  if(!/^(Glasbreite|Scheibenbreite|Scheibengröße|Gläserbreite|Glasdurchmesser|Lens Width|Lens Size)$/i.test(field.name) || specifics[field.name]?.trim()) continue;
  const value=field.values.find(v=>Number(v.replace(/\s*mm$/i,""))===Number(candidates[0].value));
  if(value || field.mode === "FREE_TEXT") specifics[field.name]=value ?? (field.dataType === "NUMBER" ? candidates[0].value : `${candidates[0].value} mm`);
 }
 const patch:Partial<ListingResult>={eyewear,item_specifics:specifics};
 const m=l.frontMeasurement, o=m?.observation;
 if(o && m?.lensWidthPx && m.lensHeightPx) {
  const w=((o.leftLens.right.x-o.leftLens.left.x)+(o.rightLens.right.x-o.rightLens.left.x))/2;
  const h=((o.leftLens.bottom.y-o.leftLens.top.y)+(o.rightLens.bottom.y-o.rightLens.top.y))/2;
  if(w>0 && h>0) {
   const sizes:(ImageSize|undefined)[]=Array(m.photoIndex).fill(undefined);
   sizes[m.photoIndex-1]={width:m.lensWidthPx/w,height:m.lensHeightPx/h};
   const recalculated=calculateFrontMeasurement(o,sizes,{...l,eyewear});
   patch.frontMeasurement=recalculated;
   // Replace only prior automatically derived values; explicit seller fields stay intact.
   for(const [name,value] of Object.entries(specifics)) {
    if(l.manual_measurement_fields?.includes(name) || !l.estimates?.[name]) continue;
    const oldValue=Number(value.replace(/\s*mm$/i,""));
    const next=/^(Gesamtbreite|Rahmenbreite|Fassungsbreite)$/i.test(name) && oldValue===m.totalWidthMm ? recalculated.totalWidthMm
      : /^(Scheibenhöhe|Glashöhe|Gläserhöhe)$/i.test(name) && oldValue===m.lensHeightMm ? recalculated.lensHeightMm : undefined;
    if(next && recalculated.status !== "unavailable" && !recalculated.reasons.some(r=>r.startsWith("Referenzprüfung:")))
      specifics[name]=/mm\s*$/i.test(value) ? `${next} mm` : String(next);
   }
   patch.item_specifics=specifics;
  }
 }
 return patch;
}
