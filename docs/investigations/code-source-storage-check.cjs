// Isolated real-IndexedDB checks. Requires an existing Playwright installation; no live app/backend calls.
const fs=require('fs'), path=require('path'), assert=require('assert/strict');
const root=path.resolve(__dirname,'../..');
const {chromium}=require(process.env.XHANDLE_PLAYWRIGHT_PATH);
const parser=require(path.join(root,'node_modules/@babel/parser'));
const source=fs.readFileSync(path.join(root,'src/components/generateFunctionalDecompositionFromGitHub.js'),'utf8');
const names=['idbOpen','idbPut','idbGet','publishArchitectureRun','sourceStorageBudget','throwIfAborted'];
const ast=parser.parse(source,{sourceType:'module',plugins:['jsx']});
const functions=ast.program.body.map(n=>n.type==='ExportNamedDeclaration'?n.declaration:n).filter(n=>n?.type==='FunctionDeclaration'&&names.includes(n.id.name)).map(n=>source.slice(n.start,n.end)).join('\n');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.XHANDLE_CHROME_PATH});
 try {
  const page=await browser.newPage();
  await page.route('**/*',r=>r.fulfill({status:200,contentType:'text/html',body:'<title>Isolated storage fixture</title>'}));
  await page.goto('http://localhost:3000/source-storage-fixture');
  await page.evaluate(code=>{
   const setup=`const IDB_DB_NAME='xhandle', IDB_VERSION=4, IDB_STORES={cba:'copilot_baseline',codeIndex:'code_index',positions:'diagram_positions'};
   const SOURCE_INDEX_BUDGET=20000, ROW_HISTORY_BUDGET=10000;
   const serializedBytes=value=>new TextEncoder().encode(JSON.stringify(value)).length;
   function assertStorageBudget(bytes,limit,label){if(bytes>limit)throw new Error('storage budget exceeded: '+label);}
   const notifyBackupDataChanged=()=>{};`;
   window.fixture=new Function(setup+code+';return {idbPut,idbGet,publishArchitectureRun,sourceStorageBudget};')();
  },functions);
  const result=await page.evaluate(async()=>{
   const f=window.fixture,key='cba:fixture:repo',checkpoint='checkpoint:fixture';
   const rows=[{traceId:'keep',fromDetails:'manual edit',reviewStatus:'approved'}];
   const run={fingerprint:'a',version:1};
   await f.idbPut('copilot_baseline',checkpoint,{rows:['partial']});
   await f.publishArchitectureRun(key,rows,run,checkpoint,[]);
   const dump=()=>new Promise(resolve=>{const req=indexedDB.open('xhandle',4);req.onsuccess=()=>{const db=req.result,tx=db.transaction('copilot_baseline','readonly'),get=tx.objectStore('copilot_baseline').getAll();get.onsuccess=()=>resolve(get.result);tx.oncomplete=()=>db.close();};});
   const before=JSON.stringify(await dump()).length;
   for(let i=0;i<5;i++) await f.publishArchitectureRun(key,rows,run,checkpoint,rows);
   const after=JSON.stringify(await dump()).length;
   const next=[{traceId:'new'},{...rows[0],lineage:{status:'historical'}}];
   await f.publishArchitectureRun(key,next,{fingerprint:'b',version:1},checkpoint,rows);
   const history=await f.idbGet('copilot_baseline',`${key}:history:a`);
   let capacity=false,cancel=false,conflict=false,quota=false;
   try {await f.publishArchitectureRun(key,[{text:'x'.repeat(30000)}],{fingerprint:'c'},checkpoint,next);}catch(e){capacity=/budget/.test(e.message);}
   const abort=new AbortController();abort.abort();try{await f.publishArchitectureRun(key,[],{fingerprint:'c'},checkpoint,next,abort.signal);}catch{cancel=true;}
   try{await f.publishArchitectureRun(key,[],{fingerprint:'c'},checkpoint,[]);}catch(e){conflict=/edited/.test(e.message);}
   const original=IDBObjectStore.prototype.put;
   IDBObjectStore.prototype.put=function(value){if(value.key===key)throw new DOMException('Synthetic quota failure','QuotaExceededError');return original.call(this,value);};
   try{await f.publishArchitectureRun(key,[],{fingerprint:'c'},checkpoint,next);}catch(e){quota=e.name==='QuotaExceededError';}finally{IDBObjectStore.prototype.put=original;}
   const retained=await f.idbGet('copilot_baseline',key),latestRun=await f.idbGet('copilot_baseline',`${key}:run`);
   const budget=await f.sourceStorageBudget();budget('same',{content:'x'.repeat(9000)});budget('same',{content:'x'.repeat(9000)});
   let indexCapacity=false;try{budget('different',{content:'y'.repeat(12000)});}catch{indexCapacity=true;}
   return {before,after,capacity,cancel,conflict,quota,indexCapacity,history,retained,latestRun};
  });
  assert.equal(result.before,result.after);for(const flag of ['capacity','cancel','conflict','quota','indexCapacity'])assert.equal(result[flag],true,flag);
  assert.equal(result.history[0].fromDetails,'manual edit');assert.equal(result.retained[0].traceId,'new');assert.equal(result.latestRun.fingerprint,'b');
  console.log(JSON.stringify(result));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
