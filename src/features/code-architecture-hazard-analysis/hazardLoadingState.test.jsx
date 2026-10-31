import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import Loader from './SavedHazardPanelLoader';
import requestHazardRows from './requestHazardRows';
import {PAGED_HAZARD} from './hazardRowIndex';

jest.mock('lucide-react',()=>new Proxy({__esModule:true},{get:(_target,name)=>name==='__esModule'?true:()=>null}));
jest.mock('./requestHazardRows',()=>({__esModule:true,default:jest.fn()}));
global.IS_REACT_ACT_ENVIRONMENT=true;

const headers=['Raw Analysis Row ID','Function (From)','Control Action','Function (To)','Hazard'];
const row=index=>[`HA-${index}`,'Source','Command','Target',`Hazard ${index}`];
const indices=Array.from({length:1000},(_,index)=>index);
const layout={headers,indices,total:indices.length,groups:[{key:'all',label:'All interfaces',rowCount:indices.length,rowIndices:indices}]};
const run={id:'loading-test',projectId:'project',repoId:'repo',[PAGED_HAZARD]:{generation:'one',revision:'one',headers,total:indices.length}};
const empty=[];
let host,root,requests;
const flush=async()=>{
 await act(async()=>{jest.advanceTimersByTime(0);await Promise.resolve();});
 await act(async()=>{await Promise.resolve();});
};
const render=async(props={})=>{
 await act(async()=>root.render(<Loader latestRun={run} method="STPA-Textbook" cbaRows={empty} operationalContexts={empty} {...props}/>));
 await flush();
};
const resolveRows=async request=>{
 const rowIndices=request.options.indices;
 await act(async()=>request.resolve({headers,rowIndices,rows:rowIndices.map(row),nextOffset:rowIndices.length,total:rowIndices.length}));
 await flush();
};
beforeEach(()=>{
 jest.useFakeTimers();requests=[];
 requestHazardRows.mockReset().mockImplementation((_run,options)=>new Promise((resolve,reject)=>requests.push({options,resolve,reject})));
 host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);
});
afterEach(()=>{act(()=>root.unmount());host.remove();jest.useRealTimers();localStorage.clear();});

test('one indicator follows worker progress, then required rows, while the mounted table keeps prefetch alive',async()=>{
 await render({restoration:{status:'loading',progress:30,retry:jest.fn()}});
 expect(host.querySelectorAll('[role="progressbar"]')).toHaveLength(1);
 expect(host.querySelector('[role="progressbar"]').hasAttribute('aria-valuenow')).toBe(false);
 expect(host.textContent).not.toMatch(/Refreshing saved results|Preparing saved rows|70%/);
 act(()=>requests[0].options.onProgress({completed:76,total:100}));
 expect(host.querySelectorAll('[role="progressbar"]')).toHaveLength(1);
 expect(host.querySelector('[role="progressbar"]').getAttribute('aria-valuenow')).toBe('76');
 await act(async()=>requests[0].resolve(layout));await flush();
 const table=host.querySelector('table');
 expect(table).not.toBeNull();
 expect(table.getAttribute('aria-busy')).toBe('true');
 expect(host.querySelectorAll('[role="progressbar"]')).toHaveLength(1);
 expect(host.querySelector('[role="progressbar"]').getAttribute('aria-label')).toBe('Loading hazard rows');
 expect(host.querySelectorAll('[data-hazard-loading-row]').length).toBeGreaterThan(0);
 expect(host.textContent).not.toContain('Loading row');
 const reads=requests.filter(request=>!request.options.operation);
 expect(reads).toHaveLength(2);
 await resolveRows(reads[0]);
 expect(host.querySelector('table')).toBe(table);
 expect(host.querySelector('[role="progressbar"]')).toBeNull();
 expect(table.hasAttribute('aria-busy')).toBe(false);
 expect(table.textContent).toContain('Hazard 0');
 // The second, optional prefetch remains pending without a visible loader.
 expect(reads[1].options.signal.aborted).toBe(false);
 await resolveRows(reads[1]);
 expect(host.querySelector('table')).toBe(table);
 expect(host.querySelector('[role="progressbar"]')).toBeNull();
});

test('a failed layout ends preparation and retry starts fresh progress before showing results',async()=>{
 const retry=jest.fn();await render({restoration:{status:'loaded',retry}});
 await act(async()=>requests[0].reject(new Error('Saved table worker unavailable')));
 expect(host.querySelector('[role="progressbar"]')).toBeNull();
 expect(host.querySelector('[role="alert"]').textContent).toContain('Saved table worker unavailable');
 act(()=>[...host.querySelectorAll('button')].find(button=>button.textContent==='Retry rows').click());await flush();
 expect(retry).toHaveBeenCalledTimes(1);
 expect(host.querySelectorAll('[role="progressbar"]')).toHaveLength(1);
 expect(host.querySelector('[role="progressbar"]').hasAttribute('aria-valuenow')).toBe(false);
 const second=requests.filter(request=>request.options.operation==='layout')[1];
 act(()=>second.options.onProgress({completed:1,total:4}));
 expect(host.querySelector('[role="progressbar"]').getAttribute('aria-valuenow')).toBe('25');
 await act(async()=>second.resolve({...layout,indices:[],groups:[],total:0}));await flush();
 expect(host.querySelector('[role="progressbar"]')).toBeNull();
 expect(host.textContent).toContain('No hazard rows match');
});

test('a viewport read failure stops its loader while retaining the table and retry controls',async()=>{
 await render();await act(async()=>requests[0].resolve(layout));await flush();
 const table=host.querySelector('table');
 await act(async()=>requests.find(request=>!request.options.operation).reject(new Error('Saved row read failed')));await flush();
 expect(host.querySelector('[role="progressbar"]')).toBeNull();
 expect(host.querySelector('[role="alert"]').textContent).toContain('Saved row read failed');
 expect(host.querySelector('table')).toBe(table);
 act(()=>[...host.querySelectorAll('button')].find(button=>button.textContent==='Retry rows').click());await flush();
 expect(host.querySelectorAll('[role="progressbar"]')).toHaveLength(1);
 expect(host.querySelector('table')).toBe(table);
 const retries=requests.filter(request=>!request.options.operation);
 await resolveRows(retries[retries.length-1]);
 expect(host.querySelector('[role="progressbar"]')).toBeNull();
});

test('a superseded query cannot overwrite the next source progress',async()=>{
 await render();const obsolete=requests[0];
 act(()=>obsolete.options.onProgress({completed:90,total:100}));
 await render({latestRun:{...run,id:'new-run'}});
 expect(obsolete.options.signal.aborted).toBe(true);
 act(()=>obsolete.options.onProgress({completed:100,total:100}));
 expect(host.querySelectorAll('[role="progressbar"]')).toHaveLength(1);
 expect(host.querySelector('[role="progressbar"]').hasAttribute('aria-valuenow')).toBe(false);
});

test('active analysis owns the visible progress while draft and saved rows prepare, with Stop available',async()=>{
 const onCancelAnalysis=jest.fn();
 await render({isRunning:true,progress:{message:'Analyzing control actions'},draftLoading:true,draftProgress:48,onCancelAnalysis});
 expect(host.querySelectorAll('[role="progressbar"]')).toHaveLength(1);
 expect(host.querySelector('[role="progressbar"]').getAttribute('aria-label')).toBe('Analyzing control actions');
 expect(host.textContent.match(/Analyzing control actions/g)).toHaveLength(1);
 expect(host.textContent).not.toContain('48%');
 act(()=>[...host.querySelectorAll('button')].find(button=>button.textContent==='Stop analysis').click());
 expect(onCancelAnalysis).toHaveBeenCalledTimes(1);
 await act(async()=>requests[0].resolve(layout));await flush();
 expect(host.querySelector('table')).not.toBeNull();
 expect(requests.some(request=>!request.options.operation)).toBe(true);
 expect(host.querySelectorAll('[role="progressbar"]')).toHaveLength(1);
});
