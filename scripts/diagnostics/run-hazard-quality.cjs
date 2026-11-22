#!/usr/bin/env node
// Opt-in live benchmark of the current functional abstraction and STPA runner.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {fork}=require('node:child_process');
const {fingerprint,command,cleanEnvironment}=require('./electron-regression-support.cjs');
const {SpendBudget,increaseCampaignCap}=require('./hazard-quality/budget.cjs');
const {installSourceRuntime}=require('./hazard-quality/source-runtime.cjs');
const {readAppSettings}=require('./hazard-quality/app-settings.cjs');
const {parseQualityJson:parse}=require('./hazard-quality/quality-json.cjs');
const {preserveUnscoredAuditMetadata}=require('./hazard-quality/quality-audit-transport.cjs');
const root=path.resolve(__dirname,'../..'), support=path.join(__dirname,'hazard-quality');
const argument=name=>{const index=process.argv.indexOf(name);return index<0?null:process.argv[index+1];};
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
if(process.argv.includes('--help')) {
  console.log('Usage: node scripts/diagnostics/run-hazard-quality.cjs --live --campaign /tmp/new-campaign --max-spend-usd 25 [--settings-file /private/local/settings.json | --app-profile PATH --electron PATH] [--organization-profile FILE] [--functional-view FILE] [--preview --keep-preview --playwright PATH --desktop PATH] [--change-notes TEXT] [--increase-cap] [--repair-evaluator] [--resume-evaluation ITERATION_DIR]\nEach invocation uses the provided functional snapshot or real abstraction prompts, then runs STPA generation, persistence checks, calibrated independent-prompt grading and offline regressions. Below 9/10: inspect diagnosis.json, make a source change, then rerun the same campaign. Two consecutive fresh passes on unchanged source confirm the target. Default runs never contact a provider.');
  process.exit(0);
}
if(!process.argv.includes('--live'))throw Error('Live evaluation requires explicit --live and a total campaign spend cap.');
const campaign=argument('--campaign');
if(!campaign)throw Error('--campaign is required; use the same directory across improvements.');
const campaignDirectory=path.resolve(campaign);fs.mkdirSync(campaignDirectory,{recursive:true,mode:0o700});
const stateFile=path.join(campaignDirectory,'campaign.json');
let state=fs.existsSync(stateFile)?JSON.parse(fs.readFileSync(stateFile,'utf8')):null;
const cap=Number(argument('--max-spend-usd'));
if(!Number.isFinite(cap) || !(cap>0))throw Error('An explicit finite positive --max-spend-usd is required.');
if(state && state.maxSpendUsd!==cap) {
  if(!process.argv.includes('--increase-cap'))throw Error('Preserve the existing cap unless the user explicitly authorizes --increase-cap with recorded --change-notes.');
  state=increaseCampaignCap(state,cap,{authorized:true,reason:argument('--change-notes')});
}
let backendChild,budget,settings,runDirectory,preview;
let previewUpdates=Promise.resolve();
const scrub=value=>settings?.apiKey?String(value).split(settings.apiKey).join('[REDACTED]'):String(value);
const save=(filename,value)=>{const data=scrub(JSON.stringify(value,null,2)+'\n');fs.writeFileSync(filename+'.tmp',data,{mode:0o600});fs.renameSync(filename+'.tmp',filename);};
const persist=()=>{if(budget){state.spentUsd=budget.spentUsd;state.reservedUsd=budget.reservedUsd;}save(stateFile,state);};
const observe=patch=>{if(preview)previewUpdates=previewUpdates.then(()=>preview.update(patch)).catch(()=>{});};
const progress=message=>{console.log(`[hazard-quality] ${scrub(message)}`);observe({message:scrub(message),spent:budget?.spentUsd || 0});};
const controller=new AbortController();
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{
  controller.abort();backendChild?.kill('SIGTERM');preview?.close().catch(()=>{});
});

async function main() {
  settings=argument('--settings-file')?JSON.parse(fs.readFileSync(argument('--settings-file'),'utf8')):
    await readAppSettings({profile:argument('--app-profile') || path.join(os.homedir(),'Library/Application Support/xHandle'),
      electron:argument('--electron') || path.join(root,'../xhandle-desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')});
  if(!settings.apiKey || !settings.model || !settings.provider)throw Error('Current provider settings and a usable credential are required.');
  if(settings.provider!=='anthropic' || settings.model!=='claude-sonnet-5-5')throw Error('This run needs an explicit reviewed price configuration for the selected model; only current Sonnet 5.5 pricing is registered.');
  // Verified against https://platform.claude.com/docs/en/about-claude/pricing
  const rates={input:2,output:10,source:'https://platform.claude.com/docs/en/about-claude/pricing',verifiedOn:'2026-11-22'};
  const fixtureFile=argument('--fixture') || path.join(support,'haulage-project.json');
  const oracleFile=argument('--oracle') || path.join(support,'haulage-oracle.json');
  const fixture=JSON.parse(fs.readFileSync(fixtureFile,'utf8')),oracle=JSON.parse(fs.readFileSync(oracleFile,'utf8'));
  const functionalView=argument('--functional-view')?fs.readFileSync(argument('--functional-view'),'utf8'):null;
  let organizationProfile=settings.organizationProfile;
  if(argument('--organization-profile'))organizationProfile=JSON.stringify({enabled:true,markdown:fs.readFileSync(argument('--organization-profile'),'utf8')});
  const protectedHash=hash([fixtureFile,oracleFile,path.join(support,'quality-json.cjs'),...['functionalQualityScoring.js','functionalQualityJudge.js','functionalQualityAdjudication.js','functionalQualityCitationRepair.js','functionalQualityTransport.js'].map(file=>path.join(root,'src/features/hazard-eval',file))]
    .map(file=>fs.readFileSync(file,'utf8')).join('\n')+JSON.stringify([settings.provider,settings.model,settings.effort,organizationProfile,functionalView]));
  const immutableBenchmarkHash=hash([fixtureFile,oracleFile,path.join(root,'src/features/hazard-eval/functionalQualityScoring.js')]
    .map(file=>fs.readFileSync(file,'utf8')).join('\n')+JSON.stringify([settings.provider,settings.model,settings.effort,organizationProfile,functionalView]));
  const source=fingerprint(root),previous=state?.iterations?.at(-1);
  let evaluationResume=null;
  if(argument('--resume-evaluation')) {
    const directory=path.resolve(argument('--resume-evaluation'));
    const origin=state?.iterations?.find(item=>path.resolve(item.directory)===directory);
    const originError=origin && fs.existsSync(path.join(directory,'error.json'))?JSON.parse(fs.readFileSync(path.join(directory,'error.json'),'utf8')):{};
    const budgetStopped=origin?.status==='spend-cap' && originError.code==='QUALITY_SPEND_CAP';
    if(!origin || (!budgetStopped && (origin.status!=='incomplete' || (!/^(?:Independent evaluator|Adjudication)/.test(origin.error || '') && !(origin.freshGeneration===false && originError.code==='SyntaxError')))))throw Error('Evaluation resume requires an incomplete evaluator attempt in this same campaign.');
    const run=JSON.parse(fs.readFileSync(path.join(directory,'run.json'),'utf8'));
    if(run.runState!=='complete' || run.finalSavePending)throw Error('Only a complete, persisted live analysis may resume evaluation.');
    evaluationResume={directory,origin,run,input:JSON.parse(fs.readFileSync(path.join(directory,'hazard-input.json'),'utf8')),model:JSON.parse(fs.readFileSync(path.join(directory,'functional-model.json'),'utf8'))};
  }
  if(state?.immutableBenchmarkHash && state.immutableBenchmarkHash!==immutableBenchmarkHash && state.iterations.some(item=>item.score!=null))throw Error('Fixture, source oracle, scoring rubric or selected model/profile changed after scoring.');
  if(state?.benchmarkHash && state.benchmarkHash!==protectedHash) {
    if(state.iterations.every(item=>item.score==null) && argument('--change-notes')) {
      state.setupRevisions ||= [];state.setupRevisions.push({previousHash:state.benchmarkHash,nextHash:protectedHash,reason:argument('--change-notes'),at:new Date().toISOString()});
      state.benchmarkHash=protectedHash;
    } else if(process.argv.includes('--repair-evaluator') && argument('--change-notes') && state.iterations.every(item=>{
      if(item.score==null)return true;
      const file=path.join(item.directory,'quality.json');if(!fs.existsSync(file))return false;
      return JSON.parse(fs.readFileSync(file,'utf8')).failures.some(failure=>/^Judge (?:finding|support|omitted)/.test(failure));
    })) {
      // An invalid prior evaluator cannot freeze a known-broken evidence contract.
      // Preserve its scores/history as provisional; never alter weights or labels.
      state.evaluatorRepairs ||= [];state.evaluatorRepairs.push({previousHash:state.benchmarkHash,nextHash:protectedHash,immutableBenchmarkHash,reason:argument('--change-notes'),at:new Date().toISOString()});
      state.benchmarkHash=protectedHash;state.immutableBenchmarkHash=immutableBenchmarkHash;
    } else throw Error('Fixture, rubric, grading prompt or model/profile changed after a scored run. Preserve benchmark comparability and the spending ledger.');
  }
  if(previous?.status==='below-target' && previous.source.sha256===source.sha256)throw Error('Previous score failed. Diagnose and change production code before another paid attempt; unchanged rerolls are not improvements.');
  if(previous?.status==='below-target' && !argument('--change-notes'))throw Error('--change-notes must link the source change to the prior diagnosis.');
  state ||= {schemaVersion:1,target:9,requiredConsecutivePasses:2,maxSpendUsd:cap,spentUsd:0,reservedUsd:0,iterations:[],benchmarkHash:protectedHash,immutableBenchmarkHash,model:{provider:settings.provider,model:settings.model,effort:settings.effort},rates};
  if(state.status==='target-confirmed')throw Error('This campaign already achieved two fresh passing runs.');
  budget=new SpendBudget({limitUsd:cap,rates,spentUsd:state.spentUsd+(state.reservedUsd || 0)});
  state.reservedUsd=0;
  const iteration={number:state.iterations.length+1,status:'running',source,freshGeneration:!evaluationResume,
    ...(evaluationResume?{generationFrom:evaluationResume.directory,generationSource:evaluationResume.origin.generationSource || evaluationResume.origin.source}:{}),
    changeNotes:argument('--change-notes') || 'Initial benchmark',startedAt:new Date().toISOString()};
  state.iterations.push(iteration);state.status='running';
  runDirectory=path.join(campaignDirectory,`iteration-${String(iteration.number).padStart(3,'0')}`);fs.mkdirSync(runDirectory,{mode:0o700});
  fs.writeFileSync(path.join(runDirectory,'runner.pid'),String(process.pid));
  iteration.directory=runDirectory;persist();progress(`Iteration ${iteration.number}; ${settings.provider}/${settings.model}; cap $${cap}; accounted $${budget.spentUsd.toFixed(3)}. Artifacts: ${runDirectory}`);
  const backendDirectory=path.join(runDirectory,'backend');fs.mkdirSync(backendDirectory);
  const backend=await new Promise((resolve,reject)=>{
    const trust=Object.fromEntries(['NODE_EXTRA_CA_CERTS','SSL_CERT_FILE','SSL_CERT_DIR','NODE_USE_SYSTEM_CA'].filter(key=>process.env[key]).map(key=>[key,process.env[key]]));
    backendChild=fork(path.join(support,'backend-child.cjs'),[path.join(root,'server.js')],{cwd:backendDirectory,env:cleanEnvironment({LOCAL_DEV:'true',...trust}),stdio:['ignore','pipe','pipe','ipc']});
    const log=fs.createWriteStream(path.join(runDirectory,'backend.log'),{mode:0o600});
    for(const stream of [backendChild.stdout,backendChild.stderr])stream.on('data',chunk=>log.write(scrub(chunk)));
    const timer=setTimeout(()=>reject(Error('Isolated backend did not start.')),30000);
    backendChild.once('message',message=>{clearTimeout(timer);resolve(message.backend);});
    backendChild.once('error',()=>{clearTimeout(timer);reject(Error('Isolated backend failed to start.'));});
    backendChild.once('exit',()=>{clearTimeout(timer);log.end();});
  });
  const load=installSourceRuntime(root,settings,backend);
  global.BroadcastChannel=undefined;
  if(organizationProfile)localStorage.setItem('xhandle.organizationProfile',organizationProfile);
  const {getOrganizationPromptContext}=load('src/features/organization-profile/organizationPromptContext.js');
  const {buildEffectiveOrganizationProfileContext}=load('src/features/organization-profile/organizationProfile.js');
  const organizationContext=organizationProfile?buildEffectiveOrganizationProfileContext({profile:JSON.parse(organizationProfile)}):'';
  const nativeFetch=global.fetch;
  let sequence=0;
  global.fetch=async(input,init={})=>{
    const url=new URL(String(input),backend);
    if(url.origin!==backend || url.pathname!=='/api/chat')throw Error('Quality transport admits only the isolated local AI route.');
    const body=JSON.parse(init.body || '{}');
    body.model=settings.model;body.max_tokens=Number(body.max_tokens || body.max_completion_tokens || 7000);
    if(body.tools || body.messages?.some(message=>typeof message.content!=='string'))throw Error('Only text prompts are covered by this budget contract.');
    const workflow=body.xhandleWorkflow || 'unspecified',id=++sequence;
    let ticket;
    try {ticket=await budget.admit({messages:body.messages,maxTokens:body.max_tokens,workflow},{signal:controller.signal});}
    catch(error){controller.abort(error);throw error;}
    persist();
    const headers=new Headers(init.headers);headers.set('x-ai-provider',settings.provider);headers.set('x-ai-model',settings.model);headers.set('x-ai-api-key',settings.apiKey);headers.set('x-ai-effort',settings.effort || 'medium');
    if(!workflow.startsWith('quality-')) {
      const organization=getOrganizationPromptContext({workflow,hint:workflow,projectId:'quality-benchmark'});
      if(organization.header)headers.set('x-xhandle-organization-context',organization.header);
    } else headers.delete('x-xhandle-organization-context');
    save(path.join(runDirectory,`request-${String(id).padStart(3,'0')}.json`),{id,workflow,model:settings.model,body});
    progress(`Request ${id}: ${workflow}; budget reserved $${budget.reservedUsd.toFixed(3)}.`);
    try {
      const response=await nativeFetch(url,{...init,headers,body:JSON.stringify(body),signal:init.signal || controller.signal});
      const raw=await response.text();
      let payload;try{payload=JSON.parse(raw);}catch{payload={};}
      budget.settle(ticket,payload.usage || payload.raw?.usage);persist();
      save(path.join(runDirectory,`response-${String(id).padStart(3,'0')}.json`),{id,status:response.status,payload:payload || raw});
      if(payload.model && payload.model!==settings.model)throw Error('Provider returned a different model than the frozen campaign setting.');
      return new Response(raw,{status:response.status,headers:response.headers});
    } catch(error) {
      if(!ticket.settled){budget.settle(ticket);persist();}
      throw error;
    }
  };
  const {fetchLLMResponse}=load('src/components/aiAnalysisSTPA.js');
  const {processFunctionalModel,buildFunctionalModelRows,functionalModelIsReady,immutableFunctionalRows}=load('src/features/code-architecture-context/functionalModel.js');
  const {createFunctionalRequestRuntime}=load('src/features/code-architecture-context/functionalRequestRuntime.js');
  const {ensureCodeArchitectureTraceIds,buildCodeArchitectureHazardInput}=load('src/features/code-architecture-hazard-analysis/codeArchitectureHazardUtils.js');
  const {compactHazardSources}=load('src/features/code-architecture-hazard-analysis/fastHazardPipeline.js');
  const {runFastCodeArchitectureHazardAnalysis}=load('src/features/code-architecture-hazard-analysis/fastHazardRunner.js');
  const {getCodeArchitectureHazardRunById,resolveCodeArchitectureHazardRun,saveCodeArchitectureHazardRun}=load('src/features/code-architecture-hazard-analysis/codeArchitectureHazardStore.js');
  const {validateFastAssessment}=load('src/features/code-architecture-hazard-analysis/fastHazardSchema.js');
  const {gradeFunctionalQuality}=load('src/features/hazard-eval/functionalQualityScoring.js');
  const {functionalQualityJudgePrompt,coverageJudgePrompt,validateJudgeEvidence}=load('src/features/hazard-eval/functionalQualityJudge.js');
  const {applyQualityCitationRepairs,qualityCitationRepairPrompt,qualityCitationDiagnostics}=load('src/features/hazard-eval/functionalQualityCitationRepair.js');
  const {QUALITY_ADJUDICATION_VERSION,qualityAdjudicationPrompt,applyQualityAdjudication}=load('src/features/hazard-eval/functionalQualityAdjudication.js');
  const {normalizeQualityVerdicts,compactQualitySources}=load('src/features/hazard-eval/functionalQualityTransport.js');
  const {hydrateFunctionalViewSnapshot}=load('src/features/hazard-eval/functionalViewSnapshot.js');
  const {assertSingleQualityContext,unchangedQualityInput,qualitySourceCorpus}=load('src/features/hazard-eval/functionalQualityContract.js');
  assertSingleQualityContext(oracle.contexts);
  const call=async(prompt,workflow,maxTokens=7000)=>{
    const result=await fetchLLMResponse(prompt,{},[],'',{workflow,maxTokens,signal:controller.signal,throwOnError:true,requireCompleteOutput:true});
    if(controller.signal.aborted)throw controller.signal.reason;
    if(result==='(error)')throw Error(`Provider request failed during ${workflow}; see preserved request/response evidence.`);
    return result;
  };
  const callJson=async(prompt,workflow,maxTokens)=>{
    try{return parse(await call(prompt,workflow,maxTokens));}
    catch(error){
      if(!(error instanceof SyntaxError) && error.name!=='TruncatedResponseError')throw error;
      progress(`${workflow}: incomplete JSON; retrying once with a larger output allowance.`);
      return parse(await call(prompt+'\nReturn complete bounded JSON. Keep explanations concise and do not omit any required ID.',workflow,Math.min(24000,maxTokens*2)));
    }
  };
  const rawRows=ensureCodeArchitectureTraceIds(fixture.repos[0].rows);
  immutableFunctionalRows(rawRows);
  const sharedSource=qualitySourceCorpus(rawRows),assertRawUnchanged=unchangedQualityInput(rawRows);
  const citationRepairs=[];
  const verifiedCitations=async(original,sources,assessments)=>{
    let verdicts=normalizeQualityVerdicts(original,sources);
    const evidenceArgs=()=>({verdicts,sources,assessments,facts:oracle.facts,sharedSource});
    let errors=validateJudgeEvidence(evidenceArgs());
    for(let attempt=0;attempt<2 && errors.length;attempt++) {
    const invalidIds=[...new Set(errors.map(error=>error.match(/for ([\w-]+)\./)?.[1]).filter(Boolean))];
    for(let offset=0;offset<invalidIds.length;offset+=7) {
      const ids=new Set(invalidIds.slice(offset,offset+7)),selected=verdicts.filter(row=>ids.has(row.id));
      const diagnostics=qualityCitationDiagnostics({...evidenceArgs(),verdicts:selected});
      const repairs=await callJson(qualityCitationRepairPrompt({verdicts:selected,sources:compactQualitySources(sources.filter(row=>ids.has(row.id)),sharedSource),assessments:assessments.filter(row=>ids.has(row.id)),facts:oracle.facts,sharedSource,diagnostics,errors:errors.filter(error=>[...ids].some(id=>error.endsWith('for '+id+'.')))}),'quality-citation-repair',8000);
      verdicts=applyQualityCitationRepairs(verdicts,repairs,diagnostics);
      citationRepairs.push({ids:[...ids],repairs});save(path.join(runDirectory,'judge-citation-repairs.json'),citationRepairs);
    }
    errors=validateJudgeEvidence(evidenceArgs());
    }
    const remaining=validateJudgeEvidence(evidenceArgs());
    if(remaining.length)throw Error('Independent evaluator evidence remains invalid: '+remaining.join('; '));
    return verdicts;
  };
  const auditHistory=[];
  const auditedVerdicts=async(original,sources,assessments)=>{
    const normalized=normalizeQualityVerdicts(original,sources),output=[];
    let nextOffset=0;
    await Promise.all(Array.from({length:3},async()=>{while(nextOffset<normalized.length) {
      const offset=nextOffset;nextOffset+=7;
      const batch=normalized.slice(offset,offset+7),pending=batch.filter(row=>row.adjudication?.version!==QUALITY_ADJUDICATION_VERSION);
      if(!pending.length){output.push(...batch);continue;}
      const ids=new Set(pending.map(row=>row.id)),selected=sources.filter(row=>ids.has(row.id)),rows=assessments.filter(row=>ids.has(row.id));
      const prompt=qualityAdjudicationPrompt({verdicts:pending,sources:compactQualitySources(selected,sharedSource),assessments:rows,facts:oracle.facts,sharedSource});
      const response=await callJson(prompt,'quality-evidence-audit',14000);
      auditHistory.push({firstPass:pending,audit:response});save(path.join(runDirectory,'judge-evidence-audits.json'),auditHistory);
      if(!Array.isArray(response.rows))throw Error('Independent evaluator audit omitted rows.');
      // Validate/repair exact quotation fields before applying decisions. A
      // formatting correction cannot change the decision or original allegation.
      const proofs=response.rows.map(audit=>({id:audit.id,scores:{grounding:0,applicability:0,causality:0,requirements:0,verification:0},support:audit.support,
        findings:(audit.decisions || []).map(decision=>({...pending.find(row=>row.id===audit.id)?.findings?.[decision.index],claim:decision.claim,evidence:decision.evidence}))}));
      const cited=await verifiedCitations(proofs,selected,rows);
      const corrected=response.rows.map(audit=>({...audit,support:cited.find(row=>row.id===audit.id).support,decisions:audit.decisions.map((decision,index)=>({...decision,claim:cited.find(row=>row.id===audit.id).findings[index].claim,evidence:cited.find(row=>row.id===audit.id).findings[index].evidence}))}));
      const audited=applyQualityAdjudication({verdicts:pending,audits:preserveUnscoredAuditMetadata(corrected,pending,rows),sources:selected,assessments:rows,facts:oracle.facts,sharedSource});
      output.push(...batch.map(row=>audited.find(item=>item.id===row.id) || row));
    }}));
    return verifiedCitations(normalizeQualityVerdicts(output,sources),sources,assessments);
  };
  let modeled=functionalView?hydrateFunctionalViewSnapshot({text:functionalView,rawRows}):null;
  if(process.argv.includes('--preview')) {
    const {launchQualityPreview}=require('./hazard-quality/electron-preview.cjs');
    const visibleFixture={...fixture,repos:[{...fixture.repos[0],rows:modeled || rawRows}]};
    preview=await launchQualityPreview({root,directory:runDirectory,desktop:argument('--desktop') || path.resolve(root,'../xhandle-desktop'),
      electron:argument('--electron') || path.resolve(root,'../xhandle-desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),
      playwright:argument('--playwright') || require.resolve('playwright-core'),fixture:visibleFixture,contexts:oracle.contexts,
      modelSettings:{provider:settings.provider,model:settings.model,effort:settings.effort},organizationProfile});
    observe({phase:modeled?'Functional snapshot loaded':'Functional abstraction',cap});
  }
  // Calibrate the evaluator on a nominal safeguard and two deliberately wrong
  // outputs before trusting its score. These probes never enter generation.
  const calibrate=async()=>{
  observe({phase:'Evaluator calibration'});
  const calibrationRow=rawRows.find(row=>row.to==='plan_speed');
  if(!calibrationRow)throw Error('Benchmark needs an explicit reset/speed calibration source.');
  const calibrationSources=['QC-1','QC-2','QC-3','QC-4'].map(id=>({id,from:calibrationRow.from,action:calibrationRow.action,to:calibrationRow.to,
    phrase:'Providing the control action causes a hazard',context:oracle.contexts[0],details:[calibrationRow.controlActionDetails],
    evidence:{code:calibrationRow.codeEvidence,source:calibrationRow.sourceEvidence}}));
  const good={applicable:'Yes',assessedAction:calibrationRow.action,applicabilityRationale:'The selected target governs motion authority.',
    classification:'Safety — Direct',classificationRationale:'If the guard fails and an external actuator follows the target, unintended motion can strike personnel.',
    assumptions:'Assume an external actuator follows a nonzero target; the fixture itself has no physical actuation.',
    uca:'The controller returns a positive motion target during explicit stop reset while personnel occupy the vehicle path.',
    hazard:'Vehicle motion is authorized during reset in occupied stopping space.',loss:'Personnel injury from unintended vehicle motion.',
    causalScenario:'Assume a fault in the reset guard permits the remote positive target during reset; an external actuator following that target could move toward personnel.',
    causalFactor:'Hypothesis: the reset-cycle zero-target guard fails.',safetyConstraint:'The controller shall inhibit positive motion target during explicit reset.',
    softwareRequirement:'The software shall inhibit a positive target whenever command.reset_stop is true, including when stopped is false and command.target_mps is positive.',
    verification:'Call plan_speed with command.reset_stop=true, stopped=false and command.target_mps=2.0; verify the returned target is 0.0 m/s.'};
  const calibrationAssessments=[{...good,id:'QC-1'},
    {...good,id:'QC-2',softwareRequirement:'The software shall return the positive command.target_mps during explicit reset when stopped is false.',verification:'Call plan_speed with command.reset_stop=true, stopped=false and command.target_mps=2.0; verify target is 2.0 m/s.'},
    {...good,id:'QC-3',verification:'Verify stopping_distance(2.0) = 1.8 m; accept obstacle clearance 2.0 m as safe at 2 m/s.'},
    {...good,id:'QC-4',verification:'Integration test through tick: now=10.0, state.last_sequence=1, stop_latched=true, stop_reasons=(collision_envelope,), brake_requested_at=9.9; use an otherwise valid command sequence=2, sent_at=10.0, reset_stop=true, target_mps=2.0 and otherwise valid vehicle sampled_at=10.0, speed_mps=0.05, obstacle_m=10.0, brake_applied=true. Verify stop_latched becomes false, output.target_mps=0.0, brake=hold and traction_enabled=false.'}];
  let calibration;
  if(evaluationResume) {
    const prior=JSON.parse(fs.readFileSync(path.join(evaluationResume.directory,'calibration.json'),'utf8'));
    if(!Array.isArray(prior.errors) || prior.errors.length || JSON.stringify(prior.assessments)!==JSON.stringify(calibrationAssessments))throw Error('Saved calibration does not match the unchanged evaluator inputs.');
    calibration={rows:prior.verdicts};progress('Reusing passed calibration for the unchanged evaluator and source inputs.');
  } else calibration=await callJson(functionalQualityJudgePrompt({sources:compactQualitySources(calibrationSources,sharedSource),assessments:calibrationAssessments,facts:oracle.facts,sharedSource}),'quality-calibration',12000);
  const calibrationVerdicts=await auditedVerdicts(calibration.rows || [],calibrationSources,calibrationAssessments);
  const calibrationErrors=validateJudgeEvidence({verdicts:calibrationVerdicts,sources:calibrationSources,assessments:calibrationAssessments,facts:oracle.facts,sharedSource});
  if(calibrationVerdicts.length!==4 || new Set(calibrationVerdicts.map(row=>row.id)).size!==4 ||
    ['QC-1','QC-4'].some(id=>calibrationVerdicts.find(row=>row.id===id)?.findings?.some(issue=>issue.severity==='critical')) ||
    ['QC-2','QC-3'].some(id=>!calibrationVerdicts.find(row=>row.id===id)?.findings?.some(issue=>issue.severity==='critical')))calibrationErrors.push('Evaluator did not distinguish nominal reset behavior from unsafe reset/arithmetic probes.');
  save(path.join(runDirectory,'calibration.json'),{sources:calibrationSources,assessments:calibrationAssessments,verdicts:calibrationVerdicts,errors:calibrationErrors});
  if(calibrationErrors.length)throw Error('Quality evaluator calibration failed: '+calibrationErrors.join('; '));
  };
  if(!modeled) {
    observe({phase:'Functional abstraction'});
    const functionalRequest=createFunctionalRequestRuntime({signal:controller.signal,request:(prompt,signal)=>fetchLLMResponse(prompt,{},[],'',{workflow:'functional-abstraction',maxTokens:7000,signal})});
    try {modeled=await processFunctionalModel(rawRows,{request:functionalRequest,signal:controller.signal,force:true,concurrency:32,onProgress:info=>progress(info.message || 'Functional abstraction')});}
    finally {functionalRequest.close();}
  }
  if(!functionalModelIsReady(modeled))throw Error('Functional abstraction did not become ready.');
  immutableFunctionalRows(modeled);
  const assertModelUnchanged=unchangedQualityInput(modeled);
  const functional=buildFunctionalModelRows(modeled);save(path.join(runDirectory,'functional-model.json'),{mode:modeled[0]?.functionalCsvSnapshot?'provided-functional-snapshot':'live-functional-abstraction',modeled,functional});
  // CSV parsing can allocate temporary raw edge UUIDs. Compare the exact
  // canonical functional analysis input, whose supplied IDs are preserved.
  if(evaluationResume && JSON.stringify(functional)!==JSON.stringify(evaluationResume.model.functional))throw Error('Saved live analysis has a different canonical functional/source model.');
  if(preview)await preview.publishArchitecture(modeled);
  await calibrate();
  observe({phase:'Hazard analysis'});
  const rawIds=new Set(rawRows.map(row=>row.traceId)),coveredIds=new Set(functional.flatMap(row=>row.functionalModel.sourceTraceIds));
  if([...rawIds].some(id=>!coveredIds.has(id)))throw Error('Functional abstraction lost source relationship coverage.');
  const repoMeta={...fixture.repos[0].repo,operationalContext:fixture.repos[0].metadata.operationalContext};
  const input=buildCodeArchitectureHazardInput({cbaRows:modeled,repoMeta,projectId:'quality-benchmark',method:'STPA-Textbook',operationalContexts:oracle.contexts});
  assertSingleQualityContext(oracle.contexts,input.tableRows);
  const sources=compactHazardSources(input.tableRows);
  if(evaluationResume && (JSON.stringify(sources)!==JSON.stringify(evaluationResume.input.sources) || organizationContext!==evaluationResume.input.organizationContext || input.architectureSnapshotHash!==evaluationResume.run.architectureSnapshotHash))throw Error('Saved live analysis differs from the frozen source, context or profile.');
  save(path.join(runDirectory,'hazard-input.json'),{sources,organizationContext});
  let run;
  if(evaluationResume){run=evaluationResume.run;progress('Resuming quality evaluation of the saved live analysis; no fresh generation claimed.');await saveCodeArchitectureHazardRun(run);}
  else run=await runFastCodeArchitectureHazardAnalysis({cbaRows:modeled,repoMeta,projectId:'quality-benchmark',method:'STPA-Textbook',regenerate:true,
    operationalContexts:oracle.contexts,organizationContext,signal:controller.signal,setProgress:info=>progress(info.message),
    onPartialRunUpdate:partial=>{
      save(path.join(runDirectory,'partial-run.json'),partial);
      const table=partial.generatedSheets?.Summary;
      if(table?.length>1){const labels=table[0],body=table.slice(1);observe({completed:body.length,rows:body.slice(-6).map((cells,index)=>({
        id:cells[labels.indexOf('UCA ID')] || String(index+1),title:cells[labels.indexOf('Function')],text:cells[labels.indexOf('Unsafe Control Action')]}))});}
    }});
  save(path.join(runDirectory,'run.json'),run);
  assertRawUnchanged();assertModelUnchanged();
  assertSingleQualityContext(run.operationalContexts);
  if(JSON.stringify(run.operationalContexts)!==JSON.stringify(oracle.contexts))throw Error('Saved run changed the operational context.');
  if(run.runState!=='complete' || run.finalSavePending)throw Error('Generation or persistence did not complete.');
  if(preview)await preview.publishRun(run);
  const restored=await resolveCodeArchitectureHazardRun(await getCodeArchitectureHazardRunById(run.id));
  if(JSON.stringify(restored.generatedSheets.Summary)!==JSON.stringify(run.generatedSheets.Summary))throw Error('Saved/reloaded hazard results changed.');
  const sheet=run.generatedSheets.Summary,headers=sheet[0],map={assessedAction:'Control Action',applicable:'Guide Phrase Applicable',applicabilityRationale:'Guide Phrase Applicability Rationale',classification:'Safety Classification',classificationRationale:'Safety Significance Rationale',assumptions:'Assumptions',uca:'Unsafe Control Action',loss:'Loss',hazard:'Hazard',causalScenario:'Causal Scenario',causalFactor:'Causal Factor',safetyConstraint:'Safety Constraint',softwareRequirement:'Software Safety Requirement',verification:'Verification'};
  assertSingleQualityContext(oracle.contexts,sheet.slice(1).map(cells=>({operationalContextId:cells[headers.indexOf('Operational Context ID')],operationalScenario:cells[headers.indexOf('Operational Scenario')],operationalMode:cells[headers.indexOf('Operational Mode')],operatingConditions:cells[headers.indexOf('Operating Conditions')]})));
  const assessments=sheet.slice(1).map((cells,index)=>({id:sources[index]?.id,...Object.fromEntries(Object.entries(map).map(([key,label])=>[key,cells[headers.indexOf(label)]]))}));
  for(const row of assessments)if(row.applicable==='No')row.classification='Not applicable';
  const localErrors=assessments.flatMap((row,index)=>validateFastAssessment('STPA',row,sources[index],{structuralOnly:true}).map(issue=>`${row.id}: ${issue}`));
  const verdicts=[];
  observe({phase:'Independent quality review'});
  if(evaluationResume) {
    const reused=new Map();
    const batches=[];
    const recoveredFile=path.join(evaluationResume.directory,'judge-rows-recovered.json');
    if(fs.existsSync(recoveredFile))batches.push(JSON.parse(fs.readFileSync(recoveredFile,'utf8')));
    const savedFile=path.join(evaluationResume.directory,'judge-rows.json');
    if(fs.existsSync(savedFile))batches.push(JSON.parse(fs.readFileSync(savedFile,'utf8')));
    for(const filename of fs.readdirSync(evaluationResume.directory).filter(name=>/^response-\d+\.json$/.test(name)).sort()) {
      const suffix=filename.slice('response-'.length),requestFile=path.join(evaluationResume.directory,'request-'+suffix);
      if(!fs.existsSync(requestFile))continue;
      const request=JSON.parse(fs.readFileSync(requestFile,'utf8'));if(request.workflow!=='quality-row-review')continue;
      const payload=JSON.parse(fs.readFileSync(path.join(evaluationResume.directory,filename),'utf8')).payload;
      try{
        const prompt=request.body.messages.map(message=>message.content).find(content=>content.includes('\nAssessments: '));
        const requested=new Set(parse(prompt.slice(prompt.lastIndexOf('\nAssessments: ')+'\nAssessments: '.length)).map(row=>row.id));
        const value=parse(payload.choices?.[0]?.message?.content);
        if(Array.isArray(value.rows) && value.rows.every(row=>requested.has(row.id)))batches.push(value.rows);
      }catch{}
    }
    for(const batch of batches) {
      const pending=batch.filter(row=>!reused.has(row.id));if(!pending.length)continue;
      if(pending.some(row=>!sources.some(source=>source.id===row.id)))throw Error('Saved review contains an unknown source ID.');
      const ids=new Set(pending.map(row=>row.id)),selected=sources.filter(row=>ids.has(row.id)),rows=assessments.filter(row=>ids.has(row.id));
      for(const verdict of await auditedVerdicts(pending,selected,rows))reused.set(verdict.id,verdict);
    }
    verdicts.push(...reused.values());save(path.join(runDirectory,'judge-rows.json'),verdicts);
    progress(`Retained ${verdicts.length} valid source-grounded reviewer verdicts from the saved run.`);
  }
  // Review all exclusions as well as applicable rows. Fixed, small batches do
  // not hand the generation its own quality scores or rewrite its results.
  const pendingSources=sources.filter(source=>!verdicts.some(row=>row.id===source.id));
  let reviewOffset=0;
  await Promise.all(Array.from({length:3},async()=>{while(reviewOffset<pendingSources.length) {
    const offset=reviewOffset;reviewOffset+=7;
    const selected=pendingSources.slice(offset,offset+7),ids=new Set(selected.map(row=>row.id)),rows=assessments.filter(row=>ids.has(row.id));
    const result=await callJson(functionalQualityJudgePrompt({sources:compactQualitySources(selected,sharedSource),assessments:rows,facts:oracle.facts,sharedSource}),'quality-row-review',12000);
    if(!Array.isArray(result.rows))throw Error('Malformed independent quality review.');
    verdicts.push(...await auditedVerdicts(result.rows,selected,rows));
    save(path.join(runDirectory,'judge-rows.json'),verdicts);
    progress(`Independently reviewed ${verdicts.length} of ${sources.length} assessments.`);
  }}));
  const coverage=await callJson(coverageJudgePrompt({sources,assessments,expectations:oracle.coverage,facts:oracle.facts,sharedSource}),'quality-coverage-review',14000);
  if(!Array.isArray(coverage.findings))localErrors.push('Coverage review omitted the global consistency findings array.');
  for(const finding of coverage.findings || []) {
    const verdict=verdicts.find(row=>row.id===finding.id);
    if(!verdict){localErrors.push('Global consistency finding cites an unknown assessment.');continue;}
    const {id,...issue}=finding;verdict.findings.push(issue);
    const ceiling=issue.severity==='critical'?4:issue.severity==='major'?7:10;
    if(Object.hasOwn(verdict.scores,issue.dimension))verdict.scores[issue.dimension]=Math.min(verdict.scores[issue.dimension],ceiling);
  }
  verdicts.splice(0,verdicts.length,...await verifiedCitations(verdicts,sources,assessments));
  save(path.join(runDirectory,'judge-rows.json'),verdicts);
  assertRawUnchanged();assertModelUnchanged();
  const quality=gradeFunctionalQuality({sources,assessments,verdicts,coverageChecks:coverage.checks || [],expectedCoverage:oracle.coverage,localErrors});
  save(path.join(runDirectory,'quality.json'),quality);save(path.join(runDirectory,'coverage.json'),coverage);
  observe({phase:'Regression checks',score:quality.score});
  save(path.join(runDirectory,'diagnosis.json'),{score:quality.score,target:9,failures:quality.failures,findings:quality.findings,
    instruction:'Diagnose against the preserved source and prompts. Fix production behavior/prompts, add a regression for each correction, rerun offline checks, then invoke this campaign again with --change-notes. Do not lower the rubric, edit expected facts, or reroll unchanged source.'});
  progress(`Independent score ${quality.score.toFixed(2)}/10; ${quality.findings.length} findings. Running offline regression gate.`);
  const offlineDirectory=path.join(runDirectory,'offline-regression');
  const offline=await command(process.execPath,[path.join(__dirname,'run-stpa-synthetic.cjs'),'--out',offlineDirectory],{cwd:root,env:cleanEnvironment(),log:path.join(runDirectory,'regressions.log'),timeoutMs:150000});
  const regression=fs.existsSync(path.join(offlineDirectory,'result.json'))?JSON.parse(fs.readFileSync(path.join(offlineDirectory,'result.json'),'utf8')):null;
  const regressionsPassed=offline.exitCode===0 && regression?.ok===true;
  if(fingerprint(root).sha256!==source.sha256)throw Error('Source changed during the live run; results cannot qualify this revision.');
  iteration.score=quality.score;iteration.regressionsPassed=regressionsPassed;iteration.requestCount=budget.requests.length;
  iteration.status=quality.passed && regressionsPassed?'passed':'below-target';iteration.finishedAt=new Date().toISOString();
  iteration.findings=quality.findings.length;iteration.failures=quality.failures;
  let consecutive=0;
  for(const item of [...state.iterations].reverse()){if(item.status!=='passed' || item.freshGeneration===false || item.source.sha256!==source.sha256)break;consecutive++;}
  state.status=consecutive>=2?'target-confirmed':iteration.status==='passed'?(evaluationResume?'fresh-confirmation-required':'confirmation-required'):'improvement-required';persist();
  save(path.join(runDirectory,'result.json'),{ok:iteration.status==='passed',campaignStatus:state.status,quality,regressionsPassed,
    source,generationSource:evaluationResume?(evaluationResume.origin.generationSource || evaluationResume.origin.source):source,freshGeneration:!evaluationResume,model:state.model,requests:budget.requests,accountedCampaignUsd:budget.spentUsd,maxSpendUsd:cap,
    checks:[functionalView?'Provided functional snapshot preserved with source evidence':'Real functional abstraction prompts','Real STPA screening and generation prompts','Complete source trace coverage','Saved/reloaded results unchanged','Independent source-grounded row and coverage grading','Offline regression gate'],
    limits:['Automated benchmark score; not engineer-approved safety assurance. Same selected model uses a separate grading prompt. Two fresh passing generations are required on unchanged source.']});
  console.log('RESULT '+path.join(runDirectory,'result.json'));
  progress(`${state.status}: ${quality.score.toFixed(2)}/10; campaign accounted $${budget.spentUsd.toFixed(3)} of $${cap}.`);
  observe({phase:state.status,score:quality.score,rowKind:'findings',rows:quality.findings.slice(0,6).map(issue=>({id:issue.id,title:issue.severity,text:issue.reason}))});
  if(preview){await previewUpdates;await preview.screenshot(path.join(runDirectory,'preview-final.png'));}
  if(iteration.status!=='passed')process.exitCode=2;
}
main().catch(error=>{
  if(controller.signal.reason?.code==='QUALITY_SPEND_CAP')error=controller.signal.reason;
  const message=scrub(error.message || error);console.error(message);
  observe({phase:'Stopped',message});
  if(state && runDirectory){const iteration=state.iterations.at(-1);iteration.status=error.code==='QUALITY_SPEND_CAP'?'spend-cap':'incomplete';iteration.error=message;state.status=iteration.status;persist();save(path.join(runDirectory,'error.json'),{error:message,code:error.code || error.name,accountedUsd:budget?.spentUsd});}
  process.exitCode=1;
}).finally(()=>{controller.abort();backendChild?.kill('SIGTERM');if(!process.argv.includes('--keep-preview'))preview?.close().catch(()=>{});});
