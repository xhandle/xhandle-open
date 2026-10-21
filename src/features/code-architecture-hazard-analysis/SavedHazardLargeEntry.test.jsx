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
  act(()=>root.render(<Panel method="STPA" latestRun={{id:'large-entry',generatedSheets:{Summary:sheet}}} cbaRows={[]} operationalContexts={[]}/>));
  expect(host.querySelectorAll('[role="progressbar"]')).toHaveLength(1);
  expect(host.querySelector('table')).toBeNull();
  act(()=>jest.runAllTimers());
  // Completing the panel starts the separate row-height preparation effect.
  act(()=>jest.runAllTimers());
  expect(host.querySelector('[role="progressbar"]')).toBeNull();
  expect(host.textContent).toContain('26278 of 26278');
  expect(host.querySelectorAll('tbody tr').length).toBeGreaterThan(0);
  expect(host.querySelectorAll('tbody tr').length).toBeLessThan(100);
 } finally {act(()=>root.unmount());host.remove();jest.useRealTimers();}
});
