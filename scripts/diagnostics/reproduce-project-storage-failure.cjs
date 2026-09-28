// Read-only reproduction: evaluates current functions against fake storage.
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const source = fs.readFileSync('src/App.js','utf8');
const safe = fs.readFileSync('src/lib/safeStorage.js','utf8').replace(/export /g,'');
const wrapper = source.slice(source.indexOf('  localStorage.setItem = function (k, v) {'),source.indexOf('  localStorage.removeItem = function (k) {'));
const project = source.slice(source.indexOf('let projectMapReadFailed = false;'),source.indexOf('function getProjectOrganizationCalibration'));
const context = { console: {warn(){},error(){}}, result:null };
vm.createContext(context);
vm.runInContext(`${safe}
const PROJECT_DATA_KEY='xhandle.projectData';
const saveRecoveryRecord=()=>Promise.resolve();
const nextDecompositionVersion=()=>Date.now();
const disk=new Map([[PROJECT_DATA_KEY, JSON.stringify({p:{responseRows:[]}})]]);
let fail=false;
const localStorage={getItem:k=>disk.get(k)||null};
const _set=(k,v)=>{if(fail)throw Object.assign(new Error('quota'),{name:'QuotaExceededError'});disk.set(k,v)};
const QUOTA_AWARE_KEYS=new Set();
const reportQuota=()=>{};const shouldFireForKey=()=>false;const fire=()=>{};let quotaNotificationSent=false;
${wrapper}
${project}
fail=true;
const reportedSuccess=saveProjectPatch('p',{responseRows:[{fromFunction:'Imported function'}]});
const diskRows=JSON.parse(disk.get(PROJECT_DATA_KEY)).p.responseRows.length;
projectMapCache=null;projectMapSerializedCache=null;
result={reportedSuccess,diskRows,rowsAfterRefresh:loadProjectData('p').responseRows.length};
`,context);
assert.strictEqual(context.result.reportedSuccess,false);
assert.strictEqual(context.result.diskRows,0);
assert.strictEqual(context.result.rowsAfterRefresh,0);
console.log('PASS quota failure is reported accurately:',JSON.stringify(context.result));
vm.runInContext(`
fail=false;
disk.set(PROJECT_DATA_KEY,'{corrupt');
const corruptSave=saveProjectPatch('p',{responseRows:[]});
result={corruptSave,untouched:disk.get(PROJECT_DATA_KEY)==='{corrupt'};
`,context);
assert.strictEqual(context.result.corruptSave,false);
assert.strictEqual(context.result.untouched,true);
console.log('PASS corrupt project storage is not overwritten.');
vm.runInContext(`
disk.set(PROJECT_DATA_KEY,JSON.stringify({p:{responseRows:[{fromFunction:'Kept'}]}}));
const successful=saveProjectPatch('p',{riskMethod:'STPA'});
projectMapCache=null;projectMapSerializedCache=null;
result={successful,rows:loadProjectData('p').responseRows.length};
`,context);
assert.strictEqual(context.result.successful,true);
assert.strictEqual(context.result.rows,1);
console.log('PASS successful metadata save preserves decomposition after refresh.');
