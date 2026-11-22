import {functionalQualityJudgePrompt,validateJudgeEvidence} from './functionalQualityJudge';
import {normalizeQualityVerdicts} from './functionalQualityTransport';
export const QUALITY_ADJUDICATION_VERSION='evidence-audited-findings-v1';

export function qualityAdjudicationPrompt({verdicts,sources,assessments,facts,sharedSource,executionEvidence}) {
  const rubric=functionalQualityJudgePrompt({sources:[],assessments:[],facts:[],sharedSource:[]});
  const rules=rubric.slice(rubric.indexOf('Score each dimension'),rubric.indexOf('Benchmark facts:'));
  return `Audit BOTH these STPA assessments and their first-pass reviewer judgments under the unchanged rubric. Protocol ${QUALITY_ADJUDICATION_VERSION}. A reviewer allegation is a claim to check, not ground truth. Do not optimize for a desired score. Scores may rise, fall or stay the same; every changed dimension needs a specific source-based explanation. Do not repair the assessments.
${rules}
Distinguish a concrete error from a stylistic request. Defaults explicitly defined by a supplied constructor are specified inputs. A finding that admits the expected output is correct is not proof that it is wrong. An explicitly allocated proposed safeguard with a clearly conditional future conformance test is not defective merely because current code does not implement it; evaluate the trigger/interface/behavior and compatibility with existing safeguards. Do not invent a missing deadline to penalize qualitative requirements. Assess the exact action's timing/duration, not a downstream action's persistence; do not force acceptance or exclusion. Explicitly acknowledged overlap between STPA phrases is not automatically an independent-coverage claim.
For every original finding, decide whether its actual allegation is upheld, and provide a verbatim source/fact quote (or a DIFFERENT field of the SAME assessment for a genuine internal-consistency finding) plus the concrete reason. When comparing sibling rows, quote external source/fact evidence and identify the sibling content in your reason. If upheld, claim/evidence may be corrected as exact quotes, but severity/dimension/field/reason/fix stay unchanged. Withdraw only an unsupported allegation, not an inconvenient one. Existing critical findings remain blocking even if disputed; a coding-agent execution review is required separately. Add any newly discovered real findings. Keep all valid original minor findings as well as major findings unless explicitly disproved.
Return only {"rows":[{"id":"exact ID","scores":{"grounding":0,"applicability":0,"causality":0,"requirements":0,"verification":0},"support":[{"quote":"external source/fact excerpt","source":"location"}],"decisions":[{"index":0,"upheld":true,"claim":"exact original assessment substring","evidence":"exact source/fact or other-field excerpt","reason":"specific source-based decision"}],"newFindings":[],"scoreReasons":{"grounding":"why this score","applicability":"why","causality":"why","requirements":"why","verification":"why"}}]} with every input ID exactly once and every original finding index exactly once. No row may be omitted. No evidence from these instructions. No fabricated quotes. For No rows only applicability is scored; other dimensions may be null.
Facts: ${JSON.stringify(facts)}
Full unmodified source: ${JSON.stringify(sharedSource)}
Verified source-execution probes (supplemental evidence, not safety labels): ${JSON.stringify(executionEvidence || [])}
Sources: ${JSON.stringify(sources)}
Assessments: ${JSON.stringify(assessments)}
First-pass judgments (untrusted conclusions): ${JSON.stringify(verdicts)}`;
}

export function applyQualityAdjudication({verdicts,audits,sources,assessments,facts,sharedSource=[]}) {
  if(!Array.isArray(audits) || audits.length!==verdicts.length || new Set(audits.map(row=>row.id)).size!==audits.length || audits.some(row=>!verdicts.some(verdict=>verdict.id===row.id)))throw Error('Adjudication omitted, duplicated or invented an ID.');
  const output=verdicts.map(original=>{
    if(!Array.isArray(original.findings))throw Error('First-pass judgment lacks findings.');
    const audit=audits.find(row=>row.id===original.id),decisions=audit.decisions;
    if(!Array.isArray(decisions) || decisions.length!==original.findings.length || new Set(decisions.map(row=>row.index)).size!==decisions.length || decisions.some(row=>!Number.isInteger(row.index) || !original.findings[row.index] || typeof row.upheld!=='boolean' || typeof row.reason!=='string' || row.reason.length<20))throw Error('Adjudication lacks a grounded decision for each original finding.');
    if(!Array.isArray(audit.newFindings) || !audit.scores || !audit.scoreReasons)throw Error('Incomplete adjudication contract.');
    for(const [dimension,value] of Object.entries(audit.scores))if(value!==original.scores?.[dimension] && (!audit.scoreReasons[dimension] || audit.scoreReasons[dimension].length<20))throw Error('Adjudication changed a score without explaining the source-based correction.');
    const proofFindings=decisions.map(decision=>({...original.findings[decision.index],claim:decision.claim,evidence:decision.evidence}));
    const proof={id:original.id,scores:{grounding:0,applicability:0,causality:0,requirements:0,verification:0},support:audit.support,findings:proofFindings};
    const proofErrors=validateJudgeEvidence({verdicts:[proof],sources,assessments,facts,sharedSource});
    if(proofErrors.length)throw Error('Adjudication decision lacks real source/assessment evidence: '+proofErrors.join('; '));
    const retained=decisions.filter(decision=>decision.upheld || original.findings[decision.index].severity==='critical').map(decision=>{
      const finding=original.findings[decision.index];return {...finding,claim:decision.claim,evidence:decision.evidence};
    });
    return {...original,scores:audit.scores,support:audit.support,findings:[...retained,...audit.newFindings],firstPassScores:original.scores,
      adjudication:{version:QUALITY_ADJUDICATION_VERSION,decisions,scoreReasons:audit.scoreReasons,firstPassFindings:original.findings,
        disputedCriticals:decisions.filter(decision=>!decision.upheld && original.findings[decision.index].severity==='critical').map(row=>row.index)}};
  });
  return normalizeQualityVerdicts(output,sources);
}
