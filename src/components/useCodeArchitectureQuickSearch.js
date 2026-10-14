import {useEffect} from 'react';
import {QUICK_SEARCH_COLLECT,isSearchVisible} from './quickSearchUtils';

export default function useCodeArchitectureQuickSearch({hostRef,storageKey,getNodes,getEdges,fitView,setNodes,setEdges,setSelectedNodeIds,setHighlightedEdgeId}) {
 useEffect(()=>{
  const collect=event=>{
   if(!isSearchVisible(hostRef.current) || !Array.isArray(event.detail?.entries))return;
   const nodes=getNodes().filter(node=>!node.hidden),byId=new Map(nodes.map(node=>[node.id,node]));
   const focus=(targets,nodeId,edgeId)=>{
    setSelectedNodeIds(nodeId?[nodeId]:[]);setHighlightedEdgeId(edgeId || null);
    setNodes(all=>all.map(node=>({...node,selected:node.id===nodeId})));
    setEdges(all=>all.map(edge=>({...edge,selected:edge.id===edgeId})));
    fitView({nodes:targets,padding:0.45,duration:250,maxZoom:1.15});
   };
   nodes.forEach(node=>event.detail.entries.push({
    id:`${storageKey}:node:${node.id}`,kind:node.type==='groupBox'?'Architecture group':'Diagram node',
    label:String(node.data?.label || node.id),text:String(node.data?.description || ''),activate:()=>focus([node],node.id,null),
   }));
   getEdges().filter(edge=>!edge.hidden && byId.has(edge.source) && byId.has(edge.target)).forEach(edge=>{
    const endpoints=[byId.get(edge.source),byId.get(edge.target)];
    event.detail.entries.push({id:`${storageKey}:edge:${edge.id}`,kind:'Diagram connection',label:String(edge.data?.label || edge.label || 'Connection'),
     text:endpoints.map(node=>node.data?.label || node.id).join(' → ')+' '+String(edge.data?.description || ''),activate:()=>focus(endpoints,null,edge.id)});
   });
  };
  window.addEventListener(QUICK_SEARCH_COLLECT,collect);
  return ()=>window.removeEventListener(QUICK_SEARCH_COLLECT,collect);
 },[hostRef,storageKey,getNodes,getEdges,fitView,setNodes,setEdges,setSelectedNodeIds,setHighlightedEdgeId]);
}
