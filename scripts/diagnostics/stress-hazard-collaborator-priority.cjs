// Isolated Electron renderer + production modules, deterministic AI, fresh profile.
// No user data or external provider calls. --expose-gc is measurement-only.
const {app,BrowserWindow}=require('electron');
const fs=require('fs'),path=require('path'),os=require('os'),http=require('http');
const base=path.resolve(__dirname,'../..');
const output=process.env.XHANDLE_STRESS_OUTPUT||fs.mkdtempSync(path.join(os.tmpdir(),'xhandle-hazard-priority-'));
fs.mkdirSync(output,{recursive:true});app.setPath('userData',path.join(output,'profile'));
app.commandLine.appendSwitch('js-flags','--expose-gc');
app.commandLine.appendSwitch('enable-precise-memory-info');
app.on('window-all-closed',()=>{});
const failures=[];let win,server,meter,deadline;
app.whenReady().then(async()=>{
 const webpack=require(path.join(base,'node_modules/webpack'));
 const sourceRoot=process.env.XHANDLE_STRESS_SOURCE_ROOT;
 const plugins=[new webpack.DefinePlugin({'process.env':JSON.stringify({NODE_ENV:'production',REACT_APP_BACKEND_URL:'http://127.0.0.1:9'})})];
 if(sourceRoot)plugins.push(new webpack.NormalModuleReplacementPlugin(/./,resource=>{
   if(resource.request.startsWith('.')&&resource.context){
    const target=path.resolve(resource.context,resource.request);
    const original=path.join(base,'src');
    if(target.startsWith(original+path.sep))resource.request=path.join(sourceRoot,'src',path.relative(original,target));
   }
 }));
 await new Promise((resolve,reject)=>{
 const compiler=webpack({mode:'production',devtool:false,entry:path.join(base,'scripts/diagnostics/hazard-collaborator-priority/entry.js'),output:{path:output,filename:'stress.js'},optimization:{minimize:false},
 resolve:{extensions:['.ts','.js','.jsx','.json'],modules:[path.join(base,'node_modules')]},plugins,
 module:{rules:[{test:/\.css$/,use:[require.resolve(path.join(base,'node_modules/style-loader')),require.resolve(path.join(base,'node_modules/css-loader'))]},{test:/\.[jt]sx?$/,exclude:/node_modules/,use:{loader:require.resolve(path.join(base,'node_modules/babel-loader')),options:{babelrc:false,configFile:false,presets:[require.resolve(path.join(base,'node_modules/@babel/preset-env')),require.resolve(path.join(base,'node_modules/@babel/preset-typescript')),[require.resolve(path.join(base,'node_modules/@babel/preset-react')),{runtime:'automatic'}]]}}}]}});
 compiler.run((e,s)=>compiler.close(()=>e||s.hasErrors()?reject(e||Error(s.toString({all:false,errors:true}))):resolve()));});
 server=http.createServer((req,res)=>{
 const script=path.join(output,path.basename(req.url));
 if(req.url.endsWith('.js')&&fs.existsSync(script)){res.setHeader('Content-Type','text/javascript');fs.createReadStream(script).pipe(res);}
 else{res.setHeader('Content-Type','text/html');res.end('<html><style>body{font-family:sans-serif}#app{height:850px}</style><div id="app"></div><script src="/stress.js"></script></html>');}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 win=new BrowserWindow({show:false,width:1440,height:950,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
 win.webContents.on('render-process-gone',(_e,d)=>{failures.push(d);console.error('CRASH',d);});
 await win.loadURL('http://127.0.0.1:'+server.address().port);
 const fixture=await win.webContents.executeJavaScript('window.seed()');
 console.log('SEEDED',JSON.stringify(fixture));
 const baselineHeapMiB=await win.webContents.executeJavaScript('window.retained()');
 let peakWorkingSetMiB=0;
 meter=setInterval(()=>{for(const p of app.getAppMetrics())if(p.type==='Tab')peakWorkingSetMiB=Math.max(peakWorkingSetMiB,p.memory.workingSetSize/1024);},200);
 deadline=setTimeout(()=>{console.error('Timed out');app.exit(2);},300000);
 const result=await win.webContents.executeJavaScript('window.run()');
 result.retainedHeapMiB=await win.webContents.executeJavaScript('window.retained()');
 const report={electron:process.versions.electron,fixture,baselineHeapMiB,peakWorkingSetMiB,...result,crashes:failures};
 fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 if(result.failures.length||failures.length)throw Error('Runtime failure');

}).catch(error=>{console.error(error.stack);fs.writeFileSync(path.join(output,'failure.txt'),String(error.stack));process.exitCode=1;}).finally(async()=>{
 clearInterval(meter);clearTimeout(deadline);win?.destroy();if(server)await new Promise(r=>server.close(r));console.log('ARTIFACTS',output);app.quit();
});
