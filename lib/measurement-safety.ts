import type {ListingResult} from "./types";
import {lensReference} from "./lens-reference";
const derived=/^(Scheibenhöhe|Glashöhe|Gläserhöhe|Gesamtbreite|Fassungsbreite|Rahmenbreite|Frame Width|Total Frame Width|Lens Height)(?:\s*\(mm\))?$/i;
// Repair old automatic estimates too. Explicit seller values and clears always win.
export function measurementSafetyPatch(l:ListingResult):Partial<ListingResult>|undefined {
 if(lensReference(l)) return;
 const specifics={...l.item_specifics},estimates={...l.estimates},evidence={...l.evidence};let changed=false;
 for(const name of Object.keys(specifics)) if(derived.test(name) && !l.manual_measurement_fields?.some(k=>derived.test(k) && (/höhe|height/i.test(k)===/höhe|height/i.test(name)))) {
  delete specifics[name];delete estimates[name];delete evidence[name];changed=true;
 }
 const total=l.eyewear?.fields.totalWidth;
 const eyewear=l.eyewear ? {...l.eyewear,fields:{...l.eyewear.fields}} : undefined;
 if(total && total.source!=="manual") {delete eyewear!.fields.totalWidth;changed=true;}
 const measurements=l.measurements?.split("\n").filter(line=>!/(?:Scheibenhöhe: ca\.|Gesamtbreite: ca\.).*(?:Frontfoto|Messfoto)/i.test(line)).join("\n");
 if(measurements!==l.measurements) changed=true;
 return changed ? {item_specifics:specifics,estimates,evidence,eyewear,measurements} : undefined;
}
