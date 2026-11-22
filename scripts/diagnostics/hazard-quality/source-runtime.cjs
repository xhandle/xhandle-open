const fs = require('node:fs'), path = require('node:path');
const {pathToFileURL} = require('node:url');
const babel = require('@babel/core');

class MemoryStorage {
  getItem(key) {return Object.hasOwn(this,key)?this[key]:null;}
  setItem(key,value) {this[key]=String(value);}
  removeItem(key) {delete this[key];}
  clear() {Object.keys(this).forEach(key=>delete this[key]);}
  key(index) {return Object.keys(this)[index] || null;}
  get length() {return Object.keys(this).length;}
}
function installSourceRuntime(root,settings,backend) {
  const old = require.extensions['.js'];
  const loader = (module,filename)=>{
    if (!filename.startsWith(path.join(root,'src')+path.sep)) return old(module,filename);
    const source = fs.readFileSync(filename,'utf8').replace(/import\.meta\.url/g,JSON.stringify(pathToFileURL(filename).href));
    const result = babel.transformSync(source,{filename,babelrc:false,configFile:false,presets:[
      [require.resolve('@babel/preset-env'),{targets:{node:'current'},modules:'commonjs'}],
      require.resolve('@babel/preset-typescript'),require.resolve('@babel/preset-react')]});
    module._compile(result.code,filename);
  };
  for (const extension of ['.js','.jsx','.ts','.tsx']) require.extensions[extension]=loader;
  require('fake-indexeddb/auto');
  global.localStorage = new MemoryStorage(); global.sessionStorage = new MemoryStorage();
  global.window = new EventTarget();
  window.localStorage=localStorage; window.sessionStorage=sessionStorage;
  window.location=new URL(backend); window.__BACKEND_URL=backend;
  localStorage.setItem('xhandle.aiProvider.active',settings.provider);
  localStorage.setItem(`xhandle.aiProviderModel.${settings.provider}`,settings.model);
  localStorage.setItem(`xhandle.aiProviderEffort.${settings.provider}`,settings.effort || 'medium');
  localStorage.setItem('xhandle.localAIProviderSettings',JSON.stringify([{provider:settings.provider,apiKey:settings.apiKey,is_active:true}]));
  return filename=>require(path.join(root,filename));
}
module.exports={installSourceRuntime};
