import {useEffect,useState} from 'react';
import {loadArtifactRowsAsync} from './artifactUtils';
import {ARTIFACT_KINDS} from './artifactDefinitions';
const kinds={softwareRequirements:ARTIFACT_KINDS.SOFTWARE,systemRequirements:ARTIFACT_KINDS.SYSTEM,subsystemRequirements:ARTIFACT_KINDS.SUBSYSTEM,designElements:ARTIFACT_KINDS.DESIGN};
const empty=Object.fromEntries(Object.keys(kinds).map(key=>[key,[]]));
export default function useDiagramAssuranceArtifacts(projectId,repoId) {
 const scope=JSON.stringify([projectId,repoId]);
 const [state,setState]=useState(null);
 useEffect(()=>{
  let cancelled=false,sequence=0;
  if(!projectId || !repoId)return;
  const load=async()=>{
   const request=++sequence;
   const entries=await Promise.all(Object.entries(kinds).map(async([key,kind])=>{
    try{return [key,await loadArtifactRowsAsync(kind,projectId,repoId)];}
    catch(error){console.warn('[architecture-links] Unable to load '+key,error);return [key,null];}
   }));
   if(!cancelled && request===sequence)setState(previous=>({scope,rows:Object.fromEntries(entries.map(([key,value])=>[key,value ?? (previous?.scope===scope?previous.rows[key]:[])]))}));
  };
  const changed=event=>{
   const detail=event.detail || {};
   if(detail.projectId && detail.projectId!==projectId)return;
   if(detail.repoId && detail.repoId!==repoId)return;
   load();
  };
  load();window.addEventListener('xhandle:code-architecture-assurance:changed',changed);
  return ()=>{cancelled=true;window.removeEventListener('xhandle:code-architecture-assurance:changed',changed);};
 },[projectId,repoId,scope]);
 return state?.scope===scope?state.rows:empty;
}
