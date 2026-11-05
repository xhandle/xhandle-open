import { artifactTypesForAreas, SCOPE_ARTIFACT_TYPES } from './workspaceGraphCapabilities';
const normalize=value=>String(value??'').normalize('NFKC').toLocaleLowerCase();
const containsName=(query,name)=>{const at=normalize(query).indexOf(normalize(name));if(at<0||!name)return false;const text=normalize(query);return (!at||!/[\p{L}\p{N}]/u.test(text[at-1]))&&(!text[at+name.length]||!/[\p{L}\p{N}]/u.test(text[at+name.length]));};
const knownTypes=new Set([...Object.values(SCOPE_ARTIFACT_TYPES).flatMap(types=>[...types]),'note','project','folder','requirements_project','sysml_model','repository','summary_artifact']);
export const READ_OPERATIONS=['search','query','aggregate','read','relationships','versions','compare','source'];
export function resolveWorkspaceReadPolicy({query='',projects=[],projectId=null,activeView={},areas=[]}={}){
 const names=[...new Set(projects.map(project=>project.name).filter(Boolean))].filter(name=>containsName(query,name));
 let named=projects.filter(project=>names.includes(project.name));
 if(/\b(?:cba|code[- ]based architecture|code architecture)\b/i.test(query))named=named.filter(project=>project.projectType==='code-based-architecture');
 else if(/\bfunctional diagramming\b/i.test(query))named=named.filter(project=>project.projectType!=='code-based-architecture');
 const duplicates=names.filter(name=>named.filter(project=>normalize(project.name)===normalize(name)).length>1);
 if(duplicates.length)return {clarification:`Which project named “${duplicates[0]}” do you mean? Please specify its workspace area.`,projects:[]};
 if(!named.length&&/\b(?:project:\s*|(?:for|in) project\s+)(?!this\b|the current\b|current\b)["“]?[^\n?.,]+/i.test(query))return {clarification:'I could not resolve the named project. Please use its exact workspace name.',projects:[]};
 const explicit=/\b(?:all|across|every)\s+(?:the\s+)?(?:projects|workspaces)|workspace[- ]wide|\b(?:list|show|how many|count)\b.*\bprojects\b/i.test(query);
 const selected=named.length?named:explicit?projects:projects.filter(project=>String(project.id)===String(projectId));
 if(!selected.length)return {clarification:'Which project should I search?',projects:[]};
 let repoId=activeView.activeCodeArchitectureRepoId||null;
 const mentioned=selected.flatMap(project=>(project.sourceData?.repos||[]).filter(repo=>[repo.repoName,repo.repoId,repo.owner&&repo.repo?`${repo.owner}/${repo.repo}`:null].some(name=>name&&String(name).length>=3&&containsName(query,name))));
 if(mentioned.length>1)return {clarification:'Which repository should I use for this lookup?',projects:[]};
 if(mentioned.length===1)repoId=mentioned[0].id||mentioned[0].repoId;
 else if(/\b(?:repository|repo):|\b(?:in|for) (?:the )?(?:repository|repo) /i.test(query))return {clarification:'Please select the repository or use its exact name.',projects:[]};
 const selectedRepo=selected.flatMap(project=>project.sourceData?.repos||[]).find(repo=>[repo.id,repo.repoId,repo.repoName].map(String).includes(String(repoId)));
 const repoIds=selectedRepo?[selectedRepo.id,selectedRepo.repoId,selectedRepo.repoName,selectedRepo.owner&&selectedRepo.repo?`${selectedRepo.owner}/${selectedRepo.repo}`:null].filter(Boolean).map(String):repoId?[String(repoId)]:[];
 return {projects:selected.map(project=>({id:String(project.id),name:project.name,repos:project.sourceData?.repos||[]})),
  projectIds:selected.map(project=>String(project.id)),repoId:mentioned.length?repoId:named.length||explicit?null:repoId,
  repoIds:((named.length&&!mentioned.length)||(explicit&&!mentioned.length))?[]:repoIds,
  runId:named.length||explicit||/\b(?:history|historical|previous|older|versions?|compare|latest|newest|most recent)\b/i.test(query)?null:activeView.activeCodeArchitectureHazardRunId||null,
  types:[...(artifactTypesForAreas(areas)||[])],historyAllowed:/\b(?:histor(?:y|ical)|previous|older|versions?|compare|comparison|latest|newest|most recent)\b/i.test(query),
  query:String(query).slice(0,4000)};
}
export function validateWorkspaceReadCall(raw,policy){
 if(!raw||typeof raw!=='object'||!READ_OPERATIONS.includes(raw.operation))throw Error('Unsupported workspace read operation.');
 const allowedKeys=new Set(['operation','projectId','artifactId','otherArtifactId','query','field','section','path','runId','relationType','history','types','offset','limit','filters','groupBy','distinctFields']);
 if(Object.keys(raw).some(key=>!allowedKeys.has(key)))throw Error('Unsupported workspace read argument.');
 const call={operation:raw.operation};
 if(raw.projectId!=null&&!policy.projectIds.includes(String(raw.projectId)))throw Error('Read plan requested a project outside the user’s scope.');
 if(raw.projectId!=null)call.projectId=String(raw.projectId);
 for(const key of ['artifactId','otherArtifactId','query','field','section','path','runId','relationType'])if(raw[key]!=null){if(typeof raw[key]!=='string'||raw[key].length>512)throw Error('Invalid workspace read argument.');call[key]=raw[key];}
 if(['versions','compare'].includes(call.operation)&&!policy.historyAllowed)throw Error('Saved versions were not requested.');
 if(call.runId&&!policy.historyAllowed&&!normalize(policy.query).includes(normalize(call.runId)))throw Error('A different saved run must be selected explicitly.');
 if(raw.history==='all'&&!policy.historyAllowed)throw Error('History access was not requested.');
 call.history=raw.history==='all'?'all':'latest';
 const types=raw.types==null||(Array.isArray(raw.types)&&!raw.types.length&&policy.types.length)?policy.types:raw.types;
 if(!Array.isArray(types)||types.length>24||types.some(type=>typeof type!=='string'||type.length>100||!knownTypes.has(type)))throw Error('Invalid artifact types.');
 if(policy.types.length&&types.some(type=>!policy.types.includes(type)))throw Error('Read plan requested a capability outside the user’s scope.');
 call.types=types;
 for(const key of ['offset','limit'])if(raw[key]!=null){if(!Number.isSafeInteger(raw[key])||raw[key]<0||raw[key]>(key==='limit'?20:1000000))throw Error('Invalid workspace result range.');call[key]=raw[key];}
 if(raw.filters!=null){if(!Array.isArray(raw.filters)||raw.filters.length>8)throw Error('Too many workspace filters.');call.filters=raw.filters.map(filter=>{
  if(!filter||typeof filter.field!=='string'||filter.field.length>128||!['eq','contains','exists','gt','lt'].includes(filter.op)||!['string','number','boolean','undefined'].includes(typeof filter.value)||String(filter.value??'').length>512)throw Error('Invalid workspace filter.');
  return {field:filter.field,op:filter.op,value:filter.value};
 });}
 if(raw.distinctFields&&(raw.groupBy||call.operation!=='aggregate'))throw Error('Distinct counts are a separate aggregate operation.');
 if(raw.distinctFields!=null){if(!Array.isArray(raw.distinctFields)||!raw.distinctFields.length||raw.distinctFields.length>4||raw.distinctFields.some(field=>typeof field!=='string'||field.length>128))throw Error('Invalid distinct fields.');call.distinctFields=raw.distinctFields;}
 if(raw.groupBy!=null){if(typeof raw.groupBy!=='string'||raw.groupBy.length>128)throw Error('Invalid grouping field.');call.groupBy=raw.groupBy;}
 if(['read','relationships','compare'].includes(call.operation)&&!call.artifactId)throw Error('An exact artifact is required.');
 if(call.operation==='compare'&&!call.otherArtifactId)throw Error('Two saved artifacts are required for comparison.');
 if(call.operation==='source'&&call.path&&(call.path.startsWith('/')||call.path.includes('\\')||call.path.split('/').includes('..')||call.path.includes('\0')))throw Error('Source paths must be repository-relative.');
 if(call.operation==='source'&&!call.path)throw Error('A source-file path is required.');
 return call;
}
