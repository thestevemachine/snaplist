import type {ListingResult} from "./types";
import type {AspectMeta} from "./ebay/taxonomy";
import {germanGlassesTitle,hasStrass,totalWidthForTitle,componentFrameColors} from "./glasses-rules";
import {normalizedEyewearCondition} from "./listing-content-rules";
export function eyewearSellerRulePatch(l:ListingResult,meta:AspectMeta[]):Partial<ListingResult>|undefined {
 const patch:Partial<ListingResult>={};
 const condition=normalizedEyewearCondition(l);
 if(condition!==l.condition_notes) patch.condition_notes=condition;
 const colorMeta=meta.find(m=>/^(Rahmenfarbe|Fassungsfarbe|Farbe)$/i.test(m.name));
 const colors=colorMeta ? l.item_specifics?.[colorMeta.name] ?? "" : "";
 const rose=/ros[eé][ -]?gold/i.test([colors,...(Array.isArray(l.color) ? l.color : [l.color ?? ""])].join(" "));
 if(rose && colorMeta?.values.some(v=>/^gold$/i.test(v)) && /ros[eé][ -]?gold/i.test(colors)) {
  const gold=colorMeta.values.find(v=>/^gold$/i.test(v))!;
  patch.item_specifics={...l.item_specifics,[colorMeta.name]:[...new Set(colors.split(" | ").map(v=>/ros[eé][ -]?gold/i.test(v) ? gold : v))].join(" | ")};
  if(!l.color) patch.color=colors.split(" | ");
 }
 const componentColors=componentFrameColors(l);
 if(componentColors.length>1 && colorMeta?.cardinality==="MULTI") {
  const allowed=componentColors.map(v=>colorMeta.values.find(c=>c.toLowerCase()===v.toLowerCase()) ?? (colorMeta.mode==="FREE_TEXT" ? v : "")).filter(Boolean);
  if(allowed.length===componentColors.length) {
   const combined=[...new Set(allowed)].join(" | ");
   if(combined!==colors) patch.item_specifics={...l.item_specifics,...patch.item_specifics,[colorMeta.name]:combined};
  }
 }
 const primary=l.item_specifics?.Hauptfarbe;
 if(primary && colorMeta?.cardinality==="MULTI") {
  const current=(patch.item_specifics?.[colorMeta.name] ?? colors).split(" | ").filter(Boolean);
  const matched=current.find(v=>v.toLowerCase()===primary.toLowerCase());
  if(matched && current[0]!==matched) patch.item_specifics={...l.item_specifics,...patch.item_specifics,[colorMeta.name]:[matched,...current.filter(v=>v!==matched)].join(" | ")};
 }
 const total=totalWidthForTitle(l);
 const brand=l.item_specifics?.Marke || l.brand || "";
 const generatedStyle=Boolean(brand && l.title.toLowerCase().startsWith(brand.toLowerCase()) && (/lilac/i.test(l.title) || /\b(?:rund|panto|oval|pilot|eckig|rechteckig|quadratisch|cat eye|katzenauge|butterfly|schmetterling)\b/i.test(l.title)));
 if(!l.title_manually_edited && generatedStyle && (rose || hasStrass(l) || total>139 || componentColors.length>1 || /lilac|geometr/i.test(l.title) || Boolean(l.item_specifics?.Hauptfarbe))) {
  const title=germanGlassesTitle({...l,...patch},meta);
  if(title!==l.title) patch.title=title;
 }
 return Object.keys(patch).length ? patch : undefined;
}
