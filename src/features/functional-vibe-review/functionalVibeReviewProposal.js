import { backendURL, buildAIAuthOpts } from "../../components/backendConfig";
import { extractVibeReviewProviderText, parseVibeReviewProposal } from "../project-hazard-analysis/vibeReviewProposal";
import {
  FUNCTIONAL_ARCHITECTURE_FIELDS,
  FUNCTIONAL_HAZARD_ANALYSIS_FIELDS,
  FUNCTIONAL_REVIEW_FIELDS,
  normalizeFunctionalVibeReviewProposal,
} from "./functionalVibeReview";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const DEFAULT_FUNCTIONAL_REVIEW_TIMEOUT_MS = 120_000;

function compactRow(row = {}) {
  return Object.fromEntries(FUNCTIONAL_REVIEW_FIELDS.map((field) => [field, clean(row?.[field])]).filter(([, value]) => value));
}

function reviewFieldsFromScopeLabel(reviewFocus = "") {
  const label = clean(reviewFocus).toLowerCase();
  const fieldsByLabel = [
    ["Lifecycle Phase", "lifecyclePhase"],
    ["Interface Type", "interfaceType"],
    ["Hazard Analysis Eligibility", "hazardAnalysisEligibility"],
    ["Eligibility Rationale", "hazardAnalysisEligibilityRationale"],
    ["CSCI", "csci"],
    ["CSC", "csc"],
    ["CSU", "csu"],
  ];
  return fieldsByLabel
    .filter(([fieldLabel]) => label.includes(`${fieldLabel.toLowerCase()} =`))
    .map(([, field]) => field);
}

export async function requestFunctionalVibeReviewProposal({
  row,
  rowNumber,
  projectName,
  organizationContext = "",
  reviewFocus = "",
  reviewFields = [],
  reviewInstructions = "",
  surroundingRows = [],
  provider,
  model,
  effort,
  signal,
  requestTimeoutMs = DEFAULT_FUNCTIONAL_REVIEW_TIMEOUT_MS,
}) {
  const currentRow = compactRow(row);
  const focusedFields = Array.from(new Set([
    ...(reviewFields || []),
    ...reviewFieldsFromScopeLabel(reviewFocus),
  ].filter((field) => FUNCTIONAL_REVIEW_FIELDS.includes(field))));
  const focusedClassificationGuidance = [
    focusedFields.includes("lifecyclePhase")
      ? "Classify Lifecycle Phase as Runtime, Initialization, Configuration, Mode Transition, Shutdown, Deployment/Update, Test/Verification, Static Structure, or Needs Review. Base it on when the evidenced relationship executes. When its current value is Needs Review, select the most defensible concrete lifecycle value supported by the row and nearby evidence; use lower confidence when appropriate."
      : "",
    focusedFields.includes("interfaceType")
      ? "Classify Interface Type from the evidenced exchange semantics. When its current value is Needs Review, select the most defensible concrete interface type supported by the evidence."
      : "",
    focusedFields.includes("hazardAnalysisEligibility")
      ? "Resolve Hazard Analysis Eligibility as Include or Exclude when its current value is Needs Review."
      : "",
  ].filter(Boolean).join(" ");
  const focusedFieldText = focusedFields.length
    ? `\nThis is a column-scoped review. Evaluate only: ${focusedFields.join(", ")}. Preserve every other field exactly as supplied. Do not use this review to repair interface direction, descriptions, architecture allocation, or an unrequested classification column. A Revise proposal is valid only when its changedFields are confined to the named target field(s). Do not propose Remove for a column-scoped review. ${focusedClassificationGuidance}`
    : "";
  const prompt = `Review exactly one existing functional-decomposition interface row. This is a bounded human-review proposal, not permission to redesign the architecture.

Project: ${projectName || "Untitled project"}
Row number: ${rowNumber}
${organizationContext || "No applicable organization profile text is available."}
Review focus: ${reviewFocus || "Complete functional-interface row"}
Reviewer instructions:
${clean(reviewInstructions) || "Assess the selected row against the stated review focus."}
${focusedFieldText}

Current row:
${JSON.stringify(currentRow, null, 2)}

Nearby rows for consistency checks only (do not propose changes to them):
${JSON.stringify((surroundingRows || []).map(compactRow), null, 2)}

Assess whether the row expresses a necessary, non-duplicative interface between implementable leaf functions with correct subsystem ownership, direction, interface semantics, and technically useful details. Check that Function From is the actual source behavior, Function To is the actual receiving behavior, and Control Action names the exchanged command, data, state, feedback, event, configuration, authority, force, resource, or energy flow. Do not invent unsupported architecture.

When CSCI, CSC, CSU, or Architecture Rationale fields are present, also assess their allocation hierarchy and rationale. If the review focus names one of those columns, prioritize whether that value is correct for the evidenced source behavior while preserving sound interface fields.

When Lifecycle Phase, Interface Type, Hazard Analysis Eligibility, or Eligibility Rationale fields are present, assess them as one governed classification unless this is explicitly a column-scoped review. Include an interface in code-based hazard analysis only when it represents runtime behavior or consequential initialization, configuration, mode-transition, shutdown, or update behavior that can affect operational outputs, authority, control, monitoring, or protection. Exclude static definitions and structural relationships, and relationships confined to tests, examples, documentation, or other non-operational tooling. Use Needs Review only when the supplied row and nearby evidence cannot establish whether the relationship is operationally consequential. If the review focus is Eligibility, prioritize resolving Include, Exclude, or Needs Review and its evidence-based rationale; preserve otherwise sound interface and architecture fields. For a Hazard Analysis Eligibility value currently marked Needs Review, use Revise with Include or Exclude when the evidence supports a determination; use Needs Input, not Keep, if the material evidence gap remains.

Return strict JSON only with:
- decision: exactly Keep, Revise, Remove, or Needs Input
- explanation: a brief plain-language explanation for the engineer
- rationale: the evidence-based reason for the decision
- confidence: High, Medium, or Low
- issues: a short array of specific issues
- proposedRow: required only for Revise and containing all seven fields: subsystem, fromFunction, fromDetails, controlAction, controlDetails, toFunction, toDetails
- proposedRow must also preserve and may revise these architecture fields when they are present: ${FUNCTIONAL_ARCHITECTURE_FIELDS.join(", ")}
- proposedRow must also preserve and may revise these code hazard-analysis fields when they are present: ${FUNCTIONAL_HAZARD_ANALYSIS_FIELDS.join(", ")}
- remainingQuestion: one material question when decision is Needs Input

Use Keep when the row is sound, including when its existing eligibility classification is already correct. Use Revise only when a complete corrected row or governed eligibility classification can be grounded in the supplied project evidence. Use Remove only for a clear duplicate, ceremonial acknowledgement, invalid container-to-container relationship, or unjustified interface; an eligibility value of Exclude does not by itself mean the functional row should be removed. Use Needs Input when a material architectural fact is missing. Preserve the row's intent and avoid stylistic churn.`;

  const enforceReviewFocus = (result) => {
    if (!result?.valid || !focusedFields.length) return result;
    const decision = result.proposal?.decision;
    const outsideFocus = (result.proposal?.changedFields || []).filter((field) => !focusedFields.includes(field));
    const unresolvedTargets = focusedFields.filter((field) => (
      clean(currentRow[field]).toLowerCase() === "needs review"
      && (decision === "Keep" || clean(result.proposal?.proposedRow?.[field]).toLowerCase() === "needs review")
    ));
    const focusErrors = [];
    if (decision === "Remove") focusErrors.push("A column-scoped review cannot propose removing the row.");
    if (outsideFocus.length) {
      focusErrors.push(`The proposal changed fields outside the requested review column(s): ${outsideFocus.join(", ")}.`);
    }
    if (unresolvedTargets.length) {
      focusErrors.push(`The proposal must resolve the requested Needs Review field(s) to concrete values: ${unresolvedTargets.join(", ")}. If the evidence cannot support a value, return Needs Input instead of Keep.`);
    }
    return focusErrors.length
      ? { ...result, valid: false, errors: [...(result.errors || []), ...focusErrors] }
      : result;
  };

  const callProvider = async (messages, maxTokens = 1800) => {
    const requestController = new AbortController();
    let timedOut = false;
    const forwardAbort = () => requestController.abort(signal?.reason);
    if (signal?.aborted) forwardAbort();
    else signal?.addEventListener?.("abort", forwardAbort, { once: true });
    const timeoutId = setTimeout(() => {
      timedOut = true;
      requestController.abort();
    }, Math.max(1, Number(requestTimeoutMs) || DEFAULT_FUNCTIONAL_REVIEW_TIMEOUT_MS));
    try {
      const response = await fetch(`${backendURL}/api/chat`, {
        method: "POST",
        ...buildAIAuthOpts({ "Content-Type": "application/json" }),
        signal: requestController.signal,
        body: JSON.stringify({
          provider,
          model,
          effort,
          reasoning_effort: effort,
          xhandleWorkflow: "functional-vibe-review",
          messages,
          temperature: 0.1,
          max_tokens: maxTokens,
        }),
      });
      if (!response.ok) throw new Error(`Functional vibe review failed (${response.status}). ${await response.text().catch(() => "")}`.trim());
      return extractVibeReviewProviderText(await response.json());
    } catch (error) {
      if (timedOut) {
        throw new Error(`Functional vibe review timed out after ${Math.round(requestTimeoutMs / 1000)} seconds.`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
      signal?.removeEventListener?.("abort", forwardAbort);
    }
  };

  const rawText = await callProvider([
    { role: "system", content: "Act as a senior systems architect reviewing one functional interface at a time. Return bounded strict JSON only; do not expose hidden reasoning." },
    { role: "user", content: prompt },
  ]);
  let normalized = enforceReviewFocus(normalizeFunctionalVibeReviewProposal(parseVibeReviewProposal(rawText), currentRow));
  if (normalized.valid) return normalized;

  const repairedText = await callProvider([
    { role: "system", content: "Repair one functional-decomposition review response into the required JSON shape without adding architecture or changing its engineering meaning. Return JSON only." },
    { role: "user", content: `The response failed validation: ${normalized.errors.join("; ")}\n\nOriginal task:\n${prompt}\n\nResponse to repair:\n${rawText || "(empty)"}` },
  ]);
  normalized = enforceReviewFocus(normalizeFunctionalVibeReviewProposal(parseVibeReviewProposal(repairedText), currentRow));
  return normalized;
}
