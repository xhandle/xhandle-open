import { backendURL, buildAIAuthOpts } from "../../components/backendConfig";
import { normalizeNeedsReviewClassificationDecision } from "./needsReviewResolver";
import { auditSafetyClassificationRecord, isSubstantiveClassificationEvidence } from "./safetySignificancePolicy";
import { inspectClassificationResolution } from "./classificationResolutionStatus";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

/**
 * Identity of the contract a proposal was produced under.
 *
 * Recorded alongside every proposal so a stored decision can be traced to the
 * prompt, schema and policy that generated it. Without it, changing a prompt
 * silently reinterprets every decision already in the artifact.
 */
export const HAZARD_REVIEW_CONTRACT = Object.freeze({
  promptVersion: "hazard-review-prompt/2026-09-20",
  schemaVersion: "hazard-review-proposal/1",
  policyVersion: "safety-significance-policy/2026-09-20",
});

export const DEFAULT_HAZARD_REVIEW_TIMEOUT_MS = 120000;

/**
 * The review schema asks for roughly eighteen fields, several of them prose, and
 * reasoning models spend part of the output budget before emitting any of it. A
 * budget that is merely "usually enough" produces truncated JSON, which parses
 * to nothing and is then reported as "the model did not return a usable
 * proposal" -- indistinguishable from the model ignoring the format.
 */
export const HAZARD_REVIEW_TOKEN_BUDGET = 2600;
export const HAZARD_REVIEW_RETRY_TOKEN_BUDGET = 5200;

const TRUNCATED_FINISH_REASONS = new Set(["length", "max_tokens", "max_output_tokens"]);

export function isTruncatedCompletion(finishReason) {
  return TRUNCATED_FINISH_REASONS.has(String(finishReason || "").toLowerCase());
}

/**
 * Bound every hazard provider call the way the functional review already does.
 * A provider that never responds used to hang the review indefinitely with no
 * way back to the queue.
 */
export function callHazardReviewProvider({ label, workflow, provider, model, effort, signal, timeoutMs = DEFAULT_HAZARD_REVIEW_TIMEOUT_MS, maxTokens = 1500 }) {
  return async (messages, overrideMaxTokens) => {
    const tokenBudget = Number(overrideMaxTokens) > 0 ? Number(overrideMaxTokens) : maxTokens;
    const requestController = new AbortController();
    let timedOut = false;
    const forwardAbort = () => requestController.abort(signal?.reason);
    if (signal?.aborted) forwardAbort();
    else signal?.addEventListener?.("abort", forwardAbort, { once: true });
    const timeoutId = setTimeout(() => {
      timedOut = true;
      requestController.abort();
    }, Math.max(1, Number(timeoutMs) || DEFAULT_HAZARD_REVIEW_TIMEOUT_MS));
    try {
      const response = await fetch(`${backendURL}/api/chat`, {
        method: "POST",
        ...buildAIAuthOpts({ "Content-Type": "application/json" }),
        signal: requestController.signal,
        // Only fields the provider API understands may appear here: the backend
        // spreads this whole body into the upstream request, so an unrecognised
        // key is rejected by the provider. Contract identity is recorded on the
        // review session and its audit trail instead.
        body: JSON.stringify({
          provider, model, effort, reasoning_effort: effort,
          xhandleWorkflow: workflow, messages, temperature: 0.1, max_tokens: tokenBudget,
        }),
      });
      if (!response.ok) throw new Error(`${label} failed (${response.status}). ${await response.text().catch(() => "")}`.trim());
      const payload = await response.json();
      // The finish reason is the only way to tell a cut-off answer from a
      // badly-formatted one, and they need different remedies.
      return {
        text: extractVibeReviewProviderText(payload),
        finishReason: payload?.choices?.[0]?.finish_reason || payload?.stop_reason || "",
      };
    } catch (error) {
      if (timedOut) throw new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
      throw error;
    } finally {
      clearTimeout(timeoutId);
      signal?.removeEventListener?.("abort", forwardAbort);
    }
  };
}


function contentText(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(contentText).filter(Boolean).join("\n");
  if (value && typeof value === "object") return contentText(value.text || value.content || value.value || value.output_text);
  return "";
}

export function extractVibeReviewProviderText(payload = {}) {
  return [payload?.choices?.[0]?.message?.content, payload?.choices?.[0]?.text,
    payload?.content, payload?.result, payload?.answer, payload?.message, payload?.text,
    payload?.data?.content, payload?.data?.result, payload?.output, payload?.output_text,
    payload?.candidates?.[0]?.content?.parts].map(contentText).find((value) => clean(value)) || "";
}

export function parseVibeReviewProposal(value) {
  if (Array.isArray(value)) return value.length === 1 ? parseVibeReviewProposal(value[0]) : null;
  if (value && typeof value === "object") return value.proposal || value.data?.proposal || value;
  const raw = String(value || "").trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] || raw;
  try { const parsed = JSON.parse(fenced); return parsed.proposal || parsed.data?.proposal || parsed; } catch {}
  const start = fenced.indexOf("{"); const end = fenced.lastIndexOf("}");
  if (start >= 0 && end > start) try { const parsed = JSON.parse(fenced.slice(start, end + 1)); return parsed.proposal || parsed; } catch {}
  return null;
}

export function coerceVibeReviewProposal(value) {
  const root = parseVibeReviewProposal(value);
  if (!root || typeof root !== "object" || Array.isArray(root)) return {};
  const candidates = [
    root,
    root.proposal,
    root.assessment,
    root.review,
    root.result,
    root.data?.proposal,
    root.data?.assessment,
    root.data,
  ].filter((candidate) => candidate && typeof candidate === "object" && !Array.isArray(candidate));
  const proposal = candidates.find((candidate) => (
    candidate.normalizedDecision
    || candidate.normalized_decision
    || (typeof candidate.decision === "string" && candidate.decision)
    || candidate["Safety Classification"]
    || candidate.safetyClassification
    || candidate.safety_classification
  )) || candidates[0] || {};
  const normalizedDecision = clean(
    proposal.normalizedDecision
    || proposal.normalized_decision
    || (typeof proposal.decision === "string" ? proposal.decision : "")
    || proposal["Safety Classification"]
    || proposal.safetyClassification
    || proposal.safety_classification,
  );
  return normalizedDecision ? { ...proposal, normalizedDecision } : proposal;
}

const APPLICABILITY_NO_REASONS = new Set([
  "Semantic mismatch",
  "Receiver unaffected",
  "Architecture precludes deviation",
  "No adverse state in context",
]);

function canonicalApplicabilityDecision(value) {
  const candidate = clean(value);
  if (/^yes$/i.test(candidate)) return "Yes";
  if (/^no$/i.test(candidate)) return "No";
  if (/^needs review$/i.test(candidate)) return "Needs Review";
  return "";
}

function proposalObject(value) {
  const root = parseVibeReviewProposal(value);
  if (!root || typeof root !== "object" || Array.isArray(root)) return {};
  return root.proposal || root.assessment || root.review || root.result || root.data?.proposal || root.data || root;
}

function normalizedEvidence(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function groundedApplicabilityEvidence(proposal = {}, rowFields = {}) {
  const field = clean(proposal.notApplicableEvidenceField || proposal.evidenceField);
  const quote = clean(proposal.notApplicableEvidenceQuote || proposal.evidenceQuote);
  const matchingHeader = Object.keys(rowFields).find((header) => normalizedEvidence(header) === normalizedEvidence(field));
  return Boolean(
    matchingHeader
    && normalizedEvidence(quote).length >= 8
    && normalizedEvidence(rowFields[matchingHeader]).includes(normalizedEvidence(quote))
  );
}

export function normalizeGuidePhraseApplicabilityProposal(raw = {}, rowFields = {}) {
  const proposal = proposalObject(raw);
  const decision = canonicalApplicabilityDecision(
    proposal.applicabilityDecision
    || proposal.guidePhraseApplicable
    || proposal["Guide Phrase Applicable"]
    || proposal.normalizedDecision
    || proposal.decision,
  );
  const rationale = clean(
    proposal["Guide Phrase Applicability Rationale"]
    || proposal.guidePhraseApplicabilityRationale
    || proposal.rationale
    || proposal.explanation,
  );
  const mechanism = clean(proposal.applicabilityMechanism || proposal.mechanism || proposal.explanation);
  const evidenceGap = clean(proposal.remainingEvidenceGap || proposal.evidenceGap);
  const errors = [];
  if (!decision) errors.push("Provider update omitted the required applicabilityDecision");
  if (decision === "Yes" && (!rationale || !mechanism)) {
    errors.push("An applicable decision must explain how the exact guide-phrase deviation can affect the receiving function");
  }
  if (decision === "No") {
    const reasonCode = clean(proposal.notApplicableReasonCode);
    const strongestReason = clean(proposal.strongestReasonForNo || proposal.reasonNotApplicable);
    if (!APPLICABILITY_NO_REASONS.has(reasonCode) || !strongestReason || !groundedApplicabilityEvidence(proposal, rowFields)) {
      errors.push("A No decision requires a grounded non-applicability proof, reason code, source field, and exact source excerpt");
    }
  }
  if (decision === "Needs Review" && !evidenceGap) {
    errors.push("Needs Review requires one concise material applicability evidence gap");
  }
  const governedDecision = decision && !errors.length ? {
    "Guide Phrase Applicable": decision,
    "Guide Phrase Applicability Rationale": rationale || `Needs review: ${evidenceGap}.`,
  } : null;
  return {
    valid: Boolean(governedDecision && decision !== "Needs Review"),
    errors,
    evidenceGap: evidenceGap || errors[0] || "A definitive guide-phrase applicability decision was not supported.",
    proposal: {
      ...proposal,
      sourceRowId: proposal.sourceRowId || rowFields["Raw Analysis Row ID"],
      applicabilityDecision: decision || "Needs Review",
      normalizedDecision: decision || "Needs Review",
      applicabilityConfidence: clean(proposal["Classification Confidence"] || proposal.classificationConfidence || proposal.confidence || (decision === "Needs Review" ? "Low" : "Medium")),
      governedDecision,
    },
  };
}

/**
 * Compose a governed rationale that does not repeat or nest itself.
 *
 * The rationale is written back into the row, so the next decision reads it as
 * "existing basis" and embeds it again -- a row reviewed three times carried
 * three nested copies of its own history inside the largest artifact in browser
 * storage. The reviewer's decision and any genuinely new gap are the durable
 * content; prior rationales remain in the revision history and audit trail.
 */
const GOVERNED_RATIONALE_MAX_CHARS = 1200;
const PRIOR_RATIONALE_MARKER = /^Human-directed (?:Vibe Review|Safety Classification) decision:/i;

/**
 * A field that already holds a previous governed rationale is history, not
 * evidence for the next decision. Embedding it -- even wrapped in "Existing
 * documented basis:" -- is what made the rationale grow on every review.
 */
export function withoutPriorGovernedRationale(value) {
  const text = clean(value);
  return PRIOR_RATIONALE_MARKER.test(text) ? "" : text;
}

export function composeGovernedRationale(parts = []) {
  const seen = new Set();
  const kept = [];
  parts.map((part) => clean(part)).filter(Boolean).forEach((part, index) => {
    // The first part is this decision's own header. A later part that looks
    // like one is a PRIOR decision's rationale: history, not evidence here.
    if (index > 0 && PRIOR_RATIONALE_MARKER.test(part)) return;
    const fingerprint = part.toLowerCase();
    if (seen.has(fingerprint)) return;
    seen.add(fingerprint);
    kept.push(part);
  });
  const composed = kept.join(" ");
  if (composed.length <= GOVERNED_RATIONALE_MAX_CHARS) return composed;
  return `${composed.slice(0, GOVERNED_RATIONALE_MAX_CHARS).trimEnd()}… (rationale truncated; the full history is in the review audit trail.)`;
}


export function buildHumanGuidePhraseApplicabilityDecision({ rowFields = {}, proposal = {}, applicable, userFeedback = "", proposalValid = null } = {}) {
  const decision = /^yes$/i.test(clean(applicable)) ? "Yes" : "No";
  const reviewerBasis = clean(userFeedback);
  const proposed = proposalValid === false ? {} : (proposal?.governedDecision || {});
  if (decision === "No" && proposed["Guide Phrase Applicable"] !== "No" && !reviewerBasis) {
    throw new Error("Mark No requires a row-specific explanation of why this guide-phrase deviation cannot affect the receiving function. Reply “no — because …” or skip it.");
  }
  const existingGap = firstValue(proposal.remainingEvidenceGap, proposal.evidenceGap);
  const baseRationale = withoutPriorGovernedRationale(firstValue(
    reviewerBasis,
    proposed["Guide Phrase Applicability Rationale"],
    rowFields["Guide Phrase Applicability Rationale"],
  )) || clean(reviewerBasis);
  const applicabilityGapAdds = existingGap && clean(existingGap).toLowerCase() !== clean(baseRationale).toLowerCase();
  const rationale = composeGovernedRationale([
    `Human-directed Vibe Review decision: Guide Phrase Applicable = ${decision}.`,
    baseRationale || (decision === "Yes"
      ? "The reviewer determined that the stated deviation is meaningful for this interface and can affect the receiving function."
      : "The reviewer determined that the stated deviation cannot affect the receiving function in this context."),
    applicabilityGapAdds ? `Remaining contract or downstream-classification evidence gap: ${existingGap}` : "",
    "This applicability disposition does not independently resolve Safety Significance.",
  ]);
  return {
    sourceRowId: rowFields["Raw Analysis Row ID"],
    reviewTarget: "guidePhraseApplicable",
    humanAdjudication: true,
    applicabilityDecision: decision,
    normalizedDecision: decision,
    "Guide Phrase Applicable": decision,
    "Guide Phrase Applicability Rationale": rationale,
    applicabilityConfidence: reviewerBasis ? "Medium" : "Low",
    remainingEvidenceGap: existingGap,
    governedDecision: {
      "Guide Phrase Applicable": decision,
      "Guide Phrase Applicability Rationale": rationale,
    },
  };
}

export async function requestGuidePhraseApplicabilityProposal({ headers, row, projectName, organizationContext = "", provider, model, effort, signal }) {
  const rowFields = compactVibeReviewRow(headers, row);
  const prompt = `Review exactly one hazard-analysis row for Guide Phrase Applicable only. This is an applicability decision, not a Safety Significance classification.\n\nProject: ${projectName || "Untitled project"}\n${organizationContext || "No applicable organization profile text is available."}\n\nRow evidence:\n${JSON.stringify(rowFields, null, 2)}\n\nReturn strict JSON with: sourceRowId, explanation, applicabilityDecision, Guide Phrase Applicable, Guide Phrase Applicability Rationale, applicabilityMechanism, notApplicableReasonCode, strongestReasonForNo, notApplicableEvidenceField, notApplicableEvidenceQuote, Classification Confidence, remainingEvidenceGap.\nRules: applicabilityDecision and Guide Phrase Applicable must be exactly Yes, No, or Needs Review. Decide whether the named guide-phrase deviation is semantically meaningful for this interface and can affect the receiving function in the stated context. Do not decide whether the resulting effect is Safety Significant. Missing numeric thresholds, validity windows, protections, or downstream physical-harm evidence may lower confidence or remain as an evidence gap, but they are not by themselves proof that a semantically possible deviation is inapplicable. For Yes, name the interface-specific receiver effect in applicabilityMechanism. For No, satisfy a strict proof obligation: notApplicableReasonCode is exactly Semantic mismatch, Receiver unaffected, Architecture precludes deviation, or No adverse state in context; strongestReasonForNo states why the deviation cannot matter; and notApplicableEvidenceField plus notApplicableEvidenceQuote cite an exact excerpt from the supplied row. Use Needs Review only when the supplied interface semantics truly cannot establish whether the deviation can occur or affect the receiver.`;
  const callProvider = callHazardReviewProvider({
    label: "Guide-phrase applicability review",
    workflow: "hazard-applicability-vibe-review",
    provider, model, effort, signal,
  });
  const messages = [
    { role: "system", content: "Assess only guide-phrase applicability for one interface. Keep applicability separate from downstream safety classification. Return strict JSON only." },
    { role: "user", content: prompt },
  ];
  const attempt = await requestCompletion(callProvider, messages, { budget: HAZARD_REVIEW_TOKEN_BUDGET });
  const rawText = attempt.text;
  let normalized = normalizeGuidePhraseApplicabilityProposal(rawText, rowFields);
  if (normalized.valid) return normalized;
  const repairedText = await callProvider([
    { role: "system", content: "Repair one guide-phrase applicability proposal. Use only supplied evidence, keep applicability separate from safety significance, and return strict JSON only." },
    { role: "user", content: `The proposal failed: ${normalized.errors.join("; ") || normalized.evidenceGap}. Reissue the complete object. A missing interface contract is not proof of non-applicability when the deviation is semantically meaningful.\n\nOriginal task:\n${prompt}\n\nProvider response:\n${rawText || "(empty response)"}` },
  ]);
  normalized = normalizeGuidePhraseApplicabilityProposal(repairedText.text ?? repairedText, rowFields);
  return { ...normalized, providerFailure: normalized.valid ? null : describeProviderFormatFailure(attempt) };
}


/**
 * Ask the provider, and if the answer was cut off, ask again with room.
 *
 * A truncated completion is the one failure the caller can actually fix, so it
 * is worth one retry with a larger budget before reporting a format failure.
 */
async function requestCompletion(callProvider, messages, { budget, retryBudget } = {}) {
  let attempt = await callProvider(messages, budget);
  if (isTruncatedCompletion(attempt.finishReason) || !clean(attempt.text)) {
    attempt = await callProvider(messages, retryBudget || HAZARD_REVIEW_RETRY_TOKEN_BUDGET);
  }
  return attempt;
}

/** Explain a format failure in terms the reviewer can act on. */
export function describeProviderFormatFailure(attempt) {
  if (isTruncatedCompletion(attempt?.finishReason)) {
    return "the model's response was cut off before it finished the assessment";
  }
  if (!clean(attempt?.text)) return "the model returned an empty response";
  return "the model did not return the required structured fields";
}

export function normalizeVibeReviewProposal(raw = {}, rowFields = {}, requestedSignificance = "") {
  const proposal = coerceVibeReviewProposal(raw);
  const desired = requestedSignificance === "Yes" ? /Safety/.test(proposal.normalizedDecision || "")
    : requestedSignificance === "No" ? /Mission|Not Applicable/.test(proposal.normalizedDecision || "") : true;
  if (!desired) return { valid: false, errors: [`The proposal did not establish a coherent ${requestedSignificance} subtype.`], proposal };
  const proposedIntermediateFunction = clean(proposal["Intermediate Safety Function"] || proposal.intermediateSafetyFunction);
  const proposedIntermediateEffect = clean(proposal["Intermediate Safety Effect"] || proposal.intermediateSafetyEffect);
  const directDependsOnIntermediate = /^Safety\s*[—-]\s*Direct$/i.test(clean(proposal.normalizedDecision))
    && proposedIntermediateFunction && proposedIntermediateEffect
    && !/^not applicable$/i.test(proposedIntermediateFunction)
    && !/^not applicable$/i.test(proposedIntermediateEffect);
  const proposalForNormalization = directDependsOnIntermediate
    ? { ...proposal, normalizedDecision: "Safety — Related", "Safety Classification": "Safety — Related", "Causal Path Type": "Contributory" }
    : proposal;
  const normalized = normalizeNeedsReviewClassificationDecision(proposalForNormalization, rowFields, rowFields["Safety Classification Rule"] || "U4");
  const governed = normalized.decision;
  const mergeAliases = (...values) => values.map(clean).filter(Boolean).join(" ");
  // The governed decision is a COMPLETE materialized candidate row:
  // normalizeNeedsReviewClassificationDecision already folds in the current row
  // for every field the proposal left unset, and deliberately emits "" for the
  // fields this classification must not carry. Validating a concatenation of the
  // pre-update row and the candidate therefore resurrects evidence the candidate
  // just cleared -- a proposed Direct would be audited against the previous
  // Related intermediate effect and rejected for a contradiction that exists in
  // neither state. The validator must see exactly one complete candidate.
  const audited = auditSafetyClassificationRecord({
    guidePhrase: rowFields["Guide Phrase"],
    guidePhraseApplicable: governed["Guide Phrase Applicable"],
    safetyClassification: governed["Safety Classification"],
    safetyClassificationRule: governed["Safety Classification Rule"],
    causalPathType: governed["Causal Path Type"],
    causalEffect: governed["Causal Effect"],
    resultingSystemState: governed["Resulting System State"],
    intermediateSafetyFunction: governed["Intermediate Safety Function"],
    intermediateSafetyEffect: governed["Intermediate Safety Effect"],
    protectionAssessment: governed["Protection Assessment"],
    protectionStatus: governed["Protection Status"],
    physicalHarmChainTermination: governed["Physical-Harm Chain Termination"],
    classificationEvidence: governed["Classification Evidence"],
    safetySignificanceRationale: governed["Safety Significance Rationale"],
    proposedSafetyAssessmentRationale: governed["Proposed Safety Assessment Rationale"],
    proposedSafetyAssessment: governed["Proposed Safety Assessment"],
    safetySignificant: governed["Safety Significant"],
    // Losses and Hazards are not governed by the decision; these merge two
    // spellings of the same source column, not old and new state.
    losses: mergeAliases(rowFields.Losses, rowFields.Loss),
    hazards: mergeAliases(rowFields.Hazards, rowFields.Hazard),
    causalScenario: rowFields["Causal Scenario"],
    safetyExposurePath: rowFields["Safety Exposure Path"],
  }, {
    from: rowFields["Function (From)"],
    controlAction: rowFields["Control Action"],
    to: rowFields["Function (To)"],
    guidePhrase: rowFields["Guide Phrase"],
  });
  const auditErrors = audited.validationFindings || [];
  const errors = [...normalized.errors, ...auditErrors];
  const classification = errors.length ? "Needs Review" : governed["Safety Classification"];
  const governedDecision = errors.length ? {
    ...governed,
    "Safety Classification": "Needs Review",
    "Safety Classification Rule": audited.safetyClassificationRule,
    "Causal Path Type": "Uncertain",
    "Safety Significant": "Needs Review",
    "Proposed Safety Assessment": audited.proposedSafetyAssessment,
    "Classification Confidence": "Low",
    "Safety Significance Rationale": `Needs review: ${errors.join("; ")}.`,
  } : governed;
  const definitive = classification !== "Needs Review" && errors.length === 0;
  return {
    valid: definitive,
    errors,
    evidenceGap: proposal.remainingEvidenceGap || normalized.evidenceGap || errors[0] || "A definitive causal classification could not be established from the documented evidence.",
    proposal: { ...proposal, sourceRowId: proposal.sourceRowId || rowFields["Raw Analysis Row ID"], normalizedDecision: classification, governedDecision },
  };
}

const CLASSIFICATION_FIELDS = ["Safety Classification", "Safety Classification Rule", "Causal Path Type", "Classification Evidence", "Classification Confidence"];

function isExplicitProtectionOnlyGap(value = "") {
  const gap = clean(value);
  if (!gap) return false;
  return /(?:affects?|concerns?|changes?|limits?|applies? to) protection status only/i.test(gap)
    || /does not (?:unresolve|invalidate|prevent|block|change) (?:the )?(?:causal )?classification/i.test(gap)
    || /classification (?:is|remains) (?:otherwise )?(?:resolved|established|supported)/i.test(gap);
}

function classificationFromEstablishedPath(supplied = {}, rowFields = {}) {
  const intermediateFunction = clean(supplied["Intermediate Safety Function"] || rowFields["Intermediate Safety Function"]);
  const intermediateEffect = clean(supplied["Intermediate Safety Effect"] || rowFields["Intermediate Safety Effect"]);
  const path = clean(supplied["Causal Path Type"] || rowFields["Causal Path Type"]);
  return (intermediateFunction && intermediateEffect && !/^not applicable$/i.test(intermediateFunction) && !/^not applicable$/i.test(intermediateEffect))
    || /contribut|related|intermediate/i.test(path)
    ? "Safety — Related"
    : "Safety — Direct";
}

export function buildDeterministicClassificationResolutionRepair(rowFields = {}, findings = []) {
  const messages = (findings || []).map(clean).filter(Boolean);
  const directWithIntermediate = messages.some((finding) => (
    /Safety\s*[—-]\s*Direct cannot depend on an intermediate safety function/i.test(finding)
  ));
  const intermediateFunction = clean(rowFields["Intermediate Safety Function"]);
  const intermediateEffect = clean(rowFields["Intermediate Safety Effect"]);
  if (directWithIntermediate
    && isSubstantiveClassificationEvidence(intermediateFunction)
    && isSubstantiveClassificationEvidence(intermediateEffect)) return {
    sourceRowId: rowFields["Raw Analysis Row ID"],
    normalizedDecision: "Safety — Related",
    "Safety Classification": "Safety — Related",
    "Safety Classification Rule": "R1",
    "Causal Path Type": "Contributory",
    "Causal Effect": rowFields["Causal Effect"],
    "Resulting System State": rowFields["Resulting System State"],
    "Intermediate Safety Function": intermediateFunction,
    "Intermediate Safety Effect": intermediateEffect,
    "Protection Assessment": rowFields["Protection Assessment"],
    "Protection Status": rowFields["Protection Status"],
    "Physical-Harm Chain Termination": rowFields["Physical-Harm Chain Termination"],
    "Classification Evidence": [
      clean(rowFields["Classification Evidence"]),
      `Policy reconciliation: the documented path depends on ${intermediateFunction}, whose documented effect is ${intermediateEffect}; the path is therefore contributory rather than direct.`,
    ].filter(Boolean).join(" "),
    "Classification Confidence": "High",
    explanation: "The existing row evidence establishes an intermediate safety function and its effect, so the causal path is contributory and the coherent classification is Safety — Related.",
    remainingEvidenceGap: "",
  };

  const relatedWithoutIntermediate = messages.some((finding) => (
    /Safety\s*[—-]\s*Related requires (?:a named )?intermediate safety function/i.test(finding)
    || /Safety\s*[—-]\s*Related requires the effect on the intermediate safety function/i.test(finding)
  ));
  const causalEffect = clean(rowFields["Causal Effect"]);
  const resultingState = clean(rowFields["Resulting System State"]);
  const physicalHarmEvidence = clean(rowFields.Hazard || rowFields.Hazards || rowFields.Loss || rowFields.Losses || rowFields["Causal Scenario"]);
  if (!relatedWithoutIntermediate
    || isSubstantiveClassificationEvidence(intermediateFunction)
    || isSubstantiveClassificationEvidence(intermediateEffect)
    || !causalEffect || !resultingState || !physicalHarmEvidence) return null;

  return {
    sourceRowId: rowFields["Raw Analysis Row ID"],
    normalizedDecision: "Safety — Direct",
    "Safety Classification": "Safety — Direct",
    "Safety Classification Rule": "D1",
    "Causal Path Type": "Direct",
    "Causal Effect": causalEffect,
    "Resulting System State": resultingState,
    "Intermediate Safety Function": "",
    "Intermediate Safety Effect": "",
    "Protection Assessment": rowFields["Protection Assessment"],
    "Protection Status": rowFields["Protection Status"],
    "Physical-Harm Chain Termination": "",
    "Classification Evidence": [
      clean(rowFields["Classification Evidence"]),
      "Policy reconciliation: no substantive intermediate safety function or effect is documented, so the established physical-harm path is direct rather than contributory.",
    ].filter(Boolean).join(" "),
    "Classification Confidence": "High",
    explanation: "The row documents a causal effect, hazardous resulting state, and physical-harm path without a substantive intervening safety function, so the coherent classification is Safety — Direct.",
    remainingEvidenceGap: "",
  };
}

export function normalizeSafetyClassificationProposal(raw = {}, rowFields = {}) {
  const applicability = canonicalApplicabilityDecision(rowFields["Guide Phrase Applicable"]);
  const significance = canonicalApplicabilityDecision(rowFields["Safety Significant"]);
  const supplied = proposalObject(raw);
  let candidate = coerceVibeReviewProposal(raw).normalizedDecision || "";
  if (applicability === "No" || (applicability === "Yes" && significance === "No")) {
    candidate = applicability === "No" ? "Not Applicable" : "Mission/Reliability";
    const rule = candidate === "Not Applicable" ? "N1" : "M1";
    const rationale = clean(supplied["Classification Evidence"] || supplied.explanation || supplied.rationale
      || `Governed ${applicability === "No" ? "Guide Phrase Applicable = No" : "Safety Significant = No"} constrains this classification to ${candidate}.`);
    return { valid: true, errors: [], evidenceGap: clean(supplied.remainingEvidenceGap), proposal: {
      ...supplied, sourceRowId: supplied.sourceRowId || rowFields["Raw Analysis Row ID"], reviewTarget: "safetyClassification", normalizedDecision: candidate,
      governedDecision: { "Safety Classification": candidate, "Safety Classification Rule": rule, "Causal Path Type": "None",
        "Classification Evidence": rationale, "Classification Confidence": clean(supplied["Classification Confidence"] || supplied.confidence || "High") },
    } };
  }
  if (!significance && !["Mission/Reliability", "Safety — Direct", "Safety — Related", "Not Applicable"].includes(candidate)) {
    return { valid: false, errors: ["Safety significance is unresolved"], evidenceGap: "The classification depends on an unresolved governed Safety Significant disposition.", proposal: { ...supplied, reviewTarget: "safetyClassification", normalizedDecision: "Needs Review", governedDecision: null } };
  }
  const suppliedGap = clean(supplied.remainingEvidenceGap || supplied.evidenceGap);
  if (candidate === "Needs Review" && significance === "Yes" && isExplicitProtectionOnlyGap(suppliedGap)) {
    candidate = classificationFromEstablishedPath(supplied, rowFields);
  }
  if (applicability === "Yes" && significance === "Yes" && !["Safety — Direct", "Safety — Related"].includes(candidate)) candidate = "Needs Review";
  const normalized = normalizeVibeReviewProposal({ ...proposalObject(raw), normalizedDecision: candidate }, rowFields);
  const governed = normalized.proposal?.governedDecision || {};
  const constrained = Object.fromEntries(CLASSIFICATION_FIELDS.map((field) => [field, governed[field]]).filter(([, value]) => clean(value)));
  const valid = normalized.valid && candidate !== "Needs Review";
  return {
    ...normalized,
    valid,
    evidenceGap: valid ? normalized.evidenceGap : (normalized.evidenceGap || "The classification depends on an unresolved safety-significance disposition."),
    proposal: { ...normalized.proposal, reviewTarget: "safetyClassification", normalizedDecision: candidate || "Needs Review", governedDecision: valid ? constrained : null },
  };
}

export function buildHumanSafetyClassificationDecision({ rowFields = {}, proposal = {}, classification, userFeedback = "", proposalValid = null } = {}) {
  const applicable = canonicalApplicabilityDecision(rowFields["Guide Phrase Applicable"]);
  const significant = canonicalApplicabilityDecision(rowFields["Safety Significant"]);
  const requested = clean(classification);
  const permitted = applicable === "No" ? ["Not Applicable"]
    : applicable === "Yes" && significant === "No" ? ["Mission/Reliability"]
      : applicable === "Yes" && significant === "Yes" ? ["Safety — Direct", "Safety — Related"] : [];
  if (!permitted.includes(requested)) throw new Error(`The governed applicability and safety-significance decisions permit only ${permitted.join(" or ") || "a classification after safety significance is resolved"}.`);
  if (requested === "Safety — Related" && (
    !isSubstantiveClassificationEvidence(rowFields["Intermediate Safety Function"] || proposal?.governedDecision?.["Intermediate Safety Function"])
    || !isSubstantiveClassificationEvidence(rowFields["Intermediate Safety Effect"] || proposal?.governedDecision?.["Intermediate Safety Effect"])
  )) throw new Error("Safety — Related requires a substantive named intermediate safety function and its effect. Choose Safety — Direct or document that intermediate evidence first.");
  // A proposal that failed validation contributes no governed evidence. Its
  // fields describe an assessment the policy rejected, and carrying them into
  // the row would record rejected reasoning as engineering evidence.
  const base = proposalValid === false ? {} : (proposal?.governedDecision || {});
  const supportingEvidence = proposalValid === false
    ? clean(rowFields["Classification Evidence"])
    : clean(base["Classification Evidence"] || proposal.explanation);
  const rule = requested === "Safety — Direct" ? "D1" : requested === "Safety — Related" ? "R1" : requested === "Mission/Reliability" ? "M1" : "N1";
  const rationale = composeGovernedRationale([
    `Human-directed Safety Classification decision: ${requested}.`,
    clean(userFeedback),
    supportingEvidence,
    proposalValid === false
      ? "The AI assessment for this row did not pass the configured checks and was not used as evidence."
      : "",
  ]);
  return {
    sourceRowId: rowFields["Raw Analysis Row ID"], reviewTarget: "safetyClassification", normalizedDecision: requested,
    "Safety Classification": requested, "Safety Classification Rule": rule,
    "Causal Path Type": requested === "Safety — Direct" ? "Direct" : requested === "Safety — Related" ? "Contributory" : "None",
    "Classification Evidence": rationale, "Classification Confidence": proposalValid === false ? "Low" : (userFeedback ? "Medium" : (base["Classification Confidence"] || "Low")),
  };
}

function firstValue(...values) {
  return values.map(clean).find(Boolean) || "";
}

function humanYesClassification(rowFields = {}, proposal = {}) {
  const governed = proposal?.governedDecision || {};
  const basis = [
    governed["Safety Classification"],
    proposal.normalizedDecision,
    rowFields["Safety Classification"],
    rowFields["Safety Significance Rationale"],
    rowFields["Proposed Safety Assessment Rationale"],
    rowFields["Classification Evidence"],
    rowFields["Causal Path Type"],
    rowFields["Intermediate Safety Function"],
    rowFields["Intermediate Safety Effect"],
  ].map(clean).join(" ");
  if (/Safety\s*[—-]\s*Direct|\bdirect causal path\b/i.test(basis)) return "Safety — Direct";
  if (/Safety\s*[—-]\s*Related|\bcontribut(?:ory|es?|ion)\b|\bintermediate safety\b/i.test(basis)) return "Safety — Related";
  return rowFields["Intermediate Safety Function"] || rowFields["Intermediate Safety Effect"]
    ? "Safety — Related"
    : "Safety — Direct";
}

/**
 * Convert an explicit reviewer Yes/No action into a bounded, auditable update.
 * The reviewer disposition is not represented as newly discovered evidence:
 * unresolved evidence remains in the rationale and is handled as a validation
 * note by the resolver.
 */

export function buildHumanVibeReviewDecision({ rowFields = {}, proposal = {}, significance, userFeedback = "", proposalValid = null } = {}) {
  const requested = /^yes$/i.test(clean(significance)) ? "Yes" : "No";
  // A proposal the policy rejected contributes no governed evidence; carrying
  // its fields forward would record rejected reasoning as the reviewer's.
  const governed = proposalValid === false ? {} : (proposal?.governedDecision || {});
  const classification = requested === "Yes"
    ? humanYesClassification(rowFields, proposal)
    : (/^no$/i.test(clean(rowFields["Guide Phrase Applicable"])) ? "Not Applicable" : "Mission/Reliability");
  const related = classification === "Safety — Related";
  const direct = classification === "Safety — Direct";
  const notApplicable = classification === "Not Applicable";
  const existingBasis = withoutPriorGovernedRationale(firstValue(
    rowFields["Safety Significance Rationale"],
    rowFields["Classification Evidence"],
    rowFields["Proposed Safety Assessment Rationale"],
    proposal.explanation,
  ));
  const remainingGap = firstValue(
    proposal.remainingEvidenceGap,
    proposal.evidenceGap,
    rowFields["Safety Classification"] === "Needs Review" ? existingBasis : "",
  );
  const reviewerBasis = clean(userFeedback);
  // A value that is both the existing basis and the remaining gap is one fact,
  // not two; emitting both produced the same sentence twice.
  const gapAddsSomething = remainingGap && clean(remainingGap).toLowerCase() !== clean(existingBasis).toLowerCase();
  const rationale = composeGovernedRationale([
    `Human-directed Vibe Review decision: the reviewer marked Safety Significant = ${requested}.`,
    reviewerBasis ? `Reviewer rationale: ${reviewerBasis}` : "No additional reviewer rationale was supplied with the button action.",
    existingBasis ? `Existing documented basis: ${existingBasis}` : "No additional supporting architecture evidence was documented in this action.",
    gapAddsSomething ? `Unresolved validation context retained: ${remainingGap}` : "",
    "This disposition records the reviewer’s decision; it does not claim that missing architecture evidence was established by the AI.",
  ]);
  const evidence = [
    firstValue(governed["Classification Evidence"], rowFields["Classification Evidence"]),
    `Human reviewer disposition: ${requested}.`,
    reviewerBasis ? `Reviewer-supplied rationale: ${reviewerBasis}` : "Supporting rationale was not supplied with the reviewer action.",
    remainingGap ? `Unresolved evidence gap: ${remainingGap}` : "",
  ].filter(Boolean).join(" ");
  const rule = related ? "R1" : direct ? "D1" : notApplicable ? "N1" : "M1";
  return {
    sourceRowId: rowFields["Raw Analysis Row ID"],
    normalizedDecision: classification,
    humanAdjudication: true,
    humanAdjudicationSignificance: requested,
    humanAdjudicationRationale: reviewerBasis,
    explanation: rationale,
    "Safety Classification": classification,
    "Safety Classification Rule": rule,
    "Causal Path Type": related ? "Contributory" : direct ? "Direct" : "None",
    "Safety Significant": requested,
    "Proposed Safety Assessment": requested === "Yes" ? "Safety" : "Mission/Reliability",
    "Safety Significance Rationale": rationale,
    "Proposed Safety Assessment Rationale": rationale,
    "Classification Evidence": evidence,
    "Classification Confidence": reviewerBasis ? "Medium" : "Low",
    "Guide Phrase Applicable": notApplicable ? "No" : firstValue(rowFields["Guide Phrase Applicable"], governed["Guide Phrase Applicable"], "Yes"),
    "Guide Phrase Applicability Rationale": firstValue(rowFields["Guide Phrase Applicability Rationale"], governed["Guide Phrase Applicability Rationale"], rationale),
    "Causal Effect": firstValue(rowFields["Causal Effect"], governed["Causal Effect"]),
    "Resulting System State": firstValue(rowFields["Resulting System State"], governed["Resulting System State"]),
    "Intermediate Safety Function": related ? firstValue(rowFields["Intermediate Safety Function"], governed["Intermediate Safety Function"]) : "",
    "Intermediate Safety Effect": related ? firstValue(rowFields["Intermediate Safety Effect"], governed["Intermediate Safety Effect"]) : "",
    "Protection Assessment": firstValue(rowFields["Protection Assessment"], governed["Protection Assessment"]),
    "Protection Status": firstValue(rowFields["Protection Status"], governed["Protection Status"], "Unknown"),
    "Physical-Harm Chain Termination": classification === "Mission/Reliability"
      ? firstValue(rowFields["Physical-Harm Chain Termination"], governed["Physical-Harm Chain Termination"])
      : notApplicable ? "The reviewer determined that this guide-phrase deviation is not applicable to the interface and context." : "",
    remainingEvidenceGap: remainingGap,
  };
}

export function compactVibeReviewRow(headers = [], row = []) {
  const allowed = new Set(["Raw Analysis Row ID", "Function (From)", "Function (From) Details", "Control Action", "Control Action Details",
    "Function (To)", "Function (To) Details", "Subsystem Allocation", "Guide Phrase", "Guide Phrase Applicable",
    "Guide Phrase Applicability Rationale", "Operational Scenario", "Operational Mode", "Operating Conditions", "Context Assumptions",
    "Canonical Loss ID", "Canonical Hazard ID", "Loss", "Hazard", "Causal Scenario", "Causal Factor", "Unsafe Control Action",
    "Proposed Safety Assessment", "Proposed Safety Assessment Rationale", "Safety Classification", "Safety Classification Rule",
    "Causal Path Type", "Causal Effect", "Resulting System State", "Intermediate Safety Function", "Intermediate Safety Effect",
    "Protection Assessment", "Protection Status", "Physical-Harm Chain Termination", "Classification Evidence", "Classification Confidence",
    "Safety Significant", "Safety Significance Rationale"]);
  return Object.fromEntries(headers.map((header, index) => [header, clean(row[index])]).filter(([header, value]) => allowed.has(header) && value));
}

export async function requestVibeReviewProposal({ headers, row, projectName, organizationContext = "", provider, model, effort, requestedSignificance = "", userFeedback = "", reviewTarget = "safetySignificant", signal }) {
  if (reviewTarget === "guidePhraseApplicable") {
    return requestGuidePhraseApplicabilityProposal({ headers, row, projectName, organizationContext, provider, model, effort, signal });
  }
  const resolutionReview = reviewTarget === "classificationResolution";
  const classificationReview = reviewTarget === "safetyClassification" || resolutionReview;
  const rowFields = compactVibeReviewRow(headers, row);
  const resolutionInspection = resolutionReview ? inspectClassificationResolution(headers, row) : null;
  const reviewerDecisionInstruction = requestedSignificance
    ? ` The human reviewer selected Safety Significant ${requestedSignificance}. Treat that Yes/No selection as the requested adjudication outcome and translate it into the most defensible grounded subtype and rationale. Clearly label it as a human-directed decision. Unknown protection effectiveness may remain Unknown and must be disclosed, but it does not by itself erase an otherwise documented causal path.`
    : "";
  const classificationContract = reviewTarget === "safetyClassification"
    ? " Safety Classification only: Guide Phrase Applicable and Safety Significant (and their rationales) are authoritative and immutable. Applicability No permits only Not Applicable; applicability Yes with Safety Significant No permits only Mission/Reliability; applicability Yes with Safety Significant Yes permits only Direct or Related. Never create or challenge a Safety Significant disposition."
    : resolutionReview
      ? " Policy-gap reconciliation: Guide Phrase Applicable and Safety Significant (and their rationales) are authoritative and immutable. Reconcile Safety Classification and its causal/evidence support fields without inventing evidence."
      : "";
  const resolutionContract = resolutionReview
    ? `\n\nThis is a policy-gap reconciliation review. The current validator findings are:\n- ${(resolutionInspection?.findings || []).join("\n- ") || "No detailed finding was reported."}\nReconcile the classification and supporting causal/evidence fields so every listed finding is addressed using only supplied row evidence. Do not merely rename the status and do not change Guide Phrase Applicable or Safety Significant.`
    : "";
  const prompt = `Review exactly one hazard-analysis row. Produce a concise proposed engineering assessment; it remains a proposal until a human applies it.\n\nProject: ${projectName || "Untitled project"}\n${organizationContext || "No applicable organization profile text is available."}\n\nRow evidence:\n${JSON.stringify(rowFields, null, 2)}\n${requestedSignificance ? `\nThe user explicitly requests Safety Significant ${requestedSignificance}. Select a coherent ${requestedSignificance === "Yes" ? "Safety — Direct or Safety — Related" : "Mission/Reliability or Not Applicable"} subtype only if evidence supports it.` : ""}${userFeedback ? `\nUser-supplied feedback (label this as user-supplied in the rationale): ${userFeedback}` : ""}\n\nReturn strict JSON with: sourceRowId, explanation (brief deviation, causal effect, resulting state, harm/mission boundary), normalizedDecision, Safety Classification Rule, Causal Path Type, Causal Effect, Resulting System State, Intermediate Safety Function, Intermediate Safety Effect, Protection Assessment, Protection Status, Physical-Harm Chain Termination, Guide Phrase Applicable, Guide Phrase Applicability Rationale, Classification Evidence, Classification Confidence, Safety Significance Rationale, remainingEvidenceGap.\nRules: normalizedDecision is exactly Safety — Direct, Safety — Related, Mission/Reliability, Not Applicable, or Needs Review. Do not invent architecture, safeguards, authority, timing, or evidence. Context assumptions are not verified design evidence. Never credit a protection whose availability, independence, freshness, or effectiveness is Unknown, assumed, unconfirmed, or unverified as the reason a physical-harm chain terminates. If the source row asserts an open or contributory physical-harm path, Mission/Reliability is allowed only when supplied evidence establishes a concrete chain-termination mechanism; otherwise retain Needs Review or select an evidence-supported Safety subtype. Explicitly documented absence of a safeguard is absence evidence; uncertainty whether one exists is an evidence gap. A Related decision names the intermediate safety function/effect. Mission/Reliability names where physical-harm chain terminates. Needs Review names one material evidence gap.`;
  const governedPrompt = `${prompt}${resolutionContract}\nUnknown protection status does not invalidate an otherwise complete direct or contributory physical-harm path and is not, by itself, a reason for Needs Review. Do not require proof that no safeguard exists. When the deviation, causal effect, resulting state, and physical-harm path are established, classify the evidenced Safety subtype and retain safeguard uncertainty separately as Protection Status Unknown and, if useful, remainingEvidenceGap. Use Needs Review only when a fact required to establish the causal classification itself remains unresolved.`;
  const callProvider = callHazardReviewProvider({
    label: "Vibe review proposal",
    workflow: "hazard-vibe-review",
    provider, model, effort, signal, maxTokens: 1800,
  });
  const messages = [
    { role: "system", content: `Apply the supplied safety-significance policy to one row using only supplied evidence. Return bounded strict JSON; no hidden reasoning.${classificationContract}${reviewerDecisionInstruction}` },
    { role: "user", content: governedPrompt },
  ];
  const attempt = await requestCompletion(callProvider, messages, { budget: HAZARD_REVIEW_TOKEN_BUDGET });
  const rawText = attempt.text;
  let normalizedProposal = resolutionReview
    ? normalizeVibeReviewProposal(rawText, rowFields, requestedSignificance)
    : classificationReview ? normalizeSafetyClassificationProposal(rawText, rowFields) : normalizeVibeReviewProposal(rawText, rowFields, requestedSignificance);
  if (normalizedProposal.valid) return normalizedProposal;
  const formattingFailure = normalizedProposal.errors.some((error) => /omitted the required normalizedDecision/i.test(error));
  const repairSystem = formattingFailure
    ? "Repair one provider response into the required hazard-review JSON shape. Preserve its engineering meaning and evidence limits. Do not add architecture or evidence. Return JSON only."
    : "Correct one hazard-review proposal that failed the configured safety-classification policy. Use only supplied row evidence. Do not credit assumed, unknown, unconfirmed, or unverified protections. Return a complete JSON object only.";
  const repairInstruction = formattingFailure
    ? "The required normalizedDecision field must be exactly one of: Safety — Direct, Safety — Related, Mission/Reliability, Not Applicable, or Needs Review. Reissue a complete object for this same row."
    : `The first proposal failed these policy checks: ${normalizedProposal.errors.join("; ")}. Revise the classification and supporting fields so they are consistent with the supplied evidence. An unknown or unconfirmed safeguard cannot block an otherwise complete direct or contributory physical-harm path; do not require proof that no safeguard exists. When the row already establishes the deviation, causal effect, resulting state, named intermediate safety function/effect, and physical-harm path, classify Safety — Direct or Safety — Related and retain the protection uncertainty separately. Use Needs Review only when a fact required to establish the causal classification itself remains unresolved.`;
  const repairedText = await callProvider([
    { role: "system", content: repairSystem },
    { role: "user", content: `${repairInstruction}\n\nOriginal task:\n${governedPrompt}\n\nProvider response to correct:\n${rawText || "(empty or unrecognized response)"}` },
  ], 1800);
  const repairedRaw = repairedText.text ?? repairedText;
  normalizedProposal = resolutionReview
    ? normalizeVibeReviewProposal(repairedRaw, rowFields, requestedSignificance)
    : classificationReview ? normalizeSafetyClassificationProposal(repairedRaw, rowFields) : normalizeVibeReviewProposal(repairedRaw, rowFields, requestedSignificance);
  if (!normalizedProposal.valid) {
    normalizedProposal = { ...normalizedProposal, providerFailure: describeProviderFormatFailure(attempt) };
  }
  if (resolutionReview && !normalizedProposal.valid) {
    const deterministicRepair = buildDeterministicClassificationResolutionRepair(
      rowFields,
      resolutionInspection?.findings,
    );
    if (deterministicRepair) {
      const deterministicProposal = normalizeVibeReviewProposal(deterministicRepair, rowFields, requestedSignificance);
      if (deterministicProposal.valid) return {
        ...deterministicProposal,
        deterministicRepair: true,
      };
    }
  }
  return normalizedProposal;
}
