import React from "react";

export default function PatchProposalViewer({
  patchProposal,
  finding,
  busy,
  onExportPatch,
  onCopyDiff,
  onExportHandoff,
  onCopyHandoff,
  onMarkApplied,
  onDecision,
  onGeneratePatch,
  reviewMode = false,
}) {
  if (!patchProposal) {
    return <div className="rounded-md border border-dashed border-slate-200 p-3 text-sm text-slate-500">No patch proposal generated yet.</div>;
  }
  const isRejected = patchProposal.reviewStatus === "rejected" || finding?.reviewStatus === "rejected";
  const isFailed = patchProposal.generatedBy === "failed" || patchProposal.reviewStatus === "needs_more_info";
  const canSendToVsCode = Boolean(patchProposal.unifiedDiff && !isRejected && !isFailed);
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="flex flex-col gap-3 border-b border-slate-200 p-3 2xl:flex-row 2xl:items-start 2xl:justify-between">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-slate-800">{patchProposal.title}</div>
          <p className="mt-1 text-xs text-slate-500">{patchProposal.summary}</p>
          <p className="mt-2 text-xs text-blue-700">
            xHandle will send this proposed patch directly to the local VS Code extension when available. The patch will not be applied until you approve it inside VS Code.
          </p>
          {isFailed && (
            <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
              <div className="font-semibold">No applyable patch was generated.</div>
              <p className="mt-1">{patchProposal.summary || "Regenerate after source indexing or narrower code references are available."}</p>
              {Array.isArray(patchProposal.workspaceRoots) && patchProposal.workspaceRoots.length > 0 && (
                <p className="mt-1">
                  Active VS Code workspace used: <span className="font-mono font-semibold">{patchProposal.workspaceRoots[0]}</span>
                </p>
              )}
              {Array.isArray(patchProposal.missingContext) && patchProposal.missingContext.length > 0 && (
                <ul className="mt-1 list-disc pl-4">
                  {patchProposal.missingContext.slice(0, 4).map((item, index) => <li key={index}>{item}</li>)}
                </ul>
              )}
              {Array.isArray(patchProposal.sourceDiagnostics) && patchProposal.sourceDiagnostics.length > 0 && (
                <ul className="mt-1 list-disc pl-4">
                  {patchProposal.sourceDiagnostics.slice(0, 4).map((item, index) => (
                    <li key={index}>{item.filePath || "Unknown file"}: {item.reason || "Source unavailable"}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {patchProposal.sourceContextStatus && !isFailed && (
            <p className="mt-2 text-xs text-slate-500">Source context: {patchProposal.sourceContextStatus}</p>
          )}
        </div>
        <div className="flex w-full min-w-0 flex-wrap gap-2 2xl:w-auto 2xl:max-w-[52%] 2xl:justify-end">
          {!reviewMode && <button type="button" disabled={busy || isFailed} onClick={() => onDecision?.("approve", "Patch approved for VS Code review.")} className="whitespace-nowrap rounded-md bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">Approve Patch</button>}
          {!reviewMode && <button type="button" disabled={busy || !canSendToVsCode} onClick={() => onExportHandoff?.(patchProposal)} className="whitespace-nowrap rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50">Send to VS Code</button>}
          {!reviewMode && <button type="button" disabled={busy || !canSendToVsCode} onClick={() => onCopyHandoff?.(patchProposal)} className="whitespace-nowrap rounded-md bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-50">Copy Handoff</button>}
          <button type="button" disabled={busy || !patchProposal.unifiedDiff} onClick={() => onExportPatch?.(patchProposal)} className="whitespace-nowrap rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50">Export .patch</button>
          <button type="button" disabled={busy || !patchProposal.unifiedDiff} onClick={() => onCopyDiff?.(patchProposal)} className="whitespace-nowrap rounded-md bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-50">Copy Diff</button>
          {!reviewMode && <button type="button" disabled={busy} onClick={() => onMarkApplied?.()} className="whitespace-nowrap rounded-md bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-50">Mark Applied Manually</button>}
          {!reviewMode && <button type="button" disabled={busy} onClick={() => onGeneratePatch?.(finding)} className="whitespace-nowrap rounded-md bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-50">Regenerate</button>}
          {!reviewMode && <button type="button" disabled={busy} onClick={() => onDecision?.("reject", "Patch rejected by human reviewer.")} className="whitespace-nowrap rounded-md bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50">Reject</button>}
        </div>
      </div>
      <pre className="max-h-[360px] overflow-auto bg-slate-950 p-3 text-xs leading-relaxed text-slate-100">
        <code>{patchProposal.unifiedDiff || "No unified diff returned."}</code>
      </pre>
      {(patchProposal.testRecommendations || []).length > 0 && (
        <div className="border-t border-slate-200 p-3">
          <div className="text-xs font-semibold uppercase text-slate-500">Test Recommendations</div>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
            {patchProposal.testRecommendations.map((item, index) => <li key={index}>{item}</li>)}
          </ul>
        </div>
      )}
      {patchProposal.safetyRationale && (
        <div className="border-t border-slate-200 p-3 text-sm text-slate-700">
          <span className="font-semibold">Safety rationale: </span>{patchProposal.safetyRationale}
        </div>
      )}
    </div>
  );
}
