import React, { useEffect, useState } from "react";
import CodeReferenceList from "./CodeReferenceList";
import ImpactFileContextViewer from "./ImpactFileContextViewer";
import ImplementationEvidenceForm from "./ImplementationEvidenceForm";
import PatchProposalViewer from "./PatchProposalViewer";
import ReviewDecisionControls from "./ReviewDecisionControls";
import VerificationPanel from "./VerificationPanel";

export default function SafetyFindingDetail({
  finding,
  patchProposal,
  busy,
  onGeneratePatch,
  onDecision,
  onExportPatch,
  onCopyDiff,
  onExportHandoff,
  onCopyHandoff,
  onMarkApplied,
  onSaveImplementationEvidence,
  verificationRuns = [],
  onVerificationRunSaved,
  onVerificationDecisionSaved,
  onSendRepairProposal,
  onSendRepairProposals,
  buildHandoff,
  onExportJson,
  onExportMarkdown,
  repoMeta = {},
  onOpenHazardSummaryRow,
  initialActiveTab = "finding",
  reviewMode = false,
}) {
  const [activeTab, setActiveTab] = useState(initialActiveTab || "finding");
  useEffect(() => {
    setActiveTab(initialActiveTab || "finding");
  }, [finding?.id, initialActiveTab]);
  if (!finding) {
    return <div className="rounded-lg border border-dashed border-slate-200 p-6 text-sm text-slate-500">Select or generate a finding to review remediation details.</div>;
  }
  const tabs = [
    { id: "finding", label: "Finding" },
    { id: "patch", label: "Patch Proposal" },
    { id: "source", label: "Source Context" },
    { id: "workflow", label: "Review & Evidence" },
  ];
  const coveredRefs = Array.isArray(finding.coveredHazardRowRefs) ? finding.coveredHazardRowRefs : [];
  const coveredRows = Array.isArray(finding.coveredHazardRows) ? finding.coveredHazardRows : [];
  const tabSectionClass = "p-4";

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="flex flex-wrap items-start justify-between gap-3 p-4">
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold text-slate-900">{finding.title}</h3>
            <p className="mt-1 text-sm text-slate-600">{finding.description}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => onExportJson?.(finding)} className="rounded-md bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200">Export JSON</button>
            <button type="button" onClick={() => onExportMarkdown?.(finding)} className="rounded-md bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200">Export Report</button>
          </div>
        </div>
        <div className="flex flex-wrap gap-1 border-t border-slate-200 bg-slate-50 p-2">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`rounded-md px-3 py-2 text-xs font-semibold ${
                activeTab === tab.id
                  ? "bg-blue-600 text-white"
                  : "text-slate-600 hover:bg-white hover:text-slate-900"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

      </div>

      <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-slate-200 bg-white">
        {activeTab === "finding" && (
          <section className={`${tabSectionClass} space-y-4`}>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-md bg-slate-50 p-3">
                <div className="text-xs font-semibold uppercase text-slate-500">Hazard</div>
                <div className="mt-1 text-sm text-slate-800">{finding.hazard || "Not specified"}</div>
              </div>
              <div className="rounded-md bg-slate-50 p-3">
                <div className="text-xs font-semibold uppercase text-slate-500">Causal Factor</div>
                <div className="mt-1 text-sm text-slate-800">{finding.causalFactor || "Not specified"}</div>
              </div>
              <div className="rounded-md bg-slate-50 p-3">
                <div className="text-xs font-semibold uppercase text-slate-500">Risk</div>
                <div className="mt-1 text-sm text-slate-800">{[finding.severity, finding.likelihood, finding.riskLevel].filter(Boolean).join(" / ") || "Not specified"}</div>
                <div className="mt-1 text-xs text-slate-500">
                  {[finding.priority ? `Priority ${finding.priority}` : "", finding.riskCode ? `Risk/RAC ${finding.riskCode}` : ""].filter(Boolean).join(" · ")}
                </div>
              </div>
              <div className="rounded-md bg-slate-50 p-3">
                <div className="text-xs font-semibold uppercase text-slate-500">Architecture Element</div>
                <div className="mt-1 text-sm text-slate-800">{finding.architectureElementLabel || finding.architectureElementId}</div>
              </div>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase text-slate-500">Proposed Mitigation</div>
              <p className="mt-1 text-sm text-slate-700">{finding.proposedMitigation || "No mitigation proposed."}</p>
            </div>
            <div>
              <div className="mb-2 text-sm font-semibold text-slate-800">Hazard Summary Coverage</div>
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                  <span className="font-semibold text-slate-800">{coveredRefs.length || (finding.hazardRowRef ? 1 : 0)} covered row{(coveredRefs.length || (finding.hazardRowRef ? 1 : 0)) === 1 ? "" : "s"}</span>
                  {finding.hazardRowRef && <span>Primary row {finding.hazardRowRef}</span>}
                  {finding.coverageRationale && <span>{finding.coverageRationale}</span>}
                </div>
                {coveredRefs.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {coveredRefs.map((ref) => (
                      <button
                        key={ref}
                        type="button"
                        onClick={() => onOpenHazardSummaryRow?.(ref)}
                        className="rounded bg-blue-50 px-2 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-100 hover:underline"
                        title="Open this hazard row in the code architecture hazard summary table"
                      >
                        {ref}
                      </button>
                    ))}
                  </div>
                )}
                {coveredRows.length > 0 && (
                  <div className="mt-3 max-h-56 overflow-auto rounded border border-slate-200 bg-white">
                    <table className="min-w-full text-left text-xs">
                      <thead className="bg-slate-100 text-slate-500">
                        <tr>
                          <th className="px-2 py-1">Row</th>
                          <th className="px-2 py-1">Hazard</th>
                          <th className="px-2 py-1">Mitigation</th>
                          <th className="px-2 py-1">Source</th>
                        </tr>
                      </thead>
                      <tbody>
                        {coveredRows.map((row, index) => (
                          <tr key={`${row.rowRef || index}`} className="border-t border-slate-100">
                            <td className="px-2 py-1 font-mono text-slate-700">
                              <button
                                type="button"
                                onClick={() => onOpenHazardSummaryRow?.(row.rowRef)}
                                className="font-mono text-blue-700 hover:underline"
                                title="Open this hazard row in the code architecture hazard summary table"
                              >
                                {row.rowRef || "n/a"}
                              </button>
                            </td>
                            <td className="px-2 py-1 text-slate-700">
                              <button
                                type="button"
                                onClick={() => onOpenHazardSummaryRow?.(row.rowRef)}
                                className="text-left text-blue-700 hover:underline"
                                title="Open this hazard row in the code architecture hazard summary table"
                              >
                                {row.hazard || "Not specified"}
                              </button>
                            </td>
                            <td className="px-2 py-1 text-slate-700">{row.mitigation || "Not specified"}</td>
                            <td className="px-2 py-1 text-slate-500">{(row.sourceFiles || []).join(", ") || "n/a"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {activeTab === "patch" && (
          <section className={tabSectionClass}>
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-slate-800">Patch Proposal</div>
              {!reviewMode && onGeneratePatch && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onGeneratePatch?.(finding)}
                  className="rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {patchProposal ? "Regenerate Patch" : "Generate Patch"}
                </button>
              )}
            </div>
            <PatchProposalViewer
              patchProposal={patchProposal}
              finding={finding}
              busy={busy}
              onExportPatch={onExportPatch}
              onCopyDiff={onCopyDiff}
              onExportHandoff={onExportHandoff}
              onCopyHandoff={onCopyHandoff}
              onMarkApplied={onMarkApplied}
              onDecision={onDecision}
              onGeneratePatch={onGeneratePatch}
              reviewMode={reviewMode}
            />
          </section>
        )}

        {activeTab === "source" && (
          <section className={`${tabSectionClass} space-y-4`}>
            <div>
              <div className="mb-2 text-sm font-semibold text-slate-800">Affected Code References</div>
              <CodeReferenceList references={finding.affectedCodeRefs || []} />
            </div>
            <ImpactFileContextViewer finding={finding} repoMeta={repoMeta} />
          </section>
        )}

        {activeTab === "workflow" && (
          <section className={`${tabSectionClass} space-y-4`}>
            <VerificationPanel
              finding={finding}
              patchProposal={patchProposal}
              verificationRuns={verificationRuns}
              busy={busy}
              buildHandoff={buildHandoff}
              onVerificationRunSaved={reviewMode ? undefined : onVerificationRunSaved}
              onVerificationDecisionSaved={reviewMode ? undefined : onVerificationDecisionSaved}
              onSendRepairProposal={reviewMode ? undefined : onSendRepairProposal}
              onSendRepairProposals={reviewMode ? undefined : onSendRepairProposals}
            />
            {!reviewMode && <ImplementationEvidenceForm finding={finding} busy={busy} onSave={onSaveImplementationEvidence} />}

            {!reviewMode && <ReviewDecisionControls targetType={patchProposal ? "patch proposal" : "finding"} disabled={busy} onDecision={onDecision} />}
          </section>
        )}
      </div>
    </div>
  );
}
