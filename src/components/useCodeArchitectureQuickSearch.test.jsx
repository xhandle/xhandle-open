import React,{act,useRef} from 'react';
import {createRoot} from 'react-dom/client';
import useCodeArchitectureQuickSearch, { diagramNodeGroup } from './useCodeArchitectureQuickSearch';
import {QUICK_SEARCH_COLLECT,filterSearchEntries} from './quickSearchUtils';
global.IS_REACT_ACT_ENVIRONMENT=true;
test('active diagram search finds functions and edges, focuses without moving nodes and cleans up',()=>{
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 let nodes=[{id:'a',position:{x:10,y:20},data:{label:'Validate command',description:'Check permitted bounds'}},{id:'b',position:{x:50,y:80},data:{label:'Actuator'}},{id:'hidden',hidden:true,data:{label:'Invisible'}}];
 let edges=[{id:'e',source:'a',target:'b',data:{label:'Send torque',description:'Authorized control'}},{id:'hidden-edge',hidden:true,source:'a',target:'b'}];
 const fitView=jest.fn(),selected=jest.fn(),highlight=jest.fn();
 const props={storageKey:'project-repo',getNodes:()=>nodes,getEdges:()=>edges,fitView,setNodes:fn=>{nodes=fn(nodes);},setEdges:fn=>{edges=fn(edges);},setSelectedNodeIds:selected,setHighlightedEdgeId:highlight};
 function Fixture(){const hostRef=useRef();useCodeArchitectureQuickSearch({...props,hostRef});return <div ref={hostRef} data-canvas/>;}
 act(()=>root.render(<Fixture/>));const canvas=host.querySelector('[data-canvas]');canvas.getClientRects=()=>[{}];
 const collect=()=>{const entries=[];act(()=>window.dispatchEvent(new CustomEvent(QUICK_SEARCH_COLLECT,{detail:{entries}})));return entries;};
 const entries=collect();expect(entries).toHaveLength(3);expect(filterSearchEntries(entries,'authorized torque')).toHaveLength(1);
 const before=nodes.map(x=>x.position);
 act(()=>entries.find(x=>x.kind==='Diagram connection').activate());expect(highlight).toHaveBeenCalledWith('e');expect(edges[0].selected).toBe(true);expect(fitView.mock.calls[0][0].nodes.map(x=>x.id)).toEqual(['a','b']);
 act(()=>entries.find(x=>x.label==='Validate command').activate());expect(selected).toHaveBeenCalledWith(['a']);expect(nodes.map(x=>x.position)).toEqual(before);
 canvas.hidden=true;expect(collect()).toHaveLength(0);
 act(()=>root.unmount());expect(collect()).toHaveLength(0);host.remove();
});

test('glossary uses model parents to distinguish duplicate labels and excludes hidden endpoints', () => {
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 const nodes=[
  {id:'sys',type:'groupBox',data:{label:'Vehicle',elementType:'system'}},
  {id:'left',type:'groupBox',parentNode:'sys',data:{label:'Left',groupKind:'csc'}},
  {id:'right',type:'groupBox',parentNode:'sys',data:{label:'Right',groupKind:'csc'}},
  {id:'a',parentNode:'left',data:{label:'Control'}},
  {id:'b',parentNode:'right',data:{label:'Control'}},
  {id:'hidden',hidden:true,data:{label:'Excluded'}},
 ];
 const edges=[{id:'bad',source:'hidden',target:'a'}];
 function Fixture(){const hostRef=useRef();useCodeArchitectureQuickSearch({hostRef,storageKey:'parents',getNodes:()=>nodes,getEdges:()=>edges});return <div ref={hostRef}/>;}
 try {
  act(()=>root.render(<Fixture/>));host.firstChild.getClientRects=()=>[{}];
  const entries=[];act(()=>window.dispatchEvent(new CustomEvent(QUICK_SEARCH_COLLECT,{detail:{entries}})));
  expect(entries).toHaveLength(5);
  expect(entries.find(entry=>entry.label==='Vehicle').navigator.group).toBe('Systems');
  expect(entries.find(entry=>entry.id.endsWith(':a')).navigator.context).toBe('Vehicle › Left');
  expect(filterSearchEntries(entries,'control right').map(entry=>entry.id)).toEqual(['parents:node:b']);
  expect(diagramNodeGroup({type:'note'})).toBe('Notes');
 } finally {act(()=>root.unmount());host.remove();}
});

test('centers every rendered element label instead of the full element bounds', () => {
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 let nodes=[
  {id:'group',type:'groupBox',data:{label:'Launch'}},
  {id:'function',data:{label:'Ignite'}},
  {id:'note',type:'note',data:{label:'Constraint'}},
 ];
 let edges=[{id:'edge',source:'function',target:'note',label:'commands'}];
 const fitView=jest.fn(),setCenter=jest.fn(),screenToFlowPosition=jest.fn(point=>({x:point.x+1000,y:point.y+2000}));
 function Fixture(){const hostRef=useRef();useCodeArchitectureQuickSearch({hostRef,storageKey:'labels',getNodes:()=>nodes,getEdges:()=>edges,
  fitView,setCenter,screenToFlowPosition,setSelectedNodeIds:jest.fn(),setHighlightedEdgeId:jest.fn(),setNodes:fn=>{nodes=fn(nodes);},setEdges:fn=>{edges=fn(edges);}});return <div ref={hostRef}/>;}
 try {
  act(()=>root.render(<Fixture/>));const canvas=host.firstChild;canvas.getClientRects=()=>[{}];
  const addNodeLabel=(id,left,top,width,height)=>{const node=document.createElement('div');node.className='react-flow__node';node.dataset.id=id;
   const label=document.createElement('span');label.dataset.diagramLabel='';label.getBoundingClientRect=()=>({left,top,width,height});node.append(label);canvas.append(node);};
  addNodeLabel('group',10,20,80,20);addNodeLabel('function',100,200,60,30);addNodeLabel('note',300,400,100,40);
  const edgeLabel=document.createElement('div');edgeLabel.dataset.diagramEdgeLabel='edge';edgeLabel.getBoundingClientRect=()=>({left:500,top:600,width:120,height:20});canvas.append(edgeLabel);
  const entries=[];act(()=>window.dispatchEvent(new CustomEvent(QUICK_SEARCH_COLLECT,{detail:{entries}})));
  entries.forEach(entry=>act(()=>entry.activate()));
  expect(setCenter.mock.calls.map(call=>call.slice(0,2))).toEqual([[1050,2030],[1130,2215],[1350,2420],[1560,2610]]);
  setCenter.mock.calls.forEach(([, , options])=>expect(options).toEqual({zoom:1.15,duration:250}));
  expect(fitView).not.toHaveBeenCalled();
 } finally {act(()=>root.unmount());host.remove();}
});

test('reveals an abstracted element, waits for its camera target, and cancels pending or stale-scope navigation', () => {
 jest.useFakeTimers();
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 const model=[{id:'function',position:{x:5000,y:6000},data:{label:'Offscreen function'}}];
 let rendered=[];
 const fitView=jest.fn(()=>true),revealNode=jest.fn(),selected=jest.fn();
 function Fixture({scope}){const hostRef=useRef();useCodeArchitectureQuickSearch({hostRef,storageKey:scope,getNodes:()=>rendered,getNavigatorNodes:()=>model,getEdges:()=>[],
  fitView,revealNode,setSelectedNodeIds:selected,setHighlightedEdgeId:jest.fn(),setNodes:fn=>{rendered=fn(rendered);},setEdges:jest.fn()});return <div ref={hostRef}/>;}
 const collect=()=>{const entries=[];act(()=>window.dispatchEvent(new CustomEvent(QUICK_SEARCH_COLLECT,{detail:{entries}})));return entries;};
 try {
  act(()=>root.render(<Fixture scope="first"/>));host.firstChild.getClientRects=()=>[{}];
  const [entry]=collect();
  act(()=>entry.activate());expect(revealNode).toHaveBeenCalledWith(model[0]);expect(fitView).not.toHaveBeenCalled();
  rendered=model;
  act(()=>jest.advanceTimersByTime(50));
  expect(fitView).toHaveBeenCalledTimes(1);expect(selected).toHaveBeenCalledWith(['function']);
  expect(rendered[0].position).toEqual({x:5000,y:6000});
  rendered=[];act(()=>entry.activate());
  act(()=>root.render(<Fixture scope="second"/>));rendered=model;
  act(()=>{entry.activate();jest.runOnlyPendingTimers();});
  expect(fitView).toHaveBeenCalledTimes(1);
  rendered=[];const [second]=collect();act(()=>second.activate());
  act(()=>root.unmount());rendered=model;act(()=>jest.runOnlyPendingTimers());
  expect(fitView).toHaveBeenCalledTimes(1);
 } finally {host.remove();jest.useRealTimers();}
});
