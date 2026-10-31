// Builds only a storage seeder. The measured UI always uses the unmodified full production bundle.
// node scripts/diagnostics/build-desktop-performance-fixture.cjs /tmp/fixture-bundle
const fs=require('node:fs'),path=require('node:path'),webpack=require('webpack');
const source=path.resolve(process.env.PERF_SOURCE_ROOT||path.join(__dirname,'../..'));
const out=path.resolve(process.argv[2]);fs.mkdirSync(out,{recursive:true});
const relationshipsPerNode=Number(process.env.PERF_RELATIONSHIPS_PER_NODE||2);
const hazardScrollFixture=process.env.PERF_HAZARD_SCROLL_FIXTURE==='1';
if(!Number.isInteger(relationshipsPerNode)||relationshipsPerNode<2)throw Error('PERF_RELATIONSHIPS_PER_NODE must be an integer >= 2');
const modulePath=p=>JSON.stringify(path.join(source,'src',p));
fs.writeFileSync(path.join(out,'entry.js'),`
import {openHazardSchema,hazardMetadata} from ${modulePath('features/code-architecture-hazard-analysis/hazardSchema.js')};
import {stageHazardRun,publishHazardRun} from ${modulePath('features/code-architecture-hazard-analysis/hazardRunChunks.js')};
import {writeCbaRowsToIndexedDB} from ${modulePath('features/code-architecture-assurance/codeArchitectureStorage.js')};
import {saveArtifactRowsAsync} from ${modulePath('features/code-architecture-assurance/artifactUtils.js')};
import {ensureCodeArchitectureHazardEligibility} from ${modulePath('features/code-architecture-hazard-analysis/codeArchitectureHazardEligibility.js')};
import {processFunctionalModel,functionalModelIsReady} from ${modulePath('features/code-architecture-context/functionalModel.js')};
${hazardScrollFixture ? `import {saveCodeArchitectureHazardContexts} from ${modulePath('features/code-architecture-hazard-analysis/codeArchitectureHazardContextStore.js')};` : ''}
window.seedCbaPerformance=async(count,nodeCount=100,artifactCount=1000)=>{
 const arch=i=>({subsystem:'Control '+Math.floor(i/250),csci:'Application '+Math.floor(i/100),csc:'Controller '+Math.floor(i/25),csu:'Unit '+Math.floor(i/5)});
 let rows=Array.from({length:nodeCount*${relationshipsPerNode}},(_,i)=>{const from=i%nodeCount,to=(i+(i<nodeCount?1:7*Math.floor(i/nodeCount)))%nodeCount;return {traceId:'FD-'+i,rowRef:i+1,fromNodeId:'perf-node-'+from,toNodeId:'perf-node-'+to,edgeId:'perf-edge-'+i,from:'Function '+from,to:'Function '+to,action:'Command '+i,fromDetails:'Validates current sensor state and operating context. '.repeat(4),toDetails:'Handles requested actuation with freshness checks. '.repeat(3),controlActionDetails:'Requires sequence, timestamp, acknowledgement and expiration. '.repeat(3),fromFile:'src/unit_'+from+'.cpp',toFile:'src/unit_'+to+'.cpp',architecture:arch(from),fromArchitecture:arch(from),toArchitecture:arch(to),interfaceType:'Control',hazardAnalysisEligibility:'Include',hazardAnalysisEligibilitySource:'user',lifecyclePhase:'Runtime',sourceEvidence:{functions:[{filePath:'src/unit_'+from+'.cpp',functionName:'Function '+from,startLine:from+1}],excerpt:'Recorded source evidence. '.repeat(12)}};});
 // Offline deterministic fixture responses only. This never invokes a provider.
 const request=async prompt=>{
  if(prompt.includes('Functional hierarchy input: ')){const {functions}=JSON.parse(prompt.split('Functional hierarchy input: ')[1]);return {allocations:functions.map(fn=>({id:fn.id,subsystem:fn.existing?.subsystem||'Control',csci:fn.existing?.csci||'Application',csc:fn.existing?.csc||'Controller',rationale:'Synthetic ownership evidence.'}))};}
  if(prompt.includes('Consolidation input: ')){const {functions}=JSON.parse(prompt.split('Consolidation input: ')[1]);return {responsibilities:functions.map(fn=>({members:[fn.id],name:fn.name,description:fn.description}))};}
  const evidence=JSON.parse(prompt.split('Relationships (descriptions may be excerpts; classify only the supplied evidence): ')[1]);return {function:{name:'Responsibility '+evidence[0].from,description:'Validate and forward current control state.',significance:'meaningful'},relationships:evidence.map(row=>({index:row.index,significance:'meaningful',disposition:'interaction',target:{name:'Responsibility '+row.to,description:'Accept valid control input.'},action:row.action,kind:'control',description:'Current command state.',rationale:'Synthetic source evidence.'}))};
 };
 rows=await processFunctionalModel(ensureCodeArchitectureHazardEligibility(rows),{request});if(!functionalModelIsReady(rows))throw Error('Synthetic Functional model invalid');
 const headers=['Raw Analysis Row ID','Function (From)','Control Action','Function (To)','Guide Phrase','Hazard','Loss','Causal Scenario','Mitigation Strategy','System Requirement','Verification Method','Acceptance Criteria'];
 const summary=[headers,...Array.from({length:count},(_,i)=>['HA-'+i,'Function '+i%100,'Command '+i%100,'Function '+(i+1)%100,'Not provided','Unsafe actuator motion '+i,'Physical injury','A stale command arrives after the operating state changes. '.repeat(3),'Validate command sequence and expiration.','Reject outdated requests.','Fault injection','No command accepted after expiration.'])];
 ${hazardScrollFixture ? `// Contiguous 137-row groups cross storage-page boundaries. Two contexts and
 // a few wide hidden evidence values exercise sparse IDs and byte-limited reads.
 const contexts=[{id:'scroll-normal',scenario:'Normal operation',mode:'Automatic',conditions:'Synthetic nominal operation',assumptions:''},{id:'scroll-service',scenario:'Maintenance',mode:'Service',conditions:'Synthetic service operation',assumptions:''}];
 headers.push('Operational Context ID','Operational Scenario','Operational Mode','Diagnostic Evidence');
 summary.slice(1).forEach((row,i)=>{const group=Math.floor(i/137),context=contexts[i%2];row[1]='Function '+group%nodeCount;row[2]='Command '+group;row[3]='Function '+(group+1)%nodeCount;if(i%11===0)row[7]+='Additional variable-height explanation. '.repeat(12);row.push(context.id,context.scenario,context.mode,i<210&&i%7===0?'bounded hidden evidence '.repeat(4000):'');});
 saveCodeArchitectureHazardContexts({projectId:'perf-cba',repoId:'fixture/repo',contexts});` : ''}
 const evidence=Array.from({length:16},(_,i)=>({file:'src/unit_'+i+'.cpp',line:i+10,text:('Stored source evidence block '+i+'. ').repeat(24000)}));
 const run={id:'perf-cba-run',projectId:'perf-cba',repoId:'fixture/repo',hazardMethod:'STPA',status:'complete',updatedAt:'2026-10-30T00:00:00Z',createdAt:'2026-10-30T00:00:00Z',architectureRowsSnapshot:evidence,narrativeReviewInput:{evidence},generatedSheets:{Summary:summary}};
 ${hazardScrollFixture ? 'run.operationalContexts=contexts;run.analysisOperationalContexts=contexts;' : ''}
 const db=await openHazardSchema();try{const staged=await stageHazardRun(db,run);await publishHazardRun(db,staged,hazardMetadata(run));const tx=db.transaction('generationCheckpoints','readwrite');await tx.store.put({id:'inactive-checkpoint',scope:'other:repo',source:evidence});await tx.done;}finally{db.close();}
 await writeCbaRowsToIndexedDB('cba:perf-cba:fixture/repo',rows);
 await writeCbaRowsToIndexedDB('cba:perf-cba:fixture/other',rows.slice(0,10));
 await writeCbaRowsToIndexedDB('cba:other-cba:fixture/other',rows.slice(0,10));
 for(const [kind,prefix] of [['software-requirements','SWR'],['system-requirements','SYS'],['subsystem-requirements','SUB'],['design-elements','DES']]){
  const items=Array.from({length:artifactCount},(_,i)=>({id:prefix+'-'+i,requirementText:prefix+' requirement '+i+': Reject expired control requests. '.repeat(8),designElementName:'Command gate '+i,description:'Command processing safety design. '.repeat(8),source:'manual',sourceTraceId:'FD-'+i%rows.length,parentSwRequirement:'SWR-'+i,parentSystemRequirement:'SYS-'+i,parentRequirement:'SUB-'+i,linkedHazards:'HA-'+i%count,linkedSourceCode:'src/unit_'+i%nodeCount+'.cpp',sourceArchitectureRefs:[{traceId:'FD-'+i%rows.length,rowIndex:i%rows.length,fromFunction:rows[i%rows.length].from,toFunction:rows[i%rows.length].to,controlAction:rows[i%rows.length].action,fromFile:rows[i%rows.length].fromFile,csu:rows[i%rows.length].architecture.csu}],rationale:'Traceable source evidence. '.repeat(6),verificationMethod:'Fault injection',priority:'High',updatedAt:'2026-10-30T00:00:00Z'}));
  await saveArtifactRowsAsync(kind,'perf-cba','fixture/repo',items);
 }
 localStorage.setItem('cba:perf-cba:fixture/repo:architecture-abstraction','detailed');
 localStorage.setItem('xhandle.codeArchitectureProjects',JSON.stringify([{id:'perf-cba',name:'CBA performance fixture',repos:[{id:'fixture/repo',repoId:'fixture/repo',owner:'fixture',repo:'repo',branch:'main'},{id:'fixture/other',repoId:'fixture/other',owner:'fixture',repo:'other',branch:'main'}],activeRepoId:'fixture/repo'},{id:'other-cba',name:'Other CBA fixture',repos:[{id:'fixture/other',repoId:'fixture/other',owner:'fixture',repo:'other',branch:'main'}]}]));
 localStorage.setItem('xhandle.sidebarCodeArchitectureProjectsOpen','true');
 localStorage.setItem('xhandle.lastNonCopilotSection','code-architecture');
 return {rows:count,graphNodes:nodeCount,artifactRowsPerCollection:artifactCount,functionalModelReady:functionalModelIsReady(rows),architectureRows:rows.length,summaryUTF8Bytes:JSON.stringify(summary).length,evidenceCharacters:JSON.stringify(evidence).length,checkpointCharacters:JSON.stringify(evidence).length,estimate:await navigator.storage.estimate()${hazardScrollFixture ? ',hazardScrollFixture:{groupRows:137,contexts:contexts.map(context=>context.id),wideRows:Math.ceil(Math.min(count,210)/7)}' : ''}};
};
`);
const compiler=webpack({mode:'production',entry:path.join(out,'entry.js'),output:{path:out,filename:'seed.js'},devtool:false,optimization:{minimize:false},resolve:{modules:[path.join(source,'node_modules'),'node_modules'],extensions:['.js','.jsx','.ts','.tsx']}});
compiler.run((err,stats)=>{compiler.close(()=>{});if(err||stats.hasErrors()){console.error(err||stats.toString({all:false,errors:true}));process.exitCode=1;}else console.log(path.join(out,'seed.js'));});
