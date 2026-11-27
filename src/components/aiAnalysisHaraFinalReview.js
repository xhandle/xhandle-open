import { fetchLLMResponse } from './aiAnalysisSTPA';
import { canDeferHazardFailure, preferredHazardFailure } from '../features/code-architecture-hazard-analysis/hazardDeferredFailures';
import { formatGovernedHazardPromptContext } from '../features/project-hazard-analysis/hazardPromptContext';
import { HARA_FINAL_REVIEW_VERSION, HARA_FINAL_REVIEW_FIELDS, haraReviewRecords, haraReviewInput,
  haraReviewSignature, applyHaraReviewPatches, harmonizeHaraReviewGoals, haraReviewChangeGroups } from '../features/project-hazard-analysis/haraFinalReview';
import { HARA_REVIEW_REASONING_RULES, identifiedHaraFinding, validateHaraFinding,
  inspectHaraReviewTable, haraReviewBatchContext, haraFinalReviewFindings, HARA_REVIEW_CHANGE_GROUPS } from '../features/project-hazard-analysis/haraReviewInspection';

const stageInstructions = {
  find: `Inspect the completed HARA table and identify specific issues. You are the reviewer, not the editor. Review all supplied fields against the reasoning rules, full-table inspection, shared context and related goals. Existing rule findings are ALREADY in the correction plan: do not repeat or explain them. Return at most THREE additional findings per assessment, prioritizing substantive cross-field/cross-row contradictions and regressions. Group related fields in one finding. Do not propose replacement cells. Use ONE concise sentence (at most 180 characters) for each reason and ONE short exact evidence quote (at most 160 characters). An empty quote is allowed only for an actually empty field. Return JSON only: {"findings":[{"id":"exact assessment ID","code":"CONTROLLABILITY|MITIGATION_CREDIT|SEVERITY|HARM|EXPOSURE|STOP_RESPONSE|FTTI|EVENT|GOAL|REQUIREMENT|CONSISTENCY","fields":["affected output field"],"reason":"specific problem","evidence":[{"field":"supplied field","quote":"short exact source text"}]}]}. Omit sound rows.`,
  correct: `Correct only the listed HARA review findings. You are the editor. Make one surgical correction pass. Each patch must name the finding IDs it addresses and use exact output field names. Correct related class/rationale fields together. Do not rewrite a whole assessment, change unrelated sound cells, or lower a classification by crediting a proposed/internal safeguard. Requirements are normative until implementation is independently established; never turn shall into implements. Keep a final assessment unchanged if no sound improvement is available. Return JSON only: {"patches":[{"id":"exact assessment ID","issueIds":["supplied finding ID"],"reason":"specific reason for these corrections","changes":{"Potential Harm":"event-specific human injury outcome"}}],"retained":[{"id":"exact assessment ID","issueIds":["supplied finding ID"],"reason":"why the existing final decision is retained"}]}. Each row occurs at most once in patches; omit unchanged fields. ASIL and goal links are calculated by the application; never return them.`,
  verify: `Independently verify proposed HARA corrections. You are a fresh verifier, not the editor. Use the ORIGINAL assessment, actual source/context, related groups, and proposed differences. The candidate equals the original plus proposal.changes. Do not trust a proposed rationale as evidence of an implemented capability. Check the engineering argument, people avoiding harm, injury outcome, timing dimensions/start/end events, safe response and shared-goal consistency. Look for NEW errors and unjustified risk downgrades. Each change group is independently reversible: accept a sound group even if an unrelated group is unsound, but reject groups dependent on a rejected correction. Return an explicit decision for EVERY changeId, with ONE concise, specific sentence (at most 240 characters) for its reason. Do not rewrite the analysis or suggest another pass. Return JSON only: {"checks":[{"changeId":"exact supplied change ID","accept":true,"reason":"independent reason this group improves the original without introducing a regression"}]}. Use accept:false for an unsound or unjustified change. Missing decisions retain original cells.`,
};
stageInstructions.refine = stageInstructions.correct + ` This is the ONE targeted refinement of machine-rejected changes, not another full review. refinement.machineFindings states the exact contradictions. Return changes ONLY in refinement.allowedFields; refinement.keepChanges are already sound and must not be repeated or changed. Resolve the actual listed defect rather than paraphrasing the same argument. A symbolic hazard-based timing allocation is permitted when numerical evidence is unavailable. Do not preserve a blanket rejection of still-required stopping. Do not withhold an injury consequence merely because the source core hazards are generic. Use the original finding IDs. If no sound correction is possible, retain those fields; there is no further repair request.`;
stageInstructions.correct += ` Address EVERY supplied finding that can be soundly corrected, not just the first. For a HARM finding, return an actual injury consequence, not a restatement of operational failure. For a CONTROLLABILITY finding, explicitly reconcile the class with people's available avoidance action; C0 is not zero control. For EXPOSURE, describe normal use without conditioning on the malfunction. For FTTI, a defined symbolic physical bound is preferable to inventing a measured timeout; revise conflicting response allocations together. For STOP_RESPONSE, distinguish routine stale commands from a stopping action still needed to prevent harm. Keep each replacement concise. Never return null/empty cells.`;
stageInstructions.verify += ` For EACH changeId, evaluate that group's diff separately. Unchanged problems outside its fields are not reasons to reject an independent improvement. Your reason must identify the actual human avoidance action for a control change, normal-use situation for exposure, injury outcome for harm, fault and hazard endpoints plus complete response allocation for timing, or preservation of necessary harm prevention for response. Challenge the original as well as the editor: an original C0 paired with no human avoidance is not sound merely because it is original. A symbolic engineering estimate is allowed. Do not reject a correction solely for lack of measured numbers. Do not authorize risk reductions from assumed internal protection. Check all proposed numerical S/E/C downgrades particularly carefully.`;

export function projectHaraFinalReviewPrompt(entries, { item, overview, organizationContext = '', phase = 'find' } = {}) {
  return `${stageInstructions[phase]}
${HARA_REVIEW_REASONING_RULES}
Shared Item: ${JSON.stringify(item || {})}
Whole-table inspection and related groups: ${JSON.stringify(overview || {})}
${formatGovernedHazardPromptContext({ organizationContext })}
Permitted HARA output fields: ${JSON.stringify([...HARA_FINAL_REVIEW_FIELDS])}
Operational context indices refer to the whole-table context catalog. A {sameAs:...} value references identical text in the original assessment, not a proposed replacement.
Assessments:\n${JSON.stringify(entries)}`;
}

function compactInput(record, inspection) {
  const input = haraReviewInput(record);
  input.context = inspection.contextById.get(record.id);
  for (const field of inspection.contextFields) delete input.source[field];
  if (input.assessment.Malfunction === input.source['Unsafe Control Action']) input.assessment.Malfunction = { sameAs: 'source.Unsafe Control Action' };
  input.findings = record.findings.map(({ code, fields }) => ({ code, fields }));
  return input;
}

export async function reviewProjectHaraFinal(sheets, { protectedCells = new Map(), organizationContext = '', generationCheckpoint,
  signal, runId = '', force = false, onProgress = () => {}, request } = {}) {
  const check = () => { if (signal?.aborted) throw Object.assign(Error('Final HARA review cancelled.'), { name: 'AbortError' }); };
  check();
  const contextSignature = haraReviewSignature({ organizationContext, item: sheets?.haraItem,
    protectedCells: [...protectedCells].map(([id, fields]) => [id, [...fields].sort()]).sort(([a], [b]) => a.localeCompare(b)) });
  if (!force && sheets?.haraPostReview?.version === HARA_FINAL_REVIEW_VERSION
    && sheets.haraPostReview.contextSignature === contextSignature
    && sheets.haraPostReview.resultSignature === haraReviewSignature(sheets.Summary)) return sheets;
  const records = haraReviewRecords(sheets, protectedCells), retained = [];
  if (!records.length) return sheets;
  const byId = new Map(records.map(record => [record.id, record]));
  const inspection = inspectHaraReviewTable(sheets, records);
  const inputs = new Map(records.map(record => [record.id, compactInput(record, inspection)]));
  const findings = new Map(records.map(record => [record.id, record.findings.map(finding => identifiedHaraFinding(record, finding))]));
  const reviewedIds = new Set(), proposals = new Map();
  const progress = (step, message) => { check(); onProgress({ step, total: 100, message }); };
  progress(2, `Inspected all ${records.length} applicable HARA assessments and shared table relationships.`);

  const pack = entries => {
    const batches = []; let batch = [], size = 2;
    for (const entry of entries) {
      const length = JSON.stringify(entry).length + 1;
      if (length > 100000) { retained.push({ id: entry.id, errors: ['Final assessment retained: detailed input exceeds this bounded review request.'] }); continue; }
      if (batch.length && (batch.length >= 12 || size + length > 60000)) { batches.push(batch); batch = []; size = 2; }
      batch.push(entry); size += length;
    }
    if (batch.length) batches.push(batch);
    return batches;
  };
  let failure;
  const run = async (batches, operation) => {
    let cursor = 0;
    const worker = async () => {
      while (cursor < batches.length && !failure) {
        const batch = batches[cursor++];
        try { check(); await operation(batch); } catch (error) { failure = preferredHazardFailure(failure, error); throw error; }
      }
    };
    await Promise.allSettled(Array.from({ length: Math.min(2, batches.length) }, worker));
    if (failure) throw failure;
    check();
  };
  const ask = async (entries, phase) => {
    check();
    const batchRecords = entries.map(entry => byId.get(entry.id));
    const prompt = projectHaraFinalReviewPrompt(entries, { item: sheets.haraItem,
      overview: haraReviewBatchContext(inspection, batchRecords), organizationContext, phase });
    const basis = { stage: HARA_FINAL_REVIEW_VERSION, phase, prompt };
    const parse = raw => {
      const body = typeof raw === 'string' ? JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')) : raw;
      const field = phase === 'find' ? 'findings' : phase === 'verify' ? 'checks' : 'patches';
      if (!body || !Array.isArray(body[field])) throw Error('Invalid HARA review stage envelope.');
      const limit = phase === 'verify' ? entries.reduce((sum, entry) => sum + entry.proposal.groups.length, 0) : entries.length * (phase === 'find' ? 3 : 1);
      if (body[field].length > limit) throw Error('HARA review stage output exceeds the bounded input.');
      const allowed = new Set(entries.map(entry => entry.id));
      const changeIds = new Set(entries.flatMap(entry => entry.proposal?.groups?.map(group => group.changeId) || []));
      const validIdentity = value => phase === 'verify' ? changeIds.has(value?.changeId) : allowed.has(value?.id);
      const identities = new Map();
      for (const value of body[field]) {
        const identity = phase === 'verify' ? value?.changeId : value?.id;
        if (validIdentity(value)) identities.set(identity, (identities.get(identity) || 0) + 1);
      }
      // A malformed entry cannot nominate a row or invalidate unrelated entries.
      // Ambiguous duplicates retain only that target's original cells.
      return { ...body, [field]: body[field].filter(value => validIdentity(value)
        && (phase === 'find' || identities.get(phase === 'verify' ? value.changeId : value.id) === 1)) };
    };
    const cached = force ? null : await generationCheckpoint?.read(basis); check();
    if (cached) { try { return parse(cached); } catch { /* One request for this phase replaces malformed cache data. */ } }
    let body;
    try {
      const raw = await (request ? request(prompt, { phase, entries }) : fetchLLMResponse(prompt, {}, [], '', { signal, maxTokens: ['correct', 'refine'].includes(phase) ? 16000 : 6000, workflow: 'hazard-row-generation' }));
      check(); body = parse(raw);
    } catch (error) { check(); if (!canDeferHazardFailure(error, signal)) throw error; return null; }
    await generationCheckpoint?.write(basis, body); check();
    return body;
  };

  // Phase 1: issue finding only. Local rules cover the whole table, including
  // rows whose remote request fails. No assessment is edited in this phase.
  let foundRows = 0;
  await run(pack([...inputs.values()]), async batch => {
    const response = await ask(batch, 'find');
    if (response) {
      batch.forEach(input => reviewedIds.add(input.id));
      for (const finding of response.findings) {
        const record = byId.get(finding.id);
        if (!validateHaraFinding(record, finding)) { retained.push({ id: finding.id, errors: ['An issue finding had an invalid source reference and was not used.'] }); continue; }
        const identified = identifiedHaraFinding(record, finding), list = findings.get(record.id);
        if (!list.some(item => item.findingId === identified.findingId)) list.push(identified);
      }
    }
    foundRows += batch.length;
    progress(5 + 30 * foundRows / records.length, `Reviewed ${foundRows} of ${records.length} HARA assessments for specific issues.`);
  });

  // Phase 2: a single correction request for each affected assessment. Bind the
  // response to the captured snapshot in code; the model need not copy a digest.
  const correctionInputs = records.filter(record => findings.get(record.id).length).map(record => ({ ...inputs.get(record.id),
    findings: findings.get(record.id).map(({ evidence, hash, ...finding }) => finding) }));
  let correctedRows = 0;
  await run(pack(correctionInputs), async batch => {
    const response = await ask(batch, 'correct');
    for (const patch of response?.patches || []) {
      const record = byId.get(patch.id), issues = findings.get(patch.id), ids = patch.issueIds;
      if ((patch.hash && patch.hash !== record.hash) || !Array.isArray(ids) || !ids.length
        || ids.some(id => !issues.some(issue => issue.findingId === id))) {
        retained.push({ id: patch.id, errors: ['Correction was not bound to the captured assessment and its findings.'] }); continue;
      }
      const fields = new Set(issues.filter(issue => ids.includes(issue.findingId)).flatMap(issue => issue.fields));
      if (!patch.changes || Object.keys(patch.changes).some(field => !fields.has(field))) {
        retained.push({ id: patch.id, errors: ['Correction changed a cell unrelated to its stated findings.'] }); continue;
      }
      proposals.set(patch.id, { ...patch, hash: record.hash });
    }
    for (const input of batch) if (!proposals.has(input.id)) retained.push({ id: input.id, errors: ['Existing final assessment retained after the single targeted correction step.'] });
    correctedRows += batch.length;
    progress(35 + 30 * correctedRows / Math.max(1, correctionInputs.length), `Completed targeted corrections for ${correctedRows} of ${correctionInputs.length} HARA assessments.`);
  });

  // Refine only machine-rejected fields once. The already valid groups are
  // frozen, so a second explanation cannot silently rewrite a sound decision.
  const refinementInputs = [], refinementKeeps = new Map();
  for (const [id, patch] of proposals) {
    const record = byId.get(id), grouped = haraReviewChangeGroups(record, patch);
    const rejectedFields = [...new Set(grouped.rejected.flatMap(item => item.fields || Object.keys(patch.changes)))];
    const keepChanges = Object.assign({}, ...grouped.groups.map(group => group.changes));
    const relatedFields = Object.values(HARA_REVIEW_CHANGE_GROUPS).filter(fields => fields.some(field => rejectedFields.includes(field))).flat();
    const allowedFields = [...new Set(relatedFields)].filter(field => field in record.row && HARA_FINAL_REVIEW_FIELDS.has(field)
      && !record.locked.includes(field) && !(field in keepChanges));
    if (!allowedFields.length) continue;
    refinementKeeps.set(id, keepChanges);
    refinementInputs.push({ ...inputs.get(id), findings: findings.get(id).map(({ evidence, hash, ...finding }) => finding),
      refinement: { allowedFields, previousChanges: patch.changes, keepChanges,
        machineFindings: grouped.rejected.map(item => ({ fields: item.fields || rejectedFields, errors: item.errors })) } });
    proposals.set(id, { ...patch, changes: keepChanges });
  }
  let refinedRows = 0;
  await run(pack(refinementInputs), async batch => {
    const response = await ask(batch, 'refine'), allowed = new Map(batch.map(input => [input.id, input]));
    for (const patch of response?.patches || []) {
      const input = allowed.get(patch.id), record = byId.get(patch.id), ids = patch.issueIds;
      const issues = findings.get(patch.id);
      const issueScope = new Set(issues.filter(issue => Array.isArray(ids) && ids.includes(issue.findingId)).flatMap(issue => issue.fields));
      if ((patch.hash && patch.hash !== record.hash) || !Array.isArray(ids) || !ids.length
        || ids.some(id => !issues.some(issue => issue.findingId === id)) || !patch.changes || typeof patch.changes !== 'object'
        || Object.keys(patch.changes).some(field => !input.refinement.allowedFields.includes(field) || !issueScope.has(field))) continue;
      const candidate = { ...patch, hash: record.hash }, grouped = haraReviewChangeGroups(record, candidate);
      retained.push(...grouped.rejected);
      proposals.set(patch.id, { ...candidate, changes: { ...refinementKeeps.get(patch.id), ...Object.assign({}, ...grouped.groups.map(group => group.changes)) } });
    }
    refinedRows += batch.length;
    progress(65, `Refined machine-rejected proposals for ${refinedRows} of ${refinementInputs.length} assessments; valid changes preserved.`);
  });

  // Goal refinements are expanded BEFORE verification, so linked assessments
  // cannot acquire an unverified change through propagation after the verifier.
  const harmonized = harmonizeHaraReviewGoals(records, [...proposals.values()]);
  retained.push(...harmonized.retained);
  const groupsById = new Map();
  for (const patch of harmonized.patches) {
    const grouped = haraReviewChangeGroups(byId.get(patch.id), patch);
    retained.push(...grouped.rejected);
    if (grouped.groups.length) groupsById.set(patch.id, grouped.groups);
  }
  const verificationInputs = [...groupsById].map(([id, groups]) => {
    const record = byId.get(id), changes = Object.assign({}, ...groups.map(group => group.changes));
    return { ...inputs.get(id), findings: findings.get(id).map(({ evidence, hash, ...finding }) => finding),
      proposal: { changes, groups: groups.map(({ changeId, group, changes }) => ({ changeId, group, fields: Object.keys(changes) })) },
      candidateRuleFindings: haraFinalReviewFindings({ ...record.row, ...changes }).map(({ code, fields }) => ({ code, fields })) };
  });

  // Phase 3: a fresh semantic verification request, with no editor explanation
  // treated as authority. No further repair calls or indefinite retries follow.
  const acceptedGroups = new Map(); let verifiedRows = 0;
  await run(pack(verificationInputs), async batch => {
    const response = await ask(batch, 'verify');
    const checks = new Map((response?.checks || []).map(item => [item.changeId, item]));
    for (const input of batch) {
      for (const group of groupsById.get(input.id)) {
        const verdict = checks.get(group.changeId);
        if (verdict?.accept === true && typeof verdict.reason === 'string' && verdict.reason.trim() && verdict.reason.length <= 2000) {
          acceptedGroups.set(group.changeId, { ...group, verificationReason: verdict.reason });
        } else retained.push({ id: input.id, fields: Object.keys(group.changes), errors: [verdict?.reason || 'Original cells retained: this proposed change did not receive a sound independent verification.'] });
      }
    }
    verifiedRows += batch.length;
    progress(65 + 30 * verifiedRows / Math.max(1, verificationInputs.length), `Independently verified corrections for ${verifiedRows} of ${verificationInputs.length} HARA assessments.`);
  });
  const sharedGoalEdits = new Map();
  for (const patch of harmonized.patches) {
    if (!('Safety Goal' in patch.changes)) continue;
    const key = byId.get(patch.id).row['Safety Goal ID'] || patch.id;
    if (!sharedGoalEdits.has(key)) sharedGoalEdits.set(key, []);
    sharedGoalEdits.get(key).push(patch.id);
  }
  for (const members of sharedGoalEdits.values()) {
    const groups = members.map(id => groupsById.get(id)?.find(group => group.group === 'goal'));
    if (groups.every(group => group && acceptedGroups.has(group.changeId))) continue;
    for (const group of groups.filter(Boolean)) acceptedGroups.delete(group.changeId);
    retained.push({ id: members[0], errors: ['Shared goal retained because its refinement was not independently verified for every linked assessment.'] });
  }
  const verifiedPatches = [];
  for (const record of records) {
    const groups = (groupsById.get(record.id) || []).filter(group => acceptedGroups.has(group.changeId));
    if (!groups.length) continue;
    verifiedPatches.push({ id: record.id, hash: record.hash,
      reason: groups.map(group => acceptedGroups.get(group.changeId).verificationReason).join(' ').slice(0, 2000),
      changes: Object.assign({}, ...groups.map(group => group.changes)) });
  }
  check();
  const result = applyHaraReviewPatches(sheets, records, verifiedPatches, { runId, retained, reviewedRows: reviewedIds.size });
  result.sheets.haraPostReview.inspection = inspection.overview;
  result.sheets.haraPostReview.contextSignature = contextSignature;
  result.sheets.haraPostReview.workflow = { phases: ['find', 'correct', 'verify'], findings: [...findings.values()].reduce((sum, list) => sum + list.length, 0),
    correctedRows, refinedRows, proposedGroups: [...groupsById.values()].reduce((sum, list) => sum + list.length, 0), verifiedGroups: acceptedGroups.size };
  const countFindings = rows => rows.reduce((counts, record) => {
    for (const finding of record.findings) counts[finding.code] = (counts[finding.code] || 0) + 1;
    return counts;
  }, {});
  result.sheets.haraPostReview.quality = { before: countFindings(records), after: countFindings(haraReviewRecords(result.sheets, protectedCells)),
    note: 'Rule findings measure specific reasoning patterns, not certification or a complete semantic quality score.' };
  progress(100, `Independent HARA verification completed. Saving ${result.sheets.haraPostReview.changedRows} corrected assessments…`);
  return result.sheets;
}
