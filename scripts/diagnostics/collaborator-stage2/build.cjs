const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'../../..'),dir=process.env.XHANDLE_AUDIT_OUTPUT;
if(!dir)throw Error('Use run.cjs to build a disposable fixture.');
fs.writeFileSync(dir+'/entry.js',fs.readFileSync(process.env.XHANDLE_AUDIT_TEMPLATE||__dirname+'/entry.template.js','utf8').replaceAll('__REPO__',root));
fs.copyFileSync(__dirname+'/chrome.cjs',dir+'/chrome.cjs');
fs.copyFileSync(__dirname+'/electron.cjs',dir+'/main.cjs');
fs.writeFileSync(dir+'/index.html','<!doctype html><meta charset="UTF-8"><title>Disposable Collaborator audit</title><script src="bundle.js"></script>');
const parser=require(root+'/node_modules/@babel/parser');
const text=fs.readFileSync(root+'/src/components/XHandleCopilotView.jsx','utf8');
const ast=parser.parse(text,{sourceType:'module',plugins:['jsx']});
const names=new Set(['truncateText','boundedJson','compactPromptArtifact','isHazardAnalysisQuestion','renderCopilotContext','buildScopedContext']);
const chunks=[];
for(const stmt of ast.program.body){const n=stmt.declaration||stmt;if(n.type==='FunctionDeclaration'&&names.has(n.id.name))chunks.push(text.slice(n.start,n.end));if(n.type==='VariableDeclaration'&&n.declarations.some(d=>d.id.name==='SCOPE_ARTIFACT_TYPES'))chunks.push(text.slice(n.start,n.end));}
fs.writeFileSync(dir+'/extracted.js','import { SCOPE_ARTIFACT_TYPES } from '+JSON.stringify(root+'/src/features/workspace-graph/workspaceGraphCapabilities.ts')+';\nimport { fitWorkspacePromptSample } from '+JSON.stringify(root+'/src/features/workspace-graph/workspacePromptBudget.js')+';\n'+chunks.join('\n')+'\nexport {renderCopilotContext,buildScopedContext};');
fs.writeFileSync(dir+'/ts-loader.cjs',`const ts=require('${root}/node_modules/typescript');module.exports=function(source){return ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;};`);
const webpack=require(root+'/node_modules/webpack');
const compiler=webpack({mode:'development',entry:dir+'/entry.js',output:{path:dir,filename:'bundle.js'},devtool:false,resolve:{extensions:['.ts','.js','.json'],modules:[root+'/node_modules']},module:{rules:[{test:/\.ts$/,exclude:/node_modules/,use:[dir+'/ts-loader.cjs']}]}});
compiler.run((error,stats)=>{compiler.close(()=>{});if(error||stats.hasErrors()){console.error(error||stats.toString({all:false,errors:true}));process.exitCode=1;}else console.log('AUDIT_BUNDLE_OK');});
