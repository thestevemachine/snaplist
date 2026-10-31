import {afterEach,expect,it,vi} from 'vitest';
import {uploadOnePhoto,uploadPhotosDetailed} from '@/lib/ebay/photo-upload';
afterEach(()=>vi.unstubAllGlobals());
const image={mediaType:'image/jpeg',data:Buffer.from('fixture-image').toString('base64')};
it('uses Media API multipart image uploads and the returned EPS URL',async()=>{
 const fetch=vi.fn(async()=>new Response(JSON.stringify({imageUrl:'https://i.ebayimg.com/a.jpg'}),{status:201}));vi.stubGlobal('fetch',fetch);
 expect(await uploadOnePhoto('fixture-token',image,'sku-1.jpg')).toEqual({url:'https://i.ebayimg.com/a.jpg'});
 const [url,init]=fetch.mock.calls[0] as unknown as [string,RequestInit];expect(url).toContain('/commerce/media/v1_beta/image/create_image_from_file');expect(init.headers).toEqual({Authorization:'Bearer fixture-token'});expect((init.body as FormData).get('image')).toBeInstanceOf(Blob);
});
it('reads a valid image resource when create returns Location only',async()=>{
 const fetch=vi.fn().mockResolvedValueOnce(new Response(null,{status:201,headers:{location:'https://apim.ebay.com/commerce/media/v1_beta/image/123'}})).mockResolvedValueOnce(new Response(JSON.stringify({imageUrl:'https://i.ebayimg.com/b.jpg'})));vi.stubGlobal('fetch',fetch);
 expect((await uploadOnePhoto('fixture-token',image,'x.jpg')).url).toContain('/b.jpg');expect(fetch).toHaveBeenCalledTimes(2);
});
it('never follows a foreign Location or treats a foreign URL as an uploaded image',async()=>{
 const fetch=vi.fn(async()=>new Response(JSON.stringify({imageUrl:'https://evil.example/a.jpg'}),{status:201,headers:{location:'https://evil.example/steal'}}));vi.stubGlobal('fetch',fetch);
 expect((await uploadOnePhoto('fixture-token',image,'x.jpg')).url).toBeNull();expect(fetch).toHaveBeenCalledTimes(1);
});
it('preserves photo positions through partial failure and returns curated errors without tokens',async()=>{
 let n=0;vi.stubGlobal('fetch',vi.fn(async()=>++n===2 ? new Response(JSON.stringify({errors:[{errorId:190203,message:'echo fixture-token'}]}),{status:400}) : new Response(JSON.stringify({imageUrl:`https://i.ebayimg.com/${n}.jpg`}),{status:201})));
 const result=await uploadPhotosDetailed('fixture-token',[image,image,image],'sku');expect(result.failed).toBe(1);expect(result.results.map(r=>Boolean(r.url))).toEqual([true,false,true]);expect(result.results[1].error).toContain('190203');expect(JSON.stringify(result)).not.toContain('fixture-token');
});
it('surfaces expired consent instead of silently returning an empty URL list',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response('{}',{status:403})));const r=await uploadOnePhoto('fixture-token',image,'x.jpg');expect(r.error).toContain('Freigabe');expect(r.retryable).toBe(false);
});
