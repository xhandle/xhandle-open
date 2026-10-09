jest.mock('./softwareHazardSource', () => ({resolveSoftwareHazardSource:jest.fn(async ({current})=>current)}));
const {IDBFactory,IDBDatabase,IDBObjectStore}=require("fake-indexeddb");
const {serialize,deserialize}=require("v8");
global.IS_REACT_ACT_ENVIRONMENT = true;
jest.mock('./artifactAI', () => ({DERIVE_BY_KIND:{'software-requirements':jest.fn()}}));
jest.mock('./useArtifactReview', () => ({useArtifactReview:()=>({reviewItems:[],reviewByRow:{},reviewDrawerOptions:{}})}));
jest.mock('../../components/activity/ActivityCenter', () => ({useActivityCenter:()=>({startActivity:jest.fn(),updateActivity:jest.fn(),finishActivity:jest.fn()})}));
jest.mock('./EngineeringArtifactTable', () => ({__esModule:true,default:({rows})=><div data-testid="rows">{rows.map(row=>row.requirementText).join('|')}</div>}));
const React=require('react');
const {act}=React;
const {createRoot}=require('react-dom/client');
const Panel=require('./EngineeringArtifactPanel').default;
const {DERIVE_BY_KIND}=require('./artifactAI');
const {loadArtifactRows,loadArtifactRowsAsync,saveArtifactRowsAsync}=require('./artifactUtils');

const props={kind:'software-requirements',project:{id:'integration-p'},repo:{id:'integration-r'},cbaRows:[{from:'A',action:'Command',to:'B'}]};
const originalDb=global.indexedDB, originalClone=global.structuredClone;
let host,root;
beforeEach(()=>{
 global.indexedDB=new IDBFactory();global.structuredClone=value=>deserialize(serialize(value));localStorage.clear();
 DERIVE_BY_KIND['software-requirements'].mockResolvedValue([{id:'SWR-001',requirementText:'The software shall retain the command.'}]);
 host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);
});
afterEach(()=>{act(()=>root.unmount());host.remove();jest.restoreAllMocks();global.indexedDB=originalDb;global.structuredClone=originalClone;});
async function settle(){await act(async()=>{await new Promise(resolve=>setTimeout(resolve,80));});}
test('fallback generation remains visible after save notifications and reopening with production storage',async()=>{
 await saveArtifactRowsAsync(props.kind,props.project.id,props.repo.id,[]);
 jest.spyOn(IDBObjectStore.prototype,'put').mockImplementation(()=>{throw new Error('Injected write failure');});
 jest.spyOn(console,'warn').mockImplementation(()=>{});
 await act(async()=>root.render(<Panel {...props}/>));await settle();
 await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Derive from Functional Decomposition').click());await settle();
 expect(host.textContent).toContain('The software shall retain the command.');
 await act(async()=>root.render(null));
 await act(async()=>root.render(<Panel {...props}/>));await settle();
 expect(host.textContent).toContain('The software shall retain the command.');
 expect(await loadArtifactRowsAsync(props.kind,props.project.id,props.repo.id)).toHaveLength(1);
});

test('unsaved generated rows survive panel remount and retry without a second model call',async()=>{
 const large=[{id:'SWR-001',requirementText:'Generated requirement '+ 'x'.repeat(800000)}];
 DERIVE_BY_KIND['software-requirements'].mockClear();
 DERIVE_BY_KIND['software-requirements'].mockResolvedValue(large);
 const failure=jest.spyOn(IDBObjectStore.prototype,'put').mockImplementation(()=>{throw new Error('Injected quota failure');});
 jest.spyOn(console,'warn').mockImplementation(()=>{});
 await act(async()=>root.render(<Panel {...props}/>));await settle();
 await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Derive from Functional Decomposition').click());await settle();
 expect(host.textContent).toContain('Retry save');
 await act(async()=>root.render(null));
 await act(async()=>root.render(<Panel {...props}/>));await settle();
 expect(host.textContent).toContain('Generated requirement');
 failure.mockRestore();
 await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Retry save').click());await settle();
 expect(host.textContent).toContain('Requirements saved.');
 expect(host.textContent).not.toContain('Retry save');
 expect(DERIVE_BY_KIND['software-requirements']).toHaveBeenCalledTimes(1);
 expect(await loadArtifactRowsAsync(props.kind,props.project.id,props.repo.id)).toHaveLength(1);
});
