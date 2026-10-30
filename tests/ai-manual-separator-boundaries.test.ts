import {expect,it} from "vitest";
import {splitForAi,splitAtSeparators} from "@/lib/photo-separators";
it("retains a marked product at its manual boundary while excluding only confirmed blank photos",()=>{
 const photos=[{id:"a"},{id:"b",separator:true,separatorManual:true},{id:"c"},{id:"blank",separator:true,separatorManual:true},{id:"d"},{id:"last"}];
 expect(splitForAi(photos,new Set(["blank"]))).toEqual([["a","b"],["c"],["d","last"]]);
 expect(splitAtSeparators(photos)).toEqual([["a"],["c"],["d","last"]]);
});
it("without markers AI receives the entire sequence including the last product",()=>{expect(splitForAi([{id:"a"},{id:"b"}],new Set())).toEqual([["a","b"]]);});
