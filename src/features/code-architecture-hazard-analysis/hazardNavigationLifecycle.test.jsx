import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import Table from './CodeArchitectureHazardSummaryTable';
jest.mock('lucide-react',()=>new Proxy({},{get:()=>()=> <span/>}));
global.IS_REACT_ACT_ENVIRONMENT=true;
beforeEach(()=>jest.useFakeTimers());
afterEach(()=>jest.useRealTimers());
const flushFrames=(count=12)=>{for(let i=0;i<count;i++)act(()=>jest.advanceTimersByTime(17));};
test.each([false,true])('initial highlighted navigation completes with StrictMode=%s',strict=>{
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);
 const prior=Element.prototype.getBoundingClientRect;
 Element.prototype.getBoundingClientRect=function(){return {height:this.tagName==='TR'?400:800};};
 const sheet=[['Function','Guide Phrase','Raw Analysis Row ID'],...Array.from({length:1000},(_,i)=>[`Function ${i}`,'Not provided',`id-${i}`])];
 const resolved=jest.fn();
 try{
  const table=<Table summarySheet={sheet} storageKey={`audit-${strict}`} highlightedRowIndex={999} focusRequestKey="initial-link" onRowFocusResolved={resolved}/>;
  act(()=>root.render(strict?<React.StrictMode>{table}</React.StrictMode>:table));
  flushFrames();
  expect(host.querySelector('#cba-hazard-row-999')).not.toBeNull();
  expect(resolved).toHaveBeenCalledWith('initial-link');
  expect(resolved).toHaveBeenCalledTimes(1);
  const updated=<Table summarySheet={sheet} storageKey={`audit-${strict}`} highlightedRowIndex={10} focusRequestKey="next-link" onRowFocusResolved={resolved}/>;
  act(()=>root.render(strict?<React.StrictMode>{updated}</React.StrictMode>:updated));
  flushFrames();
  expect(host.querySelector('#cba-hazard-row-10')).not.toBeNull();
  expect(resolved).toHaveBeenCalledTimes(2);
  expect(resolved).toHaveBeenLastCalledWith('next-link');
 }finally{act(()=>root.unmount());host.remove();Element.prototype.getBoundingClientRect=prior;}
});

const useHazardRowWindow=require('./useHazardRowWindow').default;
const cols=[{index:0}],empty=new Set(),initialWidths={};
let windowModel;
function WindowProbe({groups,widths,datasetKey='one'}){
 const ref=React.useRef();windowModel=useHazardRowWindow(groups,empty,cols,widths,ref,datasetKey);
 return <div><table ref={ref}><tbody>{windowModel.visible.map(e=><tr key={e.key} data-window-key={e.key}><td>{e.key}</td></tr>)}</tbody></table></div>;
}
test('resizing a tall row keeps a reader inside that row when it shrinks below the old relative offset',async()=>{
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);
 const prior=Element.prototype.getBoundingClientRect;let height=2000;
 Element.prototype.getBoundingClientRect=function(){return {height:this.tagName==='TR'?height:800};};
 const groups=[{key:'a',items:Array.from({length:1000},(_,i)=>({rowIndex:i,row:['short']}))}];
 try{
  act(()=>root.render(<WindowProbe groups={groups} widths={initialWidths}/>));
  flushFrames();
  act(()=>windowModel.reveal(500));
  flushFrames();
  const scroller=host.querySelector('table').parentElement;
  await act(async()=>{scroller.scrollTop+=1500;scroller.dispatchEvent(new Event('scroll'));jest.advanceTimersByTime(30);});
  flushFrames();
  height=400;
  act(()=>root.render(<WindowProbe groups={groups} widths={{0:600}}/>));
  act(()=>scroller.dispatchEvent(new Event('scroll')));
  flushFrames();
  const entry=windowModel.visible.find(e=>e.key==='row:500');
  expect(entry).toBeDefined();
  expect(scroller.scrollTop).toBeLessThan(entry.offset+entry.height);
  expect(scroller.scrollTop-entry.offset).toBe(399);
  height=2000;
  act(()=>root.render(<WindowProbe groups={groups} widths={{0:120}}/>));
  flushFrames();
  const grown=windowModel.visible.find(e=>e.key==='row:500');
  expect(grown).toBeDefined();
  expect(scroller.scrollTop-grown.offset).toBe(399);
 }finally{act(()=>root.unmount());host.remove();Element.prototype.getBoundingClientRect=prior;}
});

test('only the newest pending navigation completes, and scope change or unmount cancels pending work',()=>{
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);
 const groups=[{key:'a',items:Array.from({length:1000},(_,i)=>({rowIndex:i,row:['short']}))}];
 const first=jest.fn(),second=jest.fn(),obsolete=jest.fn(),unmounted=jest.fn();let removed=false;
 try{
  act(()=>root.render(<WindowProbe groups={groups} widths={initialWidths}/>));
  act(()=>{windowModel.reveal(999,first);windowModel.reveal(20,second);});
  flushFrames();
  expect(first).not.toHaveBeenCalled();expect(second).toHaveBeenCalledTimes(1);
  expect(second.mock.calls[0][0].dataset.windowKey).toBe('row:20');
  act(()=>{windowModel.reveal(999,obsolete);root.render(<WindowProbe groups={groups} widths={initialWidths} datasetKey="two"/>);});
  expect(obsolete).not.toHaveBeenCalled();
  expect(host.querySelector('table').parentElement.scrollTop).toBe(0);
  act(()=>{windowModel.reveal(999,unmounted);root.unmount();removed=true;});
  expect(unmounted).not.toHaveBeenCalled();
 }finally{if(!removed)act(()=>root.unmount());host.remove();}
});
