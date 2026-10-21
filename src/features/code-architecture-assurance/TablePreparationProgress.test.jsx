import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import usePreparedArtifactRows from './usePreparedArtifactRows';
import TablePreparationProgress from './TablePreparationProgress';
global.IS_REACT_ACT_ENVIRONMENT = true;
function Probe({rows,scope}) {
 const state=usePreparedArtifactRows(rows,scope);
 return state.prepared ? <div data-ready>{state.prepared.map(item=>item.row.id).join(',')}</div>
  : <TablePreparationProgress label="Preparing requirements table" progress={state.progress}/>;
}
let root,host;
beforeEach(()=>{jest.useFakeTimers();host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();jest.useRealTimers();});
const rows=prefix=>Array.from({length:250},(_,i)=>({id:`${prefix}-${i}`}));
it('reports real chunk completion and finishes with every row',()=>{
 act(()=>root.render(<Probe rows={rows('A')} scope="a"/>));
 expect(host.querySelector('[role="progressbar"]').getAttribute('aria-valuenow')).toBe('0');
 act(()=>jest.advanceTimersToNextTimer());
 expect(host.querySelector('[role="progressbar"]').getAttribute('aria-valuenow')).toBe('20');
 act(()=>jest.advanceTimersToNextTimer());
 expect(host.querySelector('[role="progressbar"]').getAttribute('aria-valuenow')).toBe('40');
 act(()=>jest.advanceTimersToNextTimer());
 expect(host.querySelector('[role="progressbar"]').getAttribute('aria-valuenow')).toBe('70');
 act(()=>jest.runAllTimers());
 expect(host.querySelector('[role="progressbar"]')).toBeNull();
 expect(host.querySelector('[data-ready]').textContent.split(',')).toHaveLength(250);
});
it('cancels old scope preparation without displaying its rows',()=>{
 act(()=>root.render(<Probe rows={rows('A')} scope="a"/>));
 act(()=>jest.advanceTimersToNextTimer());
 act(()=>root.render(<Probe rows={rows('B')} scope="b"/>));
 expect(host.querySelector('[role="progressbar"]').getAttribute('aria-valuenow')).toBe('0');
 act(()=>jest.runAllTimers());
 expect(host.textContent).toContain('B-249');expect(host.textContent).not.toContain('A-');
});
it('handles empty and small tables immediately',()=>{
 act(()=>root.render(<Probe rows={[]} scope="a"/>));
 expect(host.querySelector('[data-ready]')).not.toBeNull();
 act(()=>root.render(<Probe rows={[{id:'one'}]} scope="a"/>));
 expect(host.textContent).toBe('one');
});
it('keeps a prepared table mounted when a row is edited',()=>{
 const original=rows('A');
 act(()=>root.render(<Probe rows={original} scope="a"/>));
 act(()=>jest.runAllTimers());
 const updated=original.map((r,i)=>i===0?{id:'edited'}:r);
 act(()=>root.render(<Probe rows={updated} scope="a"/>));
 expect(host.querySelector('[role="progressbar"]')).toBeNull();
 expect(host.textContent).toContain('edited');
});
it('batches large hydration after an empty snapshot and large same-scope replacement',()=>{
 act(()=>root.render(<Probe rows={[]} scope="a"/>));
 act(()=>root.render(<Probe rows={rows('A')} scope="a"/>));
 expect(host.querySelector('[role="progressbar"]').getAttribute('aria-valuenow')).toBe('0');
 act(()=>jest.advanceTimersToNextTimer());
 expect(host.querySelector('[role="progressbar"]').getAttribute('aria-valuenow')).toBe('20');
 act(()=>jest.runAllTimers());
 act(()=>root.render(<Probe rows={rows('B')} scope="a"/>));
 expect(host.querySelector('[role="progressbar"]').getAttribute('aria-valuenow')).toBe('0');
 act(()=>jest.runAllTimers());expect(host.textContent).toContain('B-249');
});
it('cancels obsolete same-scope preparation and keeps deletions immediate',()=>{
 act(()=>root.render(<Probe rows={rows('A')} scope="a"/>));
 act(()=>jest.advanceTimersToNextTimer());
 const replacement=rows('B');
 act(()=>root.render(<Probe rows={replacement} scope="a"/>));
 act(()=>jest.runAllTimers());
 expect(host.textContent).not.toContain('A-');
 act(()=>root.render(<Probe rows={replacement.slice(1)} scope="a"/>));
 expect(host.querySelector('[role="progressbar"]')).toBeNull();
 expect(host.textContent).not.toContain('B-0,');
});

it('prepares duplicate-aware keys, positions and offsets alongside rows',()=>{
 let result;
 function Model({input}) {result=usePreparedArtifactRows(input,'model');return null;}
 const input=Array.from({length:250},(_,i)=>({id:i<2?'duplicate':`row-${i}`}));
 act(()=>root.render(<Model input={input}/>));act(()=>jest.runAllTimers());
 const model=result.virtualModel;
 expect(model.items).toBe(result.prepared);
 expect(new Set(model.keys).size).toBe(250);
 expect(model.keys[0]).toBe(JSON.stringify(['duplicate',0]));
 expect(model.keys[1]).toBe(JSON.stringify(['duplicate',1]));
 expect(model.positions.get(model.keys[249])).toBe(249);
 expect(model.keyByItem.get(result.prepared[249])).toBe(model.keys[249]);
 expect(model.offsets).toHaveLength(251);expect(model.offsets[250]).toBe(30000);
});
