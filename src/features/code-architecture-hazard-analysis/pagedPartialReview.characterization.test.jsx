import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import Table from './CodeArchitectureHazardSummaryTable';
import PagedHazardPanel from './PagedHazardPanel';
import requestHazardRows from './requestHazardRows';
import {PAGED_HAZARD} from './hazardRowIndex';
jest.mock('lucide-react',()=>new Proxy({__esModule:true},{get:(target,name)=>name==='__esModule'?true:()=>null}));
let mockPanel;
jest.mock('./CodeArchitectureHazardPanel',()=>({PreparedCodeArchitectureHazardPanel:function Prepared(props){
 mockPanel=props;
 require('react').useEffect(()=>{if(props.tablePage.layout)props.tablePage.requestRows([0]);},[props.tablePage.layout,props.tablePage.requestRows]);
 return <div>{props.tablePage.controls}</div>;
}}));
jest.mock('./requestHazardRows',()=>({__esModule:true,default:jest.fn()}));
jest.mock('../code-architecture-context/functionalModel',()=>({functionalModelIsReady:()=>true,buildFunctionalModelRows:()=>[{traceId:'functional-relationship:one'}]}));
jest.mock('./codeArchitectureHazardUtils',()=>({effectiveCodeArchitectureHazardRows:()=>[],isCodeArchitectureHazardAnalysisStale:({run})=>run.architectureSnapshotHash==='old'}));
global.IS_REACT_ACT_ENVIRONMENT=true;
let host,root;
const run={id:'paged-ui',architectureSnapshotHash:'old',[PAGED_HAZARD]:{revision:'one',headers:['Hazard'],total:1000,details:['csvImportPreviousSummary']}};
const flush=async()=>{await act(async()=>{jest.advanceTimersByTime(0);await Promise.resolve();});await act(async()=>{await Promise.resolve();});};
const result=(options,headers,row)=>options.operation==='layout'?{headers,total:1,indices:[0],groups:[{key:'all',label:'Hazards',rowCount:1,rowIndices:[0]}]}:{headers,rows:[row],rowIndices:[0],offset:0,nextOffset:1,total:1};
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
 requestHazardRows.mockImplementation(async(_run,options)=>result(options,['Hazard'],[options.partial?'unreviewed partial':'published']));
 await act(async()=>root.render(<PagedHazardPanel latestRun={snapshot} reviewByRow={publishedReview}/>));await flush();
 const inspect=[...host.querySelectorAll('button')].find(button=>button.textContent==='Inspect validated partial results');
 await act(async()=>inspect.click());await flush();
 expect(mockPanel.tablePage.rowsByIndex.get(0)[0]).toBe('unreviewed partial');
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
 requestHazardRows.mockImplementation(async(_run,options)=>result(options,normalizer.headers,fillNotApplicableHazardCells(normalizer.headers,normalizer.normalizeRow(row,0))));
 const item={id:'review',status:'rejected',currentContent:{row,rowIndex:1}};
 await act(async()=>root.render(<PagedHazardPanel latestRun={{...run,[PAGED_HAZARD]:{...run[PAGED_HAZARD],headers}}} reviewItems={[item]} reviewByRow={new Map([[1,item]])}/>));await flush();
 expect(mockPanel.reviewByRow.get(0)).toBe(item);
 expect(mockPanel.reviewByRow.has(1)).toBe(false);
});

test('latest matching review wins with stable tie-breaking after a source-position change',async()=>{
 const headers=['Raw Analysis Row ID','Hazard'];
 const {createHazardRowNormalizer}=require('../project-hazard-analysis/classificationResolutionStatus');
 const {fillNotApplicableHazardCells}=require('../project-hazard-analysis/hazardNotApplicableCells');
 const normalizer=createHazardRowNormalizer(headers),row=['HA-2','retained'];
 requestHazardRows.mockImplementation(async(_run,options)=>result(options,normalizer.headers,fillNotApplicableHazardCells(normalizer.headers,normalizer.normalizeRow(row,0))));
 const reviewItems=[
  {id:'older',updatedAt:'2026-10-01',currentContent:{row,rowIndex:10}},
  {id:'tie-first',updatedAt:'2026-10-03',currentContent:{row,rowIndex:10}},
  {id:'wrong-content',updatedAt:'2026-10-04',currentContent:{row:['HA-2','stale'],rowIndex:10}},
  {id:'tie-last',updatedAt:'2026-10-03',currentContent:{row,rowIndex:10}},
 ];
 await act(async()=>root.render(<PagedHazardPanel latestRun={{...run,[PAGED_HAZARD]:{...run[PAGED_HAZARD],headers}}} reviewItems={reviewItems}/>));await flush();
 expect(mockPanel.reviewByRow.get(0)).toBe(reviewItems[3]);
});
