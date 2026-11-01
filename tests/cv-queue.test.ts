import {describe,it,expect} from 'vitest';
import {cvCandidate} from '../lib/cv-queue';
import {cvKey,cvMeasurement,keepCvMeasurement,type CvRecord} from '../lib/cv-measurement';
import type {ItemGroup,ListingResult} from '../lib/types';
const listing=()=>({eyewear:{fields:{lensWidth:{value:'50',source:'manual'}},warnings:[]},frontMeasurement:{photoIndex:2,status:'unavailable',method:'front-photo-ratio-v1',reasons:[]}} as unknown as ListingResult);
const group=()=>({id:'g',status:'done',photoIds:['front','side'],evidencePhotoIds:['side','front'],listing:listing()} as ItemGroup);
describe('local measurement queue',()=>{
 it('maps analysis index through stable evidence IDs',()=>expect(cvCandidate(group())?.photoId).toBe('front'));
 it('does not guess a frontal photo',()=>{const g=group();g.listing!.frontMeasurement!.photoIndex=0;expect(cvCandidate(g)).toBeUndefined()});
 it('requires a reference and finished unpublished draft',()=>{for(const patch of [{status:'writing'},{postStatus:'posted'},{postStatus:'posting'},{publicationAttemptSku:'sku'}])expect(cvCandidate({...group(),...patch} as ItemGroup)).toBeUndefined();const g=group();g.listing!.eyewear=undefined;expect(cvCandidate(g)).toBeUndefined()});
 it('retains saved results for text changes but invalidates new scale or photos',()=>{const g=group();const record={key:cvKey(g,g.listing!),photoId:'front',photoIds:g.photoIds,version:'v',size:[1000,600],createdAt:1} as CvRecord;g.listing!.frontMeasurement={...g.listing!.frontMeasurement!,cv:record};expect(cvCandidate(g)).toBeUndefined();expect(keepCvMeasurement(g.listing,{...g.listing!,title:'changed'},g)).toBe(g.listing!.frontMeasurement);expect(cvKey({...g,photoIds:['other']},g.listing!)).not.toBe(record.key)});
 it('uses glass opening height and complete outer span without fixed deduction',()=>{const g=group();const record={version:'v',key:'k',photoId:'front',photoIds:g.photoIds,size:[1000,600],createdAt:1,points:{left_left:[.15,.5],left_right:[.4,.5],left_top:[.275,.35],left_bottom:[.275,.65],right_left:[.5,.5],right_right:[.75,.5],right_top:[.625,.35],right_bottom:[.625,.65],outer_left:[.1,.5],outer_right:[.8,.5]}} as CvRecord;const m=cvMeasurement(record,g.listing!,1);expect(m.lensHeightMm).toBe(36);expect(m.totalWidthMm).toBe(140);expect(m.status).toBe('uncertain')});
});
