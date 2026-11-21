import { analyzedArchitecturePaths, planArchitectureAppend, verifyArchitectureAppendSource, appendArchitectureRows, mergeArchitectureManifests } from './appendCodeArchitecture';
import { processFunctionalModel, appendFunctionalModels, functionalModelIsReady, buildFunctionalModelRows } from './functionalModel';
import { hierarchyResponse } from './testSupport/functionalHierarchyFixture';
import { buildCodeArchitectureHazardInput, normalizeCodeArchitectureHazardRun, isCodeArchitectureHazardAnalysisStale } from '../code-architecture-hazard-analysis/codeArchitectureHazardUtils';
jest.mock('../code-architecture-assurance/EngineeringArtifactTable', () => () => null);
const scope = 'cba:project:repo', config = { owner:'fixture', repo:'mixed' };
const row = (file, name = 'run', targetFile = file) => ({ from:name, fromFile:file, to:'send', toFile:targetFile,
  action:'Send command', fromDetails:'Issue request', toDetails:'Send request', controlActionDetails:'Requested behavior',
  traceId:`trace:${file}:${name}`, rowRef:1, architecture:{subsystem:'Product',csci:'Runtime',csc:'Control'},
  hazardAnalysisEligibility:'Include', lineage:{scope,status:'current',runFingerprint:'original'} });
const base = () => ({ hasAnalysis:true, rows:[row('native.c', 'run', 'ui.js')], metadata:config,
  run:{fingerprint:'parent',source:{sourceType:'github',snapshotId:'old'},inputManifest:[{path:'native.c',blobSha:'c1',entryKind:'file'}],relationshipLedger:{'native.c':{supported:false,modelOnly:1,relationships:[]}}} });
const reply = prompt => {
  if (prompt.includes('Functional hierarchy input: ')) return hierarchyResponse(prompt);
  if (prompt.includes('Consolidation input: ')) return {responsibilities:JSON.parse(prompt.split('Consolidation input: ')[1]).functions.map(unit=>({members:[unit.id],name:unit.name,description:unit.description}))};
  const evidence=JSON.parse(prompt.split('Relationships (descriptions may be excerpts; classify only the supplied evidence): ')[1]);
  return {function:{name:`Execute ${evidence[0].from}`,description:'Execute requested behavior.',significance:'meaningful'},relationships:evidence.map(item=>({index:item.index,significance:'meaningful',disposition:'interaction',target:{name:'Send request',description:'Transmit request.'},action:'Requested behavior',kind:'control',description:'Request to execute',rationale:'Explicit function call.'}))};
};

test('overlap skips actual origins, never a referenced JS file; repeat is a useful no-op', () => {
  const saved=base();
  expect([...analyzedArchitecturePaths(saved)]).toEqual(['native.c']);
  expect(planArchitectureAppend(saved,[{path:'native.c'},{path:'ui.js'}],scope,config).files).toEqual([{path:'ui.js'}]);
  expect(()=>planArchitectureAppend(saved,[{path:'native.c'}],scope,config)).toThrow(/already been analyzed/);
  expect(()=>planArchitectureAppend({...saved,rows:[row('native.c')].map(row=>({...row,lineage:{scope:'other'}}))},[{path:'ui.js'}],scope,config)).toThrow(/another project/);
  expect(()=>planArchitectureAppend(saved,[{path:'ui.js'}],scope,{...config,repo:'other'})).toThrow(/different source/);
});

test('new branch revisions require unchanged old blobs, including analyses predating blob manifests', async () => {
  const saved=base(), previousFiles=jest.fn(async()=>[{path:'native.c',sha:'c1'}]);
  const options={source:{sourceType:'github',snapshotId:'new'},files:[{path:'native.c',sha:'c1'}],previousFiles};
  await verifyArchitectureAppendSource(saved,new Set(['native.c']),options);
  expect(previousFiles).not.toHaveBeenCalled();
  delete saved.run.inputManifest[0].blobSha;
  await verifyArchitectureAppendSource(saved,new Set(['native.c']),options);
  expect(previousFiles).toHaveBeenCalledWith('old');
  await expect(verifyArchitectureAppendSource(saved,new Set(['native.c']),{...options,files:[{path:'native.c',sha:'changed'}]})).rejects.toMatchObject({code:'SOURCE_APPEND_SOURCE_CHANGED'});
  await expect(verifyArchitectureAppendSource(saved,new Set(['native.c']),{...options,files:[]})).rejects.toThrow(/removed/);
  await expect(verifyArchitectureAppendSource({...saved,run:null},new Set(['native.c']),options)).rejects.toThrow(/immutable source revision/);
});

test('local append verifies earlier text digests without inferring source equivalence from folder names', async () => {
  const saved=base();saved.run.source={sourceType:'local',sourceId:'folder1',snapshotId:'a'};saved.run.inputManifest[0].textDigest='same';
  const options={source:{sourceType:'local',sourceId:'folder1',snapshotId:'b'},readText:async()=>({textDigest:'same'})};
  await verifyArchitectureAppendSource(saved,new Set(['native.c']),options);
  await expect(verifyArchitectureAppendSource(saved,new Set(['native.c']),{...options,readText:async()=>({textDigest:'changed'})})).rejects.toThrow(/changed/);
  await expect(verifyArchitectureAppendSource(saved,new Set(['native.c']),{...options,source:{...options.source,sourceId:'different'}})).rejects.toThrow(/another local/);
});

test('append preserves earlier edits, overrides, history, evidence and IDs without mutating its base', () => {
  const saved=base();saved.rows[0].hazardAnalysisEligibilitySource='analyst-override';saved.rows[0].action='Analyst wording';
  saved.rows.push({...row('retired.c'),lineage:{scope,status:'historical'}});
  const before=JSON.stringify(saved);
  const result=appendArchitectureRows(saved.rows,[row('ui.js')],scope);
  expect(result.slice(0,2)).toEqual(saved.rows);
  expect(result[2].rowRef).toBe(2);expect(result[2].lineage.status).toBe('current');
  expect(JSON.stringify(saved)).toBe(before);
  const merged=mergeArchitectureManifests(saved,[{path:'ui.js',blobSha:'j1'}],{'ui.js':{relationships:[]}},{snapshotId:'new'});
  expect(merged.inputManifest.map(file=>file.path)).toEqual(['native.c','ui.js']);
  expect(merged.inputManifest[0].source.snapshotId).toBe('old');
  expect(merged.inputManifest[1].source.snapshotId).toBe('new');
});

test('valid functional cohorts retain old IDs, connect exact cross-file references, and stale the prior hazard snapshot after reload', async () => {
  const old=await processFunctionalModel([row('native.c','run','transport.h')],{request:reply});
  const added=await processFunctionalModel([{...row('ui.js','dispatch','native.c'),to:'run',traceId:'new',rowRef:2},row('other.js','run')],{request:reply});
  const before=JSON.stringify(old), hazard=normalizeCodeArchitectureHazardRun(buildCodeArchitectureHazardInput({cbaRows:old}));
  const result=appendFunctionalModels(old,added);
  expect(functionalModelIsReady(result)).toBe(true);
  expect(result[1].functionalAbstraction.target.id).toBe(old[0].functionalAbstraction.source.id);
  expect(result[2].functionalAbstraction.source.id).not.toBe(old[0].functionalAbstraction.source.id);
  const reloaded=JSON.parse(JSON.stringify(result));expect(functionalModelIsReady(reloaded)).toBe(true);
  expect(buildFunctionalModelRows(reloaded).map(row=>row.traceId)).toContain(buildFunctionalModelRows(old)[0].traceId);
  expect(isCodeArchitectureHazardAnalysisStale({run:hazard,cbaRows:reloaded})).toBe(true);
  expect(JSON.stringify(old)).toBe(before);
  expect(appendFunctionalModels(old.map(row=>({...row,action:'edited'})),added)).toBeNull();
});

test('integration deduplicates against prior and current extraction while retaining distinct channel keys',()=>{
 const old=row('native.c','run','ui.js');old.to='handle';old.action='Analyst wording';
 const link={...old,action:'Send value',traceId:undefined,integrationEvidence:{relationshipId:'one',key:'first'}};
 expect(appendArchitectureRows([old],[link],scope)).toHaveLength(1);
 expect(appendArchitectureRows([], [old,link],scope)).toHaveLength(1);
 const saved={...link,traceId:'saved'};
 const another={...link,integrationEvidence:{relationshipId:'two',key:'second'}};
 expect(appendArchitectureRows([saved],[another],scope)).toHaveLength(2);
});

test('new links reuse current detailed node IDs instead of an older historical node',()=>{
 const active={...row('native.c','run'),fromNodeId:'current-node',toNodeId:'send-node'};
 const historical={...active,traceId:'historical',fromNodeId:'historical-node',lineage:{scope,status:'historical'}};
 const incoming={...row('ui.js','dispatch','native.c'),to:'run'};
 const combined=appendArchitectureRows([active,historical],[incoming],scope);
 expect(combined[2].toNodeId).toBe('current-node');expect(combined[1].fromNodeId).toBe('historical-node');
});

test('large append preserves baseline IDs and assigns unique new row references',()=>{
 const earlier=Array.from({length:25000},(_,i)=>({...row('native.c',`native${i}`),traceId:`old-${i}`,rowRef:i+1}));
 const incoming=Array.from({length:3000},(_,i)=>({...row('new.js',`new${i}`),traceId:undefined}));
 const combined=appendArchitectureRows(earlier,incoming,scope);
 expect(combined).toHaveLength(28000);expect(combined[24999].traceId).toBe('old-24999');
 expect(new Set(combined.map(row=>row.rowRef)).size).toBe(28000);
 expect(combined[27999].rowRef).toBe(28000);
});
