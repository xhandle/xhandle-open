import {readHazardReviewSummary} from './readHazardReviewSummary';
import requestHazardRows from './requestHazardRows';
import {PAGED_HAZARD} from './hazardRowIndex';
jest.mock('./requestHazardRows',()=>({__esModule:true,default:jest.fn()}));
beforeEach(()=>requestHazardRows.mockReset());
test('review reads all pages, propagates cancellation and excludes source evidence',async()=>{
 const run={id:'run',[PAGED_HAZARD]:{revision:'r'}};
 const controller=new AbortController();
 requestHazardRows.mockImplementation(async(_,options)=>({headers:['Hazard'],rows:[[String(options.offset)]],nextOffset:options.offset+1,total:2}));
 expect(await readHazardReviewSummary(run,{signal:controller.signal})).toEqual([['Hazard'],['0'],['1']]);
 expect(requestHazardRows).toHaveBeenNthCalledWith(2,run,{offset:1,signal:controller.signal,raw:true});
});
test('rejects oversized review snapshots rather than retaining unlimited tables',async()=>{
 requestHazardRows.mockResolvedValue({headers:['Hazard'],rows:[['x'.repeat(17*1024*1024)]],nextOffset:1,total:1});
 await expect(readHazardReviewSummary({[PAGED_HAZARD]:{}})).rejects.toThrow('safe table size');
});
test('does not retry stale or aborted row reads',async()=>{
 requestHazardRows.mockRejectedValue(new DOMException('cancelled','AbortError'));
 await expect(readHazardReviewSummary({[PAGED_HAZARD]:{}})).rejects.toMatchObject({name:'AbortError'});
 expect(requestHazardRows).toHaveBeenCalledTimes(1);
});
