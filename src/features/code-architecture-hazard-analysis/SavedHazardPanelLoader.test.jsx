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
it('paints progress and releases the prepared snapshot across unmount',()=>{
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
 expect(host.querySelector('[role="progressbar"]')).not.toBeNull();
 act(()=>jest.runAllTimers());
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
it.each([false,true])('shows one active-analysis indicator while large saved rows prepare (review mode %s)',reviewMode=>{
 const stop=jest.fn();
 act(()=>root.render(<Loader {...props} latestRun={makeRun('running')} isRunning reviewMode={reviewMode} onCancelAnalysis={stop} progress={{message:'Analyzing scenarios'}}/>));
 expect(host.querySelectorAll('[role="progressbar"]')).toHaveLength(1);
 expect(host.querySelector('[role="progressbar"]').getAttribute('aria-label')).toBe('Analyzing scenarios');
 expect(host.textContent).not.toContain('Preparing saved hazard results');
 const button=[...host.querySelectorAll('button')].find(button=>button.textContent==='Stop analysis');
 if(reviewMode)expect(button).toBeUndefined();
 else {act(()=>button.click());expect(stop).toHaveBeenCalledTimes(1);}
});
it('keeps upgrade cancellation visible during large saved-result preparation without a competing loader',()=>{
 const cancelUpgrade=jest.fn();
 act(()=>root.render(<Loader {...props} latestRun={makeRun('upgrading')} restoration={{status:'upgrading',progress:40,cancelUpgrade}}/>));
 expect(host.textContent).toContain('Upgrading saved table storage… 40%');
 expect(host.querySelector('[role="progressbar"]')).toBeNull();
 act(()=>[...host.querySelectorAll('button')].find(button=>button.textContent==='Cancel upgrade').click());
 expect(cancelUpgrade).toHaveBeenCalledTimes(1);
});
it('retains restoration error and retry while preparing existing large results',()=>{
 const retry=jest.fn();
 act(()=>root.render(<Loader {...props} latestRun={makeRun('existing')} restoration={{status:'failed',error:'Storage temporarily unavailable',retry}}/>));
 expect(host.querySelector('[role="alert"]').textContent).toContain('Previously loaded results are still shown');
 expect(host.querySelectorAll('[role="progressbar"]')).toHaveLength(1);
 act(()=>[...host.querySelectorAll('button')].find(button=>button.textContent==='Retry loading').click());
 expect(retry).toHaveBeenCalledTimes(1);
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
it('reuses only the supplied current-project prepared cache across tab reentry',()=>{
 const cache={current:null},run=makeRun('cached');
 act(()=>root.render(<Loader {...props} latestRun={run} preparationCache={cache}/>));
 act(()=>jest.runAllTimers());expect(cache.current).not.toBeNull();
 act(()=>root.render(null));act(()=>root.render(<Loader {...props} latestRun={run} preparationCache={cache}/>));
 expect(host.querySelector('[role="progressbar"]')).toBeNull();expect(host.textContent).toBe('cached-0');
 act(()=>root.render(<Loader {...props} latestRun={makeRun('different')} preparationCache={cache}/>));
 expect(cache.current).toBeNull();act(()=>jest.runAllTimers());expect(host.textContent).toBe('different-0');
});
it('does not retain a prepared result larger than the cache budget',()=>{
 const {cacheableHazardPreparation}=require('./hazardPreparationCache');
 expect(cacheableHazardPreparation({summarySheet:[['small']],functionalTraceIds:new Set()})).toBe(true);
 expect(cacheableHazardPreparation({summarySheet:[['x'.repeat(5*1024*1024)]],functionalTraceIds:new Set()})).toBe(false);
});
const {useHazardPreparationCache}=require('./hazardPreparationCache');
it.each(['results','architecture','contexts','selection','organization','deletion','scope'])('releases hidden-tab cached inputs on %s change',kind=>{
 let cache;
 const initial={...props,latestRun:makeRun('background')};
 function Workspace({visible,inputs,scope='project'}) {
  cache=useHazardPreparationCache(inputs,scope);
  return visible ? <Loader {...inputs} preparationCache={cache}/> : null;
 }
 act(()=>root.render(<Workspace visible inputs={initial}/>));act(()=>jest.runAllTimers());
 const oldCache=cache;expect(oldCache.current).not.toBeNull();
 const changes={results:{latestRun:makeRun('replacement')},architecture:{cbaRows:[]},contexts:{operationalContexts:[]},selection:{selectedOperationalContextId:'other'},organization:{organizationContext:'changed'},deletion:{latestRun:null},scope:{}};
 act(()=>root.render(<Workspace visible={false} inputs={{...initial,...changes[kind]}} scope={kind==='scope'?'other':'project'}/>));
 expect(oldCache.current).toBeNull();expect(oldCache.retired).toBe(true);
 act(()=>jest.runAllTimers());expect(cache.current).toBeNull();
});
it('preserves unchanged prepared data across hidden-tab rerenders and reentry',()=>{
 let cache;const inputs={...props,latestRun:makeRun('stable')};
 function Workspace({visible}) {cache=useHazardPreparationCache(inputs,'p');return visible?<Loader {...inputs} preparationCache={cache}/>:null;}
 act(()=>root.render(<Workspace visible/>));act(()=>jest.runAllTimers());const first=cache,current=cache.current;
 act(()=>root.render(<Workspace visible={false}/>));expect(cache).toBe(first);expect(cache.current).toBe(current);
 act(()=>root.render(<Workspace visible/>));expect(cache.current).toBe(current);expect(host.querySelector('[role="progressbar"]')).toBeNull();
});
it('does not publish into a retired cache even if old preparation finishes',()=>{
 const cache={current:null,retired:false};
 act(()=>root.render(<Loader {...props} latestRun={makeRun('old')} preparationCache={cache}/>));
 act(()=>jest.advanceTimersToNextTimer());cache.retired=true;
 act(()=>jest.runAllTimers());expect(cache.current).toBeNull();
});
it('replaces an in-flight preparation under StrictMode without publishing old results',()=>{
 let cache;
 function Workspace({run}) {
  const inputs={...props,latestRun:run};
  cache=useHazardPreparationCache(inputs,'project');
  return <Loader {...inputs} preparationCache={cache}/>;
 }
 act(()=>root.render(<React.StrictMode><Workspace run={makeRun('old-work')}/></React.StrictMode>));
 act(()=>jest.advanceTimersToNextTimer());act(()=>jest.advanceTimersToNextTimer());
 const obsolete=cache;
 act(()=>root.render(<React.StrictMode><Workspace run={makeRun('new-work')}/></React.StrictMode>));
 act(()=>jest.runAllTimers());
 expect(obsolete.retired).toBe(true);expect(obsolete.current).toBeNull();
 expect(host.textContent).toBe('new-work-0');
 expect(cache.current.result.summarySheet[1][0]).toBe('new-work-0');
});
it('preserves cache for unrelated run metadata updates while hidden',()=>{
 let cache;const run=makeRun('metadata');
 function Workspace({visible,value}) {
  const inputs={...props,latestRun:value};cache=useHazardPreparationCache(inputs,'project');
  return visible?<Loader {...inputs} preparationCache={cache}/>:null;
 }
 act(()=>root.render(<Workspace visible value={run}/>));act(()=>jest.runAllTimers());
 const before=cache,snapshot=cache.current;
 act(()=>root.render(<Workspace visible={false} value={{...run,updatedAt:'new timestamp',narrativeReview:{status:'done'}}}/>));
 expect(cache).toBe(before);expect(cache.current).toBe(snapshot);
});

it.each(['generation','revision'])('retires hidden continuous layout metadata when its saved %s changes',field=>{
 const {PAGED_HAZARD}=require('./hazardRowIndex');
 let cache;
 const run={id:'saved',projectId:'p',repoId:'r',[PAGED_HAZARD]:{generation:'one',revision:'one'}};
 function Workspace({value}){cache=useHazardPreparationCache({latestRun:value},'p');return null;}
 act(()=>root.render(<Workspace value={run}/>));
 const previous=cache;previous.current={kind:'continuous-hazard-layout',layout:{groups:[]}};
 act(()=>root.render(<Workspace value={{...run,[PAGED_HAZARD]:{...run[PAGED_HAZARD],[field]:'two'}}}/>));
 expect(previous.retired).toBe(true);expect(previous.current).toBeNull();expect(cache).not.toBe(previous);
});
