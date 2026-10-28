global.IS_REACT_ACT_ENVIRONMENT=true;
jest.mock('lucide-react',()=>{const Icon=()=> <span/>;return new Proxy({},{get:()=>Icon});});
const React=require('react');
const {act}=React;
const {createRoot}=require('react-dom/client');
const Panel=require('./CodeArchitectureHazardPanel').default;
it('paints feedback before preparing a 26278-row saved run, then shows a windowed table',()=>{
 jest.useFakeTimers();
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);
 const sheet=[['Raw Analysis Row ID','Function (From)','Control Action','Guide Phrase Applicable'],
 ...Array.from({length:26278},(_,i)=>['HA-'+i,'Function '+Math.floor(i/7),'Command','Yes'])];
 try {
  const run={id:'large-entry',generatedSheets:{Summary:sheet}}, empty=[];
  const {useHazardPreparationCache}=require('./hazardPreparationCache');
  function Workspace({visible}) {
    const inputs={latestRun:run,cbaRows:empty,operationalContexts:empty};
    const cache=useHazardPreparationCache(inputs,'project');
    return visible ? <Panel method="STPA" {...inputs} preparationCache={cache}/> : null;
  }
  act(()=>root.render(<Workspace visible/>));
  expect(host.querySelectorAll('[role="progressbar"]')).toHaveLength(1);
  expect(host.querySelector('table')).toBeNull();
  act(()=>jest.runAllTimers());
  // Completing the panel starts the separate row-height preparation effect.
  act(()=>jest.runAllTimers());
  expect(host.querySelector('[role="progressbar"]')).toBeNull();
  expect(host.textContent).toContain('26278 of 26278');
  expect(host.querySelectorAll('tbody tr').length).toBeGreaterThan(0);
  expect(host.querySelectorAll('tbody tr').length).toBeLessThan(100);
  for(let i=0;i<5;i++) {
    act(()=>root.render(<Workspace visible={false}/>));
    act(()=>root.render(<Workspace visible/>));
    act(()=>jest.runAllTimers());act(()=>jest.runAllTimers());
    expect(host.textContent).toContain('26278 of 26278');
    expect(host.querySelectorAll('tbody tr').length).toBeGreaterThan(0);
    expect(host.querySelectorAll('tbody tr').length).toBeLessThan(100);
  }
 } finally {act(()=>root.unmount());host.remove();jest.useRealTimers();}
});
