// Opens only a disposable copy of desktop Local Storage; never the live profile.
const {app, BrowserWindow, protocol, session} = require('electron');
const directory = process.argv[2];
app.setName('xHandle quality settings reader');
app.setPath('userData',directory);
protocol.registerSchemesAsPrivileged([{scheme:'xhandle',privileges:{standard:true,secure:true}}]);
app.whenReady().then(async()=>{
  session.defaultSession.webRequest.onBeforeRequest((details, callback)=>callback({cancel:!details.url.startsWith('xhandle:')}));
  protocol.handle('xhandle',()=>new Response('<!doctype html><title>Settings reader</title>',{headers:{'content-type':'text/html'}}));
  const window = new BrowserWindow({show:false,webPreferences:{nodeIntegration:false,contextIsolation:true}});
  await window.loadURL('xhandle://app/');
  const settings = await window.webContents.executeJavaScript(`(() => {
    const active = localStorage.getItem('xhandle.aiProvider.active') || 'openai';
    const provider = active === 'claude' ? 'anthropic' : active;
    const get = key => localStorage.getItem(key);
    const rows = JSON.parse(get('xhandle.localAIProviderSettings') || '[]');
    const maps = JSON.parse(get('xhandle.aiProvider.keys') || '{}');
    const row = rows.find(value => [provider,provider === 'anthropic' ? 'claude' : provider].includes(value.provider));
    const mapped = maps[provider] || maps[provider === 'anthropic' ? 'claude' : provider];
    return {provider,model:get('xhandle.aiProviderModel.'+provider) || get('xhandle.aiProvider.activeModel'),
      effort:get('xhandle.aiProviderEffort.'+provider) || 'medium',
      apiKey:row?.apiKey || mapped?.apiKey || (typeof mapped === 'string' ? mapped : ''),
      organizationProfile:get('xhandle.organizationProfile')};
  })()`);
  // Private IPC pipe, consumed by the parent; no output is forwarded to logs.
  process.stdout.write('XHANDLE_PRIVATE_SETTINGS '+JSON.stringify(settings)+'\n');
  window.destroy(); app.quit();
}).catch(()=>{process.stderr.write('Could not read copied xhandle settings.\n');app.exit(1);});
