import {expect,it} from "vitest";
import {isBlankWhitePixels,splitAtSeparators} from "@/lib/photo-separators";
it("accepts a blank white photo but rejects dark contours, colored/transparent and dim backgrounds",()=>{
 const pixels=new Uint8Array(400).fill(255);
 expect(isBlankWhitePixels(pixels)).toBe(true);
 pixels[40]=90;expect(isBlankWhitePixels(pixels)).toBe(false);
 expect(isBlankWhitePixels([255,230,210,255])).toBe(false);
 expect(isBlankWhitePixels([255,255,255,0])).toBe(false);
 expect(isBlankWhitePixels([180,180,180,255])).toBe(false);
});
it("uses every divider as a hard boundary, excluding divider photos and empty groups",()=>{
 expect(splitAtSeparators([{id:"lead",separator:true},{id:"a"},{id:"b"},{id:"divider",separator:true},{id:"again",separator:true},{id:"c"},{id:"tail",separator:true}])).toEqual([["a","b"],["c"]]);
 expect(splitAtSeparators([{id:"blank",separator:true}])).toEqual([]);
 expect(splitAtSeparators([{id:"a"},{id:"b",separator:false}])).toEqual([["a","b"]]);
});
