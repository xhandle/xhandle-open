import {sha256} from 'hash.js';
import {omitHazardField} from './hazardWorkingSet';
const containers=new Set(['object','array','string','map','set','binary']);
const checksum=value=>sha256().update(JSON.stringify(value)).digest('hex');
// Index retained token ranges while serializing or upgrading. Never assemble
// evidence or results. Traversal memory is proportional to nesting depth.
export function createHazardTableIndex() {
  const stack=[],pages=new Map(),paths=[];
  let skip=0,finished=false;
  const complete=()=>{
    const parent=stack[stack.length-1];
    if(!parent){finished=true;return;}
    if(parent.type==='object'){parent.key=null;parent.keyStart=null;parent.expectKey=true;}
    else parent.count++;
  };
  const trim=start=>{
    for(const [sequence,page] of pages){
      if(sequence<start.sequence)continue;
      page.ranges=page.ranges.flatMap(([from,to])=>sequence===start.sequence && from<start.offset ? [[from,Math.min(to,start.offset)]] : []);
      if(!page.ranges.length)pages.delete(sequence);
    }
  };
  return {
    add(token,sequence,offset){
      const type=token[0],container=containers.has(type),parent=stack[stack.length-1];
      if(skip){if(container)skip++;else if(type==='end')skip--;if(!skip)complete();return;}
      if(parent?.type==='object' && !parent.expectKey && type!=='end' && omitHazardField(parent.path,parent.key,token)){
        trim(parent.keyStart);paths.push([...parent.path,parent.key]);
        if(container)skip=1;else complete();return;
      }
      let page=pages.get(sequence);
      if(!page){page={sequence,ranges:[]};pages.set(sequence,page);}
      const last=page.ranges[page.ranges.length-1];
      if(last?.[1]===offset)last[1]++;else page.ranges.push([offset,offset+1]);
      if(container){
        const isKey=parent?.type==='object' && parent.expectKey;
        const path=parent ? [...parent.path,parent.type==='object'?parent.key:parent.count] : [];
        stack.push({type,path:isKey?parent.path:path,isKey,text:'',start:{sequence,offset},expectKey:true,count:0});
      }else if(type==='text' && parent?.isKey){parent.text+=token[1];}
      else if(type==='end'){
        const frame=stack.pop();
        if(!frame)throw Error('Invalid saved hazard token structure.');
        if(frame.isKey){const object=stack[stack.length-1];object.key=frame.text;object.keyStart=frame.start;object.expectKey=false;}
        else complete();
      }else if(!['text','bytes'].includes(type))complete();
    },
    page(sequence,digest){const page=pages.get(sequence);if(page)page.digest=digest;},
    finish(payloadDigest){
      if(stack.length || skip || !finished)throw Error('Incomplete saved hazard table index.');
      const data={version:1,payloadDigest,pages:[...pages.values()],paths};
      return {...data,digest:checksum(data)};
    },
  };
}
export function validateHazardTableIndex(payload){
  const index=payload?.tableIndex;
  const bad=()=>{throw Error('Saved table index is missing or damaged. Upgrade saved table storage again.');};
  if(!index || index.version!==1 || index.payloadDigest!==payload.digest || !Array.isArray(index.pages) || !Array.isArray(index.paths))bad();
  const {digest,...data}=index;if(digest!==checksum(data))bad();
  let previous=-1;
  for(const page of index.pages){
    if(!Number.isSafeInteger(page.sequence)||page.sequence<=previous||page.sequence>=payload.count||!Array.isArray(page.ranges)||!page.ranges.length||!/^[a-f0-9]{64}$/.test(page.digest))bad();
    previous=page.sequence;let end=-1;
    for(const [from,to] of page.ranges){if(!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||from<0||from<end||to<=from)bad();end=to;}
  }
  if(!index.pages.length || index.paths.some(path=>!Array.isArray(path)||!path.length||!['architectureRowsSnapshot','narrativeReviewInput'].includes(path[path.length-1])||path.slice(0,-1).some(part=>part!=='pendingAttempt')))bad();
  return index;
}
