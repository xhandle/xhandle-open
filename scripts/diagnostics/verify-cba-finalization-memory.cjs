// Real desktop shell, disposable profile, production data modules, no AI calls.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const { _electron } = require(process.env.XHANDLE_PLAYWRIGHT_MODULE || 'playwright-core');
const parser = require('@babel/parser'), {electronFixtureMain,cleanEnvironment,fingerprint,stageFixtureWorkers} = require('./electron-regression-support.cjs');
const root = path.resolve(__dirname,'../..'), arg = name => {const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
const stage = fs.realpathSync(arg('--stage')), baseline = arg('--baseline-source');
const stressRows = Number(arg('--stress-rows') || 0), stressFiles = Number(arg('--stress-files') || 6000);
if (stressRows && (!Number.isSafeInteger(stressRows) || stressRows < 6000 || !Number.isSafeInteger(stressFiles) || stressFiles < 6000)) throw new Error('Stress replay requires at least 6,000 files and relationships.');
const output = arg('--out') || fs.mkdtempSync(path.join(os.tmpdir(),'xhandle-cba-finalization-'));
if (arg('--out') && fs.existsSync(output)) throw new Error('Choose a fresh --out directory; prior evidence is never overwritten.');
if (!fs.existsSync(output)) fs.mkdirSync(output,{recursive:true});
const result = {root:output, checks:[], failures:[], errors:[], measurements:[], source:fingerprint(root), baseline:baseline || null, networkAttempts:[], platform:process.platform, stressRows, stressFiles, liveSamples:[], liveResidentPeaks:{}, crashes:[], pressureStops:{}};
if(stressRows)result.benchmark={files:stressFiles,relationships:stressRows,pressureTargetBytes:4e9,assumption:'Synthetic varied-source workload; actual heap and resident memory are measured at the normal heap cap.'};
let app, page;
const save = () => fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(result,null,2));
function declarations(file, names) {
  const source = fs.readFileSync(file,'utf8'), nodes=parser.parse(source,{sourceType:'module',plugins:['jsx']}).program.body;
  return nodes.map(n=>n.type==='ExportNamedDeclaration'?n.declaration:n).filter(n=>n?.type==='FunctionDeclaration'&&names.includes(n.id?.name)).map(n=>source.slice(n.start,n.end)).join('\n');
}
function dataModules(directory) {
  return ['src/features/code-architecture-storage/chunkedRecord.js','src/features/code-architecture-assurance/codeArchitectureStorage.js'].map(file=>{
    const source=fs.readFileSync(path.join(directory,file),'utf8');
    return parser.parse(source,{sourceType:'module'}).program.body.filter(n=>n.type!=='ImportDeclaration').map(n=>source.slice(n.type==='ExportNamedDeclaration'?n.declaration.start:n.start,n.end)).join('\n');
  }).join('\n');
}
async function check(name, work) {
  try {await work();result.checks.push(name);console.log('PASS '+name);}
  catch(error){result.failures.push({name,error:error.stack});console.error('FAIL '+name+': '+error.message);}
  save();
}
(async()=>{try {
  console.log('REPORT '+path.join(output,'result.json'));
  const fixture=await require('./build-cba-finalization-fixture.cjs').build(path.join(output,'fixture'));
  stageFixtureWorkers(path.dirname(fixture),stage);
  const currentGenerator=path.join(root,'src/components/generateFunctionalDecompositionFromGitHub.js');
  const helpers=declarations(currentGenerator,['normalizeEvidenceToken','scoreSourceFunctionForRow','selectSourceFunctionsForRow','sourceSnippetForFunction','splitRelatedFiles'])
    .replace('function selectSourceFunctionsForRow(sourceFunctions, row) {','function selectSourceFunctionsForRow(sourceFunctions, row) { window.memoryRowsPrepared=(window.memoryRowsPrepared || 0)+1;');
  const oldBuilder=baseline?declarations(path.join(baseline,'src/components/generateFunctionalDecompositionFromGitHub.js'),['buildCodeEvidenceForRows']):null;
  const oldModules=baseline?dataModules(baseline):null;
  const launch = async name => {
    if (app) { await app.close().catch(()=>{}); app = null; }
    const shell = path.join(output,name);fs.mkdirSync(shell,{recursive:true});
    for(const directory of ['profile','session','downloads'])fs.mkdirSync(path.join(shell,directory),{recursive:true});
    fs.writeFileSync(path.join(shell,'package.json'),JSON.stringify({name:'xhandle-cba-memory-preview',version:'1.0.0',main:'main.cjs'}));
    fs.writeFileSync(path.join(shell,'main.cjs'),`require('electron').app.commandLine.appendSwitch('enable-precise-memory-info');\n`+(stressRows?'':`require('electron').app.commandLine.appendSwitch('js-flags','--max-old-space-size=1024');\n`)+electronFixtureMain(stage,shell));
    app=await _electron.launch({executablePath:arg('--electron'),args:[shell],env:cleanEnvironment()});
    page=await app.firstWindow();page.setDefaultTimeout(30000);
    page.on('pageerror',error=>{result.errors.push(error.stack||error.message);save();});
    page.on('crash',()=>{result.crashes.push({name,at:new Date().toISOString()});if(!name.includes('baseline'))result.errors.push('Fixed renderer crashed');save();});
    let pressureAt;
    await page.exposeFunction('reportStressSample',sample=>{
      result.liveSamples.push({name,...sample});
      if(result.liveSamples.length%10===0)save();
      if(result.liveSamples.length%100===0)console.log('STRESS '+JSON.stringify({name,...sample,peakResidentBytes:result.liveResidentPeaks[name]}));
      // Capture a sustained real 4+ GB heap state at the unchanged cap. Do not
      // spend unbounded time waiting for the OS/native crash classification.
      // A controlled stop is recorded separately and never called a crash.
      if(stressRows&&name.includes('baseline')&&sample.heap>=4e9&&!pressureAt)pressureAt=Date.now();
      if(pressureAt&&Date.now()-pressureAt>=15000&&sample.phase==='staging'&&!result.pressureStops[name]) {
        result.pressureStops[name]={reason:'Captured at least 4 GB used heap and 15 seconds of final-save pressure; controlled baseline stop.',heap:sample.heap,heapLimit:sample.heapLimit};
        save();const captured=app;captured.close().catch(()=>{});
      }
    });
    const profile=await app.evaluate(({app,BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.setTitle('xHandle — Code architecture memory validation');w.setBounds({width:1500,height:1000});return app.getPath('userData');});
    assert.equal(profile,path.join(shell,'profile'));
    result.runtime=await app.evaluate(()=>process.versions);
    await page.route('**/api/chat',route=>{result.networkAttempts.push(route.request().url());return route.fulfill({status:503,body:'Offline diagnostic: provider calls are disabled.'});});
    await page.getByRole('button',{name:'Design Management',exact:true}).waitFor();
  };
  const inject = async mode => {
    await page.addScriptTag({path:fixture});
    await page.evaluate(({mode,helpers,oldBuilder,oldModules})=>{
      const a=window.cbaMemoryAPI;
      window.memoryHelpers=new Function(helpers+';return {splitRelatedFiles,selectSourceFunctionsForRow,sourceSnippetForFunction};')();
      const env={idbGet:a.readAnalysisSourceRecord,IDB_STORES:{codeIndex:'code_index'},codeSourceIndexKey:a.codeSourceIndexKey,codeSourceProvenance:a.codeSourceProvenance,throwIfAborted:signal=>{if(signal?.aborted)throw signal.reason;},sleep:()=>new Promise(resolve=>setTimeout(resolve,0)),...window.memoryHelpers};
      if(mode==='baseline') {
        window.memoryBuilder=new Function(...Object.keys(env),helpers+'\n'+oldBuilder+';return buildCodeEvidenceForRows;')(...Object.values(env));
        window.memoryStorage=new Function('const notifyBackupDataChanged=()=>{};const withDiagnosticOperation=(_name,_context,work)=>work();'+oldModules+';return {prepareArchitecturePublication,recoverArchitecturePublication,readCbaRowsFromIndexedDB};')();
      } else {window.memoryStorage=a;window.memoryBuilder=({owner,repo,rows,...source})=>a.enrichCodeEvidenceRows({owner,repo,rows,provenance:a.codeSourceProvenance(source),splitFiles:window.memoryHelpers.splitRelatedFiles,selectFunctions:window.memoryHelpers.selectSourceFunctionsForRow,snippet:window.memoryHelpers.sourceSnippetForFunction,readFile:path=>a.readAnalysisSourceRecord('code_index',a.codeSourceIndexKey({owner,repo,...source},path))});}
    },{mode,helpers,oldBuilder,oldModules});
  };
  for(const variant of stressRows?['varied']:['repeated','varied']) for(const count of stressRows?[stressRows]:[300,1200]) for(const mode of baseline?['baseline','fixed']:['fixed']) {
    await check(`${mode} ${variant} ${count}: enrichment, publication and reload`,async()=>{
      await launch(`case-${mode}-${variant}-${count}`);await inject(mode);
      // The fixture is created inside the renderer; it is never copied through
      // Playwright or retained in an external measurement process.
      const native=[];let sampling=false;
      const timer=setInterval(async()=>{if(sampling)return;sampling=true;try{const sample=await app.evaluate(({app})=>app.getAppMetrics().filter(p=>p.type==='Tab').map(p=>({pid:p.pid,...p.memory})));native.push(sample);const name=`case-${mode}-${variant}-${count}`;result.liveResidentPeaks[name]=Math.max(result.liveResidentPeaks[name]||0,...sample.map(p=>p.workingSetSize*1024));}catch{}finally{sampling=false;}},250);
      let measurement;
      try {measurement=await page.evaluate(async({count,variant,mode,stressRows,stressFiles})=>{
        const a=window.cbaMemoryAPI, db=await a.openCbaIndexedDB(), files=stressRows?stressFiles:variant==='repeated'?1:40;
        const source={sourceType:'github',sourceId:'fixture/memory',snapshotId:'fixed-snapshot',owner:'fixture',repo:'memory',commitSha:'f'.repeat(40)};
        for(let file=0;file<files;file++) {
          const filePath=`src/unit_${file}.cpp`,lines=[],functions=[];
          for(let f=0;f<64;f++){const start=lines.length+1;for(let line=0;line<8;line++)lines.push(`// source ${file} operation ${f} line ${line} café 车辆 `+'verified syntax '.repeat(15));functions.push({filePath,functionName:`operation_${f}`,startLine:start,endLine:lines.length,sourceUrl:`https://example.invalid/${filePath}#L${start}`});}
          await a.writeRecord(db,'code_index',a.codeSourceIndexKey(source,filePath),{...source,path:filePath,content:lines.join('\n'),sourceFunctions:functions,functions:functions.map(f=>f.functionName),imports:[],exports:[],sourceAudit:{fixture:true}});
          if(stressRows&&file%100===0)window.reportStressSample({phase:'source-preparation',completedFiles:file,totalFiles:files,heap:performance.memory.usedJSHeapSize,heapLimit:performance.memory.jsHeapSizeLimit});
        }
        // The production extractor flattens rows in file order. Stress rows
        // follow that order too, rather than inventing cache-thrashing input.
        const input=Array.from({length:count},(_,i)=>{const file=stressRows?Math.min(files-1,Math.floor(i*files/count)):i%files;return {traceId:`memory-${i}`,from:'operation_0',to:'operation_1',fromFile:`src/unit_${file}.cpp`,toFile:`src/unit_${file}.cpp`,action:'Call operation',fromDetails:'Source-grounded input',toDetails:'Validated output',architecture:{subsystem:'Control',csci:'Application',csc:'Command processing',csu:`Unit ${file}`}};});
        const samples=[],phases=[],start=performance.now();let phase='enrichment';
        const sample=()=>samples.push({at:performance.now()-start,phase,heap:performance.memory.usedJSHeapSize});
        const interval=setInterval(sample,20), live=stressRows?setInterval(()=>window.reportStressSample({phase,completedFiles:files,totalFiles:files,completedRelationships:window.memoryRowsPrepared || 0,totalRelationships:count,heap:performance.memory.usedJSHeapSize,heapLimit:performance.memory.jsHeapSizeLimit}),200):null;sample();
        const mark=name=>{sample();phase=name;phases.push({phase:name,at:performance.now()-start,heap:performance.memory.usedJSHeapSize});if(stressRows)window.reportStressSample({phase,completedFiles:files,totalFiles:files,heap:performance.memory.usedJSHeapSize,heapLimit:performance.memory.jsHeapSizeLimit});};
        try {
          const rows=await window.memoryBuilder({...source,rows:input});mark('staging');
          const scope=`cba:memory-${mode}-${variant}-${count}:repo`,cp=`functional-decomposition-checkpoint:${scope}:run`;
          const storage=window.memoryStorage,previous=await storage.readCbaRowsFromIndexedDB(scope),run={scope,fingerprint:`${mode}-${variant}-${count}`,publishedAt:new Date().toISOString()};
          await storage.prepareArchitecturePublication(scope,rows,run,{selectedFiles:files},cp,previous);mark('publication');
          const saved=await storage.recoverArchitecturePublication(scope,cp,undefined,mode==='fixed'?{summaryOnly:true}:undefined);mark('reload');
          const reloaded=await a.readCbaRowsFromIndexedDB(scope,{immutableEvidence:mode==='fixed'});mark('verification');
          if(reloaded.length!==count || rows.length!==count)throw Error('Rows lost');
          // Compare every row/evidence field incrementally; no whole-result JSON.
          let checksum=2166136261;
          for(let i=0;i<count;i++) {
            const expected=JSON.stringify(rows[i]),actual=JSON.stringify(reloaded[i]);
            if(expected!==actual)throw Error('Evidence changed at '+i);
            if(stressRows) {
              const file=Math.min(files-1,Math.floor(i*files/count));
              const functions=reloaded[i].sourceEvidence.functions;
              // The production scorer also matches operation_1 to operations
              // 10..19; retain its exact established order in the reference.
              const expectedOrder=[0,1,...Array.from({length:10},(_,i)=>i+10),...Array.from({length:8},(_,i)=>i+2),...Array.from({length:5},(_,i)=>i+20)];
              if(functions.length!==25||functions.some((fn,index)=>fn.filePath!==`src/unit_${file}.cpp`||fn.functionName!==`operation_${expectedOrder[index]}`||fn.startLine!==expectedOrder[index]*8+1||fn.endLine!==expectedOrder[index]*8+8))throw Error('Synthetic source citations changed at '+i);
              for(const fn of functions) {
                const index=Number(fn.functionName.split('_')[1]);
                const body=Array.from({length:8},(_,line)=>`// source ${file} operation ${index} line ${line} café 车辆 `+'verified syntax '.repeat(15)).join('\n');
                if(fn.content!==body)throw Error('Synthetic source content changed at '+i);
              }
            }
            for(let c=0;c<actual.length;c++)checksum=Math.imul(checksum^actual.charCodeAt(c),16777619);
            if(i%50===0)await new Promise(resolve=>setTimeout(resolve,0));
          }
          sample();
          const sharedIndex=stressRows?1:Math.min(files,count-1);
          return {mode,variant,count,checksum:checksum>>>0,elapsedMs:performance.now()-start,startHeap:samples[0].heap,
            peakHeap:Math.max(...samples.filter(s=>s.phase!=='verification').map(s=>s.heap)),
            totalObservedPeakHeap:Math.max(...samples.map(s=>s.heap)),endHeap:performance.memory.usedJSHeapSize,heapLimit:performance.memory.jsHeapSizeLimit,phases,samples,publicationReturnedRows:Array.isArray(saved.rows),sharedCatalog:reloaded[0].codeEvidence.files[0]===reloaded[sharedIndex].codeEvidence.files[0]};
        } finally {clearInterval(interval);if(live)clearInterval(live);db.close();}
      },{count,variant,mode,stressRows,stressFiles});}
      catch(error) {
        if(!stressRows||mode!=='baseline'||!page.isClosed()&&!result.crashes.some(c=>c.name.includes('baseline'))&&!result.pressureStops[`case-${mode}-${variant}-${count}`])throw error;
        const pressureStopped=Boolean(result.pressureStops[`case-${mode}-${variant}-${count}`]);
        measurement={mode,variant,count,crashed:!pressureStopped,pressureStopped,error:String(error),peakHeap:Math.max(...result.liveSamples.filter(s=>s.name.includes('baseline')).map(s=>s.heap)),heapLimit:result.liveSamples.find(s=>s.name.includes('baseline'))?.heapLimit};
      }finally{clearInterval(timer);}
      measurement.nativeSamples=native;result.measurements.push(measurement);
      measurement.peakRSS=Math.max(0,...native.flat().map(s=>s.workingSetSize*1024));
      if(stressRows) {
        assert(measurement.heapLimit>4e9&&measurement.heapLimit<4.6e9,'Stress replay did not use the normal approximately 4 GiB heap limit');
        if(mode==='baseline')assert(measurement.peakHeap>=4e9 || measurement.peakHeap>=3*1073741824&&measurement.peakRSS>=4e9,'Baseline never reached real 4+ GB memory pressure');
      } else assert(measurement.peakHeap<measurement.heapLimit*.85,'Insufficient heap headroom');
      if(mode==='fixed'){assert.equal(measurement.publicationReturnedRows,false);assert.equal(measurement.sharedCatalog,true);}
      const prior=result.measurements.find(m=>m.mode==='baseline'&&m.variant===variant&&m.count===count);
      if(mode==='fixed'&&prior){if(!prior.crashed&&!prior.pressureStopped)assert.equal(measurement.checksum,prior.checksum,'Baseline/fixed evidence differs');measurement.peakReduction=1-measurement.peakHeap/prior.peakHeap;}
      console.log(JSON.stringify({mode,variant,count,peakMiB:Math.round(measurement.peakHeap/1048576),elapsedMs:Math.round(measurement.elapsedMs),peakReduction:measurement.peakReduction}));
    });
  }
  if(baseline) await check('fixed large varied run reduces peak heap against identical baseline',async()=>{
    const before=result.measurements.find(m=>m.mode==='baseline'&&m.variant==='varied'&&m.count===(stressRows||1200));
    const after=result.measurements.find(m=>m.mode==='fixed'&&m.variant==='varied'&&m.count===(stressRows||1200));
    assert(before&&after,'Missing paired measurements');assert(after.peakHeap<before.peakHeap*.8,'Peak heap did not improve by at least 20%');
  });
  if(stressRows)await check('full stress result stages, survives process restart and recovers every row without source analysis',async()=>{
    const name=`case-fixed-varied-${stressRows}`,key=`cba:memory-fixed-varied-${stressRows}:repo`,cp=`functional-decomposition-checkpoint:${key}:recovery`;
    await page.evaluate(async({key,cp,stressFiles})=>{
      const a=window.cbaMemoryAPI,rows=await a.readCbaRowsFromIndexedDB(key,{immutableEvidence:true});
      await a.prepareArchitecturePublication(key,rows,{scope:key,fingerprint:'full-stress-save-recovery'},{selectedFiles:stressFiles},cp,rows);
    },{key,cp,stressFiles});
    await launch(name);await inject('fixed');
    const recovered=await page.evaluate(async({key,cp})=>{
      const a=window.cbaMemoryAPI,preview=await a.readLatestArchitectureCheckpoint(key);
      if(preview.rows.length!==50)throw Error('Full recovery preview is not bounded');
      await a.recoverArchitecturePublication(key,cp,undefined,{summaryOnly:true});
      const db=await a.openCbaIndexedDB();let count=0,checksum=2166136261;
      try {
        const record=await a.rawRecord(db,'copilot_baseline',key);
        for await(const batch of a.iterateRecordArray(db,'copilot_baseline',record,{immutableEvidence:true}))for(const row of batch){const text=JSON.stringify(row);for(let i=0;i<text.length;i++)checksum=Math.imul(checksum^text.charCodeAt(i),16777619);count++;}
      }finally{db.close();}
      return {count,checksum:checksum>>>0,previewCount:preview.rowCount,totalFiles:preview.total};
    },{key,cp});
    assert.equal(recovered.count,stressRows);assert.equal(recovered.previewCount,stressRows);assert.equal(recovered.totalFiles,stressFiles);
    assert.equal(recovered.checksum,result.measurements.find(m=>m.mode==='fixed').checksum);
    result.stressRecovery=recovered;
  });
  await page.reload();await page.getByRole('button',{name:'Design Management',exact:true}).waitFor();await inject('fixed');
  await check('ready checkpoint survives reload, previews 50 rows and saves without provider calls',async()=>{
    await page.evaluate(async()=>{const a=window.cbaMemoryAPI,key='cba:memory-recovery:repo',cp=`functional-decomposition-checkpoint:${key}:run`;const rows=Array.from({length:180},(_,i)=>({traceId:`recovery-${i}`,from:'Read',action:'Validate',to:'Apply',sourceEvidence:{excerpt:`unique ${i}`}}));await a.prepareArchitecturePublication(key,rows,{scope:key,fingerprint:'recover-me'},{selectedFiles:6000},cp,[]);});
    await page.reload();await page.getByRole('button',{name:'Design Management',exact:true}).waitFor();await inject('fixed');
    const recovered=await page.evaluate(async()=>{const a=window.cbaMemoryAPI,key='cba:memory-recovery:repo',cp=`functional-decomposition-checkpoint:${key}:run`,preview=await a.readLatestArchitectureCheckpoint(key);if(preview.rows.length!==50||preview.rowCount!==180)throw Error('Incorrect bounded preview');await a.recoverArchitecturePublication(key,cp,undefined,{summaryOnly:true});const rows=await a.readCbaRowsFromIndexedDB(key);return {count:rows.length,last:rows.at(-1).sourceEvidence.excerpt};});
    assert.deepEqual(recovered,{count:180,last:'unique 179'});
  });
  await check('native storage failures, cancellation, transaction rollback and concurrent edits retain saved results',async()=>{
    await page.evaluate(async()=>{
      const a=window.cbaMemoryAPI,store='copilot_baseline',scope='cba:native-faults:repo',cp=`functional-decomposition-checkpoint:${scope}:run`,db=await a.openCbaIndexedDB();
      const old=[{traceId:'old',manual:'keep'}],next=[{traceId:'next',sourceEvidence:{excerpt:'full source café 车辆'}}],run={scope,fingerprint:'fault-run'};
      const requireValue=(condition,message)=>{if(!condition)throw Error(message);};
      const rejects=async work=>{try{await work();return false;}catch{return true;}};
      const put=IDBObjectStore.prototype.put;
      try {
        await a.writeCbaRowsToIndexedDB(scope,old);
        const ready=await a.prepareArchitecturePublication(scope,next,run,{},cp,old),rootText=await a.rawRecord(db,store,ready.rowRecord.root);
        await a.putRawRecord(db,store,ready.rowRecord.root,JSON.stringify(['array',[]]));
        requireValue(await rejects(()=>a.recoverArchitecturePublication(scope,cp,undefined,{summaryOnly:true})),'Corrupt result published');
        requireValue((await a.readCbaRowsFromIndexedDB(scope))[0].manual==='keep','Corrupt publication lost previous rows');
        await a.putRawRecord(db,store,ready.rowRecord.root,rootText);
        const controller=new AbortController();controller.abort();
        requireValue(await rejects(()=>a.recoverArchitecturePublication(scope,cp,controller.signal,{summaryOnly:true})),'Cancellation ignored');
        IDBObjectStore.prototype.put=function(value){const request=put.call(this,value);if(value.key===scope+':run')this.transaction.abort();return request;};
        requireValue(await rejects(()=>a.recoverArchitecturePublication(scope,cp,undefined,{summaryOnly:true})),'Aborted publication succeeded');
        IDBObjectStore.prototype.put=put;
        requireValue((await a.readCbaRowsFromIndexedDB(scope))[0].manual==='keep'&&await a.rawRecord(db,store,cp),'Transaction abort lost rows or checkpoint');
        await a.recoverArchitecturePublication(scope,cp,undefined,{summaryOnly:true});
        await a.prepareArchitecturePublication(scope,old,run,{},cp,next);
        await a.writeCbaRowsToIndexedDB(scope,[{traceId:'analyst-edit'}]);
        requireValue(await rejects(()=>a.recoverArchitecturePublication(scope,cp,undefined,{summaryOnly:true})),'Concurrent edit overwritten');
        requireValue((await a.readCbaRowsFromIndexedDB(scope))[0].traceId==='analyst-edit','Analyst change lost');
        const quota='cba:native-quota:repo',quotaCP=`functional-decomposition-checkpoint:${quota}:run`;
        IDBObjectStore.prototype.put=function(value){if(value.key.startsWith(quota))throw new DOMException('Injected quota failure','QuotaExceededError');return put.call(this,value);};
        requireValue(await rejects(()=>a.prepareArchitecturePublication(quota,next,{...run,scope:quota},{},quotaCP,[])),'Quota failure ignored');
        IDBObjectStore.prototype.put=put;
        requireValue((await a.readArchitectureCheckpoint(quotaCP)).durable===false,'Unsaved result is not recoverable');
        await a.recoverArchitecturePublication(quota,quotaCP,undefined,{summaryOnly:true});
        requireValue((await a.readCbaRowsFromIndexedDB(quota))[0].sourceEvidence.excerpt==='full source café 车辆','Quota recovery changed evidence');
      }finally{IDBObjectStore.prototype.put=put;db.close();}
    });
  });
  if(!stressRows) await check('preview opens published architecture, edits and reloads while preserving evidence',async()=>{
    await page.evaluate(()=>{const id='memory-fixed-varied-1200';localStorage.setItem('xhandle.codeArchitectureProjects',JSON.stringify([{id,name:'Memory validation architecture',repos:[{id:'repo',repoId:'fixture/memory',owner:'fixture',repo:'memory'}],activeRepoId:'repo'}]));localStorage.setItem('xhandle.sidebarCodeArchitectureProjectsOpen','true');localStorage.setItem('xhandle.lastNonCopilotSection','code-architecture');localStorage.setItem(`cba:${id}:repo:architecture-abstraction`,'detailed');});
    await page.reload();await page.getByRole('button',{name:'Memory validation architecture',exact:true}).first().click();
    await page.getByRole('button',{name:'CSU',exact:true}).waitFor();
    await page.getByRole('button',{name:'CSU',exact:true}).click();
    await page.locator('.react-flow__node').first().waitFor();
    await page.getByRole('button',{name:'CSC',exact:true}).click();await page.locator('.react-flow__node').first().waitFor();
    // Controlled analyst change uses the production storage API; UI navigation
    // and the broader workspace suite exercise the ordinary editable controls.
    await inject('fixed');
    await page.evaluate(async()=>{const a=window.cbaMemoryAPI,key='cba:memory-fixed-varied-1200:repo',rows=await a.readCbaRowsFromIndexedDB(key,{immutableEvidence:true});rows[0]={...rows[0],action:'Analyst reviewed command'};await a.writeCbaRowsToIndexedDB(key,rows);});
    await page.reload();await inject('fixed');
    const restored=await page.evaluate(async()=>{const rows=await window.cbaMemoryAPI.readCbaRowsFromIndexedDB('cba:memory-fixed-varied-1200:repo');return {count:rows.length,action:rows[0].action,evidence:rows[0].sourceEvidence.functions[0].content.includes('café 车辆'),second:rows[1].action};});
    assert.deepEqual(restored,{count:1200,action:'Analyst reviewed command',evidence:true,second:'Call operation'});
    await page.screenshot({path:path.join(output,'architecture-preview.png')});
  });
  assert.equal(result.networkAttempts.length,0,'Unexpected provider requests');
  result.finalSource=fingerprint(root);assert.equal(result.finalSource.sha256,result.source.sha256,'Source changed during validation');
}catch(error){result.failures.push({name:'harness',error:error.stack});console.error(error);}
finally {result.ok=!result.failures.length&&!result.errors.length;save();console.log('RESULT '+path.join(output,'result.json'));if(app)await app.close();if(!result.ok)process.exitCode=1;}
})();
