global.IS_REACT_ACT_ENVIRONMENT=true;
jest.mock('./CodeArchitectureHazardPanel',()=>({
 PreparedCodeArchitectureHazardPanel:({preparedView,latestRun})=><div data-ready>{preparedView?.summarySheet[1]?.[0] || latestRun?.id}</div>
}));
const React=require('react');
const {act}=React;
const {createRoot}=require('react-dom/client');
const Loader=require('./SavedHazardPanelLoader').default;
const {ensureHazardAnalysisRowIds,createHazardRowNormalizer}=require('../project-hazard-analysis/classificationResolutionStatus');
let host,root;
const empty=[];
const makeRun=id=>({id,generatedSheets:{Summary:[['Raw Analysis Row ID','Guide Phrase Applicable'],...Array.from({length:1200},(_,i)=>[id+'-'+i,'Yes'])]}});
const props={cbaRows:empty,operationalContexts:empty};
beforeEach(()=>{jest.useFakeTimers();host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();jest.useRealTimers();});
it('paints progress before large preparation and reuses the completed snapshot on re-entry',()=>{
 const run=makeRun('warm');
 act(()=>root.render(<Loader {...props} latestRun={run}/>));
 expect(host.querySelector('[role="progressbar"]').getAttribute('aria-valuenow')).toBe('0');
 expect(host.querySelector('[data-ready]')).toBeNull();
 act(()=>jest.advanceTimersToNextTimer());act(()=>jest.advanceTimersToNextTimer());
 expect(Number(host.querySelector('[role="progressbar"]').getAttribute('aria-valuenow'))).toBeGreaterThan(0);
 act(()=>jest.runAllTimers());
 expect(host.textContent).toBe('warm-0');
 act(()=>root.render(null));
 act(()=>root.render(<Loader {...props} latestRun={{...run,narrativeReview:{status:'done'}}}/>));
 expect(host.querySelector('[role="progressbar"]')).toBeNull();
 expect(host.textContent).toBe('warm-0');
});
it('never publishes a superseded project and cancels unmounted work',()=>{
 act(()=>root.render(<Loader {...props} latestRun={makeRun('old')}/>));
 act(()=>jest.advanceTimersToNextTimer());act(()=>jest.advanceTimersToNextTimer());
 act(()=>root.render(<Loader {...props} latestRun={makeRun('new')}/>));
 act(()=>jest.runAllTimers());
 expect(host.textContent).toBe('new-0');
 act(()=>root.render(<Loader {...props} latestRun={makeRun('cancel')}/>));
 act(()=>root.render(null));
 expect(jest.getTimerCount()).toBe(0);
});
it('incremental normalization preserves the legacy row IDs including missing and repeated IDs',()=>{
 const sheet=[['Raw Analysis Row ID','Hazard'],['','one'],['same','two'],['same','three'],['','four']];
 const normalizer=createHazardRowNormalizer(sheet[0]);
 const rows=sheet.slice(1).map((row,index)=>normalizer.normalizeRow(row,index));
 expect([normalizer.headers,...rows]).toEqual(ensureHazardAnalysisRowIds(sheet));
 expect(sheet[1][0]).toBe('');
});
it('does not unmount an already displayed run when its summary changes',()=>{
 const run=makeRun('edit');
 act(()=>root.render(<Loader {...props} latestRun={run}/>));
 act(()=>jest.runAllTimers());
 const child=host.querySelector('[data-ready]');
 const updated={...run,generatedSheets:{Summary:run.generatedSheets.Summary.slice(0,-1)}};
 act(()=>root.render(<Loader {...props} latestRun={updated}/>));
 expect(host.querySelector('[role="progressbar"]')).toBeNull();
 expect(host.querySelector('[data-ready]')).toBe(child);
});
