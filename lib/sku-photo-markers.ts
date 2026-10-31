import type {Photo} from "./types";
// A number card assigns its exact SKU only to the first subsequent physical group.
export function assignPhotoSkus<T extends {photoIds:string[];sku:string}>(groups:T[],photos:Pick<Photo,"id"|"skuMarker">[]):T[]{
 const position=new Map(photos.map((p,i)=>[p.id,i]));const used=new Set<number>();const result=[...groups];
 const ordered=groups.map((group,index)=>({group,index,first:Math.min(...group.photoIds.map(id=>position.get(id) ?? Infinity))})).sort((a,b)=>a.first-b.first);
 for(const {group,index,first} of ordered){
  let marker=-1;for(let i=0;i<first && i<photos.length;i++)if(photos[i].skuMarker)marker=i;
  if(marker<0 || used.has(marker) || !Number.isFinite(first))continue;
  used.add(marker);if(!group.sku.trim())result[index]={...group,sku:photos[marker].skuMarker!};
 }
 return result;
}
