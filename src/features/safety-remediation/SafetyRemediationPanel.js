import React, { useEffect, useMemo, useState } from "react";
import SafetyFindingList from "./SafetyFindingList";
import SafetyFindingDetail from "./SafetyFindingDetail";
import FindingToolbar from "./finding-management/FindingToolbar";
import FindingOrganizationControls from "./finding-management/FindingOrganizationControls";
import { safetyRemediationStore } from "./safetyRemediationStore";
import {
  generatePatchProposal,
  generateSafetyFindingsFromArchitectureElement,
} from "./safetyRemediationAi";
import {
  architectureElementFromRow,
  codeReferencesFromEvidence,
  decisionToFindingStatus,
  makeSafetyRemediationId,
  nowISO,
  summarySheetToObjects,
} from "./safetyRemediationUtils";
import {
  SAFETY_FINDING_IMPLEMENTATION_STATUSES,
  SAFETY_FINDING_VIEWS,
  SAFETY_FINDING_VERIFICATION_STATUSES,
  SAFETY_REMEDIATION_TEST_STATUSES,
  SAFETY_REMEDIATION_VERIFICATION_DECISIONS,
  SAFETY_REMEDIATION_VERIFICATION_RUN_STATUSES,
} from "./safetyRemediationTypes";
import {
  DEFAULT_FINDING_FILTERS,
  filterAndSortFindings,
  findingViewCounts,
} from "./finding-management/findingManagementUtils";

import {
  copyTextToClipboard,
  exportPatchProposal,
  exportPatchProposalHandoff,
  exportSafetyFindingJson,
  exportSafetyRemediationMarkdown,
} from "./safetyRemediationExports";
import {
  buildPatchProposalHandoff,
  handoffToJson,
} from "./safetyRemediationHandoff";
import { buildSourceSnippetsForPatch } from "./safetyRemediationSourceContext";

const VSCODE_HANDOFF_URL = "http://127.0.0.1:39017/handoff";
const DIFF_PATH_RE = /^(?:diff --git a\/(.+?) b\/(.+)|--- (?:a\/)?(.+)|\+\+\+ (?:b\/)?(.+))$/gm;

async function sendHandoffToVsCode(handoff) {
  const response = await fetch(VSCODE_HANDOFF_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(handoff),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.ok === false) {
    throw new Error(body?.error || `VS Code handoff failed (${response.status})`);
  }
  return body;
}

function extractDiffPaths(unifiedDiff = "") {
  const text = String(unifiedDiff || "");
  const paths = new Set();
  let match;
  while ((match = DIFF_PATH_RE.exec(text))) {
    [match[1], match[2], match[3], match[4]].filter(Boolean).forEach((filePath) => {
      if (filePath && filePath !== "/dev/null") paths.add(filePath);
    });
  }
  return Array.from(paths);
}

function normalizeRepairFiles(proposal = {}) {
  return Array.from(new Set([
    ...(Array.isArray(proposal.filesChanged) ? proposal.filesChanged : []),
    ...(proposal.filePath ? [proposal.filePath] : []),
    ...extractDiffPaths(proposal.unifiedDiff),
  ].filter(Boolean)));
}

export default function SafetyRemediationPanel({
  project,
  projectId,
  cbaRows = [],
  selectedElement,
  hazardSummarySheet,
  codeArchitectureHazardAnalysis = null,
  isCodeArchitectureHazardAnalysisStale = false,
  riskRegister = [],
  repoMeta = {},
  compact = false,
  onOpenHazardSummaryRow,
  reviewMode = false,
  initialState = null,
}) {
  const [findings, setFindings] = useState([]);
  const [patches, setPatches] = useState([]);
  const [decisions, setDecisions] = useState([]);
  const [verificationRuns, setVerificationRuns] = useState([]);
  const [selectedFindingId, setSelectedFindingId] = useState("");
  const [findingFilters, setFindingFilters] = useState(DEFAULT_FINDING_FILTERS);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [detailFocused, setDetailFocused] = useState(false);
  const [reviewPopoutFindingId, setReviewPopoutFindingId] = useState("");

  const hazardSummaryRows = useMemo(() => {
    if (Array.isArray(codeArchitectureHazardAnalysis?.summaryRows) && codeArchitectureHazardAnalysis.summaryRows.length) {
      return codeArchitectureHazardAnalysis.summaryRows;
    }
    return summarySheetToObjects(hazardSummarySheet || codeArchitectureHazardAnalysis?.generatedSheets?.Summary);
  }, [codeArchitectureHazardAnalysis, hazardSummarySheet]);
  const scopedAllFindings = useMemo(() => {
    const repoId = repoMeta.repoId || repoMeta.repoName || "";
    return findings.filter((finding) => {
      if (projectId && finding.projectId && String(finding.projectId) !== String(projectId)) return false;
      if (repoId && finding.repoId && finding.repoId !== repoId) return false;
      return true;
    });
  }, [findings, projectId, repoMeta.repoId, repoMeta.repoName]);
  const viewCounts = useMemo(() => findingViewCounts(scopedAllFindings), [scopedAllFindings]);
  const scopedFindings = useMemo(
    () => filterAndSortFindings(scopedAllFindings, findingFilters),
    [findingFilters, scopedAllFindings],
  );
  const selectedFinding = scopedFindings.find((finding) => finding.id === selectedFindingId) || scopedFindings[0] || null;
  const selectedFindingArchitectureElement = useMemo(() => {
    if (!selectedFinding) return selectedElement || null;
    if (selectedElement?.id && selectedElement.id === selectedFinding.architectureElementId) return selectedElement;
    const rowRef = selectedFinding.architectureRowRef || String(selectedFinding.architectureElementId || "").replace(/^cba-row-/, "");
    const index = cbaRows.findIndex((row, rowIndex) => String(row?.rowRef || rowIndex + 1) === String(rowRef));
    return index >= 0 ? architectureElementFromRow(cbaRows[index], index) : selectedElement || null;
  }, [cbaRows, selectedElement, selectedFinding]);
  const selectedFindingForDisplay = useMemo(() => {
    if (!selectedFinding) return null;
    if (Array.isArray(selectedFinding.affectedCodeRefs) && selectedFinding.affectedCodeRefs.length) return selectedFinding;
    const fallbackRefs = codeReferencesFromEvidence({
      architectureElement: selectedFindingArchitectureElement,
      repoMeta,
    });
    return fallbackRefs.length
      ? { ...selectedFinding, affectedCodeRefs: fallbackRefs }
      : selectedFinding;
  }, [repoMeta, selectedFinding, selectedFindingArchitectureElement]);
  const selectedPatch = useMemo(() => {
    if (!selectedFinding) return null;
    const exact = selectedFinding.proposedPatchId
      ? patches.find((patch) => patch.id === selectedFinding.proposedPatchId)
      : null;
    if (exact) return exact;
    return patches
      .filter((patch) => patch.safetyFindingId === selectedFinding.id)
      .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime())[0] || null;
  }, [patches, selectedFinding]);
  const coverageSummary = useMemo(() => {
    const allRefs = hazardSummaryRows.map((row, index) => String(row?.hazardRowRef || row?.id || row?.rowRef || `hazard-row-${index + 1}`)).filter(Boolean);
    const covered = new Set(scopedAllFindings.flatMap((finding) => [
      ...(Array.isArray(finding.coveredHazardRowRefs) ? finding.coveredHazardRowRefs : []),
      finding.hazardRowRef,
    ].map((value) => String(value || "").trim()).filter(Boolean)));
    return {
      total: allRefs.length,
      covered: allRefs.filter((ref) => covered.has(ref)).length,
    };
  }, [hazardSummaryRows, scopedAllFindings]);

  useEffect(() => {
    if (reviewMode && initialState) {
      setFindings(initialState.safetyFindings || []);
      setPatches(initialState.patchProposals || []);
      setDecisions(initialState.reviewDecisions || []);
      setVerificationRuns(initialState.verificationRuns || []);
      return undefined;
    }
    let cancelled = false;
    async function load() {
      const state = await safetyRemediationStore.loadAll();
      if (cancelled) return;
      setFindings(state.safetyFindings || []);
      setPatches(state.patchProposals || []);
      setDecisions(state.reviewDecisions || []);
      setVerificationRuns(state.verificationRuns || []);
    }
    load();
    const onChanged = () => load();
    window.addEventListener("xhandle:safety-remediation:changed", onChanged);
    return () => {
      cancelled = true;
      window.removeEventListener("xhandle:safety-remediation:changed", onChanged);
    };
  }, [initialState, reviewMode]);

  useEffect(() => {
    if (!selectedFindingId && scopedFindings[0]) setSelectedFindingId(scopedFindings[0].id);
  }, [scopedFindings, selectedFindingId]);

  useEffect(() => {
    if (selectedFindingId && scopedFindings.length && !scopedFindings.some((finding) => finding.id === selectedFindingId)) {
      setSelectedFindingId(scopedFindings[0].id);
    }
    if (selectedFindingId && !scopedFindings.length) setSelectedFindingId("");
  }, [scopedFindings, selectedFindingId]);

  const handleGenerateFindings = async () => {
    if (!selectedElement) {
      setMessage("Select an architecture row first.");
      return;
    }
    if (!codeArchitectureHazardAnalysis) {
      setMessage("Run hazard analysis for this code architecture before generating remediation findings.");
      return;
    }
    if (isCodeArchitectureHazardAnalysisStale) {
      setMessage("The code architecture changed since hazard analysis was run. Re-run hazard analysis before generating new remediation findings.");
      return;
    }
    setBusy(true);
    setMessage("Generating safety findings...");
    try {
      const generated = await generateSafetyFindingsFromArchitectureElement({
        element: selectedElement,
        hazardSummaryRows,
        riskRegister,
        project: project || { id: projectId },
        repoMeta,
        hazardAnalysis: codeArchitectureHazardAnalysis,
        isBasedOnStaleHazardAnalysis: isCodeArchitectureHazardAnalysisStale,
      });
      await safetyRemediationStore.upsertFindings(generated);
      setFindings((prev) => {
        const byId = new Map(prev.map((item) => [item.id, item]));
        generated.forEach((item) => byId.set(item.id, item));
        return Array.from(byId.values());
      });
      setSelectedFindingId(generated[0]?.id || selectedFindingId);
      if (generated[0]?.id) setDetailFocused(false);
      const generatedCoverage = new Set(generated.flatMap((finding) => [
        ...(Array.isArray(finding.coveredHazardRowRefs) ? finding.coveredHazardRowRefs : []),
        finding.hazardRowRef,
      ].filter(Boolean)));
      setMessage(`Generated ${generated.length} safety finding${generated.length === 1 ? "" : "s"} covering ${generatedCoverage.size} hazard summary row${generatedCoverage.size === 1 ? "" : "s"}.`);
    } catch (error) {
      setMessage(error?.message || "Failed to generate safety findings.");
    } finally {
      setBusy(false);
    }
  };

  const handleGeneratePatch = async (finding) => {
    if (!finding) return;
    setBusy(true);
    setMessage("Collecting source context for patch proposal...");
    try {
      const sourceSnippets = await buildSourceSnippetsForPatch({
        finding,
        codeReferences: finding.affectedCodeRefs || [],
        repoMeta,
      });
      const sourceDiagnostics = Array.isArray(sourceSnippets.diagnostics) ? sourceSnippets.diagnostics : [];
      const workspaceRoots = Array.from(new Set(
        sourceSnippets
          .filter((snippet) => snippet.source === "vscode_active_workspace" && snippet.workspaceRoot)
          .map((snippet) => snippet.workspaceRoot)
      ));
      setMessage(sourceSnippets.length
        ? `Generating patch proposal from ${sourceSnippets.length} source snippet${sourceSnippets.length === 1 ? "" : "s"}${workspaceRoots[0] ? ` in active VS Code workspace: ${workspaceRoots[0]}` : ""}...`
        : sourceDiagnostics[0]?.filePath
          ? `No source snippets were found for ${sourceDiagnostics[0].filePath}. Recording patch generation as needing more source context.`
          : "No indexed source snippets were found for this finding. Recording patch generation as needing more source context.");
      const patchProposal = await generatePatchProposal({
        finding,
        codeReferences: finding.affectedCodeRefs || [],
        sourceSnippets,
        sourceDiagnostics,
      });
      await safetyRemediationStore.upsertPatchProposals(patchProposal);
      const updated = await safetyRemediationStore.updateFinding(finding.id, {
        proposedPatchId: patchProposal.id,
        implementationStatus: patchProposal.unifiedDiff
          ? SAFETY_FINDING_IMPLEMENTATION_STATUSES.PATCH_PROPOSED
          : SAFETY_FINDING_IMPLEMENTATION_STATUSES.NOT_STARTED,
        verificationStatus: patchProposal.unifiedDiff
          ? SAFETY_FINDING_VERIFICATION_STATUSES.RECOMMENDED
          : SAFETY_FINDING_VERIFICATION_STATUSES.PENDING,
      });
      setPatches((prev) => {
        const byId = new Map(prev.map((item) => [item.id, item]));
        byId.set(patchProposal.id, patchProposal);
        return Array.from(byId.values());
      });
      setFindings((prev) => prev.map((item) => (item.id === finding.id ? updated || item : item)));
      setMessage(patchProposal.unifiedDiff
        ? "Patch proposal generated from source context for human review."
        : patchProposal.summary || "Patch generation needs more source context; no applyable diff was created.");
    } catch (error) {
      setMessage(error?.message || "Failed to generate patch proposal.");
    } finally {
      setBusy(false);
    }
  };

  const handleDecision = async (decision, reviewerNotes) => {
    if (!selectedFinding) return;
    const targetId = selectedPatch?.id || selectedFinding.id;
    const targetType = selectedPatch ? "patch_proposal" : "safety_finding";
    const record = {
      id: makeSafetyRemediationId("decision"),
      projectId: selectedFinding.projectId || projectId || "",
      repoId: selectedFinding.repoId || repoMeta.repoId || repoMeta.repoName || "",
      targetType,
      targetId,
      decision,
      reviewerNotes: reviewerNotes || "",
      createdAt: nowISO(),
      updatedAt: nowISO(),
    };
    await safetyRemediationStore.upsertReviewDecisions(record);
    const findingStatus = decisionToFindingStatus(decision);
    const updatedFinding = await safetyRemediationStore.updateFinding(selectedFinding.id, { reviewStatus: findingStatus });
    if (selectedPatch) {
      await safetyRemediationStore.updatePatchProposal(selectedPatch.id, { reviewStatus: findingStatus });
      setPatches((prev) => prev.map((item) => (item.id === selectedPatch.id ? { ...item, reviewStatus: findingStatus, updatedAt: nowISO() } : item)));
    }
    setDecisions((prev) => [...prev, record]);
    setFindings((prev) => prev.map((item) => (item.id === selectedFinding.id ? updatedFinding || { ...item, reviewStatus: findingStatus } : item)));
    setMessage("Review decision recorded locally.");
  };

  const handleExportPatch = async (patchProposal) => {
    exportPatchProposal(patchProposal);
    if (patchProposal?.safetyFindingId) {
      const updated = await safetyRemediationStore.updateFinding(patchProposal.safetyFindingId, {
        implementationStatus: SAFETY_FINDING_IMPLEMENTATION_STATUSES.EXPORTED,
      });
      setFindings((prev) => prev.map((item) => (item.id === patchProposal.safetyFindingId ? updated || item : item)));
    }
  };

  const buildSelectedHandoff = (patchProposal = selectedPatch) => buildPatchProposalHandoff({
    project,
    projectId,
    repoMeta,
    finding: selectedFindingForDisplay || selectedFinding,
    patchProposal,
    codeArchitectureHazardAnalysis,
    reviewDecisions: decisions,
  });

  const handleCopyDiff = async (patchProposal) => {
    try {
      await copyTextToClipboard(patchProposal?.unifiedDiff || "");
      setMessage("Patch diff copied to clipboard.");
    } catch (error) {
      setMessage(error?.message || "Copy failed. Are you on HTTPS or localhost?");
    }
  };

  const markSentToVsCode = async (patchProposal) => {
    if (patchProposal?.id) {
      await safetyRemediationStore.updatePatchProposal(patchProposal.id, {
        sentToVsCodeAt: nowISO(),
        handoffStatus: "sent_to_vscode",
      });
    }
    if (patchProposal?.safetyFindingId) {
      const updated = await safetyRemediationStore.updateFinding(patchProposal.safetyFindingId, {
        implementationStatus: SAFETY_FINDING_IMPLEMENTATION_STATUSES.SENT_TO_VSCODE,
      });
      setFindings((prev) => prev.map((item) => (item.id === patchProposal.safetyFindingId ? updated || item : item)));
    }
  };

  const handleExportHandoff = async (patchProposal) => {
    const handoff = buildSelectedHandoff(patchProposal);
    try {
      await sendHandoffToVsCode(handoff);
      await markSentToVsCode(patchProposal);
      setMessage("Sent to the xHandle VS Code extension. Continue in the VS Code sidebar to validate and apply.");
    } catch (error) {
      exportPatchProposalHandoff(handoff, patchProposal);
      await markSentToVsCode(patchProposal);
      setMessage(`Direct VS Code handoff was unavailable, so a handoff JSON was downloaded instead. ${error?.message || ""}`.trim());
    }
  };

  const handleCopyHandoff = async (patchProposal) => {
    try {
      await copyTextToClipboard(handoffToJson(buildSelectedHandoff(patchProposal)));
      await markSentToVsCode(patchProposal);
      setMessage("VS Code handoff JSON copied to clipboard.");
    } catch (error) {
      setMessage(error?.message || "Copy failed. Are you on HTTPS or localhost?");
    }
  };

  const handleMarkApplied = async () => {
    if (!selectedFinding) return;
    const updated = await safetyRemediationStore.updateFinding(selectedFinding.id, {
      implementationStatus: SAFETY_FINDING_IMPLEMENTATION_STATUSES.APPLIED_LOCALLY,
      appliedAt: nowISO(),
    });
    setFindings((prev) => prev.map((item) => (item.id === selectedFinding.id ? updated || item : item)));
    setMessage("Marked as applied locally. Record commit, PR, and test evidence when ready.");
  };

  const handleSaveImplementationEvidence = async (patch) => {
    if (!selectedFinding) return;
    const updated = await safetyRemediationStore.updateFinding(selectedFinding.id, patch);
    setFindings((prev) => prev.map((item) => (item.id === selectedFinding.id ? updated || item : item)));
    setMessage("Implementation evidence saved locally.");
  };

  const verificationEvidenceSummary = (run) => {
    const results = Array.isArray(run?.results) ? run.results : [];
    if (!results.length) return "No lightweight verification commands were run.";
    const passed = results.filter((result) => result.status === "passed").length;
    const failed = results.filter((result) => result.status === "failed" || result.status === "timed_out").length;
    const commandList = results.map((result) => `${result.command}: ${result.status}`).join("; ");
    return `Lightweight verification ${run.status}: ${passed} passed, ${failed} failed. ${commandList}`;
  };

  const handleVerificationRunSaved = async (run) => {
    if (!selectedFinding || !run) return;
    const normalizedRun = {
      ...run,
      id: run.id || makeSafetyRemediationId("verification-run"),
      projectId: selectedFinding.projectId || projectId || "",
      repoId: selectedFinding.repoId || repoMeta.repoId || repoMeta.repoName || "",
      remediationId: selectedFinding.id,
      safetyFindingId: selectedFinding.id,
      patchProposalId: selectedPatch?.id || run.patchProposalId || "",
      updatedAt: nowISO(),
    };
    await safetyRemediationStore.upsertVerificationRuns(normalizedRun);
    const failed = normalizedRun.status === SAFETY_REMEDIATION_VERIFICATION_RUN_STATUSES.FAILED;
    const passed = normalizedRun.status === SAFETY_REMEDIATION_VERIFICATION_RUN_STATUSES.PASSED;
    const updatedFinding = await safetyRemediationStore.updateFinding(selectedFinding.id, {
      verificationStatus: passed
        ? SAFETY_FINDING_VERIFICATION_STATUSES.VERIFIED
        : failed
          ? SAFETY_FINDING_VERIFICATION_STATUSES.FAILED
          : SAFETY_FINDING_VERIFICATION_STATUSES.PENDING,
      testStatus: passed
        ? SAFETY_REMEDIATION_TEST_STATUSES.PASSED
        : failed
          ? SAFETY_REMEDIATION_TEST_STATUSES.FAILED
          : SAFETY_REMEDIATION_TEST_STATUSES.NOT_RUN,
      testEvidence: verificationEvidenceSummary(normalizedRun),
    });
    setVerificationRuns((prev) => {
      const byId = new Map(prev.map((item) => [item.id, item]));
      byId.set(normalizedRun.id, normalizedRun);
      return Array.from(byId.values()).sort((a, b) => (Date.parse(b.completedAt || b.startedAt || 0) || 0) - (Date.parse(a.completedAt || a.startedAt || 0) || 0));
    });
    setFindings((prev) => prev.map((item) => (item.id === selectedFinding.id ? updatedFinding || item : item)));
    setMessage("Lightweight verification evidence saved locally.");
  };

  const handleVerificationDecisionSaved = async (run, decisionRecord) => {
    if (!selectedFinding || !decisionRecord) return;
    const targetRun = run || {
      id: makeSafetyRemediationId("verification-run"),
      projectId: selectedFinding.projectId || projectId || "",
      repoId: selectedFinding.repoId || repoMeta.repoId || repoMeta.repoName || "",
      remediationId: selectedFinding.id,
      safetyFindingId: selectedFinding.id,
      patchProposalId: selectedPatch?.id || "",
      commands: [],
      results: [],
      status: "not_run",
      startedAt: nowISO(),
      completedAt: nowISO(),
    };
    const nextRun = {
      ...targetRun,
      reviewDecision: decisionRecord,
      status: decisionRecord.decision === SAFETY_REMEDIATION_VERIFICATION_DECISIONS.OVERRIDE
        ? SAFETY_REMEDIATION_VERIFICATION_RUN_STATUSES.OVERRIDDEN
        : targetRun.status,
      updatedAt: nowISO(),
    };
    await safetyRemediationStore.upsertVerificationRuns(nextRun);
    const findingPatch = decisionRecord.decision === SAFETY_REMEDIATION_VERIFICATION_DECISIONS.APPROVE
      ? { verificationStatus: SAFETY_FINDING_VERIFICATION_STATUSES.VERIFIED }
      : decisionRecord.decision === SAFETY_REMEDIATION_VERIFICATION_DECISIONS.OVERRIDE
        ? {
          verificationStatus: SAFETY_FINDING_VERIFICATION_STATUSES.DEFERRED,
          implementationNotes: [
            selectedFinding.implementationNotes,
            `Verification override (${decisionRecord.reviewedAt}): ${decisionRecord.overrideReason}`,
          ].filter(Boolean).join("\n"),
        }
        : decisionRecord.decision === SAFETY_REMEDIATION_VERIFICATION_DECISIONS.REJECT
          ? { verificationStatus: SAFETY_FINDING_VERIFICATION_STATUSES.FAILED }
          : { verificationStatus: SAFETY_FINDING_VERIFICATION_STATUSES.PENDING };
    const updatedFinding = await safetyRemediationStore.updateFinding(selectedFinding.id, findingPatch);
    setVerificationRuns((prev) => {
      const byId = new Map(prev.map((item) => [item.id, item]));
      byId.set(nextRun.id, nextRun);
      return Array.from(byId.values()).sort((a, b) => (Date.parse(b.completedAt || b.startedAt || 0) || 0) - (Date.parse(a.completedAt || a.startedAt || 0) || 0));
    });
    setFindings((prev) => prev.map((item) => (item.id === selectedFinding.id ? updatedFinding || item : item)));
    setMessage("Verification review decision saved locally.");
  };

  const handleSendRepairProposal = async (proposal) => {
    if (!selectedFinding || !proposal?.unifiedDiff) return false;
    const repairPatch = {
      id: proposal.id || makeSafetyRemediationId("repair-patch"),
      safetyFindingId: selectedFinding.id,
      title: proposal.title || "Verification repair proposal",
      summary: proposal.summary || "Follow-up patch proposed from verification failure triage.",
      unifiedDiff: proposal.unifiedDiff,
      filesChanged: proposal.filePath ? [proposal.filePath] : [],
      testRecommendations: ["Re-run the failed lightweight verification command after applying this repair."],
      safetyRationale: proposal.rationale || "Repair proposal generated from local verification failure logs.",
      generatedBy: "verification_failure_repair",
      reviewStatus: "draft_ai_generated",
      projectId: selectedFinding.projectId || projectId || "",
      repoId: selectedFinding.repoId || repoMeta.repoId || repoMeta.repoName || "",
      sourceVerificationCommand: proposal.command || "",
      sourceVerificationRepairKind: proposal.kind || "",
      createdAt: nowISO(),
      updatedAt: nowISO(),
    };
    await safetyRemediationStore.upsertPatchProposals(repairPatch);
    const handoff = buildPatchProposalHandoff({
      project,
      projectId,
      repoMeta,
      finding: selectedFindingForDisplay || selectedFinding,
      patchProposal: repairPatch,
      codeArchitectureHazardAnalysis,
      reviewDecisions: decisions,
    });
    try {
      await sendHandoffToVsCode(handoff);
      await safetyRemediationStore.updatePatchProposal(repairPatch.id, {
        sentToVsCodeAt: nowISO(),
        handoffStatus: "sent_to_vscode",
      });
      setPatches((prev) => {
        const byId = new Map(prev.map((item) => [item.id, item]));
        byId.set(repairPatch.id, { ...repairPatch, sentToVsCodeAt: nowISO(), handoffStatus: "sent_to_vscode" });
        return Array.from(byId.values());
      });
      setMessage(`Verification repair proposal "${repairPatch.title}" sent to VS Code for review and apply.`);
      return true;
    } catch (error) {
      exportPatchProposalHandoff(handoff, repairPatch);
      setPatches((prev) => {
        const byId = new Map(prev.map((item) => [item.id, item]));
        byId.set(repairPatch.id, repairPatch);
        return Array.from(byId.values());
      });
      setMessage(`VS Code handoff was unavailable, so the repair handoff JSON was downloaded instead. ${error?.message || ""}`.trim());
      return false;
    }
  };

  const handleSendRepairProposals = async (proposals) => {
    const sendable = Array.isArray(proposals) ? proposals.filter((proposal) => proposal?.unifiedDiff) : [];
    if (!sendable.length) return;
    if (!selectedFinding) return;

    const fileOwners = new Map();
    for (const proposal of sendable) {
      const repairFiles = normalizeRepairFiles(proposal);
      for (const filePath of repairFiles) {
        const existing = fileOwners.get(filePath);
        if (existing) {
          setMessage(`Bulk send needs one combined patch per file set. "${existing.title}" and "${proposal.title}" both modify ${filePath}, so send them individually or merge them deliberately first.`);
          return;
        }
        fileOwners.set(filePath, proposal);
      }
    }

    const aggregatePatch = {
      id: makeSafetyRemediationId("repair-batch"),
      safetyFindingId: selectedFinding.id,
      title: `Verification repair batch (${sendable.length} changes)`,
      summary: sendable.map((proposal) => proposal.title || proposal.summary || "Verification repair").filter(Boolean).join("; "),
      unifiedDiff: sendable.map((proposal) => String(proposal.unifiedDiff || "").trim()).filter(Boolean).join("\n\n"),
      filesChanged: Array.from(fileOwners.keys()),
      testRecommendations: ["Re-run lightweight verification after applying this aggregate repair batch."],
      safetyRationale: sendable.map((proposal) => proposal.rationale || proposal.summary || "").filter(Boolean).join("\n\n"),
      generatedBy: "verification_failure_repair_batch",
      reviewStatus: "draft_ai_generated",
      projectId: selectedFinding.projectId || projectId || "",
      repoId: selectedFinding.repoId || repoMeta.repoId || repoMeta.repoName || "",
      sourceVerificationCommand: Array.from(new Set(sendable.map((proposal) => proposal.command).filter(Boolean))).join(" | "),
      sourceVerificationRepairKind: "aggregate_bulk_send",
      sourceRepairProposalIds: sendable.map((proposal) => proposal.id).filter(Boolean),
      createdAt: nowISO(),
      updatedAt: nowISO(),
    };

    await safetyRemediationStore.upsertPatchProposals(aggregatePatch);
    const handoff = buildPatchProposalHandoff({
      project,
      projectId,
      repoMeta,
      finding: selectedFindingForDisplay || selectedFinding,
      patchProposal: aggregatePatch,
      codeArchitectureHazardAnalysis,
      reviewDecisions: decisions,
    });
    try {
      await sendHandoffToVsCode(handoff);
      await safetyRemediationStore.updatePatchProposal(aggregatePatch.id, {
        sentToVsCodeAt: nowISO(),
        handoffStatus: "sent_to_vscode",
      });
      setPatches((prev) => {
        const byId = new Map(prev.map((item) => [item.id, item]));
        byId.set(aggregatePatch.id, { ...aggregatePatch, sentToVsCodeAt: nowISO(), handoffStatus: "sent_to_vscode" });
        return Array.from(byId.values());
      });
      setMessage(`Sent ${sendable.length} verification repair proposal${sendable.length === 1 ? "" : "s"} to VS Code as one aggregate patch.`);
    } catch (error) {
      exportPatchProposalHandoff(handoff, aggregatePatch);
      setPatches((prev) => {
        const byId = new Map(prev.map((item) => [item.id, item]));
        byId.set(aggregatePatch.id, aggregatePatch);
        return Array.from(byId.values());
      });
      setMessage(`VS Code handoff was unavailable, so the aggregate repair handoff JSON was downloaded instead. ${error?.message || ""}`.trim());
    }
  };

  const handleExportMarkdown = async (finding) => {
    const patch = patches.find((item) => item.id === finding.proposedPatchId || item.safetyFindingId === finding.id);
    const summary = exportSafetyRemediationMarkdown(finding, patch, decisions);
    if (summary) await safetyRemediationStore.upsertSummaryArtifacts(summary);
  };

  const updateFindingLocally = (updated) => {
    if (!updated) return;
    setFindings((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
  };

  const handleArchiveFinding = async (finding) => {
    if (!finding) return;
    const updated = await safetyRemediationStore.archiveFinding(finding.id);
    updateFindingLocally(updated);
    setMessage("Finding archived.");
  };

  const handleRemoveFinding = async (finding) => {
    if (!finding) return;
    const confirmed = window.confirm(`Remove finding "${finding.title}"? It will move to Removed and can be restored.`);
    if (!confirmed) return;
    const updated = await safetyRemediationStore.softDeleteFinding(finding.id);
    updateFindingLocally(updated);
    setMessage("Finding moved to Removed.");
  };

  const handleRestoreFinding = async (finding) => {
    if (!finding) return;
    const updated = finding.deletedAt
      ? await safetyRemediationStore.restoreDeletedFinding(finding.id)
      : await safetyRemediationStore.restoreFinding(finding.id);
    updateFindingLocally(updated);
    setMessage("Finding restored.");
  };

  const handleSaveFindingOrganization = async (patch) => {
    if (!selectedFinding) return;
    const updated = await safetyRemediationStore.updateFindingOrganization(selectedFinding.id, patch);
    updateFindingLocally(updated);
    setMessage("Finding organization saved.");
  };

  const handleClearAllFindings = async () => {
    const ids = scopedAllFindings.map((finding) => finding.id).filter(Boolean);
    if (!ids.length) {
      setMessage("No findings are available to clear.");
      return;
    }
    const confirmed = window.confirm(
      `Clear all ${ids.length} safety finding${ids.length === 1 ? "" : "s"} for this scope? This will also remove associated patch proposals and verification evidence.`,
    );
    if (!confirmed) return;
    const idSet = new Set(ids);
    const patchIds = new Set(patches.filter((patch) => idSet.has(patch.safetyFindingId)).map((patch) => patch.id).filter(Boolean));
    await safetyRemediationStore.deleteFindings(ids);
    setFindings((prev) => prev.filter((finding) => !idSet.has(finding.id)));
    setPatches((prev) => prev.filter((patch) => !idSet.has(patch.safetyFindingId)));
    setDecisions((prev) => prev.filter((decision) => !idSet.has(decision.targetId) && !patchIds.has(decision.targetId)));
    setVerificationRuns((prev) => prev.filter((run) => !idSet.has(run.safetyFindingId) && !patchIds.has(run.patchProposalId)));
    setSelectedFindingId("");
    setDetailFocused(false);
    setMessage(`Cleared ${ids.length} safety finding${ids.length === 1 ? "" : "s"}.`);
  };

  const handleSelectFinding = (finding) => {
    setSelectedFindingId(finding.id);
    setDetailFocused(false);
  };

  const handleOpenFindingReview = (finding) => {
    if (!finding) return;
    setSelectedFindingId(finding.id);
    setDetailFocused(false);
    setReviewPopoutFindingId(finding.id);
  };

  const handleShowFindingList = () => {
    setDetailFocused(false);
  };

  const rowRefForHazardSummaryRow = (row, index) => String(row?.hazardRowRef || row?.id || row?.rowRef || `hazard-row-${index + 1}`).trim();

  const handleOpenCoveredHazardRow = (rowRef) => {
    const ref = String(rowRef || "").trim();
    if (!ref) return;
    let targetIndex = hazardSummaryRows.findIndex((row, index) => rowRefForHazardSummaryRow(row, index) === ref);
    if (targetIndex < 0) {
      const numeric = ref.match(/(?:hazard-row|row|summary-row|cba-hazard-row)-?(\d+)$/i)?.[1] || ref.match(/^(\d+)$/)?.[1];
      const parsedIndex = numeric ? Number(numeric) - 1 : NaN;
      if (Number.isFinite(parsedIndex) && parsedIndex >= 0 && parsedIndex < hazardSummaryRows.length) {
        targetIndex = parsedIndex;
      }
    }
    if (targetIndex >= 0) {
      onOpenHazardSummaryRow?.(targetIndex);
    }
  };

  const selectedLabel = selectedElement?.label || "No architecture element selected";
  const showingDetailOnly = detailFocused && selectedFindingForDisplay;
  const reviewPopoutOpen = Boolean(reviewPopoutFindingId && selectedFindingForDisplay?.id === reviewPopoutFindingId);

  return (
    <div className={`${compact ? "flex h-full min-h-0 flex-col overflow-hidden bg-slate-50" : "mx-auto flex h-full min-h-0 w-full max-w-[1720px] flex-col overflow-hidden rounded-xl border border-slate-200 bg-slate-50"}`}>
      <div className="shrink-0 flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-3 py-2">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Safety Remediation</h2>
          {!compact && <p className="text-xs text-slate-500">Local-first findings, proposed patches, and human review for code architecture evidence.</p>}
          <div className="mt-1 max-w-[760px] truncate rounded-md bg-slate-100 px-2.5 py-1 text-[11px] text-slate-600">
            Selected: <span className="font-semibold text-slate-800">{selectedLabel}</span>
          </div>
        </div>
        {!reviewMode && (
          <button
            type="button"
            disabled={busy || !selectedElement || !codeArchitectureHazardAnalysis || isCodeArchitectureHazardAnalysisStale}
            onClick={handleGenerateFindings}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? "Working..." : "Generate Safety Findings"}
          </button>
        )}
      </div>
      {!codeArchitectureHazardAnalysis && (
        <div className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          Run hazard analysis for this code architecture before generating remediation findings.
        </div>
      )}
      {codeArchitectureHazardAnalysis && isCodeArchitectureHazardAnalysisStale && (
        <div className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          This hazard analysis may be stale because the code architecture changed. Re-run hazard analysis before generating new findings.
        </div>
      )}
      {message && <div className="shrink-0 border-b border-slate-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">{message}</div>}
      <div className={`${compact ? "min-h-0 flex-1 overflow-y-auto overscroll-contain pb-6" : showingDetailOnly ? "min-h-0 flex-1 overflow-hidden" : "grid min-h-0 flex-1 overflow-hidden gap-0 xl:grid-cols-[minmax(280px,340px)_minmax(0,1fr)]"}`}>
        {!showingDetailOnly && (
        <aside className={`${compact ? "border-b" : "border-b overflow-hidden xl:border-b-0 xl:border-r"} flex min-h-0 flex-col border-slate-200 bg-white p-3`}>
          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm font-semibold text-slate-800">Findings</div>
            <div className="flex items-center gap-2">
              <div className="text-xs text-slate-500">{scopedFindings.length} shown</div>
              {!reviewMode && (
                <button
                  type="button"
                  disabled={!scopedAllFindings.length || busy}
                  onClick={handleClearAllFindings}
                  className="rounded px-2 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-40"
                >
                  Clear All
                </button>
              )}
            </div>
          </div>
          <FindingToolbar
            filters={findingFilters}
            counts={viewCounts}
            onChange={(next) => setFindingFilters({ ...DEFAULT_FINDING_FILTERS, ...next })}
          />
          <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 xl:min-h-0 xl:flex xl:flex-1 xl:flex-col xl:overflow-hidden">
            <div className="shrink-0 border-b border-slate-200 px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Finding List
            </div>
            <div className="p-2 xl:min-h-0 xl:flex-1 xl:overflow-y-auto">
              <SafetyFindingList
                findings={scopedFindings}
                selectedFindingId={selectedFinding?.id}
                view={findingFilters.view || SAFETY_FINDING_VIEWS.ACTIVE}
                onSelect={handleSelectFinding}
                onOpenReview={handleOpenFindingReview}
                onArchive={reviewMode ? undefined : handleArchiveFinding}
                onRemove={reviewMode ? undefined : handleRemoveFinding}
                onRestore={reviewMode ? undefined : handleRestoreFinding}
              />
            </div>
          </div>
          {!reviewMode && (
            <FindingOrganizationControls
              finding={selectedFinding}
              busy={busy}
              onSave={handleSaveFindingOrganization}
            />
          )}
          <div className="mt-2 rounded-md bg-slate-50 p-2.5 text-[11px] text-slate-500">
            Context includes {cbaRows.length} architecture rows and {hazardSummaryRows.length} hazard summary rows. Coverage {coverageSummary.covered}/{coverageSummary.total}. Active {viewCounts.active}, archived {viewCounts.archived}, removed {viewCounts.removed}.
          </div>
        </aside>
        )}
        <main className={`${compact ? "" : "flex min-h-0 flex-col overflow-hidden"} min-w-0 p-3 xl:px-4`}>
          {showingDetailOnly && (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white p-3">
              <div>
                <div className="text-sm font-semibold text-slate-800">Finding Details</div>
                <div className="text-xs text-slate-500">
                  {scopedFindings.length} finding{scopedFindings.length === 1 ? "" : "s"} available. Coverage {coverageSummary.covered}/{coverageSummary.total}.
                </div>
              </div>
              <button
                type="button"
                onClick={handleShowFindingList}
                className="rounded-md bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200"
              >
                Back to Findings
              </button>
            </div>
          )}
          <SafetyFindingDetail
            finding={selectedFindingForDisplay}
            patchProposal={selectedPatch}
            busy={busy}
            onGeneratePatch={reviewMode ? undefined : handleGeneratePatch}
            onDecision={reviewMode ? undefined : handleDecision}
            onExportPatch={handleExportPatch}
            onCopyDiff={handleCopyDiff}
            onExportHandoff={reviewMode ? undefined : handleExportHandoff}
            onCopyHandoff={reviewMode ? undefined : handleCopyHandoff}
            onMarkApplied={reviewMode ? undefined : handleMarkApplied}
            onSaveImplementationEvidence={reviewMode ? undefined : handleSaveImplementationEvidence}
            verificationRuns={verificationRuns}
            onVerificationRunSaved={reviewMode ? undefined : handleVerificationRunSaved}
            onVerificationDecisionSaved={reviewMode ? undefined : handleVerificationDecisionSaved}
            onSendRepairProposal={reviewMode ? undefined : handleSendRepairProposal}
            onSendRepairProposals={reviewMode ? undefined : handleSendRepairProposals}
            buildHandoff={() => buildSelectedHandoff(selectedPatch)}
            onExportJson={(finding) => exportSafetyFindingJson(finding, selectedPatch, decisions)}
            onExportMarkdown={handleExportMarkdown}
            repoMeta={repoMeta}
            onOpenHazardSummaryRow={handleOpenCoveredHazardRow}
            reviewMode={reviewMode}
          />
        </main>
      </div>
      {reviewPopoutOpen && (
        <div className="fixed inset-0 z-[90] flex justify-end bg-slate-950/20" role="dialog" aria-modal="true" aria-label="Review safety finding">
          <button
            type="button"
            className="min-h-full flex-1 cursor-default"
            aria-label="Close review popout"
            onClick={() => setReviewPopoutFindingId("")}
          />
          <div className="flex h-full w-full max-w-[760px] flex-col border-l border-slate-200 bg-slate-50 shadow-2xl">
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-900">Review Finding</div>
                <div className="truncate text-xs text-slate-500">{selectedFindingForDisplay?.title}</div>
              </div>
              <button
                type="button"
                onClick={() => setReviewPopoutFindingId("")}
                className="rounded-md px-2.5 py-1.5 text-lg font-semibold leading-none text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                aria-label="Close review popout"
              >
                ×
              </button>
            </div>
            <div className="min-h-0 flex-1 p-3">
              <SafetyFindingDetail
                finding={selectedFindingForDisplay}
                patchProposal={selectedPatch}
                busy={busy}
                onGeneratePatch={reviewMode ? undefined : handleGeneratePatch}
                onDecision={reviewMode ? undefined : handleDecision}
                onExportPatch={handleExportPatch}
                onCopyDiff={handleCopyDiff}
                onExportHandoff={reviewMode ? undefined : handleExportHandoff}
                onCopyHandoff={reviewMode ? undefined : handleCopyHandoff}
                onMarkApplied={reviewMode ? undefined : handleMarkApplied}
                onSaveImplementationEvidence={reviewMode ? undefined : handleSaveImplementationEvidence}
                verificationRuns={verificationRuns}
                onVerificationRunSaved={reviewMode ? undefined : handleVerificationRunSaved}
                onVerificationDecisionSaved={reviewMode ? undefined : handleVerificationDecisionSaved}
                onSendRepairProposal={reviewMode ? undefined : handleSendRepairProposal}
                onSendRepairProposals={reviewMode ? undefined : handleSendRepairProposals}
                buildHandoff={() => buildSelectedHandoff(selectedPatch)}
                onExportJson={(finding) => exportSafetyFindingJson(finding, selectedPatch, decisions)}
                onExportMarkdown={handleExportMarkdown}
                repoMeta={repoMeta}
                onOpenHazardSummaryRow={handleOpenCoveredHazardRow}
                initialActiveTab="workflow"
                reviewMode={reviewMode}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
