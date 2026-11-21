import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { serialize, deserialize } from 'v8';
import { webcrypto } from 'crypto';
import { TextEncoder, TextDecoder } from 'util';
import { generateFunctionalDecompositionFromGitHub as generate } from './generateFunctionalDecompositionFromGitHub';
import { readPublishedArchitectureState, readLatestArchitectureCheckpoint, readArchitectureCheckpoint, readArchitectureRunRecords, writeImportedArchitectureRunRecords, writeCbaRowsToIndexedDB, openCbaIndexedDB, prepareArchitecturePublication, recoverArchitecturePublication } from '../features/code-architecture-assurance/codeArchitectureStorage';
import { putRawRecord } from '../features/code-architecture-storage/chunkedRecord';
import { listGitHubSnapshot, readGitHubSnapshotFile, resolveGitHubRevision } from '../features/code-architecture-context/codeSourceAcquisition';
import { functionalModelIsReady, buildFunctionalModelRows } from '../features/code-architecture-context/functionalModel';
import { buildCodeArchitectureHazardInput, normalizeCodeArchitectureHazardRun, isCodeArchitectureHazardAnalysisStale } from '../features/code-architecture-hazard-analysis/codeArchitectureHazardUtils';
import { hierarchyResponse } from '../features/code-architecture-context/testSupport/functionalHierarchyFixture';
import * as sourceStorage from '../features/code-architecture-context/analysisSourceStorage';
import * as publication from '../features/code-architecture-assurance/codeArchitectureStorage';
jest.mock('lucide-react',()=>{const Icon=()=>null;return new Proxy({},{get:()=>Icon});});
jest.mock('./LiteSummaryDiagramReactFlowGitHub',()=>()=>null);
jest.mock('./FunctionalArchitectureDiagram',()=>()=>null);
jest.mock('./ArchitectureReportViewer',()=>()=>null);
jest.mock('../features/code-architecture-assurance/EngineeringArtifactTable',()=>()=>null);
jest.mock('../features/code-architecture-context/codeSourceAcquisition',()=>({...jest.requireActual('../features/code-architecture-context/codeSourceAcquisition'),
 resolveGitHubRevision:jest.fn(),listGitHubSnapshot:jest.fn(),readGitHubSnapshotFile:jest.fn()}));
jest.mock('../features/code-architecture-context/functionalWorkScheduler',()=>({...jest.requireActual('../features/code-architecture-context/functionalWorkScheduler'),createAnalysisPacer:()=>async()=>{}}));
jest.mock('./backendConfig',()=>({backendURL:'/synthetic',ACCOUNT_ID:'fixture',getLocalAccessToken:()=>'',buildAIAuthOpts:()=>({headers:{'x-ai-provider':'fixture','x-ai-model':'fixture'}})}));
jest.mock('../features/code-architecture-assurance/codeArchitectureMetrics',()=>({
 createFunctionalDecompositionMetricsRun:()=>({calls:[],failedAiCallCount:0}),finishFunctionalDecompositionMetricsRun:()=>({}),recordFunctionalDecompositionAiCall:()=>{},saveFunctionalDecompositionMetricsRun:()=>{},
}));
const scope='cba:append:repo', commit='a'.repeat(40), nextCommit='b'.repeat(40), config={id:'repo',owner:'fixture',repo:'mixed',branch:'main'};
const files=[{path:'native.c',sha:'c1',size:90},{path:'ui.js',sha:'j1',size:90}];
const bodies={'native.c':'int nativeSend(int v) { return v; }\nint nativeRun(int v) { return nativeSend(v); }',
 'ui.js':'function uiSend(v) { return v; }\nfunction uiRun(v) { return uiSend(v); }'};
const savedGlobals={indexedDB:global.indexedDB,IDBKeyRange:global.IDBKeyRange,structuredClone:global.structuredClone,crypto:global.crypto,TextEncoder:global.TextEncoder,TextDecoder:global.TextDecoder,fetch:global.fetch};
const originalBodies={...bodies};
let prompts, providerHook, sourceHook;
function provider(prompt){
 if(prompt.includes('Functional hierarchy input: '))return JSON.stringify(hierarchyResponse(prompt));
 if(prompt.includes('Consolidation input: '))return JSON.stringify({responsibilities:JSON.parse(prompt.split('Consolidation input: ')[1]).functions.map(fn=>({members:[fn.id],name:fn.name,description:fn.description}))});
 if(prompt.includes('Relationships (descriptions may be excerpts; classify only the supplied evidence): ')){
  const evidence=JSON.parse(prompt.split('Relationships (descriptions may be excerpts; classify only the supplied evidence): ')[1]);
  return JSON.stringify({function:{name:`Execute ${evidence[0].from}`,description:'Execute requested processing.',significance:'meaningful'},relationships:evidence.map(row=>({index:row.index,disposition:'interaction',significance:'meaningful',target:{name:'Send value',description:'Send requested value.'},action:'Value request',kind:'control',description:'Requested value',rationale:'Source contains the call.'}))});
 }
 if(prompt.includes('Current file evidence contract:')){
  const path=prompt.includes('"currentFile": "native.c"')||prompt.includes('"currentFile":"native.c"')?'native.c':'ui.js',prefix=path==='native.c'?'native':'ui';
  return '| Function (From) | Function (From) Related File(s) | Function (From) Details | Control Action | Control Action Details | Function (To) | Function (To) Related File(s) | Function (To) Details |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n'+`| ${prefix}Run | ${path} | Execute request | Call ${prefix}Send | Send requested value | ${prefix}Send | ${path} | Send value |`;
 }
 return '[]';
}
beforeEach(()=>{
 global.indexedDB=new IDBFactory();global.IDBKeyRange=IDBKeyRange;global.structuredClone=v=>deserialize(serialize(v));global.crypto=webcrypto;global.TextEncoder=TextEncoder;global.TextDecoder=TextDecoder;localStorage.clear();
 Object.assign(bodies,originalBodies);for(const key of Object.keys(bodies))if(!Object.hasOwn(originalBodies,key))delete bodies[key];
 prompts=[];providerHook=null;sourceHook=null;
 resolveGitHubRevision.mockResolvedValue(commit);listGitHubSnapshot.mockImplementation(async()=>files);
 readGitHubSnapshotFile.mockImplementation(async args=>{if(sourceHook)await sourceHook(args);return {ok:true,content:bodies[args.path],size:bodies[args.path].length,decoding:'utf8-fatal-v1'};});
 global.fetch=jest.fn(async(_url,options)=>{
  const {prompt}=JSON.parse(options.body);prompts.push(prompt);const behavior=providerHook ? await providerHook(prompt,options.signal) : null;
  return {ok:true,headers:{get:key=>key==='X-AI-Provider-Used'?'fixture':key==='X-AI-Model-Used'?behavior?.usedModel || 'fixture':null},json:async()=>({result:behavior?.result ?? provider(prompt)})};
 });
 jest.spyOn(console,'info').mockImplementation(()=>{});jest.spyOn(console,'log').mockImplementation(()=>{});jest.spyOn(console,'warn').mockImplementation(()=>{});jest.spyOn(console,'error').mockImplementation(()=>{});
});
afterEach(()=>{Object.assign(global,savedGlobals);jest.restoreAllMocks();jest.clearAllMocks();});
const run=(extensions,extra={})=>generate(jest.fn(),jest.fn(),null,{repoConfig:config,projectId:'append',storageKey:scope,selectedExtensions:extensions,...extra});
const seed=async()=>{
 const result=await run(['.c']);expect(result.rows.length).toBeGreaterThan(0);expect(functionalModelIsReady(result.rows)).toBe(true);return readPublishedArchitectureState(scope);
};

test('C then JS appends once with complete union coverage, stable IDs, old edits and a reloaded functional model',async()=>{
 const initial=await seed();const oldFunctionalIds=buildFunctionalModelRows(initial.rows).map(row=>row.traceId);
 const result=await run(['.c','.js'],{analysisMode:'append',expectedBaseIdentity:initial.identity});
 expect(result.metadata).toMatchObject({analysisMode:'append',appendedFiles:1,selectedFiles:2,analyzedFiles:2,storageSaved:true});
 expect(result.rows).toHaveLength(initial.rows.length+1);
 expect(result.rows.slice(0,initial.rows.length).map(({functionalAbstraction,...row})=>row)).toEqual(initial.rows.map(({functionalAbstraction,...row})=>row));
 const loaded=await readPublishedArchitectureState(scope);
 expect(loaded.run.inputManifest.map(file=>file.path)).toEqual(['native.c','ui.js']);expect(loaded.run.batches).toHaveLength(2);
 expect(loaded.run.parentFingerprint).toBe(initial.run.fingerprint);expect(functionalModelIsReady(loaded.rows)).toBe(true);
 expect(buildFunctionalModelRows(loaded.rows).map(row=>row.traceId)).toEqual(expect.arrayContaining(oldFunctionalIds));
 const extraction=prompts.filter(prompt=>prompt.includes('Current file evidence contract:'));
 expect(extraction.filter(prompt=>prompt.includes('"currentFile": "native.c"'))).toHaveLength(1);
 expect(extraction.filter(prompt=>prompt.includes('"currentFile": "ui.js"'))).toHaveLength(1);
 const count=prompts.length;
 await expect(run(['.js'],{analysisMode:'append'})).rejects.toMatchObject({code:'SOURCE_APPEND_NO_NEW_FILES'});
 expect(prompts).toHaveLength(count);expect((await readPublishedArchitectureState(scope)).identity).toBe(loaded.identity);
});

test('Replace retains its selected-only current rows and makes earlier unselected results historical',async()=>{
 const initial=await seed();const result=await run(['.js'],{analysisMode:'replace',expectedBaseIdentity:initial.identity});
 expect(result.rows.some(row=>row.fromFile==='native.c'&&row.lineage.status==='historical')).toBe(true);
 expect(result.rows.filter(row=>row.lineage.status==='current').every(row=>row.fromFile==='ui.js')).toBe(true);
 expect(result.metadata.selectedFiles).toBe(1);
});

test('a changed earlier blob blocks append before provider calls; an unchanged new revision succeeds',async()=>{
 const initial=await seed(), count=prompts.length;resolveGitHubRevision.mockResolvedValue(nextCommit);
 listGitHubSnapshot.mockResolvedValue([{...files[0],sha:'changed'},files[1]]);
 await expect(run(['.js'],{analysisMode:'append'})).rejects.toMatchObject({code:'SOURCE_APPEND_SOURCE_CHANGED'});
 expect(prompts.length).toBe(count);expect((await readPublishedArchitectureState(scope)).identity).toBe(initial.identity);
 listGitHubSnapshot.mockResolvedValue(files);
 const result=await run(['.js'],{analysisMode:'append'});
 expect(result.rows[0].snapshotId).toBe(initial.rows[0].snapshotId);
 expect((await readPublishedArchitectureState(scope)).run.inputManifest[0].source.snapshotId).toBe(commit);
});

test('append functional failure leaves earlier publication intact and retries the same pinned batch without re-extraction',async()=>{
 const initial=await seed();let fail=true;
 providerHook=prompt=>{if(fail&&prompt.includes('Create a purpose-oriented functional abstraction'))return {usedModel:'changed-model'};};
 await expect(run(['.js'],{analysisMode:'append'})).rejects.toThrow();
 expect((await readPublishedArchitectureState(scope)).identity).toBe(initial.identity);
 const checkpoint=await readLatestArchitectureCheckpoint(scope);expect(checkpoint.completed).toBe(1);
 const saved=await readArchitectureCheckpoint(checkpoint.key);expect(saved.analysisMode).toBe('append');expect(saved.baseIdentity).toBe(initial.identity);
 const extracted=prompts.filter(prompt=>prompt.includes('Current file evidence contract:')).length;
 fail=false;resolveGitHubRevision.mockResolvedValue(nextCommit);
 const result=await run(['.c'],{resumeCheckpointKey:checkpoint.key});
 expect(result.metadata.analysisMode).toBe('append');expect(result.metadata.commitSha).toBe(commit);
 expect(prompts.filter(prompt=>prompt.includes('Current file evidence contract:'))).toHaveLength(extracted);
 expect(result.rows.filter(row=>row.lineage.status==='current')).toHaveLength(2);
});

test('stale confirmation, source failure and cancellation preserve previous publication',async()=>{
 const initial=await seed();const edited=initial.rows.map(row=>({...row,action:'Analyst edit'}));await writeCbaRowsToIndexedDB(scope,edited);
 const count=prompts.length;await expect(run(['.js'],{analysisMode:'append',expectedBaseIdentity:initial.identity})).rejects.toMatchObject({code:'SOURCE_PUBLICATION_CONFLICT'});expect(prompts.length).toBe(count);
 const current=await readPublishedArchitectureState(scope);
 sourceHook=args=>{if(args.path==='ui.js')throw Object.assign(new Error('Synthetic source invalid'),{retryable:false,code:'SOURCE_RUN_CHANGED'});};
 await expect(run(['.js'],{analysisMode:'append'})).rejects.toThrow();
 expect((await readPublishedArchitectureState(scope)).identity).toBe(current.identity);
 sourceHook=null;const controller=new AbortController();providerHook=()=>{controller.abort();throw new DOMException('Cancelled','AbortError');};
 await expect(run(['.js'],{analysisMode:'append',signal:controller.signal})).rejects.toThrow();
 expect((await readPublishedArchitectureState(scope)).identity).toBe(current.identity);
});

test('edits made during append prevent publication and keep completed work recoverable',async()=>{
 const initial=await seed();let wrote=false;
 providerHook=async prompt=>{if(!wrote&&prompt.includes('Create a purpose-oriented functional abstraction')){wrote=true;await writeCbaRowsToIndexedDB(scope,initial.rows.map(row=>({...row,action:'Concurrent edit'})));}};
 await expect(run(['.js'],{analysisMode:'append'})).rejects.toMatchObject({code:'SOURCE_PUBLICATION_CONFLICT'});
 const loaded=await readPublishedArchitectureState(scope);expect(loaded.rows[0].action).toBe('Concurrent edit');
 const checkpoint=await readLatestArchitectureCheckpoint(scope);expect(checkpoint.publicationReady).toBe(true);
 await expect(recoverArchitecturePublication(scope,checkpoint.key)).rejects.toMatchObject({code:'SOURCE_PUBLICATION_CONFLICT'});
});

test('publication storage failure retains old results and a ready checkpoint for atomic retry',async()=>{
 const initial=await seed();const recover=publication.recoverArchitecturePublication;
 jest.spyOn(publication,'recoverArchitecturePublication').mockRejectedValueOnce(new Error('Synthetic storage failure'));
 await expect(run(['.js'],{analysisMode:'append'})).rejects.toMatchObject({code:'SOURCE_PUBLICATION_PENDING'});
 expect((await readPublishedArchitectureState(scope)).identity).toBe(initial.identity);
 const checkpoint=await readLatestArchitectureCheckpoint(scope);expect(checkpoint.publicationReady).toBe(true);
 await recover(scope,checkpoint.key);expect((await readPublishedArchitectureState(scope)).metadata.analyzedFiles).toBe(2);
});

test('atomic identity detects run-only changes and deletion even when row contents match',async()=>{
 const initial=await seed(), key=`functional-decomposition-checkpoint:${scope}:atomic`;
 await prepareArchitecturePublication(scope,initial.rows,{...initial.run,fingerprint:'f'.repeat(64),baseIdentity:initial.identity},initial.metadata,key,initial.rows);
 const db=await openCbaIndexedDB();try{await putRawRecord(db,'copilot_baseline',`${scope}:run`,{fingerprint:'other'});}finally{db.close();}
 await expect(recoverArchitecturePublication(scope,key)).rejects.toMatchObject({code:'SOURCE_PUBLICATION_CONFLICT'});
 const current=await readPublishedArchitectureState(scope);
 await prepareArchitecturePublication(scope,initial.rows,{...initial.run,fingerprint:'e'.repeat(64),baseIdentity:current.identity},initial.metadata,key,initial.rows);
 const db2=await openCbaIndexedDB();try{await putRawRecord(db2,'copilot_baseline',`${scope}:storage-deleted`,true);}finally{db2.close();}
 await expect(recoverArchitecturePublication(scope,key)).rejects.toMatchObject({code:'SOURCE_PUBLICATION_CONFLICT'});
 expect((await readPublishedArchitectureState(scope)).hasAnalysis).toBe(false);
});

test('successful append preserves analyst edits, overrides and immutable evidence even when the derived model needs refreshing',async()=>{
 const initial=await seed();const edits=initial.rows.map(row=>({...row,fromDetails:'Analyst purpose',hazardAnalysisEligibility:'Exclude',hazardAnalysisEligibilitySource:'analyst-override',hazardAnalysisEligibilityRationale:'Engineering decision'}));
 await writeCbaRowsToIndexedDB(scope,edits);
 const result=await run(['.js'],{analysisMode:'append'});
 const {functionalAbstraction,...old}=result.rows[0],{functionalAbstraction:prior,...expected}=edits[0];
 expect(old).toEqual(expected);expect(functionalModelIsReady(result.rows)).toBe(true);
 expect(prompts.filter(prompt=>prompt.includes('Current file evidence contract:')&&prompt.includes('"currentFile": "native.c"'))).toHaveLength(1);
});

test('an empty new file still records union coverage and prevents duplicate work on the next append',async()=>{
 const initial=await seed();providerHook=prompt=>null;
 const originalFetch=global.fetch;
 global.fetch=jest.fn(async(url,options)=>{
  const request=JSON.parse(options.body);
  if(request.prompt.includes('Current file evidence contract:')){
   prompts.push(request.prompt);
   return {ok:true,headers:{get:key=>key==='X-AI-Provider-Used'||key==='X-AI-Model-Used'?'fixture':null},json:async()=>({result:'| Function (From) | Function (From) Related File(s) | Function (From) Details | Control Action | Control Action Details | Function (To) | Function (To) Related File(s) | Function (To) Details |\n| --- | --- | --- | --- | --- | --- | --- | --- |'})};
  }
  return originalFetch(url,options);
 });
 const result=await run(['.js'],{analysisMode:'append'});
 expect(result.rows).toEqual(initial.rows);expect(result.metadata.analyzedFiles).toBe(2);
 const loaded=await readPublishedArchitectureState(scope);expect(loaded.run.inputManifest).toHaveLength(2);
 await expect(run(['.js'],{analysisMode:'append'})).rejects.toMatchObject({code:'SOURCE_APPEND_NO_NEW_FILES'});
});

test('initializing empty row storage does not trigger an existing-analysis choice',async()=>{
 await writeCbaRowsToIndexedDB(scope,[]);
 expect(await readPublishedArchitectureState(scope,{summaryOnly:true})).toMatchObject({hasAnalysis:false});
 const result=await run(['.c']);expect(result.metadata.storageSaved).toBe(true);
 expect(await readPublishedArchitectureState(scope,{summaryOnly:true})).toMatchObject({hasAnalysis:true});
});

test('legacy rows without immutable source metadata are preserved and require Replace before append',async()=>{
 const rows=[{from:'legacy',fromFile:'native.c',to:'send',toFile:'native.c',action:'Send',traceId:'legacy'}];
 await writeCbaRowsToIndexedDB(scope,rows);const initial=await readPublishedArchitectureState(scope);
 await expect(run(['.js'],{analysisMode:'append'})).rejects.toMatchObject({code:'SOURCE_APPEND_UNAVAILABLE'});
 expect(prompts).toHaveLength(0);expect(await readPublishedArchitectureState(scope)).toEqual(initial);
});


test('append manifests survive portable export/import even when a newly analyzed file has no rows',async()=>{
 await seed();const initial=await readPublishedArchitectureState(scope);
 const next={...initial.run,fingerprint:'d'.repeat(64),parentFingerprint:initial.run.fingerprint,inputManifest:[...initial.run.inputManifest,{path:'ui.js',blobSha:'j1'}]};
 const key=`functional-decomposition-checkpoint:${scope}:empty-file`;
 await prepareArchitecturePublication(scope,initial.rows,next,{...initial.metadata,sourceAnalysis:{fingerprint:next.fingerprint}},key,initial.rows);await recoverArchitecturePublication(scope,key);
 const records=await readArchitectureRunRecords(scope,initial.rows);expect(records.map(record=>record.fingerprint)).toContain(next.fingerprint);
 const destination='cba:imported:repo',copied=initial.rows.map(row=>({...row,lineage:{...row.lineage,scope:destination}}));
 await writeImportedArchitectureRunRecords(destination,records,copied,{latestFingerprint:next.fingerprint,metadata:initial.metadata});
 const loaded=await readPublishedArchitectureState(destination);expect(loaded.run.fingerprint).toBe(next.fingerprint);expect(loaded.run.scope).toBe(destination);
 expect(loaded.run.inputManifest.map(file=>file.path)).toEqual(['native.c','ui.js']);
 // A separate legacy import cannot inherit a stale source manifest.
 await writeImportedArchitectureRunRecords(destination,[],[{from:'legacy'}]);expect((await readPublishedArchitectureState(destination)).run).toBeNull();
});


function crossBatchReply(prompt, specs) {
 const marker='Append integration input: ';
 const input=JSON.parse(prompt.split(marker)[1]);
 const relationships=specs.filter(spec=>spec.fromFile===input.source.file&&spec.toFile===input.target.file&&spec.to===input.target.symbol).flatMap(spec=>{
  const from=input.source.units.find(unit=>unit.symbol===spec.from);if(!from)return [];
  const fromLines=bodies[spec.fromFile].split('\n'),toLines=bodies[spec.toFile].split('\n');
  const fromCitation={line:spec.line,quote:fromLines[spec.line-1]};
  const toFrame=input.target.frames.find(frame=>frame.line===spec.definition);
  if(!toFrame)return [];
  const via=(spec.via||[]).map(({file,line})=>({file,line,quote:bodies[file].split('\n')[line-1]}));
  return [{fromId:from.id,toId:input.target.id,action:'Transfer requested value',description:'Explicit source connection.',kind:spec.kind||'call',key:spec.key||'',fromCitation,toCitation:{line:spec.definition,quote:toFrame.quote},via}];
 });
 return JSON.stringify({relationships,unresolved:[]});
}
function bindingFixture(){
 bodies['native.c']='int nativeSend(int v) { return v; }\nint nativeRun(int v) { return nativeSend(v); }\nvoid nativeNotify(int v) {\n  EM_ASM({ uiHandle($0); }, v);\n}\nnapi_property_descriptor props[] = { { "execute", 0, nativeRun, 0, 0, 0, napi_default, 0 } };';
 bodies['ui.js']='function uiSend(v) { return v; }\nfunction uiRun(v) {\n return addon.execute(v);\n}\nfunction uiHandle(v) { return uiSend(v); }';
 return [
  {fromFile:'native.c',from:'nativeNotify',toFile:'ui.js',to:'uiHandle',line:4,definition:5,kind:'binding',key:'uiHandle',via:[{file:'native.c',line:4}]},
  {fromFile:'ui.js',from:'uiRun',toFile:'native.c',to:'nativeRun',line:3,definition:2,kind:'binding',key:'execute',via:[{file:'native.c',line:6}]},
 ];
}

test('Append discovers previously missing C↔JS binding links in both directions and connects the functional diagram',async()=>{
 const specs=bindingFixture(),initial=await seed(),hazard=normalizeCodeArchitectureHazardRun(buildCodeArchitectureHazardInput({cbaRows:initial.rows}));
 expect(initial.rows.some(row=>row.fromFile!==row.toFile)).toBe(false);
 providerHook=prompt=>prompt.includes('Append integration input: ')?{result:crossBatchReply(prompt,specs)}:null;
 const result=await run(['.js'],{analysisMode:'append'}),links=result.rows.filter(row=>row.integrationEvidence);
 expect(links.map(row=>[row.fromFile,row.from,row.toFile,row.to]).sort()).toEqual(specs.map(spec=>[spec.fromFile,spec.from,spec.toFile,spec.to]).sort());
 expect(links.every(row=>row.integrationEvidence.reviewRequired&&row.relationshipEvidence.supported===false)).toBe(true);
 expect(links.find(row=>row.fromFile==='ui.js').toNodeId).toBe(initial.rows[0].fromNodeId);
 expect(result.rows[0].traceId).toBe(initial.rows[0].traceId);expect(result.rows[0].sourceEvidence).toEqual(initial.rows[0].sourceEvidence);
 expect(result.metadata.integration).toMatchObject({status:'candidate-review-complete',earlierFiles:1,newFiles:1,acceptedRelationships:2});
 const loaded=await readPublishedArchitectureState(scope);expect(functionalModelIsReady(loaded.rows)).toBe(true);
 expect(loaded.run.integration.relationships).toHaveLength(2);
 const model=buildFunctionalModelRows(loaded.rows);const oldNode=buildFunctionalModelRows(initial.rows)[0].fromNodeId;
 const incoming=model.find(row=>row.functionalModel.sourceTraceIds.includes(links.find(row=>row.fromFile==='ui.js').traceId));
 expect(incoming.toNodeId).toBe(oldNode);expect(model.some(row=>row.fromFile==='native.c'&&row.toFile==='ui.js')).toBe(true);
 expect(isCodeArchitectureHazardAnalysisStale({run:hazard,cbaRows:loaded.rows})).toBe(true);
 const oldCount=prompts.filter(prompt=>prompt.includes('Current file evidence contract:')&&prompt.includes('"currentFile": "native.c"')).length;
 expect(oldCount).toBe(1);
});

test('same-language append discovers both directions even when old and new extraction omitted every cross-file link',async()=>{
 bodies['native.c']='int nativeSend(int v) { return v; }\nint nativeRun(int v) { return laterWork(v); }';
 bodies['later.c']='int laterWork(int v) { return nativeSend(v); }';
 const initial=await seed();resolveGitHubRevision.mockResolvedValue(nextCommit);
 listGitHubSnapshot.mockResolvedValue([...files,{path:'later.c',sha:'l1',size:100}]);
 const specs=[{fromFile:'native.c',from:'nativeRun',toFile:'later.c',to:'laterWork',line:2,definition:1},
  {fromFile:'later.c',from:'laterWork',toFile:'native.c',to:'nativeSend',line:1,definition:1}];
 providerHook=prompt=>prompt.includes('Append integration input: ')?{result:crossBatchReply(prompt,specs)}:null;
 const result=await run(['.c'],{analysisMode:'append'});
 expect(result.rows.filter(row=>row.integrationEvidence)).toHaveLength(2);
 expect(result.metadata.integration.reviewedSections).toBeGreaterThan(0);expect(result.rows[0].traceId).toBe(initial.rows[0].traceId);
});

test('integration failure retains prior architecture and resumes successful integration sections without new requests',async()=>{
 const specs=bindingFixture(),initial=await seed();let integrationCalls=0,fail=true;
 providerHook=prompt=>{
  if(!prompt.includes('Append integration input: '))return null;
  integrationCalls++;if(fail&&integrationCalls===2)return {usedModel:'changed-model'};
  return {result:crossBatchReply(prompt,specs)};
 };
 await expect(run(['.js'],{analysisMode:'append'})).rejects.toMatchObject({code:'SOURCE_RUN_CHANGED'});
 expect((await readPublishedArchitectureState(scope)).identity).toBe(initial.identity);
 const checkpoint=await readLatestArchitectureCheckpoint(scope),saved=await readArchitectureCheckpoint(checkpoint.key);
 expect(Object.keys(saved.integration.completed)).toHaveLength(1);
 const previousFirst=prompts.filter(prompt=>prompt.includes('Append integration input: '))[0];
 const extracts=prompts.filter(prompt=>prompt.includes('Current file evidence contract:')).length;
 fail=false;const result=await run(['.c'],{resumeCheckpointKey:checkpoint.key});
 expect(result.rows.filter(row=>row.integrationEvidence)).toHaveLength(2);
 expect(prompts.filter(prompt=>prompt===previousFirst)).toHaveLength(1);
 expect(prompts.filter(prompt=>prompt.includes('Current file evidence contract:'))).toHaveLength(extracts);
});

test('fenced integration responses with surrounding prose resume a failed append without reanalyzing files',async()=>{
 const specs=bindingFixture(),initial=await seed();let fail=true;
 providerHook=prompt=>{
  if(!prompt.includes('Append integration input: '))return null;
  return {result:fail?'```json\n{"relationships":[':'Here are the evidenced connections:\n```json\n'+crossBatchReply(prompt,specs)+'\n```\nThese connections require engineering review.'};
 };
 await expect(run(['.js'],{analysisMode:'append'})).rejects.toMatchObject({code:'SOURCE_INTEGRATION_INCOMPLETE'});
 expect((await readPublishedArchitectureState(scope)).identity).toBe(initial.identity);
 const checkpoint=await readLatestArchitectureCheckpoint(scope);
 const extracts=prompts.filter(prompt=>prompt.includes('Current file evidence contract:')).length;
 fail=false;
 const result=await run(['.js'],{resumeCheckpointKey:checkpoint.key});
 expect(result.rows.filter(row=>row.integrationEvidence)).toHaveLength(2);
 expect(prompts.filter(prompt=>prompt.includes('Current file evidence contract:'))).toHaveLength(extracts);
 expect(result.rows[0].traceId).toBe(initial.rows[0].traceId);
});

test('integration cancellation, malformed responses and invalid citations cannot damage an existing publication',async()=>{
 const specs=bindingFixture(),initial=await seed(),controller=new AbortController();
 providerHook=prompt=>{if(prompt.includes('Append integration input: ')){controller.abort();throw new DOMException('Stopped','AbortError');}return null;};
 await expect(run(['.js'],{analysisMode:'append',signal:controller.signal})).rejects.toThrow();
 expect((await readPublishedArchitectureState(scope)).identity).toBe(initial.identity);
 providerHook=prompt=>prompt.includes('Append integration input: ')?{result:'{"wrong":true}'}:null;
 await expect(run(['.js'],{analysisMode:'append'})).rejects.toMatchObject({code:'SOURCE_INTEGRATION_INCOMPLETE'});
 expect((await readPublishedArchitectureState(scope)).identity).toBe(initial.identity);
 providerHook=prompt=>{
  if(!prompt.includes('Append integration input: '))return null;
  const response=JSON.parse(crossBatchReply(prompt,specs));response.relationships.forEach(row=>{row.fromCitation.quote='invented call that is not in source';});
  return {result:JSON.stringify(response)};
 };
 const result=await run(['.js'],{analysisMode:'append'});expect(result.rows.filter(row=>row.integrationEvidence)).toHaveLength(0);
 expect(result.metadata.integration.rejectedProposals).toBeGreaterThan(0);
 expect((await readPublishedArchitectureState(scope)).run.integration.rejected.every(proposal=>proposal.file&&proposal.targetFile)).toBe(true);
});

test('old files whose first analysis produced no rows are still revisited and missing source indexes are reacquired',async()=>{
 const specs=bindingFixture();
 providerHook=prompt=>prompt.includes('Current file evidence contract:')?{result:'| Function (From) | Function (From) Related File(s) | Function (From) Details | Control Action | Control Action Details | Function (To) | Function (To) Related File(s) | Function (To) Details |\n| --- | --- | --- | --- | --- | --- | --- | --- |'}:null;
 await run(['.c']);const initial=await readPublishedArchitectureState(scope);expect(initial.rows).toHaveLength(0);
 const db=await openCbaIndexedDB();try{await new Promise((resolve,reject)=>{const tx=db.transaction('code_index','readwrite');tx.objectStore('code_index').clear();tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});}finally{db.close();}
 const reads=readGitHubSnapshotFile.mock.calls.filter(([args])=>args.path==='native.c').length;
 providerHook=prompt=>prompt.includes('Append integration input: ')?{result:crossBatchReply(prompt,specs)}:null;
 const result=await run(['.js'],{analysisMode:'append'});
 expect(result.rows.filter(row=>row.integrationEvidence)).toHaveLength(2);
 expect(readGitHubSnapshotFile.mock.calls.filter(([args])=>args.path==='native.c').length).toBeGreaterThan(reads);
 expect(result.metadata.integration.earlierFiles).toBe(1);
});

test('concurrent edits during integration preserve the current publication',async()=>{
 const specs=bindingFixture(),initial=await seed();let edited=false;
 providerHook=async prompt=>{
  if(!prompt.includes('Append integration input: '))return null;
  if(!edited){edited=true;await writeCbaRowsToIndexedDB(scope,initial.rows.map(row=>({...row,fromDetails:'Concurrent integration edit'})));}
  return {result:crossBatchReply(prompt,specs)};
 };
 await expect(run(['.js'],{analysisMode:'append'})).rejects.toMatchObject({code:'SOURCE_PUBLICATION_CONFLICT'});
 expect((await readPublishedArchitectureState(scope)).rows[0].fromDetails).toBe('Concurrent integration edit');
});


test('integration checkpoint storage failure preserves prior results and allows a later retry',async()=>{
 const specs=bindingFixture(),initial=await seed();let fail=true;
 providerHook=prompt=>prompt.includes('Append integration input: ')?{result:crossBatchReply(prompt,specs)}:null;
 const write=sourceStorage.writeAnalysisSourceRecord;
 jest.spyOn(sourceStorage,'writeAnalysisSourceRecord').mockImplementation((store,key,value,options)=>{
  if(fail&&value?.phase==='integration'&&Object.keys(value.integration?.completed||{}).length)throw new DOMException('Synthetic storage quota','QuotaExceededError');
  return write(store,key,value,options);
 });
 await expect(run(['.js'],{analysisMode:'append'})).rejects.toMatchObject({code:'SOURCE_STORAGE_FAILED'});
 expect((await readPublishedArchitectureState(scope)).identity).toBe(initial.identity);
 const checkpoint=await readLatestArchitectureCheckpoint(scope);expect(checkpoint.completed).toBe(1);
 fail=false;const result=await run(['.js'],{resumeCheckpointKey:checkpoint.key});expect(result.rows.filter(row=>row.integrationEvidence)).toHaveLength(2);
});
