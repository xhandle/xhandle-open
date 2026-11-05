const {app,BrowserWindow}=require('electron');
const fs=require('fs'),path=require('path');
app.setPath('userData',path.join(__dirname,'profile-final'));
app.commandLine.appendSwitch('enable-precise-memory-info');
let win;const timeout=setTimeout(()=>{console.error('AUDIT_TIMEOUT');app.exit(1);},180000);
app.whenReady().then(async()=>{
 win=new BrowserWindow({show:false,webPreferences:{backgroundThrottling:false}});
 win.webContents.session.webRequest.onBeforeRequest((details,callback)=>callback({cancel:!details.url.startsWith('file:')}));
 win.webContents.on('render-process-gone',(_,d)=>{console.error('RENDERER_EXIT',d);app.exit(1);});
 await win.loadFile(path.join(__dirname,'index.html'));
 const result=await win.webContents.executeJavaScript('window.audit()');
 fs.writeFileSync(path.join(__dirname,'results.json'),JSON.stringify(result,null,2));
 console.log('COLLABORATOR_AUDIT_OK');
}).catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{clearTimeout(timeout);win?.destroy();app.quit();});
