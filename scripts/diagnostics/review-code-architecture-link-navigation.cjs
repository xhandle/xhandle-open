// Historical pre-fix reproducer. Assertions intentionally describe the old defects.
// For current regression checks, run the corresponding verify-code-architecture-link-navigation script.
// Review-only probes: run the real source callbacks with controlled graph/timer state.
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
const tableFile = 'src/components/generateFunctionalDecompositionFromGitHub.js';
const focusSource = sourceFunction(diagramFile, 'performArchitectureTargetFocus');
function focusHarness(nodes, edges = []) {
  const timers=clock(); const calls={fits:[], highlighted:[], selected:[]};
  const scope={ ...timers, initialLayoutPending:true, suppressAutoFitUntilRef:{current:0},
    getNodes:()=>nodes, getEdges:()=>edges, fitView:request=>{calls.fits.push(request);return false;},
    setNodes:update=>{calls.selected.push(update(nodes));},
    setHighlightedEdgeId:id=>calls.highlighted.push(id), setSelectedTrace:()=>{}, boxIdsForArchitectureData:()=>[],
  };
  return {timers,calls,focus:vm.runInNewContext(`(${focusSource})`,scope)};
}
const outcomes=[];
{
  const h=focusHarness([{id:'n:Target',data:{label:'Target'},position:{x:0,y:0}}]);
  let attempts=0, acknowledgements=0;
  const request=vm.runInNewContext(`(${sourceFunction(tableFile,'requestCsuDiagramFocus')})`,{
    ...h.timers,diagramRef:{current:{focusArchitectureTarget:t=>{attempts++;return h.focus(t);}}},
  });
  request({type:'node',functionName:'Target'},()=>acknowledgements++);
  h.timers.advance(7000);
  assert.equal(attempts,1);assert.equal(acknowledgements,1);assert.equal(h.calls.fits.length,1);
  outcomes.push({defect:'Premature focus acknowledgement',attempts,acknowledgements,viewportFitSucceeded:false,nodeMeasured:false,layoutPending:true});
}
{
  const h=focusHarness([], [{id:'edge-1',source:'from',target:'to',data:{rowRef:1}}]);
  assert.equal(h.focus({type:'edge',edgeId:'edge-1'}),true);h.timers.advance(100);
  assert.equal(h.calls.fits.length,0);
  outcomes.push({defect:'Edge acknowledged without rendered endpoints',fits:0,successReported:true});
}
{
  const h=focusHarness([{id:'new-node',data:{label:'Target'},position:{x:0,y:0}}]);
  assert.equal(h.focus({type:'node',nodeId:'old-node',functionName:'Target',traceId:'FD-1',rowIndex:0}),false);
  outcomes.push({defect:'Stale node ID has no trace/row fallback',currentNodePresent:true,successReported:false});
}
{
  const h=focusHarness([], [
    {id:'wrong-edge',source:'a',target:'b',data:{rowRef:1,fromFunction:'Other',controlAction:'Other action',toFunction:'Other target'}},
    {id:'correct-edge',source:'c',target:'d',data:{rowRef:2,fromFunction:'Desired',controlAction:'Stop',toFunction:'Control'}},
  ]);
  h.focus({type:'edge',rowRef:1,traceId:'FD-correct',fromFunction:'Desired',controlAction:'Stop',toFunction:'Control'});
  assert.equal(h.calls.highlighted[0],'wrong-edge');
  outcomes.push({defect:'Stale row reference wins over exact interface identity',selected:h.calls.highlighted[0]});
}
{
  let activeTab='software-requirements', safetyTab='remediation';
  const handler=vm.runInNewContext(`(${sourceFunction('src/App.js','handleOpenCodeArchitectureHazardSummaryRow')})`,{
    setSection:()=>{},setCodeArchitectureWorkspaceTab:v=>activeTab=v,
    setHazardRemediationTab:v=>safetyTab=v,setCodeArchitectureHazardSummaryOpenKey:()=>{},
    setHighlightedCodeArchitectureHazardRowIndex:()=>{},setTimeout:()=>{},
  });
  handler(3); assert.equal(activeTab,'safety');assert.equal(safetyTab,'remediation');
  outcomes.push({defect:'Hazard-row link retains wrong safety subtab',activeTab,safetyTab});
}
(async () => {
  let nodes=[{id:'n:Target',selected:false,type:'function',position:{x:0,y:0},data:{}}];
  const snapshot=nodes.map(node=>({...node}));
  let finishLayout;
  const layoutResult=new Promise(resolve=>{finishLayout=resolve;});
  const clean=vm.runInNewContext(`(${sourceFunction(diagramFile,'runCleanAndSpread')})`,{
    nodes:snapshot,edges:[],rows:[],isGroupBox:()=>false,runElkLayoutOnce:()=>layoutResult,
    architectureMode:true,colorSystemElements:false,systemElementColorOverrides:new Map(),
    buildArchitectureLayout:ns=>({groupedNodes:ns,absoluteNodes:ns}),
    setNodes:ns=>nodes=ns,posRef:{current:new Map()},persistSoon:()=>{},
    rowsToRawEdges:()=>[],buildEdgesFromRaw:()=>[],setEdges:()=>{},fitAfterClean:false,
  });
  const pending=clean();
  nodes=nodes.map(node=>({...node,selected:true}));
  finishLayout(snapshot.map(node=>({...node,position:{x:2000,y:2000}})));
  await pending;
  assert.equal(nodes[0].selected,false);
  outcomes.push({defect:'In-flight clean overwrites newer focus selection',selectedAfterLayout:nodes[0].selected,positionAfterLayout:nodes[0].position});
  const timers=clock();let currentFocus='older';
  const resolved=vm.runInNewContext(`(${sourceFunction('src/App.js','handleCodeArchitectureArtifactFocusResolved')})`,{
    ...timers,setCodeArchitectureArtifactFocus:v=>currentFocus=v,
  });
  resolved();timers.advance(1000);currentFocus='newer';resolved();timers.advance(2600);
  assert.equal(currentFocus,null);
  outcomes.push({defect:'Older artifact focus timeout clears newer request',newerRequestClearedAfterMs:1600});
  console.log(JSON.stringify(outcomes,null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
