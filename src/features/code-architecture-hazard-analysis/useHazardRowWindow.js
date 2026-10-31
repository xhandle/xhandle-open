import useHazardPreparation from './useHazardPreparation';
import {useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {estimateTableRowHeight} from '../../components/useDeferredTableRow';

const EMPTY_ENTRIES = [];

// Keep the viewport attached to a row, rather than an estimated pixel offset.
export default function useHazardRowWindow(groups,collapsed,columns,widths,tableRef,datasetKey,rowIdentity,enabled=true){
 const [viewport,setViewport]=useState({top:0,height:800}),[revision,setRevision]=useState(0);
 const measured=useRef(new Map()),anchor=useRef(null),pending=useRef(null);
 const scrollCorrection=useRef(null);
 const current=useRef(null),measurementFrame=useRef(null),measurementCommitPending=useRef(false);
 const entryJob=useMemo(()=>function* prepareEntries(){
  const entries=[];
  const indexes=columns.map(c=>c.index);
  const total=groups.reduce((sum,group)=>sum+1+(collapsed.has(group.key)?0:group.items.length),0);
  for(const group of groups){
   entries.push({key:`group:${group.key}`,group,height:48});
   if(!collapsed.has(group.key))for(const item of group.items){
    entries.push({key:`row:${rowIdentity?.(item) ?? item.rowIndex}`,parentKey:`group:${group.key}`,item,height:estimateTableRowHeight(item.row,widths,indexes)});
    if(entries.length%100===0)yield Math.floor(entries.length*100/total);
   }
  }
  return entries;
 },[groups,collapsed,columns,widths,rowIdentity]);
 const immediateEntries=useMemo(()=>{
  if(!(current.current?.datasetKey===datasetKey && current.current.layout.entries.length) && groups.reduce((sum,group)=>sum+1+(collapsed.has(group.key)?0:group.items.length),0)>5000)return null;
  const iterator=entryJob();let next=iterator.next();while(!next.done)next=iterator.next();return next.value;
 },[groups,collapsed,entryJob,datasetKey]);
 const preparation=useHazardPreparation(entryJob,immediateEntries);
 const preparing=!preparation.result;
 const entries=preparation.result || EMPTY_ENTRIES;
 const layout=useMemo(()=>{
  let offset=0;
  const result=entries.map(entry=>{
   const cached=measured.current.get(entry.key);
   const height=cached && cached.datasetKey===datasetKey && cached.columns===columns && cached.widths===widths ? cached.height : entry.height;
   const next={...entry,offset,height};offset+=height;return next;
  });
  return {entries:result,byKey:new Map(result.map(e=>[e.key,e])),total:offset};
 // Measurement revision invalidates offsets stored outside React state.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[entries,revision,datasetKey,columns,widths]);
 const sameDataset=Boolean(current.current && current.current.datasetKey===datasetKey);
 let retained=sameDataset?anchor.current:null;
 if(retained && !layout.byKey.has(retained.key)){
  // Prefer the collapsed parent, then the nearest surviving previous row.
  const old=current.current.layout;
  const previous=old.byKey.get(retained.key);
  const parent=layout.byKey.get(previous?.parentKey);
  const nearest=(parent && collapsed.has(parent.group.key) ? parent : null)
   || old.entries.slice(old.entries.indexOf(previous)+1).map(e=>layout.byKey.get(e.key)).find(Boolean)
   || [...old.entries].reverse().map(e=>layout.byKey.get(e.key)).find(Boolean);
  retained=nearest?{key:nearest.key,delta:0}:null;
 }
 const retainedEntry=retained && layout.byKey.get(retained.key);
 const boundedDelta=retainedEntry?Math.max(0,Math.min(retained.delta,retainedEntry.height-1)):0;
 if(retainedEntry && boundedDelta!==retained.delta){
  const cached=measured.current.get(retained.key);
  // An estimate must keep the anchor mounted, but only a current measurement
  // may permanently shorten its relative offset.
  if(cached?.datasetKey===datasetKey && cached?.columns===columns && cached?.widths===widths){
   retained={...retained,delta:boundedDelta};
  }
 }
 const requested=retainedEntry ? retainedEntry.offset+boundedDelta : sameDataset?viewport.top:0;
 const top=Math.max(0,Math.min(requested,Math.max(0,layout.total-viewport.height)));
 const visible=layout.entries.filter(e=>e.offset+e.height>=Math.max(0,top-600)&&e.offset<=top+viewport.height+600);
 const visibleKey=visible.map(e=>e.key).join('|');
 useLayoutEffect(()=>{
  if(!enabled){scrollCorrection.current=null;return;}
  const root=tableRef.current?.parentElement;
  if(!sameDataset){pending.current=null;scrollCorrection.current=null;measured.current.clear();setViewport({top:0,height:root?.clientHeight||800});}
  anchor.current=retained;
  current.current={layout,datasetKey};
  // Prune obsolete rows without discarding measurements of surviving rows.
  for(const key of measured.current.keys())if(!layout.byKey.has(key))measured.current.delete(key);
  if(root && Math.abs(root.scrollTop-top)>1)root.scrollTop=top;
  if(root)scrollCorrection.current=root.scrollTop;
 },[tableRef,sameDataset,retained,layout,datasetKey,top,enabled]);
 const captureViewport=useCallback(()=>{
  if(!enabled)return;
  const root=tableRef.current?.parentElement,latest=current.current;
  if(!root||!latest)return;
  const entry=latest.layout.entries.find(e=>e.offset+e.height>root.scrollTop);
  if(scrollCorrection.current==null || Math.abs(root.scrollTop-scrollCorrection.current)>=0.5){
   scrollCorrection.current=null;
   anchor.current=entry?{key:entry.key,delta:root.scrollTop-entry.offset}:null;
  }
  return {top:root.scrollTop,height:root.clientHeight||800};
 },[tableRef,enabled]);
 const update=useCallback(()=>{
  const next=captureViewport();
  if(next)setViewport(previous=>previous.top===next.top&&previous.height===next.height?previous:next);
 },[captureViewport]);
 useEffect(()=>{
  if(!enabled)return;
  const root=tableRef.current?.parentElement;if(!root)return;
  let frame;
  const scroll=()=>{captureViewport();if(frame==null)frame=requestAnimationFrame(()=>{frame=null;update();});};
  root.addEventListener('scroll',scroll,{passive:true});
  const observer=typeof ResizeObserver==='undefined'?null:new ResizeObserver(scroll);observer?.observe(root);update();
  return ()=>{root.removeEventListener('scroll',scroll);observer?.disconnect();cancelAnimationFrame(frame);pending.current=null;};
 },[tableRef,update,captureViewport,preparing,enabled]);
 const reveal=useCallback((index,onReady)=>{
  if(!enabled)return false;
  const latest=current.current,root=tableRef.current?.parentElement;
  const entry=latest?.layout.entries.find(e=>e.item?.rowIndex===index);
  if(!entry||!root)return false;
  anchor.current={key:entry.key,delta:0};
  pending.current={key:entry.key,onReady};
  setViewport({top:entry.offset,height:root.clientHeight||800});
  return true;
 },[tableRef,enabled]);
 const finishReveal=useCallback(()=>{
  const request=pending.current,latest=current.current;
  if(!enabled||!request||!latest||measurementFrame.current!=null||measurementCommitPending.current)return;
  if(!latest.layout.byKey.has(request.key)){pending.current=null;return;}
  const element=Array.from(tableRef.current?.querySelectorAll('tbody > tr[data-window-key]')||[]).find(row=>row.dataset.windowKey===request.key);
  if(element){pending.current=null;request.onReady?.(element);}
 },[enabled,tableRef]);
 useLayoutEffect(()=>{
  if(!enabled)return;
  const table=tableRef.current;if(!table)return;
  let active=true,frame=null;
  const measure=()=>{
   const completedFrame=frame;frame=null;
   if(!active || current.current?.layout!==layout)return;
   if(measurementFrame.current===completedFrame)measurementFrame.current=null;
   // A reveal may be temporarily clamped to the estimated end of the table.
   // Keep its requested row anchor until measurements can place that row.
   if(!pending.current)captureViewport();
   let changed=false;
   table.querySelectorAll('tbody > tr[data-window-key]').forEach(row=>{
    const height=row.getBoundingClientRect().height,key=row.dataset.windowKey,cached=measured.current.get(key);
    if(height>0 && (!cached || cached.columns!==columns || cached.widths!==widths || cached.datasetKey!==datasetKey || Math.abs(cached.height-height)>1)){
     measured.current.set(key,{height,columns,widths,datasetKey});changed=true;
    }
   });
   if(changed){measurementCommitPending.current=true;setRevision(n=>n+1);}
   else finishReveal();
  };
  const schedule=()=>{if(!active||frame!=null)return;frame=requestAnimationFrame(measure);measurementFrame.current=frame;};
  schedule();const observer=typeof ResizeObserver==='undefined'?null:new ResizeObserver(schedule);
  table.querySelectorAll('tbody > tr[data-window-key]').forEach(row=>observer?.observe(row));
  return ()=>{active=false;observer?.disconnect();cancelAnimationFrame(frame);if(measurementFrame.current===frame)measurementFrame.current=null;};
 },[tableRef,visibleKey,columns,widths,datasetKey,layout,enabled,captureViewport,finishReveal]);
 useLayoutEffect(()=>{
  measurementCommitPending.current=false;
  if(enabled)finishReveal();
 });
 useLayoutEffect(()=>()=>{pending.current=null;scrollCorrection.current=null;},[]);
 const first=visible[0]?.offset||0,last=visible[visible.length-1];
 return {preparing:!preparation.result,progress:preparation.progress,error:preparation.error,visible,top:first,bottom:last?Math.max(0,layout.total-last.offset-last.height):0,reveal,revision:visibleKey};
}
