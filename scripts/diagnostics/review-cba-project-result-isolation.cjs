// Historical reproduction: pin the reviewed pre-fix source; current behavior is
// covered by the project-isolation Jest regression suites. No browser data is touched.
const { execFileSync } = require('child_process');
const vm = require('vm');
const assert = require('node:assert/strict');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const source = execFileSync('git', ['show', 'ada74a52551972dd9bf4cd9c88bccf291aacae2d:src/App.js'], { encoding: 'utf8' });
const ast = parser.parse(source, { sourceType: 'module', plugins: ['jsx'] });
let autosave, loader, lookup;
traverse(ast, {
  CallExpression(path) {
    const n = path.node;
    if (n.callee.name !== 'useEffect' || !n.arguments[0]) return;
    const body = source.slice(n.arguments[0].start, n.arguments[0].end);
    if (body.includes('writeCbaRowsToIndexedDB(activeCodeArchitectureRowsKey, cbaTableData)')) autosave = body;
    if (body.includes('readCodeArchitectureRowsForRepo(') && body.includes('setCbaLoading(true)')) loader = body;
  },
  FunctionDeclaration(path) {
    if (path.node.id?.name === 'readCodeArchitectureRowsForRepo') lookup = source.slice(path.node.start, path.node.end);
  },
});
assert(autosave && loader && lookup, 'Could not find audited functions');
(async () => {
  const rowsA = [{ from: 'Unique A function', action: 'A interaction', to: 'A destination' }];
  const rowsB = [{ from: 'Unique B function', action: 'B interaction', to: 'B destination' }];
  for (const initialB of [[], rowsB]) {
    const db = new Map([['cba:A:repoA', rowsA], ['cba:B:repoB', initialB]]);
    let finishWrite, loaded, loading;
    const writes = [];
    const scope = {
      activeCodeArchitectureProject: {id:'B', repos:[]},
      activeCodeArchitectureRepo: {id:'repoB', owner:'different', repo:'repository'},
      activeCodeArchitectureRowsKey:'cba:B:repoB',
      activeCodeArchitectureStoredMeta:null, cbaTableData:rowsA,
      resultsReview:{reviewItems:[]},
      setCbaLoading:v=>{loading=v;}, setCbaLoadingLabel(){}, setCbaLoadingProgress(){},
      setCbaTableData:v=>{loaded=v;}, setSelectedCbaElement(){}, setActiveCodeArchitectureSelection(){},
      // Keep hydration pending: the old rows remain in the render closure.
      readCodeArchitectureRowsForRepo:()=>new Promise(()=>{}),
      codeArchitectureMetaKey:(p,r)=>`cbaMeta:${p}:${r}`,
      writeCbaRowsToIndexedDB:(key,rows)=>{writes.push({key,rows}); return new Promise(resolve=>{
        finishWrite=()=>{db.set(key,rows);resolve(true);};
      });},
    };
    vm.createContext(scope);
    const cancelLoad = vm.runInContext(`(${loader})()`,scope);
    assert.equal(loading,true);
    assert.equal(loaded,undefined, 'Loader unexpectedly cleared old rows synchronously');
    const cancelSave = vm.runInContext(`(${autosave})()`,scope);
    assert.equal(writes.length,1);
    assert.equal(writes[0].key,'cba:B:repoB');
    assert.equal(writes[0].rows,rowsA);
    cancelSave(); cancelLoad(); finishWrite(); await Promise.resolve();
    assert.equal(db.get('cba:B:repoB'),rowsA);
    console.log(`CONFIRMED: switching A -> B overwrites ${initialB.length ? 'existing' : 'empty'} B rows with A rows, even after effect cleanup.`);
  }
  for (const alias of ['cba:A:repoA', 'cba:shared/repository']) {
    const scope={
      localStorage:{getItem:()=>JSON.stringify(alias.startsWith('cba:A') ? {indexedDB:{key:alias}} : {})},
      codeArchitectureMetaKey:(p,r)=>`cbaMeta:${p}:${r}`,
      codeArchitectureRowsKey:(p,r)=>`cba:${p}:${r}`,
      codeArchitectureReposMatch:()=>false,
      readFirstCbaRowsFromIndexedDB:async keys=>({key:keys.find(k=>k===alias),rows:keys.includes(alias)?rowsA:[]}),
    };
    vm.createContext(scope);
    vm.runInContext(lookup,scope);
    const result=await scope.readCodeArchitectureRowsForRepo({id:'B',repos:[]},{id:'repoB',owner:'shared',repo:'repository'},'cba:B:repoB');
    assert.equal(result.sourceKey,alias); assert.equal(result.rows,rowsA);
    console.log(`CONFIRMED: recovery accepts ${alias} without project ownership validation.`);
  }
  console.log('Audit reproductions passed. These assert existing defects, not corrected behavior. No real browser storage was accessed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
