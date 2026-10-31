global.IS_REACT_ACT_ENVIRONMENT=true;
jest.mock('lucide-react',()=>{const Icon=()=> <span/>;return new Proxy({},{get:()=>Icon});});
const React=require('react');
const {act}=React;
const {createRoot}=require('react-dom/client');
const Panel=require('./CodeArchitectureHazardPanel').default;
const empty=[];
const makeRun=id=>({id,projectId:'p',repoId:'r',hazardMethod:'STPA',generatedSheets:{Summary:[
 ['Raw Analysis Row ID','Function (From)','Control Action','Guide Phrase Applicable','Operational Context ID'],
 ...Array.from({length:602},(_,i)=>[id+'-'+i,'Function '+Math.floor(i/7),'Command','Yes','ctx'])
]}});
let host,root;
beforeEach(()=>{jest.useFakeTimers();host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();jest.useRealTimers();});
const render=props=>act(()=>root.render(<Panel method="STPA" cbaRows={empty} operationalContexts={empty} {...props}/>));
const settle=()=>{act(()=>jest.runAllTimers());act(()=>jest.runAllTimers());};
const expectActiveAnalysisOnly=()=>{
 const indicators=host.querySelectorAll('[role="progressbar"]');
 expect(indicators).toHaveLength(1);
 expect(indicators[0].getAttribute('aria-label')).toMatch(/^Running (?:code architecture )?hazard analysis$/);
 expect(indicators[0].hasAttribute('aria-valuenow')).toBe(false);
 expect(host.textContent).not.toMatch(/Preparing saved hazard results|Preparing hazard table|Preparing hazard analysis/);
 const stop=[...host.querySelectorAll('button')].find(button=>button.textContent==='Stop analysis');
 expect(stop).toBeDefined();expect(stop.disabled).toBe(false);
};
it('cold entry keeps an actionable Stop control throughout preparation',()=>{
 const run=makeRun('running');
 const cancel=jest.fn();
 render({latestRun:run,isRunning:true,onCancelAnalysis:cancel});
 expectActiveAnalysisOnly();
 act(()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Stop analysis').click());
 expect(cancel).toHaveBeenCalledTimes(1);
 settle();
 expectActiveAnalysisOnly();
});
it('changing context for the same saved run retains the table and collapsed groups',()=>{
 const run=makeRun('context');
 render({latestRun:run,selectedOperationalContextId:'all'});settle();
 const collapse=[...host.querySelectorAll('button')].find(b=>b.textContent.includes('Collapse all groups'));
 expect(collapse).toBeDefined();
 act(()=>collapse.click());
 expect(host.querySelectorAll('tr[id^="cba-hazard-row-"]')).toHaveLength(0);
 const table=host.querySelector('table');
 render({latestRun:run,selectedOperationalContextId:'ctx'});
 expect(host.querySelector('[role="progressbar"]')).toBeNull();
 expect(host.querySelector('table')).toBe(table);
 settle();
 expect(host.querySelectorAll('tr[id^="cba-hazard-row-"]')).toHaveLength(0);
});
it('partial snapshots arriving before preparation completes never remove active-run controls',()=>{
 let run=makeRun('stream');
 render({latestRun:run,isRunning:true});
 for(let i=0;i<4;i++){
  act(()=>jest.advanceTimersToNextTimer());
  run={...run,generatedSheets:{Summary:[...run.generatedSheets.Summary]}};
  render({latestRun:run,isRunning:true});
  expectActiveAnalysisOnly();
 }
 settle();expectActiveAnalysisOnly();
});
it('recomputes freshness for same-run context changes without replacing normalized rows or the table',()=>{
 const run=makeRun('freshness');
 render({latestRun:run});settle();
 const table=host.querySelector('table');
 expect(host.textContent).not.toContain('Architecture, operational context or organization guidance changed');
 render({latestRun:run,organizationContext:{name:'Changed guidance'}});
 expect(host.querySelector('table')).toBe(table);
 expect(host.querySelector('[role="progressbar"]')).toBeNull();
 expect(host.textContent).toContain('Architecture, operational context or organization guidance changed');
 render({latestRun:run});
 expect(host.querySelector('table')).toBe(table);
 expect(host.textContent).not.toContain('Architecture, operational context or organization guidance changed');
});
it('keeps cancellation available when preparation fails',()=>{
 const run=makeRun('broken');
 run.generatedSheets.Summary[1][0]={toString(){throw new Error('Unreadable saved row');}};
 const cancel=jest.fn();
 render({latestRun:run,isRunning:true,onCancelAnalysis:cancel});settle();
 expect(host.textContent).toContain('Unreadable saved row');
 act(()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Stop analysis').click());
 expect(cancel).toHaveBeenCalledTimes(1);
});
it('does not restart preparation or remove the mounted table for a partial result update',()=>{
 let run=makeRun('mounted-stream');
 render({latestRun:run,isRunning:true});settle();
 const table=host.querySelector('table');
 expect(table).not.toBeNull();
 run={...run,generatedSheets:{Summary:run.generatedSheets.Summary.slice(0,-1)}};
 render({latestRun:run,isRunning:true});
 expect(host.querySelector('table')).toBe(table);
 expectActiveAnalysisOnly();
 expect(host.textContent).toContain('601 of 601');
});

it('preserves an already mounted table when streaming results cross the preparation threshold',()=>{
 const full=makeRun('threshold');
 const small={...full,generatedSheets:{Summary:full.generatedSheets.Summary.slice(0,401)}};
 render({latestRun:small,isRunning:true});settle();
 act(()=>[...host.querySelectorAll('button')].find(b=>b.textContent.includes('Collapse all groups')).click());
 const table=host.querySelector('table');
 expect(host.querySelectorAll('tr[id^="cba-hazard-row-"]')).toHaveLength(0);
 render({latestRun:full,isRunning:true});
 expect(host.querySelector('table')).toBe(table);
 settle();
 expect(host.querySelectorAll('tr[id^="cba-hazard-row-"]')).toHaveLength(0);
});
it('keeps same-run threshold updates mounted but prepares a different large run',()=>{
 const full=makeRun('threshold-repeat');
 const small={...full,generatedSheets:{Summary:full.generatedSheets.Summary.slice(0,501)}};
 render({latestRun:small,isRunning:true});settle();
 const table=host.querySelector('table');
 expect(table).not.toBeNull();
 for(const run of [full, {...full}, small, full]) {
  render({latestRun:run,isRunning:true});
  expect(host.querySelector('table')).toBe(table);
  expectActiveAnalysisOnly();
 }
 const other=makeRun('other-large');
 other.projectId='other-project';
 render({latestRun:other,isRunning:true});
 expect(host.querySelector('table')).toBeNull();
 expectActiveAnalysisOnly();
 settle();
 expect(host.querySelector('table')).not.toBe(table);
 expect(host.querySelector('[data-window-key="row:other-large-0"]')).not.toBeNull();
 expect(host.querySelector('[data-window-key="row:threshold-repeat-0"]')).toBeNull();
});
