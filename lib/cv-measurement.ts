import {z} from 'zod';
import {lensReference} from './lens-reference';
import type {ListingResult,ItemGroup} from './types';
import type {FrontMeasurement} from './front-measurements';
export const WIDTH_RANGE_NOTE = "Gesamtbreite außerhalb des üblichen Bereichs (130–143 mm). Grobe Schätzung, bitte nachmessen.";

export function automaticFrameWidth(raw: number, lensWidth?: number, bridgeWidth?: number) {
  if (raw >= 130 && raw <= 143) return { mm: Math.round(raw), fallback: false };
  const fromBox = 2 * (lensWidth ?? 0) + (bridgeWidth ?? 0) + 12;
  return { mm: lensWidth && bridgeWidth && fromBox >= 130 && fromBox <= 143 ? Math.round(fromBox) : 137, fallback: true };
}
export const CV_VERSION='opencv-browser-v8.1';
const point=z.tuple([z.number().finite().min(0).max(1),z.number().finite().min(0).max(1)]);
export const cvPointsSchema=z.object({left_left:point,left_right:point,left_top:point,left_bottom:point,right_left:point,right_right:point,right_top:point,right_bottom:point,outer_left:point.optional(),outer_right:point.optional()});
export type CvPoints=z.infer<typeof cvPointsSchema>;
export const cvRecordSchema=z.object({version:z.string().max(60),key:z.string().max(6000),photoId:z.string().max(200),photoIds:z.array(z.string().max(200)).max(1000),size:z.tuple([z.number().min(1).max(10000),z.number().min(1).max(10000)]),points:cvPointsSchema.optional(),createdAt:z.number().finite(),corrected:z.boolean().optional()});
export type CvRecord=z.infer<typeof cvRecordSchema>;
export function cvKey(group:Pick<ItemGroup,'photoIds'|'evidencePhotoIds'>,listing:ListingResult){const r=lensReference(listing);return r?JSON.stringify([CV_VERSION,group.evidencePhotoIds??group.photoIds,group.photoIds,r.mm,r.source,r.quote??'',listing.eyewear?.fields.bridgeWidth??null]):undefined}
export function cvMeasurement(record:CvRecord,listing:ListingResult,photoIndex:number,reasons:string[]=[]):FrontMeasurement{
 const ref=lensReference(listing);const result:FrontMeasurement={method:'opencv-boxing-v1',status:'unavailable',photoIndex,reasons:[...reasons,'OpenCV · vorläufige Schätzung, am Foto prüfen.'],cv:record};
 if(!ref){result.reasons.push('Belegte Glasbreite fehlt.');return result}
 result.referenceMm=ref.mm;result.referenceSource=ref.source;result.referenceQuote=ref.source==='manual'?'Manuell bestätigte Glasbreite':ref.quote;result.referencePhotos=ref.photos??[];
 const parsed=cvPointsSchema.safeParse(record.points);if(!parsed.success){result.reasons.push('Glaskonturen fehlen oder sind ungültig.');return result}
 const p=parsed.data,[w,h]=record.size;result.imageSize={width:w,height:h};
 const pixel=(key:keyof CvPoints)=>{const v=p[key]!;return [v[0]*w,v[1]*h]};const centre=(a:keyof CvPoints,b:keyof CvPoints)=>{const x=pixel(a),y=pixel(b);return[(x[0]+y[0])/2,(x[1]+y[1])/2]};
 const l=centre('left_left','left_right'),r=centre('right_left','right_right'),angle=Math.atan2(r[1]-l[1],r[0]-l[0]),c=Math.cos(angle),s=Math.sin(angle);
 const q=(key:keyof CvPoints)=>{const[x,y]=pixel(key);return[x*c+y*s,-x*s+y*c]};const widths=[q('left_right')[0]-q('left_left')[0],q('right_right')[0]-q('right_left')[0]],heights=[q('left_bottom')[1]-q('left_top')[1],q('right_bottom')[1]-q('right_top')[1]];
 if(Math.min(...widths)<80||Math.min(...heights)<=0||w<600||h<200){result.reasons.push('Konturen widersprüchlich oder Auflösung zu gering.');return result}
 const scale=ref.mm/((widths[0]+widths[1])/2),gap=(q('right_left')[0]-q('left_right')[0])*scale;
 const bridge=listing.eyewear?.fields.bridgeWidth;const bridgeMm=Number(bridge?.value.replace(/\s*mm$/i,'').replace(',','.'));const bridgeKnown=bridge?.source==='manual'||(bridge?.source==='label'&&bridge.quote&&bridge.photos?.length);
 const failures=[];
 if(Math.abs(angle*180/Math.PI)>12)failures.push('Fassungsrotation zu groß.');
 if(Math.abs(widths[0]-widths[1])/Math.max(...widths)>.12||Math.abs(heights[0]-heights[1])/Math.max(...heights)>.12)failures.push('Glasöffnungen unterscheiden sich deutlich.');
 if(gap<5||gap>40)failures.push('Glasabstand unplausibel.');
 if(bridgeKnown&&bridgeMm>=5&&bridgeMm<=40&&Math.abs(gap-bridgeMm)>Math.max(3,bridgeMm*.15))failures.push('Glasabstand passt nicht zum Kastenmaß.');
 if(failures.length){result.reasons.push(...failures.map(s=>'Referenzprüfung: '+s));return result}
 const height=(heights[0]+heights[1])/2*scale;if(height<10||height>90)return result;
 result.lensHeightMm=Math.round(height);result.lensWidthPx=(widths[0]+widths[1])/2;result.lensHeightPx=(heights[0]+heights[1])/2;
 if(p.outer_left&&p.outer_right){const span=q('outer_right')[0]-q('outer_left')[0],total=span*scale;if(q('outer_left')[0]<q('left_left')[0]&&q('outer_right')[0]>q('right_right')[0]){const width=automaticFrameWidth(total,ref.mm,bridgeKnown?bridgeMm:undefined);result.totalWidthMm=width.mm;result.totalWidthPx=span;if(width.fallback)result.reasons.push(WIDTH_RANGE_NOTE)}}
 // Keep the read/confirmed bridge as authority; don't publish a second inferred bridge.
 result.status='uncertain';return result;
}
export function keepCvMeasurement(previous:ListingResult|undefined,next:ListingResult,group:Pick<ItemGroup,'photoIds'|'evidencePhotoIds'>){const old=previous?.frontMeasurement;if(old?.cv&&old.cv.key===cvKey(group,next))return old;return undefined}
