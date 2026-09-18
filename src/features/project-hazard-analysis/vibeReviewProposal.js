import { backendURL, buildAIAuthOpts } from "../../components/backendConfig";
import { normalizeNeedsReviewClassificationDecision } from "./needsReviewResolver";
import { auditSafetyClassificationRecord } from "./safetySignificancePolicy";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

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

export function buildHumanGuidePhraseApplicabilityDecision({ rowFields = {}, proposal = {}, applicable, userFeedback = "" } = {}) {
  const decision = /^yes$/i.test(clean(applicable)) ? "Yes" : "No";
  const reviewerBasis = clean(userFeedback);
  const proposed = proposal?.governedDecision || {};
  if (decision === "No" && proposed["Guide Phrase Applicable"] !== "No" && !reviewerBasis) {
    throw new Error("Mark No requires a row-specific explanation of why this guide-phrase deviation cannot affect the receiving function. Reply “no — because …” or skip it.");
  }
  const existingGap = firstValue(proposal.remainingEvidenceGap, proposal.evidenceGap);
  const baseRationale = firstValue(
    reviewerBasis,
    proposed["Guide Phrase Applicability Rationale"],
    rowFields["Guide Phrase Applicability Rationale"],
  );
  const rationale = [
    `Human-directed Vibe Review decision: Guide Phrase Applicable = ${decision}.`,
    baseRationale || (decision === "Yes"
      ? "The reviewer determined that the stated deviation is meaningful for this interface and can affect the receiving function."
      : "The reviewer determined that the stated deviation cannot affect the receiving function in this context."),
    existingGap ? `Remaining contract or downstream-classification evidence gap: ${existingGap}` : "",
    "This applicability disposition does not independently resolve Safety Significance.",
  ].filter(Boolean).join(" ");
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
  const callProvider = async (messages) => {
    const response = await fetch(`${backendURL}/api/chat`, { method: "POST", ...buildAIAuthOpts({ "Content-Type": "application/json" }), signal,
      body: JSON.stringify({ provider, model, effort, reasoning_effort: effort, xhandleWorkflow: "hazard-applicability-vibe-review", messages, temperature: 0.1, max_tokens: 1500 }) });
    if (!response.ok) throw new Error(`Guide-phrase applicability review failed (${response.status}). ${await response.text().catch(() => "")}`.trim());
    return extractVibeReviewProviderText(await response.json());
  };
  const messages = [
    { role: "system", content: "Assess only guide-phrase applicability for one interface. Keep applicability separate from downstream safety classification. Return strict JSON only." },
    { role: "user", content: prompt },
  ];
  const rawText = await callProvider(messages);
  let normalized = normalizeGuidePhraseApplicabilityProposal(rawText, rowFields);
  if (normalized.valid) return normalized;
  const repairedText = await callProvider([
    { role: "system", content: "Repair one guide-phrase applicability proposal. Use only supplied evidence, keep applicability separate from safety significance, and return strict JSON only." },
    { role: "user", content: `The proposal failed: ${normalized.errors.join("; ") || normalized.evidenceGap}. Reissue the complete object. A missing interface contract is not proof of non-applicability when the deviation is semantically meaningful.\n\nOriginal task:\n${prompt}\n\nProvider response:\n${rawText || "(empty response)"}` },
  ]);
  normalized = normalizeGuidePhraseApplicabilityProposal(repairedText, rowFields);
  return normalized;
}

export function normalizeVibeReviewProposal(raw = {}, rowFields = {}, requestedSignificance = "") {
  const proposal = coerceVibeReviewProposal(raw);
  const desired = requestedSignificance === "Yes" ? /Safety/.test(proposal.normalizedDecision || "")
    : requestedSignificance === "No" ? /Mission|Not Applicable/.test(proposal.normalizedDecision || "") : true;
  if (!desired) return { valid: false, errors: [`The proposal did not establish a coherent ${requestedSignificance} subtype.`], proposal };
  const normalized = normalizeNeedsReviewClassificationDecision(proposal, rowFields, rowFields["Safety Classification Rule"] || "U4");
  const governed = normalized.decision;
  const joinEvidence = (...values) => values.map(clean).filter(Boolean).join(" ");
  const audited = auditSafetyClassificationRecord({
    guidePhrase: rowFields["Guide Phrase"],
    guidePhraseApplicable: governed["Guide Phrase Applicable"],
    safetyClassification: governed["Safety Classification"],
    safetyClassificationRule: governed["Safety Classification Rule"],
    causalPathType: governed["Causal Path Type"],
    causalEffect: joinEvidence(rowFields["Causal Effect"], governed["Causal Effect"]),
    resultingSystemState: joinEvidence(rowFields["Resulting System State"], governed["Resulting System State"]),
    intermediateSafetyFunction: governed["Intermediate Safety Function"],
    intermediateSafetyEffect: joinEvidence(rowFields["Intermediate Safety Effect"], governed["Intermediate Safety Effect"]),
    protectionAssessment: joinEvidence(rowFields["Protection Assessment"], governed["Protection Assessment"]),
    protectionStatus: governed["Protection Status"],
    physicalHarmChainTermination: governed["Physical-Harm Chain Termination"],
    classificationEvidence: joinEvidence(rowFields["Classification Evidence"], governed["Classification Evidence"]),
    safetySignificanceRationale: joinEvidence(rowFields["Safety Significance Rationale"], governed["Safety Significance Rationale"]),
    proposedSafetyAssessmentRationale: joinEvidence(rowFields["Proposed Safety Assessment Rationale"], governed["Proposed Safety Assessment Rationale"]),
    proposedSafetyAssessment: governed["Proposed Safety Assessment"],
    safetySignificant: governed["Safety Significant"],
    losses: joinEvidence(rowFields.Losses, rowFields.Loss),
    hazards: joinEvidence(rowFields.Hazards, rowFields.Hazard),
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
export function buildHumanVibeReviewDecision({ rowFields = {}, proposal = {}, significance, userFeedback = "" } = {}) {
  const requested = /^yes$/i.test(clean(significance)) ? "Yes" : "No";
  const governed = proposal?.governedDecision || {};
  const classification = requested === "Yes"
    ? humanYesClassification(rowFields, proposal)
    : (/^no$/i.test(clean(rowFields["Guide Phrase Applicable"])) ? "Not Applicable" : "Mission/Reliability");
  const related = classification === "Safety — Related";
  const direct = classification === "Safety — Direct";
  const notApplicable = classification === "Not Applicable";
  const existingBasis = firstValue(
    rowFields["Safety Significance Rationale"],
    rowFields["Classification Evidence"],
    rowFields["Proposed Safety Assessment Rationale"],
    proposal.explanation,
  );
  const remainingGap = firstValue(
    proposal.remainingEvidenceGap,
    proposal.evidenceGap,
    rowFields["Safety Classification"] === "Needs Review" ? existingBasis : "",
  );
  const reviewerBasis = clean(userFeedback);
  const rationale = [
    `Human-directed Vibe Review decision: the reviewer marked Safety Significant = ${requested}.`,
    reviewerBasis ? `Reviewer rationale: ${reviewerBasis}` : "No additional reviewer rationale was supplied with the button action.",
    existingBasis ? `Existing documented basis: ${existingBasis}` : "No additional supporting architecture evidence was documented in this action.",
    remainingGap ? `Unresolved validation context retained: ${remainingGap}` : "",
    "This disposition records the reviewer’s decision; it does not claim that missing architecture evidence was established by the AI.",
  ].filter(Boolean).join(" ");
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
  const rowFields = compactVibeReviewRow(headers, row);
  const reviewerDecisionInstruction = requestedSignificance
    ? ` The human reviewer selected Safety Significant ${requestedSignificance}. Treat that Yes/No selection as the requested adjudication outcome and translate it into the most defensible grounded subtype and rationale. Clearly label it as a human-directed decision. Unknown protection effectiveness may remain Unknown and must be disclosed, but it does not by itself erase an otherwise documented causal path.`
    : "";
  const prompt = `Review exactly one hazard-analysis row. Produce a concise proposed engineering assessment; it remains a proposal until a human applies it.\n\nProject: ${projectName || "Untitled project"}\n${organizationContext || "No applicable organization profile text is available."}\n\nRow evidence:\n${JSON.stringify(rowFields, null, 2)}\n${requestedSignificance ? `\nThe user explicitly requests Safety Significant ${requestedSignificance}. Select a coherent ${requestedSignificance === "Yes" ? "Safety — Direct or Safety — Related" : "Mission/Reliability or Not Applicable"} subtype only if evidence supports it.` : ""}${userFeedback ? `\nUser-supplied feedback (label this as user-supplied in the rationale): ${userFeedback}` : ""}\n\nReturn strict JSON with: sourceRowId, explanation (brief deviation, causal effect, resulting state, harm/mission boundary), normalizedDecision, Safety Classification Rule, Causal Path Type, Causal Effect, Resulting System State, Intermediate Safety Function, Intermediate Safety Effect, Protection Assessment, Protection Status, Physical-Harm Chain Termination, Guide Phrase Applicable, Guide Phrase Applicability Rationale, Classification Evidence, Classification Confidence, Safety Significance Rationale, remainingEvidenceGap.\nRules: normalizedDecision is exactly Safety — Direct, Safety — Related, Mission/Reliability, Not Applicable, or Needs Review. Do not invent architecture, safeguards, authority, timing, or evidence. Context assumptions are not verified design evidence. Never credit a protection whose availability, independence, freshness, or effectiveness is Unknown, assumed, unconfirmed, or unverified as the reason a physical-harm chain terminates. If the source row asserts an open or contributory physical-harm path, Mission/Reliability is allowed only when supplied evidence establishes a concrete chain-termination mechanism; otherwise retain Needs Review or select an evidence-supported Safety subtype. Explicitly documented absence of a safeguard is absence evidence; uncertainty whether one exists is an evidence gap. A Related decision names the intermediate safety function/effect. Mission/Reliability names where physical-harm chain terminates. Needs Review names one material evidence gap.`;
  const governedPrompt = `${prompt}\nUnknown protection status does not invalidate an otherwise complete direct or contributory physical-harm path and is not, by itself, a reason for Needs Review. Do not require proof that no safeguard exists. When the deviation, causal effect, resulting state, and physical-harm path are established, classify the evidenced Safety subtype and retain safeguard uncertainty separately as Protection Status Unknown and, if useful, remainingEvidenceGap. Use Needs Review only when a fact required to establish the causal classification itself remains unresolved.`;
  const callProvider = async (messages, maxTokens = 1800) => {
    const response = await fetch(`${backendURL}/api/chat`, { method: "POST", ...buildAIAuthOpts({ "Content-Type": "application/json" }), signal,
      body: JSON.stringify({ provider, model, effort, reasoning_effort: effort, xhandleWorkflow: "hazard-vibe-review", messages, temperature: 0.1, max_tokens: maxTokens }) });
    if (!response.ok) throw new Error(`Vibe review proposal failed (${response.status}). ${await response.text().catch(() => "")}`.trim());
    return extractVibeReviewProviderText(await response.json());
  };
  const messages = [
    { role: "system", content: `Apply the supplied safety-significance policy to one row using only supplied evidence. Return bounded strict JSON; no hidden reasoning.${reviewerDecisionInstruction}` },
    { role: "user", content: governedPrompt },
  ];
  const rawText = await callProvider(messages);
  let normalizedProposal = normalizeVibeReviewProposal(rawText, rowFields, requestedSignificance);
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
  normalizedProposal = normalizeVibeReviewProposal(repairedText, rowFields, requestedSignificance);
  return normalizedProposal;
}
