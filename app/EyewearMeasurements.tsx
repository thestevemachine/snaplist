"use client";
import {photoMeasurement} from "@/lib/measurement-photos";
import {lensReference} from "@/lib/lens-reference";
import type {ListingResult} from "@/lib/types";
import type {AspectMeta} from "@/lib/ebay/taxonomy";
import {manualEyewearMeasurement,measurementDefinitions} from "@/lib/eyewear-measurements";
export function EyewearMeasurements({listing,meta,onEdit}:{listing:ListingResult;meta:AspectMeta[];onEdit:(patch:Partial<ListingResult>)=>void}) {
 const reference=lensReference(listing);
 return <section aria-label="Brillenmaße" className="measurement-grid">
  {measurementDefinitions.map(d=>{
   const field=d.key ? listing.eyewear?.fields[d.key] : undefined;
   const actual=meta.find(f=>d.pattern.test(f.name));
   const specific=Object.entries(listing.item_specifics ?? {}).find(([name])=>d.pattern.test(name))?.[1];
   const manual=field?.source === "manual" || listing.manual_measurement_fields?.some(name=>d.pattern.test(name));
   const measured=photoMeasurement(listing,d.key ?? "lensHeight");
   const calculated=reference && listing.frontMeasurement?.status!=="unavailable" ? d.label === "Gesamtbreite" ? listing.frontMeasurement?.totalWidthMm : d.label === "Glashöhe" ? listing.frontMeasurement?.lensHeightMm : d.label === "Stegbreite" ? listing.frontMeasurement?.bridgeWidthMm : undefined : undefined;
   const value=manual ? (listing.manual_measurement_values?.[d.label] ?? (field?.source==="manual" ? field.value : specific ?? "")) : (measured ? String(measured.mm) : "") || field?.value?.trim() || (calculated ? String(calculated) : /^\d+(?:\s*mm)?$/i.test(specific ?? "") ? specific! : "");
   return <label key={d.label} data-review-field={d.label}>{actual?.name.replace(/\s*\(mm\)$/i,"") ?? d.label} (mm)
    <input type="number" inputMode="numeric" min={d.key==="lensWidth" ? 20 : 1} max={d.key==="lensWidth" ? 90 : 250} step="1" aria-label={`${d.label} manuell (mm)`}
      value={value.replace(/\s*mm$/i,"")} placeholder="Nicht erkannt"
      onChange={event=>onEdit(manualEyewearMeasurement(listing,d.label,event.target.value,meta))}/>
    {!manual && measured && <small>Messfoto · {measured.evidence.method==="caliper" ? "Messschieber" : "Millimeterpapier"} · prüfen</small>}
    {!manual && !measured && calculated && <small>{listing.frontMeasurement?.status === "estimated" ? "Berechnet · Schätzung" : "Unsichere Schätzung · prüfen"}</small>}
   </label>;
  })}

  <small className="measurement-missing">{reference ? `Referenz: Glasbreite ${reference.mm} mm · ${reference.source==="manual" ? "manuell" : reference.quote}` : listing.measurementPhotos?.length ? "Messfoto berücksichtigt. Weitere Maße benötigen eine belegte Referenz." : "Glasbreite fehlt oder Aufdruck nicht belegt. Bitte Glasbreite eintragen; ohne Referenz keine Berechnung."}</small>
  {!!listing.frontMeasurement?.reasons.some(r=>r.startsWith("Referenzprüfung:")) && <small role="status">Nicht an eBay übernommen: Konturen passen nicht zum Kastenmaß. Bitte Maße manuell prüfen.</small>}
  {reference && !listing.frontMeasurement?.lensHeightMm && !photoMeasurement(listing,"lensHeight") && <small className="measurement-missing">{listing.frontMeasurement?.reasons?.join(" ") || "Frontkonturen fehlen. Unter ‚Maße berechnen‘ das Frontfoto wählen."}</small>}
 </section>;
}
