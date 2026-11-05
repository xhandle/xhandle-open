import {quickWorkspaceReadPlan} from './workspaceReadPlanner';
import {artifactTypesForAreas} from './workspaceGraphCapabilities';
import {resolveWorkspaceReadPolicy} from './workspaceReadPolicy';

// Resolve the named project before touching large analysis stores. An ordinary
// Projects workspace does not store code-architecture derived datasets.
export function scopeWorkspaceIndex(indexScope,{query,projectId,areas=[]}) {
 if(!indexScope)return {indexScope,projectIds:undefined};
 let projects;
 try{projects=[...JSON.parse(localStorage.getItem('xhandle.projects')||'[]').map(p=>({...p,projectType:'project'})),...JSON.parse(localStorage.getItem('xhandle.codeArchitectureProjects')||'[]').map(p=>({...p,projectType:'code-based-architecture'}))];}
 catch{return {indexScope,projectIds:undefined};}
 const policy=resolveWorkspaceReadPolicy({query,projects,projectId,areas});
 if(policy.clarification)return {indexScope:{...indexScope,steps:['projects']},projectIds:undefined};
 const selected=projects.filter(p=>policy.projectIds.includes(String(p.id)));
 const regularOnly=selected.length===policy.projectIds.length&&selected.length>0&&selected.every(p=>p.projectType==='project');
 return {projectIds:policy.projectIds.length?policy.projectIds:undefined,indexScope:regularOnly?{...indexScope,steps:indexScope.steps.filter(step=>!['codeArchitecture','codeArchitectureAssurance','codeIndex'].includes(step)),types:indexScope.types.filter(type=>!type.startsWith('code_architecture_')&&!['repository','source_file'].includes(type))}:indexScope};
}

// Deterministic single-domain lookups can use a smaller set of index steps.
// Model-planned reads use their requested domains and the same project scoping.
export function workspaceIndexScope(query,areas=[]) {
 let projects=[];
 try {
  projects=['xhandle.projects','xhandle.codeArchitectureProjects'].flatMap(key=>JSON.parse(localStorage.getItem(key)||'[]')).filter(row=>row&&typeof row.name==='string');
 } catch {return null;}
 const allowed=artifactTypesForAreas(areas);
 const calls=quickWorkspaceReadPlan(query,{projects,types:allowed?[...allowed]:[]});
 if(calls?.length!==1)return null;
 const call=calls[0];
 if(call.operation==='source')return !allowed||allowed.has('source_file')?{steps:['projects','codeIndex'],types:['source_file']}:null;
 if(!['aggregate','query'].includes(call.operation)||!call.types?.length)return null;
 if(allowed&&call.types.some(type=>!allowed.has(type)))return null;
 const required={
  project:['projects'],
  code_architecture_software_requirement:['projects','codeArchitectureAssurance'],
  code_architecture_system_requirement:['projects','codeArchitectureAssurance'],
  code_architecture_subsystem_requirement:['projects','codeArchitectureAssurance'],
  generated_report:['projects','generatedReports'],
  safety_issue_report:['projects','durableProjectAnalysis'],
 };
 if(call.types.some(type=>!required[type]))return null;
 return {steps:[...new Set(call.types.flatMap(type=>required[type]))],types:call.types};
}

// Semantic context requests enumerate domains before any index dependency.
// Some legacy stores contain several domains; a step can scan that store, but
// candidate/read types remain restricted to the requested domain union.
export function requestedWorkspaceIndexScope(areas) {
 const steps = {
  projects:['projects'], requirements:['projects','projectData','requirements','sysml','codeArchitectureAssurance'],
  risk:['projects','projectData','durableProjectAnalysis','codeArchitectureAssurance','indexedFeatureStores'],
  functional:['projects','projectData','codeArchitecture','sysml'],
  reports:['projects','generatedReports','durableProjectAnalysis'],
  testing:['projects','verificationTests','codeArchitectureAssurance','indexedFeatureStores'],
  review:['projects','indexedFeatureStores','codeArchitectureAssurance'],
  cba:['projects','codeArchitecture','codeArchitectureAssurance','codeIndex','indexedFeatureStores'],
  source:['projects','codeIndex'], design:['projects','sysml','codeArchitectureAssurance'], notes:['projects','indexedFeatureStores'],
 };
 if(!Array.isArray(areas)||!areas.length||areas.some(area=>!steps[area]))throw Error('A supported data area is required before workspace retrieval.');
 return {steps:[...new Set(areas.flatMap(area=>steps[area]))],types:[...artifactTypesForAreas(areas)],deterministic:false};
}
