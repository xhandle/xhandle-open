import React from 'react';
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import Panel from './EngineeringArtifactPanel';
import {loadArtifactRows,loadArtifactRowsAsync} from './artifactUtils';
jest.mock('./artifactAI',()=>({DERIVE_BY_KIND:{}}));
jest.mock('./artifactUtils',()=>({...jest.requireActual('./artifactUtils'),loadArtifactRows:jest.fn(()=>[]),loadArtifactRowsAsync:jest.fn()}));
jest.mock('./useArtifactReview',()=>({useArtifactReview:()=>({reviewItems:[],reviewByRow:new Map(),reviewDrawerOptions:{}})}));
jest.mock('../../components/activity/ActivityCenter',()=>({useActivityCenter:()=>({})}));
jest.mock('lucide-react',()=>{const Icon=()=>null;return new Proxy({},{get:()=>Icon});});
global.IS_REACT_ACT_ENVIRONMENT=true;

let host,root;
const stableRows=[];
beforeEach(()=>{
 loadArtifactRows.mockReturnValue([]);
 host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);
});
afterEach(()=>{act(()=>root.unmount());host.remove();});
it.each([
 ['system-requirements','software-requirements'],
 ['subsystem-requirements','system-requirements'],
 ['design-elements','subsystem-requirements'],
])('handles source failure and retries without discarding %s results',async(kind,parent)=>{
 let failed=true;
 loadArtifactRowsAsync.mockImplementation(requestKind=>requestKind===parent && failed
   ? Promise.reject(new Error('Source storage timeout'))
   : Promise.resolve(requestKind===kind?[{id:'',requirementText:'Retained requirement',designElementName:'Retained requirement'}]:[]));
 await act(async()=>root.render(<Panel cbaRows={stableRows} sourceRows={stableRows} kind={kind} project={{id:'p'}} repo={{id:'r'}}/>));
 expect(host.textContent).toContain('Retained requirement');
 expect(host.textContent).toContain('Source storage timeout');
 failed=false;
 await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Retry loading').click());
 expect(host.textContent).toContain('Retained requirement');
 expect(host.textContent).not.toContain('Source storage timeout');
});
it('ignores delayed reads and errors after switching projects',async()=>{
 const pending=[];
 loadArtifactRowsAsync.mockImplementation((kind,project)=>project==='old'
   ? new Promise((resolve,reject)=>pending.push({resolve,reject}))
   : Promise.resolve(kind==='system-requirements'?[{id:'SYS-1',requirementText:'New project'}]:[]));
 const render=project=>root.render(<Panel cbaRows={stableRows} sourceRows={stableRows} kind="system-requirements" project={{id:project}} repo={{id:'r'}}/>);
 await act(async()=>render('old'));
 await act(async()=>render('new'));
 await act(async()=>pending.forEach((p,i)=>i%2 ? p.reject(new Error('Old failure')):p.resolve([{id:'SYS-2',requirementText:'Old project'}])));
 expect(host.textContent).toContain('New project');
 expect(host.textContent).not.toContain('Old failure');
 expect(host.textContent).not.toContain('Old project');
});
it('automatically recovers a transient read while retaining visible rows',async()=>{
 jest.useFakeTimers();
 try {
  let failing=true;
  loadArtifactRows.mockReturnValue([{id:'SYS-1',requirementText:'Visible cached result'}]);
  loadArtifactRowsAsync.mockImplementation(async kind=>{
   if(failing) throw Object.assign(new Error('Read delayed'),{name:'ArtifactStorageTimeoutError'});
   return kind==='system-requirements'?[{id:'SYS-1',requirementText:'Recovered saved result'}]:[];
  });
  await act(async()=>root.render(<Panel cbaRows={stableRows} sourceRows={stableRows} kind="system-requirements" project={{id:'p'}} repo={{id:'r'}}/>));
  expect(host.textContent).toContain('Visible cached result');
  expect(host.textContent).toContain('Retrying automatically');
  expect(host.querySelectorAll('[role="progressbar"]')).toHaveLength(1);
  expect(host.querySelector('[role="progressbar"]').textContent).toContain('Retrying automatically');
  expect(host.querySelector('[role="progressbar"]').hasAttribute('aria-valuenow')).toBe(false);
  expect(host.querySelectorAll('[role="alert"]')).toHaveLength(0);
  expect(host.textContent).not.toContain('Retry loading');
  failing=false;
  await act(async()=>jest.advanceTimersByTime(2000));
  expect(host.textContent).toContain('Recovered saved result');
  expect(host.textContent).not.toContain('Retrying automatically');
 } finally {jest.useRealTimers();}
});

it('shows one loading state for an unknown saved table, and exposes a terminal error without an empty table',async()=>{
 const pending=[];
 loadArtifactRowsAsync.mockImplementation(()=>new Promise((resolve,reject)=>pending.push({resolve,reject})));
 await act(async()=>root.render(<Panel cbaRows={stableRows} sourceRows={stableRows} kind="system-requirements" project={{id:'cold'}} repo={{id:'r'}}/>));
 expect(host.querySelectorAll('[role="progressbar"]')).toHaveLength(1);
 expect(host.querySelector('table')).toBeNull();
 expect(host.textContent).not.toContain('0 of 0 rows');
 await act(async()=>pending.forEach(({reject})=>reject(new Error('Saved rows unavailable'))));
 expect(host.querySelectorAll('[role="progressbar"]')).toHaveLength(0);
 expect(host.querySelector('table')).toBeNull();
 expect(host.querySelector('[role="alert"]').textContent).toContain('Saved rows unavailable');
 expect(host.textContent).toContain('Retry loading');
});
