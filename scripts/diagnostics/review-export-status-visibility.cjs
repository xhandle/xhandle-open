// Render the actual export modal JSX with synthetic state and production CSS.
// Does not load the app, contact a server, or read user browser/project storage.
const fs=require('node:fs');
const assert=require('node:assert/strict');
const path=require('node:path');
const React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const babel=require('@babel/core');
const engines=require(process.env.XHANDLE_PLAYWRIGHT_PATH || 'playwright-core');
const app=fs.readFileSync('src/App.js','utf8');
const start=app.indexOf('        {showCodeArchitectureProjectExport && (');
const end=app.indexOf('        {showNewCodeArchitectureProject && (',start);
const section=app.slice(start,end);
const jsx=section.slice(section.indexOf('<div'),section.lastIndexOf('        )}')).trim();
const compiled=babel.transformSync(`const Modal = () => (${jsx});`,{babelrc:false,configFile:false,presets:[require.resolve('@babel/preset-react')]}).code;
const css=fs.readdirSync('build/static/css').filter(n=>n.endsWith('.css')).map(n=>fs.readFileSync(path.join('build/static/css',n),'utf8')).join('\n');
const rows=Array.from({length:20},(_,i)=>({id:String(i),name:`Project ${i}`,repoCount:1,rowCount:4792,activeRepoName:'autoware-core-main'}));
function markup(state){
 const ready=state==='ready';
 const factory=new Function('React','codeArchitectureDashboardRows','codeArchitectureProjectExportSelection','codeArchitectureProjectExportMsg','isExportingCodeArchitectureProject','codeArchitectureArchiveDownload','exportSelectedCodeArchitectureProject',`${compiled};return Modal;`);
 const Modal=factory(React,rows,'0',ready?'100% — archive ready. Save the project file.':state==='error'?'Storage connection timed out. Close other xHandle tabs and retry the export.':'Exporting saved project data (16%) — 250.0 MB prepared…',state==='exporting',ready?{url:'blob:synthetic',name:'project.xhproject'}:null,()=>{});
 return renderToStaticMarkup(React.createElement(Modal));
}
(async()=>{
 for(const engine of ['chromium','webkit']){
 const browser=await engines[engine].launch({headless:true,...(engine==='chromium'?{executablePath:process.env.XHANDLE_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}:{})});
 try{
 const page=await browser.newPage();
 for(const viewport of [{width:1280,height:800},{width:1024,height:600},{width:800,height:450},{width:390,height:844},{width:390,height:400}]){
 await page.setViewportSize(viewport);
 for(const state of ['exporting','ready','error']){
 await page.setContent(`<style>${css}</style>${markup(state)}`);
 const result=await page.evaluate(()=>{
 const rect=el=>{const r=el.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,fullyVisible:r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth};};
 const list=document.querySelector('.overflow-auto');
 const status=document.querySelector('[role=status]');
 const buttons=[...document.querySelectorAll('button')];
 const download=document.querySelector('a[download]');
 return {panel:rect(document.querySelector('.cba-project-export-panel')),status:rect(status),controls:buttons.map(rect),download:download?rect(download):null,statusInsideList:list.contains(status),listScrollHeight:list.scrollHeight,listClientHeight:list.clientHeight,selectionDisabled:document.querySelector('input').disabled};
 });
 const label=`${engine} ${viewport.width}x${viewport.height} ${state}`;
 assert.equal(result.panel.fullyVisible,true,`${label}: panel outside viewport`);
 assert.ok(result.listClientHeight>0,`${label}: project list collapsed`);
 for(const r of [result.status,...result.controls,...(result.download?[result.download]:[])]) {
   assert.ok(r.top>=result.panel.top && r.bottom<=result.panel.bottom && r.left>=result.panel.left && r.right<=result.panel.right,`${label}: content clipped by panel`);
 }
 assert.equal(result.status.fullyVisible,true,`${label}: status clipped`);
 assert.equal(result.statusInsideList,false,`${label}: status inside list`);
 assert.ok(result.controls.every(r=>r.fullyVisible),`${label}: controls clipped`);
 if(result.download)assert.equal(result.download.fullyVisible,true,`${label}: download clipped`);
 assert.equal(result.selectionDisabled,state==='exporting',`${label}: selection state`);
 await page.locator('.overflow-auto').evaluate(el=>{el.scrollTop=el.scrollHeight;});
 const after=await page.locator('[role=status]').boundingBox();
 assert.equal(after.y,result.status.top,`${label}: status moved when list scrolled`);
 console.log(JSON.stringify({engine,viewport,state,...result}));
 }
 }
 }finally{await browser.close();}
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
