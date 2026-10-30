import {measurementChoice} from "./measurement-choice";
import type {ListingResult} from "./types";
import type {AspectMeta} from "./ebay/taxonomy";
import {mapEyewear,parseBoxDimensions,type EyewearKey} from "./eyewear-inscriptions";
import {manualLensWidth} from "./manual-lens-width";
const dimensionKeys=["lensWidth","bridgeWidth","templeLength"] as const;
export function boxSizePatch(l:ListingResult,meta:AspectMeta[]):Partial<ListingResult>|undefined {
 const fields={...l.eyewear?.fields};let changed=false;
 const storedBox=parseBoxDimensions(l.size ?? "");
 if(storedBox) for(const key of dimensionKeys) {
  const label=key==="lensWidth" ? "Glasbreite" : key==="bridgeWidth" ? "Stegbreite" : "Bügellänge";
  if(!fields[key]?.value?.trim() && fields[key]?.source!=="manual" && !l.manual_measurement_fields?.includes(label) && storedBox[key]) {
   fields[key]={value:storedBox[key]!,source:l.manual_measurement_fields?.includes("Größe") ? "manual" : "label",quote:l.size,photos:l.evidence?.Größe ?? l.evidence?.Kastenmaß ?? []};changed=true;
  }
 }
 const facts=Object.values(fields).filter(f=>f?.source==="label" && f.quote && f.photos?.length);
 for(const key of dimensionKeys) {
  if(fields[key]?.source==="manual" || (fields[key]?.value?.trim() && fields[key]?.quote && fields[key]?.photos?.length)) continue;
  const candidates=facts.flatMap(f=>{const d=parseBoxDimensions(f!.quote!);return d?.[key] ? [{...f!,value:d[key]!}] : []});
  if(new Set(candidates.map(f=>f.value)).size===1 && (!fields[key]?.value?.trim() || fields[key]!.value.replace(/\s*mm$/i, "")===candidates[0].value)) {fields[key]=candidates[0];changed=true;}
 }
 const box=[fields.lensWidth?.value,fields.bridgeWidth?.value].filter(Boolean).join(" □ ")+(fields.templeLength?.value ? ` ${fields.templeLength.value}` : "");
 const sizeMissing=!l.size?.trim() && !l.manual_measurement_fields?.includes("Größe") && Boolean(fields.lensWidth?.value && fields.bridgeWidth?.value);

 const next:ListingResult={...l,eyewear:{...l.eyewear,fields,warnings:l.eyewear?.warnings ?? []}};
 const aspects=Object.fromEntries(Object.entries(l.item_specifics ?? {}).map(([k,v])=>[k,v.split(" | ").filter(Boolean)]));
 mapEyewear(next,aspects,meta);
 for(const key of dimensionKeys) mapEyewear(next,aspects,meta.filter(m=>!aspects[m.name]?.length && !l.manual_measurement_fields?.includes(m.name)),key);
 for(const d of measurementDefinitions) {
  const value=l.manual_measurement_values?.[d.label];if(value===undefined) continue;
  const actual=meta.find(m=>d.pattern.test(m.name));if(!actual) continue;
  const choice=measurementChoice(actual.values,Number(value));
  if(value && !choice && actual.mode==="SELECTION_ONLY") continue;
  for(const name of Object.keys(aspects)) if(d.pattern.test(name) && name!==actual.name) delete aspects[name];
  aspects[actual.name]=!value ? [] : [choice ?? (actual.dataType==="NUMBER" ? value : `${value} mm`)];
 }
 if(!changed && !sizeMissing && JSON.stringify(aspects)===JSON.stringify(Object.fromEntries(Object.entries(l.item_specifics ?? {}).map(([k,v])=>[k,v.split(" | ").filter(Boolean)])))) return;
 return {eyewear:next.eyewear,item_specifics:Object.fromEntries(Object.entries(aspects).map(([k,v])=>[k,v.join(" | ")])),...(sizeMissing ? {size:box} : {})};
}
export const measurementDefinitions=[
 {label:"Glasbreite",key:"lensWidth",pattern:/^(Glasbreite|Gläserbreite|Scheibenbreite|Glasdurchmesser|Scheibengröße|Lens Width)(?:\s*\(mm\))?$/i},
 {label:"Stegbreite",key:"bridgeWidth",pattern:/^(Stegbreite|Brückenbreite|Bridge Width)(?:\s*\(mm\))?$/i},
 {label:"Bügellänge",key:"templeLength",pattern:/^(Bügellänge|Temple Length)(?:\s*\(mm\))?$/i},
 {label:"Glashöhe",key:undefined,pattern:/^(Glashöhe|Scheibenhöhe|Gläserhöhe|Lens Height)(?:\s*\(mm\))?$/i},
 {label:"Gesamtbreite",key:"totalWidth",pattern:/^(Gesamtbreite|Rahmenbreite|Fassungsbreite|Frame Width|Total Frame Width)(?:\s*\(mm\))?$/i},
] as const;
export function manualEyewearMeasurement(l:ListingResult,label:string,value:string,meta:AspectMeta[]):Partial<ListingResult> {
 const definition=measurementDefinitions.find(d=>d.label===label)!;
 if(definition.key==="lensWidth") return manualLensWidth(l,value,meta);
 const specific={...l.item_specifics};const actual=meta.find(m=>definition.pattern.test(m.name));
 const name=actual?.name ?? label;
 // Do not send an invented selection-only option to eBay.
 const choice=actual ? measurementChoice(actual.values,Number(value)) : undefined;
 const mapped=!value ? "" : choice ?? (actual?.mode==="SELECTION_ONLY" ? "" : actual?.dataType==="NUMBER" ? value : `${value} mm`);
 for(const alias of Object.keys(specific)) if(definition.pattern.test(alias)) delete specific[alias];
 if(actual) specific[name]=mapped;
 const eyewear=definition.key ? {...l.eyewear,fields:{...l.eyewear?.fields,[definition.key]:{value,source:"manual" as const}},warnings:l.eyewear?.warnings ?? []} : l.eyewear;
 return {item_specifics:specific,eyewear,manual_measurement_values:{...l.manual_measurement_values,[label]:value},manual_measurement_fields:[...new Set([...(l.manual_measurement_fields ?? []),name,label])],
  evidence:Object.fromEntries(Object.entries(l.evidence ?? {}).filter(([k])=>!definition.pattern.test(k))),
  estimates:Object.fromEntries(Object.entries(l.estimates ?? {}).filter(([k])=>!definition.pattern.test(k)))};
}
