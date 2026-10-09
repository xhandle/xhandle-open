import React, { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import useScopedArchitectureRows from './useScopedArchitectureRows';
const fs = require('fs');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

// Exercise App's actual persistence callback, not a second implementation.
const app = fs.readFileSync('src/App.js', 'utf8');
let saveBody, loadBody;
traverse(parser.parse(app, { sourceType: 'module', plugins: ['jsx'] }), {
  CallExpression({node}) {
    if (node.callee.name !== 'useEffect' || !node.arguments[0]) return;
    const body = app.slice(node.arguments[0].start, node.arguments[0].end);
    if (body.includes('writeCbaRowsToIndexedDB(activeCodeArchitectureRowsKey, cbaTableData)')) saveBody = body;
    if (body.includes('readCodeArchitectureRowsForRepo(') && body.includes('setCbaLoading(true)')) loadBody = body;
  },
});
global.IS_REACT_ACT_ENVIRONMENT = true;
let root, api, writes;
const A = 'cba:A:repoA', B = 'cba:B:repoB';
const rowsA = [{from:'A function', functionalModel:{name:'A model'}}];
const rowsB = [{from:'B function'}];
function Harness({scope}) {
  api = useScopedArchitectureRows(scope);
  useEffect(() => {
    const env = {
      activeCodeArchitectureProject: {id:scope?.split(':')[1]},
      activeCodeArchitectureRepo: {id:scope?.split(':')[2]},
      activeCodeArchitectureRowsKey:scope,
      cbaOwnedSnapshot:api.snapshot, cbaTableData:api.rows,
      codeArchitectureMetaKey:()=>scope,
      writeCbaRowsToIndexedDB:(key,rows)=>{writes.push({key,rows});return Promise.resolve(true);},
      localStorage:{setItem(){}}, codeSourceProvenance:()=>({}), normalizeRepoIdentity:()=>scope,
      activeCodeArchitectureStoredMeta:null, functionalModelIsReady:()=>false,
      normalizeCodeArchitectureGroundingStats:()=>null,
      XHANDLE_IDB_NAME:'xhandle', XHANDLE_IDB_CBA_STORE:'copilot_baseline',setCbaLoadError:jest.fn(),
    };
    return new Function(...Object.keys(env), `return (${saveBody})();`)(...Object.values(env));
  }, [scope, api.snapshot]);
  return <div>{api.rows.map(row=>row.from).join(',')}</div>;
}
const render = async scope => act(async()=>root.render(<Harness scope={scope}/>));
beforeEach(()=>{root=createRoot(document.createElement('div'));writes=[];});
afterEach(()=>act(()=>root.unmount()));
test.each([[[]], [rowsB]])('switching to a destination never writes the previous rows (%j)', async destination => {
  await render(A); await act(async()=>api.adoptRows(rowsA));
  expect(api.rows[0].functionalModel.name).toBe('A model');
  await render(B); expect(api.rows).toEqual([]); expect(writes).toEqual([]);
  await act(async()=>api.adoptRows(destination));
  expect(api.rows).toEqual(destination); expect(writes).toEqual([]);
  await act(async()=>api.setRows([{from:'B edit'}]));
  expect(writes).toEqual([{key:B,rows:[{from:'B edit'}]}]);
});
test('rapid A/B/A rejects old setters and loads, without re-saving dirty A', async()=>{
  await render(A); await act(async()=>api.setRows(rowsA));
  const stale=api; const valid=api.beginLoad();
  await render(B); await render(A);
  expect(api.rows).toEqual([]); expect(valid()).toBe(false);
  await act(async()=>stale.setRows(rowsB));
  expect(api.rows).toEqual([]); expect(writes).toHaveLength(1);
});
test('new publication invalidates pending hydration and remains a clean snapshot', async()=>{
  await render(A); const valid=api.beginLoad();
  await act(async()=>api.publishRows(A,rowsA));
  expect(valid()).toBe(false); expect(api.rows).toEqual(rowsA); expect(writes).toEqual([]);
});
test('background publication cannot change the selected project', async()=>{
  await render(A); const publish=api.publishRows;
  await render(B); await act(async()=>api.adoptRows(rowsB));
  await act(async()=>publish(A,rowsA));
  expect(api.rows).toEqual(rowsB); expect(writes).toEqual([]);
});
test('a new repository can publish using a callback captured before selection', async()=>{
  await render(A); const publish=api.publishRows;
  await render(B); await act(async()=>publish(B,rowsB));
  expect(api.rows).toEqual(rowsB); expect(writes).toEqual([]);
});
test('failed or cancelled hydration leaves a new project empty and cannot save foreign rows', async()=>{
  await render(A); await act(async()=>api.adoptRows(rowsA));
  await render(B); const valid=api.beginLoad();
  await Promise.reject(new Error('Storage unavailable')).catch(()=>{});
  expect(valid()).toBe(true); expect(api.rows).toEqual([]); expect(writes).toEqual([]);
});

function startActualLoad(read) {
  const env = {
    activeCodeArchitectureRowsKey:B, activeCodeArchitectureProject:{id:'B'},activeCodeArchitectureRepo:{id:'repoB'},
    codeArchitectureAnalysisScopeRef:{current:null}, beginCbaLoad:api.beginLoad, adoptCbaTableData:api.adoptRows,
    setCbaLoading:jest.fn(),setCbaLoadingProgress:jest.fn(),setCbaLoadingLabel:jest.fn(),setCbaLoadError:jest.fn(),
    setSelectedCbaElement:jest.fn(),setActiveCodeArchitectureSelection:jest.fn(),setCodeArchitectureHazardRun:jest.fn(),
    readCodeArchitectureRowsForRepo:read,codeArchitectureReviewRowsForRepo:jest.fn(()=>[]),resultsReview:{reviewItems:[]},
    requestAnimationFrame:cb=>cb(),ensureCodeArchitectureTraceIdsAsync:async rows=>rows,immutableFunctionalRowsAsync:async rows=>rows,
  };
  env.cancel = new Function(...Object.keys(env), `return (${loadBody})();`)(...Object.values(env));
  return env;
}
test('actual App load failure ends loading, reports an error and never exposes A in B', async()=>{
  await render(A);await act(async()=>api.adoptRows(rowsA));await render(B);
  let env;
  await act(async()=>{env=startActualLoad(()=>Promise.reject(new Error('Storage unavailable')));});
  expect(env.setCbaLoadError).toHaveBeenLastCalledWith('Storage unavailable');
  expect(env.setCbaLoading).toHaveBeenLastCalledWith(false);
  expect(api.rows).toEqual([]);expect(writes).toEqual([]);
});
test('actual delayed App hydration cannot replace a newly published model', async()=>{
  await render(B);let resolve;
  const env=startActualLoad(()=>new Promise(r=>{resolve=r;}));
  await act(async()=>api.publishRows(B,rowsB));
  await act(async()=>resolve({rows:rowsA,found:true}));
  expect(api.rows).toEqual(rowsB);expect(writes).toEqual([]);env.cancel();
});
test('actual App loader respects an intentionally empty saved dataset', async()=>{
  await render(B);let env;
  await act(async()=>{env=startActualLoad(()=>Promise.resolve({rows:[],found:true}));});
  expect(env.codeArchitectureReviewRowsForRepo).not.toHaveBeenCalled();
  expect(env.setCbaLoading).toHaveBeenLastCalledWith(false);
  expect(api.rows).toEqual([]);expect(writes).toEqual([]);
});

test('a new visit cannot apply an updater to rows from a previous visit before hydration', async()=>{
  await render(A);await act(async()=>api.adoptRows(rowsA));await render(B);await render(A);
  let received;
  await act(async()=>api.setRows(previous=>{received=previous;return [{from:'New edit'}];}));
  expect(received).toEqual([]);
});
