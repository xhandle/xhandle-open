import { automaticEvidenceForNode, reconcileSafetyCaseEvidence } from './safetyCaseEvidenceAutomation';
import { evidenceRevision, requirementEvidence, verificationEvidence } from './safetyCaseEvidenceSources';
import { normalizeSafetyCase } from './safetyCaseTypes';

const requirement = requirementEvidence({id:'r',projectId:'p',title:'Stop safely',version:1});
const doc = {id:'d',sourceProjectId:'p',name:'Tests'};
const testRow = {id:'t',requirementId:'r',status:'Pass',evidence:'Execution log 42'};
const testArtifact = verificationEvidence(testRow, doc, requirement);
const makeCase = () => normalizeSafetyCase({id:'c',projectId:'p',nodes:[
  {id:'design',type:'claim',title:'User wording',metadata:{evidenceRole:'design'}},
  {id:'verification',type:'claim',title:'User verification',linkedArtifactIds:['manual'],metadata:{evidenceRole:'verification'}},
],edges:[]});
const snapshot = (artifacts=[requirement,testArtifact],extra={}) => ({projectId:'p',complete:true,errors:[],artifacts,...extra});
const sync = (safetyCase, input=snapshot()) => ({...safetyCase,evidenceAutomation:reconcileSafetyCaseEvidence(safetyCase,input,'2026-11-06T12:00:00Z')});

test('collects explicit traces into the argument without altering authored nodes, links or acceptance',()=>{
 const initial=makeCase(); initial.nodes[1].status='accepted';
 const next=sync(initial);
 expect(next.nodes).toBe(initial.nodes);
 expect(automaticEvidenceForNode(next,'verification')).toEqual([expect.objectContaining({id:testArtifact.id,state:'current',outcome:'passed',origin:'automatic',rationale:expect.stringContaining('explicitly targets')})]);
 expect(next.nodes[1].linkedArtifactIds).toEqual(['manual']);
 expect(next.nodes[1].status).toBe('accepted');
 expect(reconcileSafetyCaseEvidence(next,snapshot(),'later')).toBe(next.evidenceAutomation);
});

test('draft or ready plans never become passing evidence, even when their expected results sound positive',()=>{
 for(const status of ['Draft','Ready','Pass']){
  const planned=verificationEvidence({...testRow,status,evidence:''},doc,requirement);
  expect(planned.outcome).toBe('planned');
  expect(sync(makeCase(),snapshot([requirement,planned])).evidenceAutomation.allocations.find(a=>a.nodeId==='verification').state).toBe('planned');
 }
 const failed=verificationEvidence({...testRow,status:'Fail'},doc,requirement);
 expect(sync(makeCase(),snapshot([requirement,failed])).evidenceAutomation.allocations.find(a=>a.nodeId==='verification').state).toBe('failed');
});

test('source edits and deletions stay visible and changed revisions require explicit acknowledgement',()=>{
 const initial=sync(makeCase());
 const changed=verificationEvidence({...testRow,evidence:'New execution log'},doc,requirement);
 let next=sync(initial,snapshot([requirement,changed]));
 expect(automaticEvidenceForNode(next,'verification')[0].state).toBe('changed');
 next=sync(next,snapshot([requirement,changed]));
 expect(automaticEvidenceForNode(next,'verification')[0].state).toBe('changed');
 next.nodes=next.nodes.map(n=>n.id==='verification'?{...n,metadata:{...n.metadata,reviewedAutomaticEvidenceRevisions:{[testArtifact.id]:changed.revision}}}:n);
 next=sync(next,snapshot([requirement,changed]));
 expect(automaticEvidenceForNode(next,'verification')[0].state).toBe('current');
 const missing=sync(next,snapshot([requirement]));
 expect(automaticEvidenceForNode(missing,'verification')[0]).toMatchObject({title:changed.title,state:'missing'});
});

test('losing a requirement trace does not silently remove an earlier testArtifact allocation',()=>{
 const initial=sync(makeCase());
 const untraced=verificationEvidence(testRow,doc,null);
 const next=sync(initial,snapshot([untraced]));
 expect(automaticEvidenceForNode(next,'verification')[0].state).toBe('untraced');
 expect(next.evidenceAutomation.untracedTestCount).toBe(1);
});

test('persisted exclusions survive sync/restart and can be restored without changing manual links',()=>{
 let next=sync(makeCase());
 next.nodes[1].metadata.excludedAutomaticEvidenceIds=[testArtifact.id];
 next=sync(normalizeSafetyCase(JSON.parse(JSON.stringify(next))));
 expect(automaticEvidenceForNode(next,'verification')).toEqual([]);
 expect(next.nodes[1].linkedArtifactIds).toEqual(['manual']);
 next.nodes[1].metadata.excludedAutomaticEvidenceIds=[];
 expect(automaticEvidenceForNode(sync(next),'verification')).toHaveLength(1);
});

test('incomplete scans retain previous evidence and do not interpret read failures as deletion',()=>{
 const initial=sync(makeCase());
 const next=sync(initial,snapshot([],{complete:false,errors:['Unreadable']}));
 expect(next.evidenceAutomation.artifacts).toEqual(initial.evidenceAutomation.artifacts);
 expect(next.evidenceAutomation.allocations).toEqual(initial.evidenceAutomation.allocations);
 expect(next.evidenceAutomation.lastSyncedAt).toBe(initial.evidenceAutomation.lastSyncedAt);
 expect(next.evidenceAutomation.complete).toBe(false);
});

test('rejects foreign and unknown project records, including imported mismatched snapshots',()=>{
 const bad={...testArtifact,id:'foreign',projectId:'q'};
 const next=sync(makeCase(),snapshot([bad,{...testArtifact,id:'unknown',projectId:null}]));
 expect(next.evidenceAutomation.allocations).toEqual([]);
 expect(automaticEvidenceForNode({...next,evidenceAutomation:{...sync(makeCase()).evidenceAutomation,projectId:'q'}},'verification')).toEqual([]);
 const moved={...sync(makeCase()),projectId:'q',sourceProjectId:'q'};
 const failed=sync(moved,{projectId:'q',complete:false,errors:['offline'],artifacts:[]});
 expect(failed.evidenceAutomation.artifacts).toBeUndefined();
});

test('revisions are stable under key reordering and bind a result to its requirement revision',()=>{
 expect(evidenceRevision({a:1,b:2})).toBe(evidenceRevision({b:2,a:1}));
 expect(verificationEvidence(testRow,doc,{...requirement,revision:'new'}).revision).not.toBe(testArtifact.revision);
});
