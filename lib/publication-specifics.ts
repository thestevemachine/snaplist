import {measurementDefinitions} from "./eyewear-measurements";
import type {ListingResult} from "./types";
// Group actual outgoing measurement aspects together; never invent eBay fields.
export function publicationSpecifics(listing:ListingResult):[string,string][] {
 const entries=Object.entries(listing.item_specifics ?? {}).filter(([,value])=>value.trim());
 const index=(name:string)=>measurementDefinitions.findIndex(d=>d.pattern.test(name));
 return [...entries.filter(([name])=>index(name)<0),...entries.filter(([name])=>index(name)>=0).sort((a,b)=>index(a[0])-index(b[0]))];
}
