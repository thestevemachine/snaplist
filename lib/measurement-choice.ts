// Match a real eBay option exactly, or a clearly bounded millimetre interval.
// Never round to a nearby standard size or fabricate an option.
export function measurementChoice(values:string[],mm:number):string|undefined {
 const number=(v:string)=>/^\d+(?:[.,]\d+)?(?:\s*mm)?$/i.test(v.trim()) ? Number(v.replace(/\s*mm$/i,"").replace(",",".")) : NaN;
 const exact=values.find(v=>number(v)===mm);if(exact) return exact;
 const ranges=values.filter(v=>{const m=v.trim().match(/^(\d+(?:[.,]\d+)?)\s*(?:mm\s*)?(?:[-–—]|bis|to)\s*(\d+(?:[.,]\d+)?)\s*(?:mm)?$/i);return m && mm>=Number(m[1].replace(",",".")) && mm<=Number(m[2].replace(",","."));});
 return ranges.length===1 ? ranges[0] : undefined;
}
