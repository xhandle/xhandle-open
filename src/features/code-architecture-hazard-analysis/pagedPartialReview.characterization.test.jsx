jest.mock('lucide-react',()=>new Proxy({__esModule:true},{get:(target,name)=>name==='__esModule'?true:()=>null}));
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import Table from './CodeArchitectureHazardSummaryTable';
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
// Partial inspection must not inherit published review identities or controls.
test('partial row zero excludes published rejection and undo controls',async()=>{
 const publishedReview=new Map([[0,{id:'published-review',status:'rejected'}]]);
 const snapshot={...run,[PAGED_HAZARD]:{...run[PAGED_HAZARD],pending:true,partialCount:1}};
 requestHazardRows.mockImplementation(async(_run,options)=>({headers:['Hazard'],rows:[[options.partial?'unreviewed partial':'published']],rowIndices:[0],offset:0,nextOffset:1,total:1}));
 await act(async()=>root.render(<PagedHazardPanel latestRun={snapshot} reviewByRow={publishedReview}/>));await flush();
 const inspect=[...host.querySelectorAll('button')].find(button=>button.textContent==='Inspect validated partial results');
 await act(async()=>inspect.click());await flush();
 expect(mockPanel.preparedView.summarySheet[1][0]).toBe('unreviewed partial');
 const partialProps=mockPanel;
 // Render the same row/review props the actual prepared panel forwards.
 await act(async()=>root.render(<Table summarySheet={partialProps.preparedView.summarySheet} remotePage={partialProps.tablePage} reviewByRow={partialProps.reviewByRow}/>));
 expect(host.querySelector('#cba-hazard-row-0').className).not.toContain('bg-rose');
 expect(partialProps.tablePage.hasCsvUndo).toBe(false);
 expect(partialProps.reviewMode).toBe(true);
 expect(partialProps.onImportSummary).toBeUndefined();
});

test('published review follows row identity after deletion shifts its position',async()=>{
 const headers=['Raw Analysis Row ID','Hazard'];
 const {createHazardRowNormalizer}=require('../project-hazard-analysis/classificationResolutionStatus');
 const {fillNotApplicableHazardCells}=require('../project-hazard-analysis/hazardNotApplicableCells');
 const normalizer=createHazardRowNormalizer(headers);
 const row=['HA-2','retained'];
 requestHazardRows.mockImplementation(async()=>({headers:normalizer.headers,rows:[fillNotApplicableHazardCells(normalizer.headers,normalizer.normalizeRow(row,0))],rowIndices:[0],offset:0,nextOffset:1,total:1}));
 const item={id:'review',status:'rejected',currentContent:{row,rowIndex:1}};
 await act(async()=>root.render(<PagedHazardPanel latestRun={{...run,[PAGED_HAZARD]:{...run[PAGED_HAZARD],headers}}} reviewItems={[item]} reviewByRow={new Map([[1,item]])}/>));await flush();
 expect(mockPanel.reviewByRow.get(0)).toBe(item);
 expect(mockPanel.reviewByRow.has(1)).toBe(false);
});
