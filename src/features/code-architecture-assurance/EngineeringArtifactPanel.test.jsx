jest.mock('./softwareHazardSource', () => ({resolveSoftwareHazardSource:jest.fn(async ({current})=>current)}));
global.IS_REACT_ACT_ENVIRONMENT = true;
jest.mock('./artifactAI', () => ({DERIVE_BY_KIND:{'software-requirements':jest.fn()}}));
jest.mock('./artifactUtils', () => ({...jest.requireActual('./artifactUtils'),ensureArtifactStorageReady:jest.fn(async()=>{}),loadArtifactRows:jest.fn(()=>[]),loadArtifactRowsAsync:jest.fn(),saveArtifactRowsAsync:jest.fn(async()=>{})}));
jest.mock('./useArtifactReview', () => ({useArtifactReview:()=>({reviewItems:[],reviewByRow:{},reviewDrawerOptions:{}})}));
jest.mock('../../components/activity/ActivityCenter', () => ({useActivityCenter:()=>({startActivity:jest.fn(),updateActivity:jest.fn(),finishActivity:jest.fn()})}));
jest.mock('./EngineeringArtifactTable', () => ({__esModule:true,default:({rows})=><div data-testid="rows">{rows.map(row=>row.requirementText).join('|')}</div>}));
const React=require('react');
const {act}=React;
const {createRoot}=require('react-dom/client');
const Panel=require('./EngineeringArtifactPanel').default;
const {DERIVE_BY_KIND}=require('./artifactAI');
const {loadArtifactRows,loadArtifactRowsAsync,saveArtifactRowsAsync}=require('./artifactUtils');
const props={kind:'software-requirements',project:{id:'p',name:'Example'},repo:{id:'r'},cbaRows:[{from:'A',action:'Command',to:'B'}]};
let root,host;
beforeEach(()=>{
 jest.clearAllMocks();loadArtifactRows.mockReturnValue([]);loadArtifactRowsAsync.mockResolvedValue([]);saveArtifactRowsAsync.mockResolvedValue();
 DERIVE_BY_KIND['software-requirements'].mockResolvedValue([{id:'SWR-001',requirementText:'The software shall retain the command.'}]);
 host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);
});
afterEach(()=>{act(()=>root.unmount());host.remove();});
async function generate(){await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Derive from Functional Decomposition').click());}
test('a delayed initial storage read cannot erase newly generated requirements',async()=>{
 let release;loadArtifactRowsAsync.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
 await act(async()=>root.render(<Panel {...props}/>));
 await generate();
 expect(host.textContent).toContain('The software shall retain the command.');
 await act(async()=>release([]));
 expect(host.textContent).toContain('The software shall retain the command.');
});
test('empty generation preserves existing requirements and reports failure',async()=>{
 loadArtifactRowsAsync.mockResolvedValue([{id:'SWR-001',requirementText:'Existing requirement'}]);
 DERIVE_BY_KIND['software-requirements'].mockResolvedValue([]);
 await act(async()=>root.render(<Panel {...props}/>));
 await generate();
 expect(host.textContent).toContain('Existing requirement');
 expect(host.textContent).toMatch(/no.*requirements.*generated/i);
 expect(saveArtifactRowsAsync).not.toHaveBeenCalled();
});

test('loading stored results does not start a save/reload feedback loop',async()=>{
 jest.useFakeTimers();
 try {
  loadArtifactRowsAsync.mockResolvedValue([{id:'SWR-001',requirementText:'Saved requirement'}]);
  await act(async()=>root.render(<Panel {...props}/>));
  await act(async()=>jest.advanceTimersByTime(1000));
  expect(saveArtifactRowsAsync).not.toHaveBeenCalled();
  expect(host.textContent).toContain('Saved requirement');
 } finally {jest.useRealTimers();}
});

test('an older change-event reload cannot replace completed generation',async()=>{
 await act(async()=>root.render(<Panel {...props}/>));
 let release;let softwareReads=0;
 loadArtifactRowsAsync.mockImplementation(kind=>kind==='software-requirements' && ++softwareReads===2
  ? new Promise(resolve=>{release=resolve;}) : Promise.resolve([]));
 await act(async()=>window.dispatchEvent(new CustomEvent('xhandle:code-architecture-assurance:changed',
  {detail:{kind:props.kind,projectId:'p',repoId:'r'}})));
 await generate();
 await act(async()=>release([]));
 expect(host.textContent).toContain('The software shall retain the command.');
});

test('generated requirements survive leaving and reopening the panel',async()=>{
 const stored=new Map();
 loadArtifactRowsAsync.mockImplementation(async kind=>stored.get(kind)||[]);
 saveArtifactRowsAsync.mockImplementation(async(kind,_project,_repo,rows)=>{stored.set(kind,rows);});
 await act(async()=>root.render(<Panel {...props}/>));
 await generate();
 await act(async()=>root.render(null));
 await act(async()=>root.render(<Panel {...props}/>));
 expect(host.textContent).toContain('The software shall retain the command.');
});

test('failed storage load reports the error without autosaving an empty replacement',async()=>{
 jest.useFakeTimers();
 try {
  loadArtifactRows.mockReturnValue([{id:'SWR-001',requirementText:'Retained in memory'}]);
  loadArtifactRowsAsync.mockRejectedValue(new Error('Saved requirements are incomplete or damaged.'));
  const warn=jest.spyOn(console,'warn').mockImplementation(()=>{});
  await act(async()=>root.render(<Panel {...props}/>));
  await act(async()=>jest.advanceTimersByTime(1000));
  expect(host.textContent).toContain('incomplete or damaged');
  expect(host.textContent).toContain('Retained in memory');
  expect(saveArtifactRowsAsync).not.toHaveBeenCalled();
  warn.mockRestore();
 } finally {jest.useRealTimers();}
});

test('storage preflight failure prevents model requests',async()=>{
 const {ensureArtifactStorageReady}=require('./artifactUtils');
 ensureArtifactStorageReady.mockRejectedValueOnce(new Error('Requirements storage upgrade is blocked.'));
 await act(async()=>root.render(<Panel {...props}/>));
 await generate();
 expect(DERIVE_BY_KIND['software-requirements']).not.toHaveBeenCalled();
 expect(host.textContent).toContain('storage upgrade is blocked');
});

test('shows fallback and hazard-import diagnostics rather than an unqualified success',async()=>{
 const rows=[{id:'SWR-001',requirementText:'Fallback draft',source:'functional-derived-fallback'}];
 rows.derivationReport={fallbackRows:1,failures:['AI returned no usable software requirements.'],hazardRows:3,importedSafetyRows:0,excludedSafetyRows:2,missingRequirementRows:1};
 DERIVE_BY_KIND['software-requirements'].mockResolvedValue(rows);
 await act(async()=>root.render(<Panel {...props}/>));
 await generate();
 expect(host.textContent).toContain('not completed AI requirements');
 expect(host.textContent).toContain('2 excluded by safety significance');
 expect(host.textContent).toContain('1 missing requirement text');
});
