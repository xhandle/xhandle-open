const {test}=require('node:test'),assert=require('node:assert/strict');
const {preserveUnscoredAuditMetadata}=require('./quality-audit-transport.cjs');
test('No-row normalization preserves scored applicability and every finding/decision',()=>{
 const original=[{id:'A',scores:{grounding:8,applicability:7,causality:8,requirements:8,verification:8}}];
 const audits=[{id:'A',scores:{grounding:null,applicability:6,causality:null,requirements:null,verification:null},decisions:[{index:0,upheld:true}],newFindings:[{severity:'critical'}]}];
 const before=JSON.stringify(audits),[result]=preserveUnscoredAuditMetadata(audits,original,[{id:'A',applicable:'No'}]);
 assert.equal(result.scores.applicability,6);
 assert.equal(result.scores.grounding,8);
 assert.deepEqual(result.decisions,audits[0].decisions);assert.deepEqual(result.newFindings,audits[0].newFindings);
 assert.equal(JSON.stringify(audits),before);
});
test('applicable rows and unknown identities cannot acquire different scored values',()=>{
 const audits=[{id:'A',scores:{grounding:4,applicability:7}}];
 assert.deepEqual(preserveUnscoredAuditMetadata(audits,[{id:'A',scores:{grounding:9}}],[{id:'A',applicable:'Yes'}]),audits);
 assert.deepEqual(preserveUnscoredAuditMetadata(audits,[],[{id:'A',applicable:'No'}]),audits);
});
