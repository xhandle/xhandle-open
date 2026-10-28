import {PAGED_HAZARD} from './hazardRowIndex';
import requestHazardRows from './requestHazardRows';
// Explicit review actions may need the complete table, but never source evidence.
// Keep this out of the first-view path and bound the retained review snapshot.
export async function readHazardReviewSummary(run, {signal}={}) {
 if(!run?.[PAGED_HAZARD])return run?.generatedSheets?.Summary || null;
 const summary=[];let offset=0,bytes=0;
 do {
  const page=await requestHazardRows(run,{offset,signal,raw:true});
  if(!summary.length)summary.push(page.headers);
  for(const row of page.rows){
   bytes+=JSON.stringify(row).length*2;
   if(bytes>32*1024*1024)throw Error('This review exceeds the safe table size. Review a smaller result set. No changes were saved.');
   summary.push(row);
  }
  if(page.nextOffset>=page.total)break;
  if(page.nextOffset<=offset)throw Error('Saved review rows could not be loaded.');
  offset=page.nextOffset;
 }while(true);
 return summary;
}
