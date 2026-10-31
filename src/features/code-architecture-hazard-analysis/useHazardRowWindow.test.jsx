import React,{act,useRef} from 'react';
import {createRoot} from 'react-dom/client';
import useHazardRowWindow from './useHazardRowWindow';
global.IS_REACT_ACT_ENVIRONMENT=true;
const columns=[{index:0}],widths={},collapsed=new Set();
const makeGroups=()=>[{key:'group',items:Array.from({length:1000},(_,i)=>({rowIndex:i,row:['short']}))}];
let windowResult;
beforeEach(()=>jest.useFakeTimers());
afterEach(()=>jest.useRealTimers());
const flushFrames=(count=8)=>{for(let i=0;i<count;i++)act(()=>jest.advanceTimersByTime(17));};
function Probe({groups,hidden=collapsed,columnWidths=widths,datasetKey='one',rowIdentity}){
 const tableRef=useRef();
 windowResult=useHazardRowWindow(groups,hidden,columns,columnWidths,tableRef,datasetKey,rowIdentity);
 return <div><table ref={tableRef}><tbody>{windowResult.visible.map(e=><tr key={e.key} data-window-key={e.key}><td>{e.key}</td></tr>)}</tbody></table></div>;
}
test('reveals distant rows through measured height changes',()=>{
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);
 const prior=Element.prototype.getBoundingClientRect;
 Element.prototype.getBoundingClientRect=function(){return {height:this.tagName==='TR'?400:800};};
 try{
  act(()=>root.render(<Probe groups={makeGroups()}/>));
  const ready=jest.fn();
  act(()=>windowResult.reveal(999,ready));
  flushFrames();
  expect(ready).toHaveBeenCalledTimes(1);
  expect(ready.mock.calls[0][0].dataset.windowKey).toBe('row:999');
  expect(host.querySelector('[data-window-key="row:999"]')).not.toBeNull();
 }finally{act(()=>root.unmount());host.remove();Element.prototype.getBoundingClientRect=prior;}
});
test('preserves the anchor through equivalent fresh group data',()=>{
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);
 try{
  act(()=>root.render(<Probe groups={makeGroups()}/>));
  act(()=>windowResult.reveal(500));
  const scroller=host.querySelector('table').parentElement;
  expect(scroller.scrollTop).toBeGreaterThan(10000);
  const before=scroller.scrollTop;
  act(()=>root.render(<Probe groups={makeGroups()}/>));
  expect(scroller.scrollTop).toBe(before);
 }finally{act(()=>root.unmount());host.remove();}
});

test('keeps a row and relative offset through resize, and resets for another dataset',async()=>{
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);
 const prior=Element.prototype.getBoundingClientRect;let height=400;
 Element.prototype.getBoundingClientRect=function(){return {height:this.tagName==='TR'?height:800};};
 const groups=makeGroups();
 try{
  act(()=>root.render(<Probe groups={groups}/>));
  act(()=>windowResult.reveal(500));
  const scroller=host.querySelector('table').parentElement;
  await act(async()=>{scroller.scrollTop+=37;scroller.dispatchEvent(new Event('scroll'));jest.advanceTimersByTime(30);});
  flushFrames();
  height=600;
  act(()=>root.render(<Probe groups={groups} columnWidths={{0:120}}/>));
  flushFrames();
  expect(host.querySelector('[data-window-key="row:500"]')).not.toBeNull();
  expect(scroller.scrollTop).toBeGreaterThan(10000);
  const anchored=scroller.scrollTop;
  act(()=>windowResult.reveal(500));
  expect(anchored-scroller.scrollTop).toBe(37);
  act(()=>root.render(<Probe groups={groups} datasetKey="two"/>));
  expect(scroller.scrollTop).toBe(0);
 }finally{act(()=>root.unmount());host.remove();Element.prototype.getBoundingClientRect=prior;}
});

test('reconciles a collapsed parent or removed row to a surviving nearby anchor',()=>{
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);
 const rows=makeGroups()[0].items;
 const groups=[{key:'a',items:rows.slice(0,500)},{key:'b',items:rows.slice(500)}];
 try{
  act(()=>root.render(<Probe groups={groups}/>));
  act(()=>windowResult.reveal(750));
  act(()=>root.render(<Probe groups={groups} hidden={new Set(['b'])}/>));
  const scroller=host.querySelector('table').parentElement;
  expect(host.querySelector('[data-window-key="group:b"]')).not.toBeNull();
  expect(scroller.scrollTop).toBeGreaterThan(10000);
  act(()=>root.render(<Probe groups={groups}/>));
  act(()=>windowResult.reveal(750));
  const afterDelete=[groups[0],{...groups[1],items:groups[1].items.filter(i=>i.rowIndex!==750)}];
  act(()=>root.render(<Probe groups={afterDelete}/>));
  expect(host.querySelector('[data-window-key="row:751"]')).not.toBeNull();
  expect(scroller.scrollTop).toBeGreaterThan(40000);
 }finally{act(()=>root.unmount());host.remove();}
});

test('retains a stable row ID when deletion renumbers row indexes',()=>{
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);
 const identify=item=>item.row[0];
 const rows=makeGroups()[0].items.map(item=>({...item,row:[`id-${item.rowIndex}`]}));
 try{
  act(()=>root.render(<Probe groups={[{key:'a',items:rows}]} rowIdentity={identify}/>));
  act(()=>windowResult.reveal(500));
  const remaining=rows.slice(1).map((item,index)=>({...item,rowIndex:index}));
  act(()=>root.render(<Probe groups={[{key:'a',items:remaining}]} rowIdentity={identify}/>));
  const target=host.querySelector('[data-window-key="row:id-500"]');
  expect(target).not.toBeNull();
  const ready=jest.fn();
  act(()=>windowResult.reveal(499,ready));
  flushFrames();
  expect(ready).toHaveBeenCalledWith(target);
 }finally{act(()=>root.unmount());host.remove();}
});
