// Review gates, not an automated safety approval or a source of risk ratings.
export const HARA_QUALITY_FIELDS = {
  vehicleHazard: 'Vehicle-Level Hazard', operationalSituation: 'Operational Situation',
  hazardOutcome: 'Hazard Outcome', harmChain: 'Harm Chain', evidenceBasis: 'Evidence Basis',
  exposureEvidence: 'Exposure Evidence', independentMeasures: 'Independent External Measures',
  safeStateJustification: 'Safe State Justification', safeStateEvidence: 'Safe State Evidence',
  fttiEvidence: 'FTTI Evidence', candidateRequirements: 'Candidate Safety Requirements',
  candidateTiming: 'Candidate Timing Requirements', proposedMitigations: 'Proposed Mitigations',
  safetyGoalRationale: 'Safety Goal Rationale', hazardMappingReview: 'Canonical Mapping Review',
  decisionBasis: 'Assessment Basis',
};
export const HARA_QUALITY_GUIDANCE = `HARA reasoning contract:
E describes exposure to the operational situation over the intended vehicle use. Never multiply it by malfunction, packet loss, acknowledgment timeout, communication outage, diagnostic or recovery-failure probability. Scenario criticality alone does not establish E2/E3. Use supplied quantitative or qualitative frequency/duration evidence when available; otherwise select ONE best-estimate E class from the intended use and state the operational-frequency assumption. Equivalent operational situations need the same exposure basis; identify a genuinely different sub-situation explicitly.
S describes potential injuries conditional on the hazardous event. S3 includes life-threatening injuries with uncertain survival and fatal injuries. Uncertain death is not a reason to downgrade S3. Do not lower S because an internal fallback, later detection, a retry or proposed mitigation might prevent the event. Preserve uncertainties as gaps.
C concerns the people at risk avoiding harm, not an engineer detecting, repairing or restarting an internal failure. Identify people, credible avoidance actions, time available, and sufficiently independent external measures supported by supplied evidence. An absent driver or inability to diagnose audio processing alone does not prove C3. Never invent emergency buttons, alternate cellular channels, passenger capacity or dispatch intervention.
Separate the interface malfunction, vehicle/item-level hazardous state, operational situation, and resulting injury in a complete harmChain. Distinguish missed/delayed real emergencies from false emergency alerts and resource diversion; never give materially different outcomes one combined risk argument. Use one primary outcome per assessment and flag additional outcomes for separate assessment where the source cannot resolve them.
evidenceBasis is E/E malfunction, SOTIF concern, or Mixed scope. Nominal recognition limitations without malfunction belong to SOTIF, not automatic ISO 26262 classification. Distinguish supplied architecture from engineering assumptions and required mitigations. Treat absent evidence as uncertainty, not proof of non-applicability. For every applicable event make ONE best-supported S/E/C decision and provide the complete harm argument. Do not leave decisions blank, return alternative ratings, or use Draft/Needs review as a result. decisionBasis is Source-supported or Engineering judgment. Put any necessary assumption in assumptions and explain it in the relevant rationale; do not represent an estimate as a documented fact.
Safety goals are concise item/vehicle-level functional objectives with a responsible entity and shall. Do not make a separate goal for every function/guide phrase. Keep frame rates, checksums, buffer rules, retries, watchdogs and per-function behaviour in candidateRequirements, with their source event retained. Never merge missed-emergency and false-alert goals simply because both involve audio.
A safeState needs safeStateJustification explaining how harm is prevented for THIS outcome. Suppressing alerts/rejecting audio can worsen missed emergencies; select an effective required response instead. Quote implemented architecture in safeStateEvidence when available; otherwise state that the response is a required safety measure and record the implementation assumption. Do not invent an existing fallback capability.
FTTI is the hazard-based interval between fault occurrence and potential hazardous event, not a frame period, processing deadline, diagnostic timeout, retry interval or minimum reporting duration. Use supplied hazard timing analysis when available. Otherwise give ONE hazard-based engineering estimate with its fault-to-hazard reasoning, assumptions and response allocation explicitly in fttiRationale. Never use an unexplained numerical default or pretend an estimate is measured evidence. If FTTI does not apply to this event, state Not applicable and explain why. Keep other deadlines in candidateTiming.
Compare the supplied canonical hazard with raw evidence and the event harm chain. hazardMappingReview must be Supported: <specific justification> or Mismatch: <reason and corrected vehicle-level state>. Do not overwrite an unrelated raw hazard with a canonical label. Retain source identities and original evidence. These are completed engineering decisions, not a claim of certification or proof that assumed architecture is implemented.`;

const text = value => String(value ?? '').replace(/\s+/g, ' ').trim();
export const haraKey = value => text(value).toLowerCase();
const absent = value => !text(value) || /^(?:not applicable|not provided|unknown|needs review|none|n\/a)\b/i.test(text(value));
export const substantiveHaraVerification = value => !absent(value) || text(value).length>80 && /inject|measure|verify|integration test|fault test/i.test(text(value));
export function haraSuppliedEvidence(value) {
  // Explicit assumptions/proposals may inform a review, but cannot corroborate
  // a claimed implemented safeguard or a validated timing bound.
  if(Array.isArray(value))return value.map(haraSuppliedEvidence);
  if(value && typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>!/assum|proposed|candidate/i.test(key)).map(([key,item])=>[key,haraSuppliedEvidence(item)]));
  return typeof value==='string'?value.split('\n').filter(line=>!/^\s*(?:context )?assumptions?\s*:/i.test(line)).join('\n'):value;
}
export const missingEvidenceExclusion = rationale => /(?:no|missing|lack(?:s|ing)?|not (?:provided|documented|specified|available)|insufficient|absen\w*)[^.]{0,80}(?:evidence|specification|document|interface|information)|(?:evidence|interface)[^.]{0,65}(?:missing|not provided|not documented|unavailable)/i.test(text(rationale));
export const implementationGoal = value => /\b(?:checksums?|crc|watchdogs?|retries|retry|frames?|buffers?|packets?|sampling rate|schema validation|validate (?:the |each )?(?:timestamp|schema)|countdown|\d+\s*(?:hz|ms|milliseconds))\b|(?:inhibit|reject|discard)[^.]{0,80}(?:commands?|messages?|data)[^.]{0,100}(?:stale|schema|timestamp|validation)|(?:validate|check)[^.]{0,50}(?:command|message|data)[^.]{0,50}(?:freshness|timestamp|schema)/i.test(text(value));
export const outcomeKinds = value => {
  const v = text(value), kinds=[];
  if (/\b(?:missed|undetected|unreported)\b[^.]{0,70}\bemergenc|\b(?:loss|absence|delay|failure|fail\w*|cannot|unable)\b[^.]{0,90}\b(?:detect\w*|report\w*|respond\w*|notif\w*)\b[^.]{0,70}\bemergenc|\bemergenc[^.]{0,100}\b(?:not detected|not reported|without response|reporting fails)\b/i.test(v)) kinds.push('missed-emergency');
  if (/\bfalse\b[^.]{0,40}\b(?:emergenc|alert|dispatch)|\b(?:spurious|unwarranted)\b[^.]{0,40}\b(?:alert|dispatch|emergenc)|resource diversion/i.test(v)) kinds.push('false-alert');
  return kinds;
};
const failureTerm = '(?:(?:communication|network|recovery|diagnostic|dispatch|transmission)[ /-]+)*(?:failures?|malfunctions?|outages?|packet[ -]loss|acknowledg\\w*\\s+timeouts?)';
const failureSubject = `(?:${failureTerm})(?:\\s*/\\s*(?:${failureTerm}))*`;
const failureStatistic = '(?:probability|likelihood|rates?|frequency)';
const excludedFailureBasis = new RegExp(`\\b(?:never|not|rather than|excluding|excludes?|independent(?:ly)? of)\\s+(?:(?:based on|determined by|using|including)\\s+)?(?:the\\s+)?(?:${failureSubject}\\s+${failureStatistic}|${failureStatistic}\\s+(?:of|for)\\s+(?:the\\s+)?${failureSubject})\\b`, 'gi');
export const positiveFailureBasis = value => {
  // Remove only the explicitly excluded factor first, in either word order.
  // This preserves a separate affirmative failure argument in the same sentence.
  const v=text(value).replace(excludedFailureBasis, '').replace(/(?:never|not|rather than|excluding)[^.;&]{0,100}(?:failure|malfunction|outage)[^.;&]{0,50}(?:probability|rate|frequency)|(?:never|not|excluding)\s+(?:the\s+)?(?:failure|malfunction)\s+(?:probability|rate)/gi,'');
  return /(?:probability|frequency|rate|exposure)[^.]{0,90}(?:fail(?:ure|s)|malfunction|packet loss|outage|acknowledg\w*\s+timeout)|(?:fail(?:ure|s)|malfunction|packet loss|outage|acknowledg\w*\s+timeout)[^.]{0,90}(?:probability|frequency|rate)|because[^.]{0,50}(?:transmissions? (?:will )?fail|network reliability)|(?:failures?|malfunctions?|outages?)[^.]{0,35}(?:occur\w*|are|is)\s+(?:only\s+)?(?:rare|infrequent|frequent|intermittent|occasional|low|high)/i.test(v);
};
export const diagnosticOnlyTiming = value => /(?:ftti (?:is|equals|must be)|derived from|based on|covers?)\s+(?:the\s+)?(?:minimum duration|\d+\s+(?:(?:consecutive|nominal)\s+)?(?:\d+\s*ms\s*)?frames?|frame (?:period|interval)|(?:diagnostic |acknowledg\w* |processing )?timeout|processing deadline|retry interval|(?:\d+(?:\.\d+)?[- ]?(?:ms|second|millisecond)s? )?(?:data )?freshness (?:threshold|window|limit))|minimum duration for which[^.]*updates|typical emergency response time|freshness window[^.]{0,160}(?:specified in|per) (?:the )?mitigation strategy/i.test(text(value));

// Only catch affirmative, blanket braking gates. Ordinary planned-stop gates
// and explicit emergency overrides are valid and must not be removed.
export function unsafeBrakingGate(value) {
  return text(value).split(/(?<=[.!?])\s+|\n/).some(sentence =>
    /(?:shall (?:not|never) (?:issue|apply|command|permit|authorize|allow)[^.]{0,60}brak|(?:inhibit|prohibit|prevent|disable|block)[^.]{0,35}brak|does not brake)[^.]{0,400}(?:until|unless|only when|only if)/i.test(sentence)
    && !/non[- ]emergency|routine (?:brak|planned)|planned[- ]stop|emergency brak[^.]{0,80}(?:override|exempt|always|precedence|remain available)/i.test(sentence));
}
export function supportedQuote(quote, source) {
  const q=haraKey(quote);
  return q.length>=16 && !/\btbd\b|\[.*\]|not provided|unknown/.test(q) && haraKey(source).includes(q);
}

export function haraRowFindings(get) {
  const issues=[],add=(code,detail)=>issues.push(`${code}: ${detail}`);
  if (/^no$/i.test(get('Guide Phrase Applicable'))) {
    if (missingEvidenceExclusion(get('Guide Phrase Applicability Rationale')) || absent(get('Guide Phrase Applicability Rationale'))) add('APPLICABILITY_EVIDENCE','Missing evidence does not prove non-applicability; review this exclusion.');
    if (substantiveHaraVerification(get('Verification Method')) || substantiveHaraVerification(get('Excluded Candidate Verification'))) add('EXCLUDED_VERIFICATION','A substantive candidate verification procedure is retained for an excluded row; reconcile applicability and procedure scope.');
    return issues;
  }
  const severity=get('Severity Rationale'), exposure=get('Exposure Rationale'), control=get('Controllability Rationale');
  if (positiveFailureBasis(exposure)) add('EXPOSURE_FAILURE_BASIS','Exposure uses malfunction/communication/recovery failure probability; assess only the operational situation.');
  if (!absent(get('Exposure')) && absent(get('Exposure Evidence')) && get('Assessment Basis')!=='Engineering judgment') add('EXPOSURE_EVIDENCE','Record the operational frequency evidence or engineering-frequency assumption behind the class.');
  if (/^S[012]$/i.test(get('Severity')) && /(?:death|fatal|survival)[^.]{0,65}(?:uncertain|not (?:certain|guaranteed))|(?:not certain|uncertain)[^.]{0,65}(?:death|fatal)|(?:fallback|mitigation)[^.]{0,110}(?:prevent|surviv|eventually|notif|mitigat)|not S3 because/i.test(severity)) add('SEVERITY_MITIGATION_CREDIT','Reassess potential injuries without crediting an internal/proposed fallback or treating uncertain death as lower severity.');
  if (/fallback|mitigation/i.test(severity) && /(?:depend|assum|if |credit)/i.test(severity) && !/without credit|no credit|not credit|unmitigated/i.test(severity)) add('SEVERITY_CONDITIONAL','Severity reasoning depends on fallback success; establish the unmitigated injury outcome.');
  if (get('Controllability')==='C3' && /detect|repair|diagnos|restart|internal.*fail/i.test(control) && !/avoid[^.]{0,80}(?:harm|injur|impact|collision)|(?:passenger|pedestrian|person|occupant)[^.]{0,80}(?:escape|evacuat|avoid)/i.test(control)) add('CONTROLLABILITY_HARM_AVOIDANCE','C3 needs a people-at-risk harm-avoidance argument; inability to diagnose or repair an internal fault is insufficient.');
  if (absent(get('Harm Chain')) || absent(get('Vehicle-Level Hazard'))) add('HARM_CHAIN','Distinguish the interface malfunction, vehicle-level hazardous state, operational situation and injury outcome.');
  const kinds=outcomeKinds(get('Hazardous Event')+' '+get('Potential Harm'));
  if (kinds.length>1) add('OUTCOME_SPLIT','Missed emergencies and false alerts/resource diversion require separate event assessments and risk reasoning.');
  if (implementationGoal(get('Safety Goal'))) add('GOAL_ABSTRACTION','Move function-specific mechanisms and timing to linked candidate requirements; define an item/vehicle-level goal.');
  if (!absent(get('Safe State')) && (absent(get('Safe State Evidence')) && get('Assessment Basis')!=='Engineering judgment' || absent(get('Safe State Justification')))) add('SAFE_RESPONSE_EVIDENCE','Record the required-response assumption or architecture evidence and harm-prevention justification.');
  if (/reject|suppress|discard|mute|disable.*alert/i.test(get('Safe State')) && kinds.includes('missed-emergency')) add('SAFE_RESPONSE_CONFLICT','Rejecting audio or suppressing alerts may worsen missed-emergency harm; validate an alternative harm-prevention path.');
  if (!absent(get('Fault Tolerant Time Interval')) && (absent(get('FTTI Evidence')) && get('Assessment Basis')!=='Engineering judgment' || diagnosticOnlyTiming(get('FTTI Rationale')))) add('FTTI_BASIS','Record fault-to-hazard timing evidence or the hazard-based estimate; a diagnostic/processing deadline is only a candidate timing requirement.');
  if (!/^Supported:\s*\S/i.test(get('Canonical Mapping Review'))) add('CANONICAL_MAPPING','Check the canonical hazard against this event and raw harm chain; an ID alone does not establish a valid mapping.');
  const mapped=outcomeKinds(get('Mapped Canonical Hazard')), actual=outcomeKinds(get('Hazardous Event'));
  if (mapped.length && actual.length && !mapped.some(kind=>actual.includes(kind))) add('CANONICAL_OUTCOME_MISMATCH','The canonical hazard and event describe different outcomes.');
  if (/SOTIF|nominal|insufficien/i.test(get('Evidence Basis'))) add('SCOPE_SOTIF','Distinguish nominal performance limitations from E/E malfunction hazards; retain for SOTIF/scope review.');
  if (absent(get('Evidence Basis'))) add('EVIDENCE_BASIS','Identify an E/E malfunction, SOTIF concern, mixed scope or missing evidence.');
  return issues;
}

export function guardGeneratedHaraAssessment(input, sourceEvidence) {
  const result={...input}, assumptions=[text(input.assumptions)].filter(value=>value && !/^(?:none|no (?:additional |necessary )?assumptions(?: required)?|not applicable|n\/a)\.?$/i.test(value));
  if(!supportedQuote(input.exposureEvidence,sourceEvidence))assumptions.push(`Exposure ${input.exposure} is an engineering judgment about the operational situation; a documented exposure study was not supplied.`);
  if(text(input.safeState) && !supportedQuote(input.safeStateEvidence,sourceEvidence))assumptions.push('The selected safe response is a required safety measure; its implementation is not established by the supplied architecture.');
  if(text(input.ftti) && !/^not applicable\b/i.test(input.ftti) && !supportedQuote(input.fttiEvidence,sourceEvidence))assumptions.push(`FTTI ${input.ftti} is a hazard-based engineering estimate, not a measured or validated timing bound.`);
  result.decisionBasis=assumptions.length?'Engineering judgment':'Source-supported';
  result.assumptions=[...new Set(assumptions)].join('\n');
  return result;
}

// Repair an unsound argument rather than publishing a withheld decision. The
// rules never select a numerical risk class in place of engineering reasoning.
export function generatedHaraDecisionErrors(row) {
  const errors=[],get=name=>row[Object.entries(HARA_QUALITY_FIELDS).find(([,header])=>header===name)?.[0]] || ({Severity:row.severity,'Severity Rationale':row.severityRationale,Exposure:row.exposure,'Exposure Rationale':row.exposureRationale,Controllability:row.controllability,'Controllability Rationale':row.controllabilityRationale,'Hazardous Event':row.hazardousEvent,'Potential Harm':row.potentialHarm,'Safe State':row.safeState,'Fault Tolerant Time Interval':row.ftti,'FTTI Rationale':row.fttiRationale,'Safety Goal':row.safetyGoal})[name] || '';
  for(const [field,pattern] of [['severity',/^S[0-3]$/],['exposure',/^E[0-4]$/],['controllability',/^C[0-3]$/]])if(!pattern.test(text(row[field])) && !(row.evidenceBasis==='SOTIF concern' && /^not applicable\b/i.test(text(row[field]))))errors.push(`Return exactly one ${field} decision, using the best supported engineering judgment if source evidence is incomplete.`);
  for(const field of ['vehicleHazard','harmChain','hazardOutcome','personsAtRisk','severityRationale','exposureRationale','controllabilityRationale','safetyGoal','safeState','safeStateJustification','ftti','fttiRationale'])if(!text(row[field]))errors.push(`Provide a complete ${field} decision and basis rather than withholding it.`);
  if(text(row.safetyGoal) && !/\bshall\b/i.test(row.safetyGoal))errors.push('Write the safety goal as a complete item-level shall statement.');
  const blocked=['EXPOSURE_FAILURE_BASIS','SEVERITY_MITIGATION_CREDIT','SEVERITY_CONDITIONAL','CONTROLLABILITY_HARM_AVOIDANCE','OUTCOME_SPLIT','SAFE_RESPONSE_CONFLICT'];
  errors.push(...haraRowFindings(get).filter(issue=>blocked.some(code=>issue.startsWith(code+':'))));
  if(diagnosticOnlyTiming(row.fttiRationale))errors.push('FTTI needs a fault-to-hazard argument; do not substitute a frame period, timeout or minimum reporting duration.');
  if(!/^not applicable\b/i.test(text(row.ftti)) && !/fault|hazard|harm|injur|fatal|collision|emergenc|crossing|time[- ]to|reaction/i.test(text(row.fttiRationale)))errors.push('Explain the fault-to-hazard interval underlying the selected FTTI or engineering estimate.');
  return errors;
}
