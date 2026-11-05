import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import PagedHazardPanel from './PagedHazardPanel';
import requestHazardRows from './requestHazardRows';
import {createHazardFilterOptions} from './hazardFilterOptions';
import {PAGED_HAZARD} from './hazardRowIndex';
let mockPanel;
jest.mock('./CodeArchitectureHazardPanel',()=>({PreparedCodeArchitectureHazardPanel:function Prepared(props){
 mockPanel=props;
 require('react').useEffect(()=>{if(props.tablePage.layout)props.tablePage.requestRows([props.highlightedRowIndex ?? props.tablePage.layout.indices[0]].filter(value=>value!=null));},[props.tablePage.layout,props.tablePage.requestRows,props.highlightedRowIndex]);
 return <div>{props.tablePage.controls}</div>;
}}));
jest.mock('./requestHazardRows',()=>({__esModule:true,default:jest.fn()}));
jest.mock('../code-architecture-context/functionalModel',()=>({functionalModelIsReady:()=>true,buildFunctionalModelRows:()=>[{traceId:'functional-relationship:one'}]}));
jest.mock('./codeArchitectureHazardUtils',()=>({effectiveCodeArchitectureHazardRows:()=>[],isCodeArchitectureHazardAnalysisStale:({run})=>run.architectureSnapshotHash==='old'}));
global.IS_REACT_ACT_ENVIRONMENT=true;
let host,root;
const run={id:'paged-ui',architectureSnapshotHash:'old',[PAGED_HAZARD]:{revision:'one',headers:['Hazard'],total:1000,details:['csvImportPreviousSummary']}};
const flush=async()=>{await act(async()=>{jest.advanceTimersByTime(0);await Promise.resolve();});await act(async()=>{await Promise.resolve();});};
beforeEach(()=>{
 jest.useFakeTimers();mockPanel=null;requestHazardRows.mockReset();
 requestHazardRows.mockImplementation(async(_run,options)=>{
  if(options.operation==='detail')return {value:[['Hazard'],['undo']]};
  if(options.operation==='layout'){
   const indices=Object.keys(options.filters||{}).length?[999]:Array.from({length:1000},(_,i)=>i);
   return {headers:['Hazard'],indices,groups:[{key:'all',label:'All hazards',rowCount:indices.length,rowIndices:indices}],total:indices.length};
  }
  const indices=options.indices || Array.from({length:1000},(_,i)=>i),offset=options.offset||0;
  const rowIndices=indices.slice(offset,offset+(options.limit||100));
  return {headers:['Hazard'],rows:rowIndices.map(index=>['saved '+index]),rowIndices,offset,nextOffset:offset+rowIndices.length,total:indices.length};
 });
 host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);
});
afterEach(()=>{act(()=>root.unmount());host.remove();jest.useRealTimers();});
test('paged view preserves Functional trace targets, stale status and lazy CSV undo',async()=>{
 await act(async()=>root.render(<PagedHazardPanel latestRun={run}/>));await flush();
 expect(mockPanel.preparedView.functionalTraceIds.has('functional-relationship:one')).toBe(true);
 expect(mockPanel.preparedView.isStale).toBe(true);
 expect(mockPanel.tablePage.hasCsvUndo).toBe(true);
 expect(requestHazardRows.mock.calls.some(([,options])=>options.operation==='detail')).toBe(false);
 let undo;await act(async()=>{undo=await mockPanel.tablePage.loadUndo();});
 expect(undo).toEqual([['Hazard'],['undo']]);
});
test('explicit off-page row focus survives clearing filters and does not poison later searches',async()=>{
 await act(async()=>root.render(<PagedHazardPanel latestRun={run}/>));await flush();
 act(()=>mockPanel.tablePage.setFilter(0,['saved']));await act(async()=>jest.advanceTimersByTime(200));await flush();
 await act(async()=>root.render(<PagedHazardPanel latestRun={run} highlightedRowIndex={999} forceSummaryOpenKey={1}/>));await flush();
 expect(mockPanel.tablePage.rowIndices).toContain(999);
 expect(mockPanel.tablePage.layout.total).toBe(1000);
 expect(host.textContent).not.toMatch(/Next rows|Previous rows/);
 act(()=>mockPanel.tablePage.setFilter(0,['saved']));await act(async()=>jest.advanceTimersByTime(200));await flush();
 expect(mockPanel.tablePage.layout.indices).toEqual([999]);
});
test('leaving the panel aborts its active page request and ignores late completion',async()=>{
 let resolve;requestHazardRows.mockImplementation((_run,options)=>new Promise(done=>{resolve=done;}));
 await act(async()=>root.render(<PagedHazardPanel latestRun={run}/>));await flush();
 const signal=requestHazardRows.mock.calls.at(-1)[1].signal;
 act(()=>root.render(null));expect(signal.aborted).toBe(true);
 await act(async()=>resolve({headers:[],rows:[],rowIndices:[],total:0,nextOffset:0}));
 expect(host.textContent).toBe('');
});

test('scroll fills retain the editable view identity and deletion receives the absolute source row',async()=>{
 const remove=jest.fn();
 await act(async()=>root.render(<PagedHazardPanel latestRun={run} onDeleteSummaryRow={remove}/>));await flush();
 const sheet=mockPanel.preparedView.summarySheet;
 await act(async()=>mockPanel.tablePage.requestRows([975,976]));await flush();
 expect(mockPanel.tablePage.rowsByIndex.get(975)).toEqual(['saved 975']);
 expect(mockPanel.preparedView.summarySheet).toBe(sheet);
 await act(async()=>mockPanel.onDeleteSummaryRow(975));
 expect(remove).toHaveBeenCalledWith(975);
});

test('reuses only bounded layout metadata on tab reentry and never for another source revision',async()=>{
 const preparationCache={current:null,retired:false};
 const render=async latest=>{await act(async()=>root.render(<PagedHazardPanel latestRun={latest} preparationCache={preparationCache}/>));await flush();};
 await render(run);
 expect(preparationCache.current.kind).toBe('continuous-hazard-layout');
 expect(preparationCache.current.layout.rows).toBeUndefined();
 const reads=()=>requestHazardRows.mock.calls.filter(([,options])=>options.operation==='layout').length;
 expect(reads()).toBe(1);
 act(()=>root.render(null));
 await render(run);
 expect(reads()).toBe(1);
 act(()=>root.render(null));
 await render({...run,[PAGED_HAZARD]:{...run[PAGED_HAZARD],revision:'two'}});
 expect(reads()).toBe(2);
});

test('retrying failed row reads refreshes the saved descriptor as well as retrying the viewport',async()=>{
 const fallback=requestHazardRows.getMockImplementation(),retry=jest.fn();let broken=true;
 requestHazardRows.mockImplementation((value,options)=>options.operation==='layout'||!broken?fallback(value,options):Promise.reject(Error('Saved results changed. Reload the table before continuing.')));
 await act(async()=>root.render(<PagedHazardPanel latestRun={run} restoration={{retry}}/>));await flush();
 expect(host.querySelector('[role="alert"]').textContent).toContain('Saved results changed');
 broken=false;
 await act(async()=>[...host.querySelectorAll('button')].find(button=>button.textContent==='Retry rows').click());await flush();
 expect(retry).toHaveBeenCalledTimes(1);
 expect(mockPanel.tablePage.rowsByIndex.get(0)).toEqual(['saved 0']);
 expect(host.querySelector('[role="alert"]')).toBeNull();
});

test('review normalization is reused as scrolling loads other source ranges',async()=>{
 const normalize=jest.spyOn(require('../project-hazard-analysis/classificationResolutionStatus'),'createHazardRowNormalizer');
 const reviewItems=Array.from({length:1000},(_,i)=>({id:'review-'+i,currentContent:{row:['hazard '+i],rowIndex:i}}));
 try{
  await act(async()=>root.render(<PagedHazardPanel latestRun={run} reviewItems={reviewItems}/>));await flush();
  const calls=normalize.mock.calls.length;expect(calls).toBeGreaterThan(0);
  await act(async()=>mockPanel.tablePage.requestRows([500,501]));await flush();
  expect(mockPanel.tablePage.rowsByIndex.has(500)).toBe(true);
  expect(normalize.mock.calls.length).toBe(calls);
 }finally{normalize.mockRestore();}
});

test('filter options distinguish loading, ignore stale searches and keep filter failures local',async()=>{
 const fallback=requestHazardRows.getMockImplementation(),pending=[];
 requestHazardRows.mockImplementation((value,options)=>options.operation==='options'?new Promise((resolve,reject)=>pending.push({options,resolve,reject})):fallback(value,options));
 await act(async()=>root.render(<PagedHazardPanel latestRun={run}/>));await flush();
 act(()=>mockPanel.tablePage.requestOptions(0,''));
 expect(mockPanel.tablePage.optionsLoading).toBe(true);expect(mockPanel.tablePage.options).toEqual([]);
 act(()=>mockPanel.tablePage.requestOptions(0,'later'));expect(pending[0].options.signal.aborted).toBe(true);
 await act(async()=>pending[0].resolve({options:['Stale value']}));expect(mockPanel.tablePage.options).toEqual([]);expect(mockPanel.tablePage.optionsLoading).toBe(true);
 await act(async()=>pending[1].reject(Error('Filter read failed')));
 expect(mockPanel.tablePage.optionsError).toBe('Filter read failed');expect(mockPanel.tablePage.optionsLoading).toBe(false);
 expect(host.querySelector('[role="alert"]')).toBeNull();
 act(()=>mockPanel.tablePage.requestOptions(0,'later'));
 await act(async()=>pending[2].resolve({options:['Later value'],truncated:false}));
 expect(mockPanel.tablePage.options).toEqual(['Later value']);expect(mockPanel.tablePage.optionsLoading).toBe(false);
 act(()=>mockPanel.tablePage.requestOptions(0,'new'));
 act(()=>mockPanel.tablePage.cancelOptions());expect(pending[3].options.signal.aborted).toBe(true);expect(mockPanel.tablePage.optionsLoading).toBe(false);
 await act(async()=>pending[3].resolve({options:['Canceled value']}));expect(mockPanel.tablePage.options).toEqual([]);
});

test('prepared options and searches need no additional storage read and are replaced with the source revision',async()=>{
 const fallback=requestHazardRows.getMockImplementation();
 requestHazardRows.mockImplementation(async(value,options)=>{
  const result=await fallback(value,options);
  return options.operation==='layout'?{...result,optionIndex:{columns:[{options:[value[PAGED_HAZARD].revision,'Offscreen value'],truncated:false}]}}:result;
 });
 await act(async()=>root.render(<PagedHazardPanel latestRun={run}/>));await flush();
 expect(mockPanel.tablePage.getPreparedOptions(0,'OFFSCREEN').options).toEqual(['Offscreen value']);
 act(()=>mockPanel.tablePage.requestOptions(0,''));
 expect(mockPanel.tablePage.optionsLoading).toBe(false);
 expect(mockPanel.tablePage.options).toContain('one');
 expect(requestHazardRows.mock.calls.some(([,options])=>options.operation==='options')).toBe(false);
 await act(async()=>root.render(<PagedHazardPanel latestRun={{...run,[PAGED_HAZARD]:{...run[PAGED_HAZARD],revision:'two'}}}/>));await flush();
 expect(mockPanel.tablePage.getPreparedOptions(0,'').options).toEqual(['two','Offscreen value']);
});

test('checkbox selection filters in place without another layout read and copy uses the matching source indices',async()=>{
 const fallback=requestHazardRows.getMockImplementation();
 requestHazardRows.mockImplementation(async(value,options)=>{
  const result=await fallback(value,options);
  if(options.operation==='layout'){
   const collector=createHazardFilterOptions(1,1000);
   for(let i=0;i<1000;i++)collector.addRow([i%2?'odd':'even']);
   return {...result,optionIndex:collector.finish()};
  }
  return result;
 });
 Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:jest.fn(async()=>{})}});
 await act(async()=>root.render(<PagedHazardPanel latestRun={run}/>));await flush();
 const options=mockPanel.tablePage.getPreparedOptions(0,'');
 for(let i=0;i<10;i++){
  act(()=>mockPanel.tablePage.setFilter(0,['odd']));
  expect(mockPanel.tablePage.loadState.status).toBe('ready');
  expect(mockPanel.tablePage.layout.total).toBe(500);
  expect(host.textContent).toContain('500 of 1,000 rows match filters');
  expect(mockPanel.tablePage.layout.indices.at(-1)).toBe(999);
  expect(mockPanel.tablePage.getPreparedOptions(0,'')).toBe(options);
  act(()=>mockPanel.tablePage.setFilter(0,['even','odd']));
  expect(mockPanel.tablePage.layout.total).toBe(1000);
  act(()=>mockPanel.tablePage.clearFilters());
  expect(mockPanel.tablePage.layout.total).toBe(1000);
 }
 act(()=>mockPanel.tablePage.setFilter(0,['odd']));await flush();
 await act(async()=>mockPanel.tablePage.copy([0]));
 const text=navigator.clipboard.writeText.mock.calls[0][0];
 expect(text).toContain('saved 999');expect(text).not.toContain('saved 998');
 expect(requestHazardRows.mock.calls.filter(([,o])=>o.operation==='layout')).toHaveLength(1);
 expect(requestHazardRows.mock.calls.some(([,o])=>o.operation==='options')).toBe(false);
});
test('unindexed fallback preserves the displayed table and ignores an obsolete filter response',async()=>{
 const fallback=requestHazardRows.getMockImplementation(),pending=[];
 requestHazardRows.mockImplementation((value,options)=>options.operation==='layout'&&Object.keys(options.filters).length
  ?new Promise(resolve=>pending.push({options,resolve})):fallback(value,options));
 await act(async()=>root.render(<PagedHazardPanel latestRun={run}/>));await flush();
 const initial=mockPanel.tablePage.layout;
 act(()=>mockPanel.tablePage.setFilter(0,['first']));await act(async()=>jest.advanceTimersByTime(200));
 expect(mockPanel.tablePage.layout).toBe(initial);expect(mockPanel.tablePage.loadState.status).toBe('ready');
 act(()=>mockPanel.tablePage.setFilter(0,['second']));await act(async()=>jest.advanceTimersByTime(200));
 expect(pending[0].options.signal.aborted).toBe(true);
 await act(async()=>pending[0].resolve({...initial,indices:[1],total:1}));
 expect(mockPanel.tablePage.layout).toBe(initial);
 await act(async()=>pending[1].resolve({...initial,indices:[2],total:1}));
 expect(mockPanel.tablePage.layout.indices).toEqual([2]);
 act(()=>mockPanel.tablePage.clearFilters());expect(mockPanel.tablePage.layout).toBe(initial);
});
