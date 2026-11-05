// Isolated Electron renderer + production modules, deterministic AI, fresh profile.
// No user data or external provider calls. --expose-gc is measurement-only.
const {app,BrowserWindow}=require('electron');
const fs=require('fs'),path=require('path'),os=require('os'),http=require('http');
const base=path.resolve(__dirname,'../..');
const output=process.env.XHANDLE_STRESS_OUTPUT||fs.mkdtempSync(path.join(os.tmpdir(),'xhandle-downstream-memory-'));
fs.mkdirSync(output,{recursive:true});app.setPath('userData',path.join(output,'profile'));
app.commandLine.appendSwitch('js-flags','--expose-gc');
app.commandLine.appendSwitch('enable-precise-memory-info');
app.on('window-all-closed',()=>{});
const counts=(process.env.XHANDLE_STRESS_COUNTS||'5392,8088').split(',').map(Number);
if(counts.some(n=>!Number.isInteger(n)||n<1||n>15000))throw Error('Invalid counts');
const kinds=['system-requirements','subsystem-requirements','design-elements'];
const results=[],failures=[];let win,server,meter,deadline;
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
 const compiler=webpack({mode:'production',devtool:false,entry:path.join(base,'scripts/diagnostics/downstream-memory/entry.jsx'),output:{path:output,filename:'stress.js'},optimization:{minimize:false},
 resolve:{extensions:['.js','.jsx','.json'],modules:[path.join(base,'node_modules')]},plugins,
 module:{rules:[{test:/\.css$/,use:[require.resolve(path.join(base,'node_modules/style-loader')),require.resolve(path.join(base,'node_modules/css-loader'))]},{test:/\.[jt]sx?$/,exclude:/node_modules/,use:{loader:require.resolve(path.join(base,'node_modules/babel-loader')),options:{babelrc:false,configFile:false,presets:[require.resolve(path.join(base,'node_modules/@babel/preset-env')),[require.resolve(path.join(base,'node_modules/@babel/preset-react')),{runtime:'automatic'}]]}}}]}});
 compiler.run((e,s)=>compiler.close(()=>e||s.hasErrors()?reject(e||Error(s.toString({all:false,errors:true}))):resolve()));});
 server=http.createServer((req,res)=>{
 if(req.url==='/stress.js'){res.setHeader('Content-Type','text/javascript');fs.createReadStream(path.join(output,'stress.js')).pipe(res);}
 else{res.setHeader('Content-Type','text/html');res.end('<html><style>body{font-family:sans-serif}#app{height:850px}</style><div id="app"></div><script src="/stress.js"></script></html>');}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 win=new BrowserWindow({show:false,width:1440,height:950,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
 win.webContents.on('render-process-gone',(_e,d)=>{failures.push(d);console.error('CRASH',d);});
 await win.loadURL('http://127.0.0.1:'+server.address().port);
 const baselineHeapMiB=await win.webContents.executeJavaScript('window.retainedHeap()');
 meter=setInterval(()=>fs.appendFileSync(path.join(output,'process-metrics.jsonl'),JSON.stringify({at:Date.now(),processes:app.getAppMetrics()})+'\n'),2000);
 deadline=setTimeout(()=>{console.error('Timed out');app.exit(2);},1200000);
 for(const count of counts)for(const kind of kinds){
  console.log('START',kind,count);
  const result=await win.webContents.executeJavaScript(`window.runCase(${JSON.stringify(kind)},${count})`);
  result.retainedHeapMiB=await win.webContents.executeJavaScript('window.retainedHeap()');
  result.failures=await win.webContents.executeJavaScript('window.failures');
  results.push(result);
  const report={electron:process.versions.electron,sourceRoot:sourceRoot||base,counts,baselineHeapMiB,results,failures};
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(report,null,2));console.log('RESULT',JSON.stringify(result));
  if(result.failures.length||failures.length)throw Error('Runtime failure');
  if(result.retainedHeapMiB>1500)throw Error('Diagnostic safety stop: retained heap exceeds 1.5 GiB');
 }
}).catch(error=>{console.error(error.stack);fs.writeFileSync(path.join(output,'failure.txt'),String(error.stack));process.exitCode=1;}).finally(async()=>{
 clearInterval(meter);clearTimeout(deadline);win?.destroy();if(server)await new Promise(r=>server.close(r));console.log('ARTIFACTS',output);app.quit();
});
