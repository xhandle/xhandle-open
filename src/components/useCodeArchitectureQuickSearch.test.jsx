import React,{act,useRef} from 'react';
import {createRoot} from 'react-dom/client';
import useCodeArchitectureQuickSearch from './useCodeArchitectureQuickSearch';
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
