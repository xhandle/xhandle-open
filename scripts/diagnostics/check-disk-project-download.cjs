// Isolated real-browser download test; never opens the user's workspace or databases.
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
const express=require('express');
const webpack=require('webpack');
const {createProjectTransferRouter}=require('../../server/projectTransferFiles.cjs');
(async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'xhandle-download-check-'));
 const router=createProjectTransferRouter({directory});let server,browser;
 try {
  const entry=path.join(directory,'entry.js');
  await fs.writeFile(entry,`import {checkStorage} from ${JSON.stringify(path.resolve('scripts/diagnostics/disk-project-storage.browser.js'))};window.checkStorage=checkStorage;import {createDiskArchiveSink} from ${JSON.stringify(path.resolve('src/features/code-architecture-transfer/diskArchiveSink.js'))};window.prepare=async()=>{const sink=await createDiskArchiveSink('browser-check',{baseURL:location.origin});for(let i=0;i<200;i++)await sink.write('x'.repeat(32768)+'\\n');const result=await sink.finish();window.result=result;const a=document.createElement('a');a.id='save';a.href=result.url;a.download=result.name;a.textContent='Save';document.body.append(a);};`);
  await new Promise((resolve,reject)=>{const compiler=webpack({mode:'development',plugins:[new webpack.DefinePlugin({'process.env':JSON.stringify({})})],entry,output:{path:directory,filename:'bundle.js'},resolve:{modules:[path.resolve('node_modules'),'node_modules']}});compiler.run((error,stats)=>compiler.close(()=>error || stats.hasErrors()?reject(error || Error(stats.toString({all:false,errors:true}))):resolve()));});
  const app=express();app.use('/api/project-transfer-files',router);app.use(express.static(directory));app.get('/',(req,res)=>res.send('<script src="/bundle.js"></script>'));
  server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const playwright=require(process.env.PLAYWRIGHT_MODULE || '/tmp/xhandle-browser-check/node_modules/playwright-core');
  const kind=process.env.CHECK_BROWSER || 'webkit';browser=await playwright[kind].launch(kind==='chromium'?{executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true}:{headless:true});
  const page=await browser.newPage({acceptDownloads:true});page.on('pageerror',e=>console.error('browser:',e));await page.goto(`http://127.0.0.1:${server.address().port}`);await page.evaluate(()=>window.prepare());
  const [download]=await Promise.all([page.waitForEvent('download'),page.click('#save')]);
  const saved=await download.path(),data=await fs.readFile(saved);assert.equal(data.length,200*32769);assert.equal(download.suggestedFilename(),'browser-check.xhproject');assert.equal(data.toString(),('x'.repeat(32768)+'\n').repeat(200));await page.evaluate(()=>window.result.dispose());
  const storage=await page.evaluate(()=>window.checkStorage());
  console.log(`${kind}: streamed 6.25 MiB, downloaded exact file, cleanup passed; storage ${JSON.stringify(storage)}`);
 }finally{await browser?.close();if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}await router.dispose();await fs.rm(directory,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
