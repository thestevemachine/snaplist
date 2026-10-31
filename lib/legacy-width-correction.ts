import type {ListingResult} from "./types";
import type {AspectMeta} from "./ebay/taxonomy";
import {frontMeasurementFields} from "./front-measurement-fields";
import {measurementChoice} from "./measurement-choice";
import {lensReference} from "./lens-reference";
const width=/^(Gesamtbreite|Rahmenbreite|Fassungsbreite|Frame Width|Total Frame Width)(?:\s*\(mm\))?$/i;
// Undo only explicitly marked old automatic offsets; never adjust manual widths.
export function removeLegacyWidthCorrection(l:ListingResult,meta:AspectMeta[]):Partial<ListingResult>|undefined {
 const old=l.frontMeasurement;if(old?.totalWidthCorrectionMm!==3) return;
 const {totalWidthCorrectionMm,...measurement}=old;
 const manual=l.eyewear?.fields.totalWidth?.source==="manual" || l.manual_measurement_fields?.some(n=>width.test(n));
 const usable=lensReference(l) && old.status!=="unavailable" && old.totalWidthMm && !old.reasons.some(r=>r.startsWith("Referenzprüfung:"));
 if(usable) measurement.totalWidthMm=old.totalWidthMm!+3;
 const specifics={...l.item_specifics},estimates={...l.estimates},evidence={...l.evidence};
 if(usable && !manual) for(const [name,value] of Object.entries(specifics)) {
  if(!width.test(name) || estimates[name]===undefined) continue;
  const field=meta.find(m=>m.name===name);
  const previousChoice=field ? measurementChoice(field.values,old.totalWidthMm!) : undefined;
  if(Number(value.replace(/\s*mm$/i,""))===old.totalWidthMm || (previousChoice && value===previousChoice)) {delete specifics[name];delete estimates[name];delete evidence[name];}
 }
 const next={...l,item_specifics:specifics,estimates,evidence,frontMeasurement:measurement};
 const patch:Partial<ListingResult>={frontMeasurement:measurement,item_specifics:specifics,estimates,evidence};
 Object.assign(patch,frontMeasurementFields(next,meta));
 if(usable && !manual) {
  const from=`Gesamtbreite: ca. ${old.totalWidthMm} mm`,to=`Gesamtbreite: ca. ${measurement.totalWidthMm} mm`;
  if(l.measurements && /Frontfoto|Pixelberechnung/i.test(l.measurements)) patch.measurements=l.measurements.replace(from,to);
  patch.description=l.description.replace(`${from} (aus Frontfoto berechnet)`,`${to} (aus Frontfoto berechnet)`);
 }
 return patch;
}
