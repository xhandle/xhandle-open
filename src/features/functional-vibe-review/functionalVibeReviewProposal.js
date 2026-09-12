import { backendURL, buildAIAuthOpts } from "../../components/backendConfig";
import { extractVibeReviewProviderText, parseVibeReviewProposal } from "../project-hazard-analysis/vibeReviewProposal";
import { FUNCTIONAL_ROW_FIELDS, normalizeFunctionalVibeReviewProposal } from "./functionalVibeReview";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

function compactRow(row = {}) {
  return Object.fromEntries(FUNCTIONAL_ROW_FIELDS.map((field) => [field, clean(row?.[field])]));
}

export async function requestFunctionalVibeReviewProposal({
  row,
  rowNumber,
  projectName,
  organizationContext = "",
  surroundingRows = [],
  provider,
  model,
  effort,
  signal,
}) {
  const currentRow = compactRow(row);
  const prompt = `Review exactly one existing functional-decomposition interface row. This is a bounded human-review proposal, not permission to redesign the architecture.

Project: ${projectName || "Untitled project"}
Row number: ${rowNumber}
${organizationContext || "No applicable organization profile text is available."}

Current row:
${JSON.stringify(currentRow, null, 2)}

Nearby rows for consistency checks only (do not propose changes to them):
${JSON.stringify((surroundingRows || []).map(compactRow), null, 2)}

Assess whether the row expresses a necessary, non-duplicative interface between implementable leaf functions with correct subsystem ownership, direction, interface semantics, and technically useful details. Check that Function From is the actual source behavior, Function To is the actual receiving behavior, and Control Action names the exchanged command, data, state, feedback, event, configuration, authority, force, resource, or energy flow. Do not invent unsupported architecture.

Return strict JSON only with:
- decision: exactly Keep, Revise, Remove, or Needs Input
- explanation: a brief plain-language explanation for the engineer
- rationale: the evidence-based reason for the decision
- confidence: High, Medium, or Low
- issues: a short array of specific issues
- proposedRow: required only for Revise and containing all seven fields: subsystem, fromFunction, fromDetails, controlAction, controlDetails, toFunction, toDetails
- remainingQuestion: one material question when decision is Needs Input

Use Keep when the row is sound. Use Revise only when a complete corrected row can be grounded in the supplied project evidence. Use Remove only for a clear duplicate, ceremonial acknowledgement, invalid container-to-container relationship, or unjustified interface. Use Needs Input when a material architectural fact is missing. Preserve the row's intent and avoid stylistic churn.`;

  const callProvider = async (messages, maxTokens = 1800) => {
    const response = await fetch(`${backendURL}/api/chat`, {
      method: "POST",
      ...buildAIAuthOpts({ "Content-Type": "application/json" }),
      signal,
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
  };

  const rawText = await callProvider([
    { role: "system", content: "Act as a senior systems architect reviewing one functional interface at a time. Return bounded strict JSON only; do not expose hidden reasoning." },
    { role: "user", content: prompt },
  ]);
  let normalized = normalizeFunctionalVibeReviewProposal(parseVibeReviewProposal(rawText), currentRow);
  if (normalized.valid) return normalized;

  const repairedText = await callProvider([
    { role: "system", content: "Repair one functional-decomposition review response into the required JSON shape without adding architecture or changing its engineering meaning. Return JSON only." },
    { role: "user", content: `The response failed validation: ${normalized.errors.join("; ")}\n\nOriginal task:\n${prompt}\n\nResponse to repair:\n${rawText || "(empty)"}` },
  ]);
  normalized = normalizeFunctionalVibeReviewProposal(parseVibeReviewProposal(repairedText), currentRow);
  return normalized;
}

