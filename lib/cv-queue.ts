import {cvKey} from './cv-measurement';
import type {ItemGroup} from './types';
export function cvCandidate(group:ItemGroup){
 if(group.status!=='done'||!group.listing||group.cloudBatchId||group.postStatus==='posted'||group.postStatus==='posting'||group.publicationAttemptSku)return;
 const key=cvKey(group,group.listing);if(!key||group.listing.frontMeasurement?.cv?.key===key)return;
 const measurement=group.listing.frontMeasurement;
 const index=measurement?.observation?.photoIndex??measurement?.photoIndex??0;
 const photoId=(group.evidencePhotoIds??group.photoIds)[index-1];
 // Never guess which image is frontal from the upload order.
 if(!photoId||!group.photoIds.includes(photoId))return;
 return {key,photoId};
}
