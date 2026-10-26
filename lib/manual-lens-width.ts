import type {ListingResult} from "./types";
import type {AspectMeta} from "./ebay/taxonomy";
import {mapEyewear} from "./eyewear-inscriptions";
const width=/^(Glasbreite|Gläserbreite|Glasdurchmesser|Scheibenbreite|Scheibengröße|Lens Width|Lens Size)$/i;
export function manualLensWidth(l:ListingResult,value:string,meta:AspectMeta[]):Partial<ListingResult> {
 const next:ListingResult={...l,eyewear:{...l.eyewear,fields:{...l.eyewear?.fields,lensWidth:{value,source:"manual"}},warnings:l.eyewear?.warnings ?? []}};
 const aspects=Object.fromEntries(Object.entries(l.item_specifics ?? {}).map(([k,v])=>[k,v.split(" | ").filter(Boolean)]));
 for(const name of Object.keys(aspects)) if(width.test(name)) delete aspects[name];
 for(const field of meta) if(width.test(field.name)) aspects[field.name]=[];
 mapEyewear(next,aspects,meta,"lensWidth");
 return {eyewear:next.eyewear,item_specifics:Object.fromEntries(Object.entries(aspects).map(([k,v])=>[k,v.join(" | ")])),
  manual_measurement_fields:[...new Set([...(l.manual_measurement_fields ?? []),"Glasbreite",...meta.filter(f=>width.test(f.name)).map(f=>f.name)])],
  evidence:Object.fromEntries(Object.entries(l.evidence ?? {}).filter(([k])=>!width.test(k))),
  estimates:Object.fromEntries(Object.entries(l.estimates ?? {}).filter(([k])=>!width.test(k)))};
}
