// The fixed rubric scores only applicability on an excluded row. Preserve its
// original unused metadata so null normalization cannot masquerade as a scored
// change. Raw provider judgments remain in the request/response audit trail.
function preserveUnscoredAuditMetadata(audits,verdicts,assessments) {
  return audits.map(audit=>{
    if(assessments.find(row=>row.id===audit.id)?.applicable!=='No')return audit;
    const original=verdicts.find(row=>row.id===audit.id);
    if(!original)return audit;
    const scores={...audit.scores};
    for(const dimension of ['grounding','causality','requirements','verification'])scores[dimension]=original.scores?.[dimension];
    return {...audit,scores};
  });
}
module.exports={preserveUnscoredAuditMetadata};
