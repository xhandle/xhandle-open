const fs=require('fs'),path=require('path'),{spawn}=require('child_process');
const server=require('http').createServer((request,response)=>{const file=path.join(__dirname,new URL(request.url,'http://localhost').pathname);if(!file.startsWith(__dirname+path.sep)){response.writeHead(403);response.end();return;}fs.readFile(file,(error,data)=>{response.writeHead(error?404:200,{'Content-Type':file.endsWith('.js')?'text/javascript':'text/html'});response.end(error?'Not found':data);});});
const profile=path.join(__dirname,'chrome-profile-final');fs.mkdirSync(profile,{recursive:true});
const chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-background-networking','--disable-component-update','--no-first-run','--no-default-browser-check','--enable-precise-memory-info','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:'ignore'});
const timer=setTimeout(()=>{chrome.kill();process.exit(1);},180000);let ws;
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const fixtureURL='http://127.0.0.1:'+server.address().port+'/';
 let port;for(let i=0;i<150;i++){try{port=Number(fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]);break;}catch{}await new Promise(r=>setTimeout(r,100));}if(!port)throw Error('No Chrome debugging port');
 const target=await (await fetch('http://127.0.0.1:'+port+'/json/new?about:blank',{method:'PUT'})).json();
 ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
 let next=0;const pending=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.method==='Fetch.requestPaused'){void call(m.params.request.url.startsWith(fixtureURL)?'Fetch.continueRequest':'Fetch.failRequest',{requestId:m.params.requestId,...(m.params.request.url.startsWith(fixtureURL)?{}:{errorReason:'BlockedByClient'})});return;}if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p?.reject(Error(JSON.stringify(m.error))):p?.resolve(m.result);}};
 const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
 await call('Network.enable');await call('Fetch.enable',{patterns:[{urlPattern:'*'}]});await call('Page.enable');await call('Runtime.enable');
 await call('Page.navigate',{url:fixtureURL+'index.html'});
 for(let i=0;i<100;i++){const v=await call('Runtime.evaluate',{expression:'typeof window.audit'});if(v.result.value==='function')break;await new Promise(r=>setTimeout(r,50));}
 const result=await call('Runtime.evaluate',{expression:'window.audit()',awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));
 fs.writeFileSync(path.join(__dirname,'chrome-results.json'),JSON.stringify(result.result.value,null,2));console.log('CHROME_COLLABORATOR_AUDIT_OK');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{clearTimeout(timer);ws?.close();chrome.kill();server.close();});
