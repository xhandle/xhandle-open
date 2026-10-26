// Real-runtime compressed export/download/import in a disposable profile.
// Never opens the user's localhost origin or installed Desktop profile.
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const assert=require('node:assert/strict'),express=require('express'),webpack=require('webpack');
const {createProjectTransferRouter}=require('../../server/projectTransferFiles.cjs');
(async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'xhandle-transfer-check-'));
  const router=createProjectTransferRouter({directory});let server,browser,electron;
  try {
    await new Promise((resolve,reject)=>{
      const compiler=webpack({mode:'development',plugins:[new webpack.DefinePlugin({'process.env':JSON.stringify({})})],entry:path.resolve('scripts/diagnostics/project-transfer.browser.js'),output:{path:directory,filename:'bundle.js'},resolve:{modules:[path.resolve('node_modules'),'node_modules']}});
      compiler.run((error,stats)=>compiler.close(()=>error || stats.hasErrors()?reject(error || Error(stats.toString({all:false,errors:true}))):resolve()));
    });
    const app=express();app.use('/api/project-transfer-files',router);app.use(express.static(directory));app.get('/',(req,res)=>res.send('<script src="/bundle.js"></script>'));
    server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
    const origin=`http://127.0.0.1:${server.address().port}`;
    const playwright=require(process.env.PLAYWRIGHT_MODULE || '/tmp/xhandle-browser-check/node_modules/playwright-core');
    const kind=process.env.CHECK_BROWSER || 'webkit';let page;
    if(kind==='electron'){
      const main=path.join(directory,'main.cjs');
      await fs.writeFile(main,`const {app,BrowserWindow,protocol,net}=require('electron');app.setPath('userData',${JSON.stringify(path.join(directory,'profile'))});protocol.registerSchemesAsPrivileged([{scheme:'xhandle',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true,stream:true}}]);app.whenReady().then(async()=>{protocol.handle('xhandle',async request=>{const url=new URL(request.url);return net.fetch(${JSON.stringify(origin)}+url.pathname+url.search,{method:request.method,headers:request.headers,...(!['GET','HEAD'].includes(request.method)?{body:await request.arrayBuffer()}:{})});});const window=new BrowserWindow({show:false,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});await window.loadURL('xhandle://app/');});`);
      const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
      electron=await playwright._electron.launch({env,executablePath:process.env.ELECTRON_EXECUTABLE || path.resolve('../xhandle-desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),args:[main]});page=await electron.firstWindow();
    }else{
      browser=await playwright[kind].launch(kind==='chromium'?{executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true}:{headless:true});
      page=await browser.newPage({acceptDownloads:true});await page.goto(origin);
    }
    page.setDefaultTimeout(120000);page.on('pageerror',error=>console.error('pageerror:',error.message));
    await page.waitForFunction(()=>typeof window.prepare==='function');
    const stress=process.env.CHECK_STRESS==='1'?await page.evaluate(()=>window.stressEncoder()):undefined;
    const exported=await page.evaluate(()=>window.prepare());
    const saved=path.join(directory,'saved.xhproject');
    if(electron){
      await electron.evaluate(({session},destination)=>{
        global.transferDownload=new Promise((resolve,reject)=>{
          session.defaultSession.once('will-download',(_event,item)=>{
            item.setSavePath(destination);
            item.once('done',(_event,state)=>state==='completed'?resolve():reject(Error(`Download ${state}`)));
          });
        });
      },saved);
      await page.click('#save');await electron.evaluate(()=>global.transferDownload);
    }else{
      const [download]=await Promise.all([page.waitForEvent('download'),page.click('#save')]);await download.saveAs(saved);
    }
    const bytes=await fs.readFile(saved);assert.equal(bytes[0],0x1f);assert.equal(bytes[1],0x8b);assert.equal(bytes.length,exported.bytes);
    await page.locator('#restore').setInputFiles(saved);
    const restored=await page.evaluate(()=>window.restore());
    console.log(JSON.stringify({runtime:kind,stress,exported,restored}));
  }finally{
    await electron?.close();await browser?.close();
    if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
    await router.dispose();await fs.rm(directory,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
