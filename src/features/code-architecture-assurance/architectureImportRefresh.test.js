import { mergeImportedCodeArchitectureRepos } from './architectureImportRefresh';
const fs=require('fs'),parser=require('@babel/parser'),traverse=require('@babel/traverse').default;
const source=fs.readFileSync('src/App.js','utf8');
let importBody;
traverse(parser.parse(source,{sourceType:'module',plugins:['jsx']}),{FunctionDeclaration({node}){
 if(node.id?.name==='importCodeArchitectureProjectFromFile') importBody=source.slice(node.start,node.end);
}});
test('reused repository IDs replace old entries without duplicating or changing unrelated repositories',()=>{
 const untouched={id:'other',name:'Untouched'};
 expect(mergeImportedCodeArchitectureRepos([{id:'same',name:'Old'},untouched],[{id:'same',name:'Updated'}]))
  .toEqual([{id:'same',name:'Updated'},untouched]);
});
function environment() {
 let projects=[{id:'existing',repos:[{id:'old',name:'Old'}],activeRepoId:'old'}];
 const env={
  codeArchitectureImportRef:{current:null},codeArchitectureImportScopeRef:{current:'existing'},
  createCodeArchitectureImportOperation:()=>({check(){},wait:async(label,fn)=>fn()}),
  activeCodeArchitectureProject:projects[0],makeId:()=> 'new-project',
  parseCodeArchitectureCsv:()=>[{from:'New function'}],normalizeImportedCodeArchitectureRows:value=>value,
  saveImportedCodeArchitectureRows:jest.fn(async()=>({id:'imported',name:'Imported'})),
  restoreImportedCodeArchitectureRepoAnalysis:async()=>{},mergeImportedCodeArchitectureRepos,
  setCodeArchitectureProjects:fn=>{projects=fn(projects);},setActiveCodeArchitectureProjectId:jest.fn(),
  setActiveCodeArchitectureFolderId(){},requestCbaReload:jest.fn(),codeArchitectureRowsKey:(p,r)=>`cba:${p}:${r}`,
  setSelectedCbaElement(){},setCodeArchitectureHazardRun(){},setCodeArchitectureWorkspaceTab(){},
  setCodeArchitectureFunctionalTableOpenKey(){},setSection(){},setIsSidebarOpen(){},setIsCodeArchitectureProjectsOpen(){},
  notifyBackupDataChanged(){},setCodeArchitectureImportStatus:jest.fn(),
 };
 return {env,projects:()=>projects,run:new Function(...Object.keys(env),`return (${importBody});`)(...Object.values(env))};
}
test('CSV completion explicitly refreshes its persisted destination',async()=>{
 const {env,run}=environment();
 await run({target:{files:[{name:'functions.csv',text:async()=>''}]}});
 expect(env.requestCbaReload).toHaveBeenCalledWith('cba:existing:imported');
 expect(env.setCodeArchitectureImportStatus).toHaveBeenLastCalledWith(expect.objectContaining({busy:false,message:expect.stringContaining('Imported 1 rows')}));
});
test('unchanged-scope completion still requests a reload and replaces a reused ID',async()=>{
 const {env,run,projects}=environment();
 env.saveImportedCodeArchitectureRows.mockResolvedValue({id:'old',name:'Updated'});
 await run({target:{files:[{name:'functions.csv',text:async()=>''}]}});
 expect(env.requestCbaReload).toHaveBeenCalledWith('cba:existing:old');
 expect(projects()[0].repos).toEqual([{id:'old',name:'Updated'}]);
});
test('JSON project imports preserve their new-project destination policy',async()=>{
 const {env,run,projects}=environment();
 const data={type:'xhandle-code-architecture-project',project:{name:'Imported local project'},repos:[{rows:[{from:'Imported function'}]}]};
 await run({target:{files:[{name:'project.json',text:async()=>JSON.stringify(data)}]}});
 expect(env.saveImportedCodeArchitectureRows).toHaveBeenCalledWith(expect.objectContaining({project:expect.objectContaining({id:'new-project',repos:[]})}));
 expect(env.requestCbaReload).toHaveBeenCalledWith('cba:new-project:imported');
 expect(projects().find(p=>p.id==='existing').repos).toEqual([{id:'old',name:'Old'}]);
});
