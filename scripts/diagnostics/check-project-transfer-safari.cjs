// Installed Safari, isolated WebDriver window and random loopback origin.
// Does not navigate to or read the user's xHandle workspace.
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');
const assert=require('node:assert/strict'),express=require('express'),webpack=require('webpack');
const {createProjectTransferRouter}=require('../../server/projectTransferFiles.cjs');
(async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'xhandle-safari-check-'));
 const router=createProjectTransferRouter({directory});let server,driver,session,endpoint;
 const command=async(method,route,body)=>{
  const response=await fetch(endpoint+route,{method,headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(180000)});
  const result=await response.json();if(!response.ok||result.value?.error)throw Error(JSON.stringify(result.value));return result.value;
 };
 const evaluate=async source=>{
  const result=await command('POST',`/session/${session}/execute/async`,{script:`const done=arguments[arguments.length-1];Promise.resolve().then(()=>(${source})).then(value=>done({ok:true,value}),error=>done({ok:false,error:String(error.stack||error)}));`,args:[]});
  if(!result.ok)throw Error(result.error);return result.value;
 };
 try{
  await new Promise((resolve,reject)=>{
   const compiler=webpack({mode:'development',plugins:[new webpack.DefinePlugin({'process.env':JSON.stringify({})})],entry:path.resolve('scripts/diagnostics/project-transfer.browser.js'),output:{path:directory,filename:'bundle.js'},resolve:{modules:[path.resolve('node_modules'),'node_modules']}});
   compiler.run((error,stats)=>compiler.close(()=>error||stats.hasErrors()?reject(error||Error(stats.toString({all:false,errors:true}))):resolve()));
  });
  const app=express();app.use('/api/project-transfer-files',router);app.use(express.static(directory));app.get('/',(req,res)=>res.send('<title>xHandle isolated Safari transfer test</title><p>Testing synthetic data only.</p><script src="/bundle.js"></script>'));
  server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const origin=`http://127.0.0.1:${server.address().port}`;
  const net=require('node:net');const port=await new Promise(resolve=>{const s=net.createServer().listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
  endpoint=`http://127.0.0.1:${port}`;driver=spawn('/usr/bin/safaridriver',['-p',String(port)],{stdio:'ignore'});
  for(let attempt=0;attempt<50;attempt++){try{await command('GET','/status');break;}catch(error){if(attempt===49)throw error;await new Promise(resolve=>setTimeout(resolve,100));}}
  const created=await command('POST','/session',{capabilities:{alwaysMatch:{browserName:'safari'}}});session=created.sessionId;
  console.log(JSON.stringify({stage:'Safari session started',version:created.capabilities.browserVersion}));
  await command('POST',`/session/${session}/timeouts`,{script:150000,pageLoad:60000});
  await command('POST',`/session/${session}/url`,{url:origin});
  const stress=await evaluate('window.stressEncoder()');console.log(JSON.stringify({stage:'encoder stress passed',stress}));
  const exported=await evaluate('window.prepare()');console.log(JSON.stringify({stage:'export completed',exported}));
  // Fetch the disk-backed output into the test runner, then use Safari's native
  // file input for import. No full-file Blob is created in the renderer.
  const url=await evaluate('window.downloadResult.url');assert.equal(new URL(url).origin,origin);
  const response=await fetch(url);assert.equal(response.status,200);const bytes=Buffer.from(await response.arrayBuffer());
  assert.equal(bytes[0],0x1f);assert.equal(bytes[1],0x8b);assert.equal(bytes.length,exported.bytes);
  const saved=path.join(directory,'saved.xhproject');await fs.writeFile(saved,bytes);
  const element=await command('POST',`/session/${session}/element`,{using:'css selector',value:'#restore'});
  const elementId=element['element-6066-11e4-a52e-4f735466cecf'];
  await command('POST',`/session/${session}/element/${elementId}/value`,{text:saved});
  const restored=await evaluate('window.restore()');
  console.log(JSON.stringify({runtime:'installed-safari',version:created.capabilities.browserVersion,stress,exported,restored,download:'HTTP attachment retrieved by test runner; Safari download UI not exercised'}));
 }finally{
  if(session)await command('DELETE',`/session/${session}`).catch(()=>{});
  driver?.kill();
  if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  await router.dispose();await fs.rm(directory,{recursive:true,force:true});
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
