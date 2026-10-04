// Regression probes of the actual callback bodies with controlled graph/timer state.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const parser = require('@babel/parser');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
function sourceFunction(file, name) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const ast = parser.parse(source, { sourceType: 'module', plugins: ['jsx'] });
  let found;
  function walk(node) {
    if (!node || typeof node !== 'object' || found) return;
    if (node.type === 'FunctionDeclaration' && node.id?.name === name) found = node;
    if (node.type === 'VariableDeclarator' && node.id?.name === name) {
      found = node.init.type === 'CallExpression' ? node.init.arguments[0] : node.init;
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === 'object') walk(value);
    }
  }
  walk(ast); assert.ok(found, name);
  return source.slice(found.start, found.end);
}
function clock() {
  let now = 0, seq = 0;
  const pending = new Map();
  return {
    setTimeout(fn, delay = 0) { const id = ++seq; pending.set(id, { at: now + delay, fn }); return id; },
    clearTimeout(id) { pending.delete(id); },
    advance(to) {
      while (pending.size) {
        const [id, task] = [...pending.entries()].sort((a,b) => a[1].at-b[1].at)[0];
        if (task.at > to) break;
        pending.delete(id); now=task.at; task.fn();
      }
      now=to;
    },
  };
}
const diagramFile = 'src/components/LiteSummaryDiagramReactFlowGitHub.js';
const focusSource = sourceFunction(diagramFile, 'performArchitectureTargetFocus');
function focusHarness(nodes, edges = []) {
  const calls={fits:[], highlighted:[], selected:[]};
  const scope={ navigationReadyRef:{current:false}, architectureFocus:null, suppressAutoFitUntilRef:{current:0},
    getNodes:()=>nodes, getEdges:()=>edges, fitView:request=>{calls.fits.push(request);return false;},
    setNodes:update=>calls.selected.push(update(nodes)),
    setHighlightedEdgeId:id=>calls.highlighted.push(id), setSelectedTrace:()=>{}, boxIdsForArchitectureData:()=>[],
  };
  return {scope,calls,focus:vm.runInNewContext(`(${focusSource})`,scope)};
}
const outcomes=[];
{
  const node={id:'target',width:240,height:96,data:{label:'Target'},position:{x:0,y:0}};
  const h=focusHarness([node]);
  assert.equal(h.focus({type:'node',nodeId:'target'}),false);
  assert.equal(h.calls.fits.length,0);
  h.scope.navigationReadyRef.current=true;
  node.width=0;
  assert.equal(h.focus({type:'node',nodeId:'target'}),false);
  assert.equal(h.calls.fits.length,0);
  node.width=240;
  assert.equal(h.focus({type:'node',nodeId:'target'}),false);
  assert.equal(h.calls.selected.length,0);
  h.scope.fitView=()=>true;
  assert.equal(h.focus({type:'node',nodeId:'target'}),true);
  assert.equal(h.calls.selected[0][0].selected,true);
  outcomes.push('Waits for layout, measurement, and successful fit before selecting/acknowledging');
}
{
  const h=focusHarness([], [{id:'edge',source:'from',target:'to'}]);
  h.scope.navigationReadyRef.current=true;
  assert.equal(h.focus({type:'edge',edgeId:'edge'}),false);
  assert.equal(h.calls.fits.length,0);
  outcomes.push('No edge acknowledgement without both rendered endpoints');
}
{
  let activeTab='software-requirements', safetyTab='remediation';
  const handler=vm.runInNewContext(`(${sourceFunction('src/App.js','handleOpenCodeArchitectureHazardSummaryRow')})`,{
    codeArchitectureRowFocusScopeRef:{current:{}},codeArchitectureScopeRef:{current:"test"},
    setSection:()=>{},setCodeArchitectureWorkspaceTab:v=>activeTab=v,
    setHazardRemediationTab:v=>safetyTab=v,setCodeArchitectureHazardSummaryOpenKey:()=>{},
    setHighlightedCodeArchitectureHazardRowIndex:()=>{},
  });
  handler(3); assert.equal(activeTab,'safety');assert.equal(safetyTab,'hazard-analysis');
  outcomes.push('Hazard links choose hazard analysis even from remediation');
}
(async () => {
  let nodes=[{id:'target',selected:false,type:'function',position:{x:0,y:0},data:{}}];
  const snapshot=nodes.map(node=>({...node}));
  let finishLayout;
  const layoutResult=new Promise(resolve=>{finishLayout=resolve;});
  const scope={
    nodes:snapshot,edges:[],rows:[],isGroupBox:()=>false,runElkLayoutOnce:()=>layoutResult,
    layoutEpochRef:{current:0},preserveLayoutOnMount:false,cleanOnceKey:'test',
    architectureMode:true,colorSystemElements:false,systemElementColorOverrides:new Map(),
    buildArchitectureLayout:ns=>({groupedNodes:ns,absoluteNodes:ns}),
    setNodes:update=>nodes=typeof update==='function'?update(nodes):update,
    posRef:{current:new Map()},persistSoon:()=>{},
    rowsToRawEdges:()=>[],buildEdgesFromRaw:()=>[],setEdges:()=>{},fitAfterClean:false,
  };
  const clean=vm.runInNewContext(`(${sourceFunction(diagramFile,'runCleanAndSpread')})`,scope);
  const pending=clean();
  nodes=nodes.map(node=>({...node,selected:true}));
  finishLayout(snapshot.map(node=>({...node,position:{x:2000,y:2000}})));
  await pending;
  assert.equal(nodes[0].selected,true);
  outcomes.push('Layout preserves newer selection');
  const delayed=new Promise(resolve=>{finishLayout=resolve;});
  scope.runElkLayoutOnce=()=>delayed;
  const stale=clean();
  scope.layoutEpochRef.current++;
  finishLayout(snapshot);await stale;
  assert.equal(nodes[0].position.x,2000);
  outcomes.push('Superseded layout cannot commit positions');
  const timers=clock();let currentFocus={key:'older'};
  const resolved=vm.runInNewContext(`(${sourceFunction('src/App.js','handleCodeArchitectureArtifactFocusResolved')})`,{
    ...timers,setCodeArchitectureArtifactFocus:update=>currentFocus=update(currentFocus),
  });
  resolved('older');timers.advance(1000);currentFocus={key:'newer'};resolved('newer');timers.advance(2600);
  assert.equal(currentFocus.key,'newer');timers.advance(3600);assert.equal(currentFocus,null);
  outcomes.push('Older highlight timeout cannot clear a newer request');
  console.log(JSON.stringify(outcomes,null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
