const test = require('node:test'), assert = require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm');
const {parse}=require('@babel/parser'), traverse=require('@babel/traverse').default;
const source=fs.readFileSync('src/App.js','utf8'), functions=[];
traverse(parse(source,{sourceType:'module',plugins:['jsx']}),{FunctionDeclaration({node}){
 if(['saveCodeArchitectureRepoConfig','awaitCodeArchitectureFileTypes','awaitCodeArchitectureAnalysisMode'].includes(node.id?.name)) functions.push(source.slice(node.start,node.end));
}});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture({hasAnalysis=true}={}) {
 const calls={saved:[],analyses:[],messages:[],modes:[]}, draft={analysisContextText:'fixture',analysisContextFiles:[]};
 const context={Promise,Object,Boolean,Error, codeArchitectureRepoDraft:draft, codeArchitectureRepoConfigProjectId:'p',activeCodeArchitectureProjectId:'p',
  codeArchitectureProjects:[{id:'p',repos:[{id:'existing',owner:'fixture',repo:'mixed'}]}],codeArchitectureConfigWorkflowRef:{current:null},
  repoContextDraftRef:{current:{draft,open:true,project:'p',repo:'existing',section:'code-architecture',activeProject:'p'}},
  codeArchitectureFileSelectorResolver:{current:null},codeArchitectureAnalysisModeResolver:{current:null},
  verifyCodeArchitectureRepo:async()=>({repoConfig:{id:'new-id',owner:'fixture',repo:'mixed'},repoFiles:[{path:'ui.js'}]}),
  setIsCodeArchitectureRepoAnalyzing:()=>{},setCodeArchitectureFileSelectorOpen:()=>{},setCodeArchitectureRepoFilesForModal:()=>{},
  setCodeArchitectureAnalysisModeSelection:selection=>calls.modes.push(selection),setCodeArchitectureRepoConfigMessage:message=>calls.messages.push(message),
  setActiveCodeArchitectureProjectId:()=>{},setActiveCodeArchitectureFolderId:()=>{},setShowCodeArchitectureRepoConfig:()=>{},
  codeArchitectureReposMatch:(a,b)=>a.owner===b.owner&&a.repo===b.repo, codeArchitectureRowsKey:(p,r)=>`cba:${p}:${r}`,
  readPublishedArchitectureState:async scope=>{assert.equal(scope,'cba:p:existing');return {hasAnalysis,identity:'revision',metadata:{}};},flushArchitectureWrites:async()=>{},
  assertArchitectureAppendDestination:()=>{},upsertCodeArchitectureRepo:(...args)=>calls.saved.push(args),handleBaselineRepo:async args=>calls.analyses.push(args),
 };
 vm.createContext(context);
 vm.runInContext(fs.readFileSync('src/features/code-architecture-context/repositoryContextRequest.js','utf8').replaceAll('export function','function'),context);
 for(const fn of functions)vm.runInContext(fn,context);
 return {context,calls};
}
for(const mode of ['replace','append'])test(`configuration launches explicit ${mode} only after selection and confirmation`,async()=>{
 const {context,calls}=fixture(),pending=context.saveCodeArchitectureRepoConfig({analyze:true});await tick();
 assert.equal(calls.saved.length,0);context.codeArchitectureFileSelectorResolver.current(['.js']);await tick();
 assert.equal(calls.analyses.length,0);assert.equal(calls.modes.length,1);
 context.codeArchitectureAnalysisModeResolver.current(mode);await pending;
 assert.equal(calls.analyses[0].analysisMode,mode);assert.equal(calls.analyses[0].repoConfig.id,'existing');assert.equal(calls.analyses[0].expectedBaseIdentity,'revision');
});
test('first analysis bypasses the mode dialog',async()=>{
 const {context,calls}=fixture({hasAnalysis:false}),pending=context.saveCodeArchitectureRepoConfig({analyze:true});await tick();
 context.codeArchitectureFileSelectorResolver.current(['.c']);await pending;
 assert.equal(calls.modes.length,0);assert.equal(calls.analyses.length,1);
});
test('Cancel and duplicate clicks cannot save or launch',async()=>{
 const {context,calls}=fixture(),pending=context.saveCodeArchitectureRepoConfig({analyze:true});await tick();
 await context.saveCodeArchitectureRepoConfig({analyze:true});context.codeArchitectureFileSelectorResolver.current(['.js']);await tick();
 context.codeArchitectureAnalysisModeResolver.current(null);await pending;
 assert.equal(calls.saved.length,0);assert.equal(calls.analyses.length,0);
});
for(const step of ['files','mode'])test(`navigation or a draft edit at ${step} cannot launch stale analysis`,async()=>{
 const {context,calls}=fixture(),pending=context.saveCodeArchitectureRepoConfig({analyze:true});await tick();
 if(step==='mode'){context.codeArchitectureFileSelectorResolver.current(['.js']);await tick();}
 context.repoContextDraftRef.current={...context.repoContextDraftRef.current,draft:{...context.codeArchitectureRepoDraft},activeProject:'other'};
 if(step==='files')context.codeArchitectureFileSelectorResolver.current(['.js']);else context.codeArchitectureAnalysisModeResolver.current('append');
 await pending;assert.equal(calls.saved.length,0);assert.equal(calls.analyses.length,0);
});
test('publication changes while the mode dialog is open require a fresh decision',async()=>{
 const {context,calls}=fixture(),pending=context.saveCodeArchitectureRepoConfig({analyze:true});await tick();
 context.codeArchitectureFileSelectorResolver.current(['.js']);await tick();
 context.readPublishedArchitectureState=async()=>({hasAnalysis:true,identity:'other'});
 context.codeArchitectureAnalysisModeResolver.current('replace');await pending;
 assert.equal(calls.saved.length,0);assert.equal(calls.analyses.length,0);assert.match(calls.messages.at(-1),/saved analysis changed/);
});
