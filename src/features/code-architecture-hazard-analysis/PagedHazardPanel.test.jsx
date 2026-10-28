import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import PagedHazardPanel from './PagedHazardPanel';
import requestHazardRows from './requestHazardRows';
import {PAGED_HAZARD} from './hazardRowIndex';
let mockPanel;
jest.mock('./CodeArchitectureHazardPanel',()=>({PreparedCodeArchitectureHazardPanel:props=>{mockPanel=props;return <div>{props.tablePage.controls}</div>;}}));
jest.mock('./requestHazardRows',()=>({__esModule:true,default:jest.fn()}));
jest.mock('../code-architecture-context/functionalModel',()=>({functionalModelIsReady:()=>true,buildFunctionalModelRows:()=>[{traceId:'functional-relationship:one'}]}));
jest.mock('./codeArchitectureHazardUtils',()=>({effectiveCodeArchitectureHazardRows:()=>[],isCodeArchitectureHazardAnalysisStale:({run})=>run.architectureSnapshotHash==='old'}));
global.IS_REACT_ACT_ENVIRONMENT=true;
let host,root;
const run={id:'paged-ui',architectureSnapshotHash:'old',[PAGED_HAZARD]:{revision:'one',headers:['Hazard'],total:1000,details:['csvImportPreviousSummary']}};
const flush=async()=>{await act(async()=>{await Promise.resolve();});};
beforeEach(()=>{
 jest.useFakeTimers();mockPanel=null;requestHazardRows.mockReset();
 requestHazardRows.mockImplementation(async(_run,options)=>options.operation==='detail'?{value:[['Hazard'],['undo']]}:options.operation==='query'?{indices:[999]}:{headers:['Hazard'],rows:[['saved']],rowIndices:[options.offset || 0],offset:options.offset || 0,nextOffset:(options.offset || 0)+1,total:1000});
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
 expect(mockPanel.tablePage.rowIndices).toEqual([999]);
 act(()=>mockPanel.tablePage.setFilter(0,['saved']));await act(async()=>jest.advanceTimersByTime(200));await flush();
 expect(requestHazardRows.mock.calls.at(-1)[1].offset).toBe(0);
});
test('leaving the panel aborts its active page request and ignores late completion',async()=>{
 let resolve;requestHazardRows.mockImplementation((_run,options)=>new Promise(done=>{resolve=done;}));
 await act(async()=>root.render(<PagedHazardPanel latestRun={run}/>));
 const signal=requestHazardRows.mock.calls.at(-1)[1].signal;
 act(()=>root.render(null));expect(signal.aborted).toBe(true);
 await act(async()=>resolve({headers:[],rows:[],rowIndices:[],total:0,nextOffset:0}));
 expect(host.textContent).toBe('');
});
