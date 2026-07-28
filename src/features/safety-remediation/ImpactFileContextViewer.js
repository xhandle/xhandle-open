import React, { useEffect, useMemo, useState } from "react";
import { buildImpactFileContexts } from "./safetyRemediationSourceContext";

export default function ImpactFileContextViewer({ finding, repoMeta = {} }) {
  const repoMetaKey = useMemo(() => JSON.stringify({
    repoId: repoMeta.repoId || "",
    repoName: repoMeta.repoName || "",
    repoUrl: repoMeta.repoUrl || "",
    owner: repoMeta.owner || "",
    repo: repoMeta.repo || "",
    branch: repoMeta.branch || "",
  }), [repoMeta]);
  const stableRepoMeta = useMemo(() => JSON.parse(repoMetaKey), [repoMetaKey]);
  const [state, setState] = useState({
    loading: false,
    files: [],
    diagnostics: [],
    error: "",
  });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!finding) {
        setState({ loading: false, files: [], diagnostics: [], error: "" });
        return;
      }
      setState((prev) => ({ ...prev, loading: true, error: "" }));
      try {
        const contexts = await buildImpactFileContexts({
          finding,
          codeReferences: finding.affectedCodeRefs || [],
          repoMeta: stableRepoMeta,
        });
        if (cancelled) return;
        setState({
          loading: false,
          files: contexts,
          diagnostics: Array.isArray(contexts.diagnostics) ? contexts.diagnostics : [],
          error: "",
        });
      } catch (error) {
        if (cancelled) return;
        setState({
          loading: false,
          files: [],
          diagnostics: [],
          error: error?.message || "Unable to load impacted source files.",
        });
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [finding, stableRepoMeta]);

  if (!finding) return null;
  const activeWorkspaceRoots = Array.from(new Set(
    state.files
      .filter((file) => file.source === "vscode_active_workspace" && file.workspaceRoot)
      .map((file) => file.workspaceRoot)
  ));

  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-white">
      <div className="border-b border-slate-200 p-3">
        <div className="text-sm font-semibold text-slate-800">Impacted Source Files</div>
        <p className="mt-1 text-xs text-slate-500">
          These are the source files xHandle resolved from the finding's affected code references. Patch generation uses this same source-loading path.
          {finding.traceSource === "hazard-row-traceability" && " Trace source: hazard row traceability."}
          {finding.traceSource === "architecture-evidence-fallback" && " Trace source: fallback architecture evidence."}
        </p>
        {activeWorkspaceRoots.length > 0 && (
          <div className="mt-2 rounded-md border border-blue-100 bg-blue-50 px-2 py-1.5 text-xs text-blue-800">
            Active VS Code workspace: <span className="font-mono font-semibold">{activeWorkspaceRoots[0]}</span>
          </div>
        )}
      </div>

      {state.loading && (
        <div className="p-3 text-sm text-slate-500">Loading impacted files...</div>
      )}

      {!state.loading && state.error && (
        <div className="p-3 text-sm text-rose-700">{state.error}</div>
      )}

      {!state.loading && !state.error && !state.files.length && (
        <div className="space-y-2 p-3 text-sm text-slate-600">
          <p>No impacted source files could be loaded for this finding.</p>
          {!finding.affectedCodeRefs?.length && (
            <p className="text-xs text-amber-700">
              This hazard row did not include code references. Re-run code architecture hazard analysis after traceability columns are available.
            </p>
          )}
          {state.diagnostics.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-xs text-slate-500">
              {state.diagnostics.slice(0, 4).map((item, index) => (
                <li key={`${item.filePath || "missing"}-${index}`}>
                  {item.filePath || "Unknown file"}: {item.reason || "Source unavailable"}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {!state.loading && state.files.map((file) => (
        <details key={file.filePath} className="border-t border-slate-100" open={state.files.length === 1}>
          <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-slate-800">
            {file.filePath}
            <span className="ml-2 text-xs font-normal text-slate-500">
              {file.lineCount} lines · {file.source}
            </span>
          </summary>
          <div className="border-t border-slate-100 px-3 py-2">
            <div className="mb-2 flex flex-wrap gap-2 text-xs text-slate-500">
              {file.source === "vscode_active_workspace" && file.workspaceRoot && (
                <span className="font-semibold text-blue-700">Active workspace {file.workspaceRoot}</span>
              )}
              {file.requestedFilePath && file.requestedFilePath !== file.filePath && (
                <span className="font-semibold text-emerald-700">Resolved from {file.requestedFilePath}</span>
              )}
              {file.branch && <span>Branch {file.branch}</span>}
              {file.commitSha && <span>Commit {file.commitSha.slice(0, 12)}</span>}
              {file.isTruncated && <span className="font-semibold text-amber-700">Loaded content was truncated at the indexed source limit.</span>}
            </div>
            {file.pathResolutionWarning && (
              <div className="mb-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
                {file.pathResolutionWarning}
              </div>
            )}
            {file.references?.length > 0 && (
              <div className="mb-2 text-xs text-slate-600">
                Referenced symbols: {file.references.map((ref) => [
                  ref.symbolName || "file",
                  ref.startLine ? `:${ref.startLine}${ref.endLine && ref.endLine !== ref.startLine ? `-${ref.endLine}` : ""}` : "",
                ].join("")).join(", ")}
              </div>
            )}
            <pre className="max-h-[520px] overflow-auto rounded-md bg-slate-950 p-3 text-xs leading-relaxed text-slate-100">
              <code>{file.content}</code>
            </pre>
          </div>
        </details>
      ))}
    </div>
  );
}
