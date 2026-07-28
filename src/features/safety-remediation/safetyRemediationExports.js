import { makeSafetyRemediationId, nowISO, sanitizeFilename } from "./safetyRemediationUtils";
import { handoffFilename, handoffToJson } from "./safetyRemediationHandoff";

function downloadText(filename, content, type = "text/plain;charset=utf-8") {
  const blob = new Blob([content || ""], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function exportPatchProposal(patchProposal) {
  if (!patchProposal) return;
  const name = sanitizeFilename(patchProposal.title || patchProposal.id || "xhandle-remediation");
  downloadText(`${name}.patch`, patchProposal.unifiedDiff || "", "text/x-patch;charset=utf-8");
}

export function exportPatchProposalHandoff(handoff, patchProposal = {}) {
  if (!handoff) return;
  downloadText(handoffFilename(patchProposal), handoffToJson(handoff), "application/json;charset=utf-8");
}

export async function copyTextToClipboard(text) {
  if (!navigator?.clipboard) throw new Error("Clipboard is not available in this browser context.");
  await navigator.clipboard.writeText(text || "");
}

export function exportSafetyFindingJson(finding, patchProposal = null, reviewDecisions = []) {
  if (!finding) return;
  const payload = { finding, patchProposal, reviewDecisions, exportedAt: nowISO() };
  const name = sanitizeFilename(finding.title || finding.id || "xhandle-safety-finding");
  downloadText(`${name}.json`, JSON.stringify(payload, null, 2), "application/json;charset=utf-8");
}

export function buildSafetyRemediationMarkdown(finding, patchProposal = null, reviewDecisions = []) {
  if (!finding) return "";
  const decisions = reviewDecisions.filter((decision) => decision.targetId === finding.id || decision.targetId === patchProposal?.id);
  return [
    `# Safety Remediation Summary`,
    "",
    `- **Finding:** ${finding.title}`,
    `- **Review Status:** ${finding.reviewStatus}`,
    `- **Implementation Status:** ${finding.implementationStatus}`,
    `- **Verification Status:** ${finding.verificationStatus}`,
    `- **Architecture Element:** ${finding.architectureElementLabel || finding.architectureElementId}`,
    `- **Hazard:** ${finding.hazard || "Not specified"}`,
    `- **Causal Factor:** ${finding.causalFactor || "Not specified"}`,
    `- **Risk:** ${[finding.severity, finding.likelihood, finding.riskLevel].filter(Boolean).join(" / ") || "Not specified"}`,
    "",
    "## Description",
    "",
    finding.description || "No description provided.",
    "",
    "## Proposed Mitigation",
    "",
    finding.proposedMitigation || "No mitigation proposed.",
    "",
    "## Affected Code References",
    "",
    ...(finding.affectedCodeRefs || []).map((ref) => `- ${ref.filePath || "Unknown file"}${ref.symbolName ? ` :: ${ref.symbolName}` : ""}${ref.startLine ? ` (${ref.startLine}-${ref.endLine || ref.startLine})` : ""} - confidence ${ref.confidence ?? "n/a"}`),
    ...(finding.affectedCodeRefs || []).length ? [] : ["- No code references available."],
    "",
    "## Patch Proposal",
    "",
    patchProposal ? [
      `- **Title:** ${patchProposal.title}`,
      `- **Summary:** ${patchProposal.summary || "No summary provided."}`,
      `- **Files Changed:** ${(patchProposal.filesChanged || []).join(", ") || "Not specified"}`,
      "",
      "```diff",
      patchProposal.unifiedDiff || "",
      "```",
    ].join("\n") : "No patch proposal generated.",
    "",
    "## Review Decisions",
    "",
    ...decisions.map((decision) => `- ${decision.decision} at ${decision.createdAt}: ${decision.reviewerNotes || "No notes"}`),
    decisions.length ? "" : "- No review decisions recorded.",
  ].join("\n");
}

export function exportSafetyRemediationMarkdown(finding, patchProposal = null, reviewDecisions = []) {
  if (!finding) return null;
  const markdown = buildSafetyRemediationMarkdown(finding, patchProposal, reviewDecisions);
  const name = sanitizeFilename(finding.title || finding.id || "xhandle-safety-remediation");
  downloadText(`${name}.md`, markdown, "text/markdown;charset=utf-8");
  return {
    id: makeSafetyRemediationId("summary"),
    projectId: finding.projectId || "",
    repoId: finding.repoId || "",
    findingId: finding.id,
    patchProposalId: patchProposal?.id || "",
    title: `Safety remediation summary: ${finding.title}`,
    type: "safety-remediation-summary",
    markdown,
    createdAt: nowISO(),
    updatedAt: nowISO(),
  };
}
