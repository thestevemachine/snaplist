"use client";
import {lensReference} from "@/lib/lens-reference";
import type {ListingResult} from "@/lib/types";
import type {AspectMeta} from "@/lib/ebay/taxonomy";
import {manualEyewearMeasurement,measurementDefinitions} from "@/lib/eyewear-measurements";
export function EyewearMeasurements({listing,meta,onEdit}:{listing:ListingResult;meta:AspectMeta[];onEdit:(patch:Partial<ListingResult>)=>void}) {
 const reference=lensReference(listing);
 return <section aria-label="Brillenmaße" className="measurement-grid">
  {measurementDefinitions.map(d=>{
   const field=d.key ? listing.eyewear?.fields[d.key] : undefined;
   const specific=Object.entries(listing.item_specifics ?? {}).find(([name])=>d.pattern.test(name))?.[1];
   const manual=field?.source === "manual" || listing.manual_measurement_fields?.some(name=>d.pattern.test(name));
   const calculated=reference && listing.frontMeasurement?.status!=="unavailable" ? d.label === "Gesamtbreite" ? listing.frontMeasurement?.totalWidthMm : d.label === "Glashöhe" ? listing.frontMeasurement?.lensHeightMm : undefined : undefined;
   const value=manual ? (field?.source==="manual" ? field.value : specific ?? "") : field?.value?.trim() || specific?.trim() || (calculated ? String(calculated) : "");
   return <label key={d.label} data-review-field={d.label}>{d.label} (mm)
    <input type="number" inputMode="numeric" min={d.key==="lensWidth" ? 20 : 1} max={d.key==="lensWidth" ? 90 : 250} step="1" aria-label={`${d.label} manuell (mm)`}
      value={value.replace(/\s*mm$/i,"")} placeholder="Nicht erkannt"
      onChange={event=>onEdit(manualEyewearMeasurement(listing,d.label,event.target.value,meta))}/>
    {!manual && calculated && <small>{listing.frontMeasurement?.status === "estimated" ? "Berechnet · Schätzung" : "Unsichere Schätzung · prüfen"}</small>}
   </label>;
  })}
  <small className="measurement-missing">{reference ? `Referenz: Glasbreite ${reference.mm} mm · ${reference.source==="manual" ? "manuell" : reference.quote}` : "Glasbreite fehlt oder Aufdruck nicht belegt. Bitte Glasbreite eintragen; ohne Referenz keine Berechnung."}</small>
  {reference && !listing.frontMeasurement?.lensHeightMm && <small className="measurement-missing">{listing.frontMeasurement?.reasons?.join(" ") || "Frontkonturen fehlen. Unter ‚Maße berechnen‘ das Frontfoto wählen."}</small>}
 </section>;
}
