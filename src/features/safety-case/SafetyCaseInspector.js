import React from "react";
import { Bot, Link2, Plus, Search, Trash2, Upload, X } from "lucide-react";
import { NODE_TYPE_LABELS, SAFETY_CASE_CONFIDENCE, SAFETY_CASE_NODE_TYPES, SAFETY_CASE_STATUSES } from "./safetyCaseTypes";
import { getLastEvidenceScanDiagnostics, loadLinkableSafetyCaseEvidence } from "./safetyCaseEvidenceLinks";
import { recommendEvidenceLinksForNode } from "./safetyCaseEvidenceRecommendations";
import { saveSafetyCaseEvidenceAttachments } from "./safetyCaseAttachments";

function InspectorButton({ icon: Icon, children, danger, ...props }) {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium ${danger ? "border-red-200 bg-red-50 text-red-700 hover:bg-red-100" : "bg-white text-gray-700 hover:bg-gray-50"}`}
      {...props}
    >
      {Icon && <Icon size={14} />}
      {children}
    </button>
  );
}

function EvidencePreviewModal({ artifact, onClose }) {
  if (!artifact) return null;
  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/30 p-4">
      <div className="max-h-[82vh] w-full max-w-3xl overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b px-4 py-3">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-gray-900">{artifact.title}</h3>
            <p className="mt-1 text-xs text-gray-500">{artifact.category} · {artifact.sourceLabel || artifact.source} · {artifact.id}</p>
          </div>
          <button className="rounded-md p-1.5 text-gray-600 hover:bg-gray-100" type="button" onClick={onClose} aria-label="Close preview">
            <X size={16} />
          </button>
        </div>
        <div className="max-h-[68vh] overflow-auto p-4 text-sm">
          <div className="mb-4 grid grid-cols-2 gap-3 text-xs">
            <div className="rounded-md bg-gray-50 p-3">
              <div className="font-semibold uppercase text-gray-500">Source</div>
              <div className="mt-1 break-words text-gray-800">{artifact.sourceLabel || artifact.source}</div>
            </div>
            <div className="rounded-md bg-gray-50 p-3">
              <div className="font-semibold uppercase text-gray-500">Type</div>
              <div className="mt-1 break-words text-gray-800">{artifact.type}</div>
            </div>
          </div>
          <div className="rounded-md border p-3">
            <div className="mb-2 text-xs font-semibold uppercase text-gray-500">Location</div>
            <p className="whitespace-pre-wrap text-gray-800">{artifact.description || "Location unavailable."}</p>
          </div>
          {artifact.summary && (
            <div className="mt-4 rounded-md border p-3">
              <div className="mb-2 text-xs font-semibold uppercase text-gray-500">Record summary</div>
              <p className="whitespace-pre-wrap text-gray-800">{artifact.summary}</p>
            </div>
          )}
          {artifact.raw?.dataUrl && (
            <div className="mt-4 rounded-md border p-3">
              <div className="mb-2 text-xs font-semibold uppercase text-gray-500">Attached file</div>
              <a className="text-[#2D7DFE] hover:underline" href={artifact.raw.dataUrl} target="_blank" rel="noreferrer">
                Open {artifact.raw.name || artifact.title}
              </a>
            </div>
          )}
          <details className="mt-4 rounded-md border">
            <summary className="cursor-pointer px-3 py-2 text-xs font-semibold uppercase text-gray-500">Raw localDB record</summary>
            <pre className="max-h-72 overflow-auto border-t bg-gray-50 p-3 text-xs text-gray-700">{JSON.stringify(artifact.raw || {}, null, 2)}</pre>
          </details>
        </div>
      </div>
    </div>
  );
}

function LinkedEvidenceModal({ open, artifacts, unresolvedIds, loading, onClose, onOpenLinker, onUnlink }) {
  const [previewArtifact, setPreviewArtifact] = React.useState(null);
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[1080] flex items-center justify-center bg-black/30 p-4">
      <div className="flex max-h-[82vh] w-full max-w-4xl flex-col rounded-lg bg-white shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Linked Evidence</h3>
            <p className="text-xs text-gray-500">Review evidence currently linked to this safety case node.</p>
          </div>
          <button className="rounded-md p-1.5 text-gray-600 hover:bg-gray-100" type="button" onClick={onClose} aria-label="Close linked evidence">
            <X size={16} />
          </button>
        </div>
        <div className="min-h-[260px] flex-1 overflow-auto p-4">
          {loading && <div className="rounded-md border border-dashed p-6 text-center text-sm text-gray-500">Loading linked evidence...</div>}
          {!loading && !artifacts.length && !unresolvedIds.length && (
            <div className="rounded-md border border-dashed p-6 text-center text-sm text-gray-500">No evidence is linked to this node yet.</div>
          )}
          {!!artifacts.length && (
            <div className="overflow-x-auto rounded-md border">
              <table className="min-w-full text-left text-xs">
                <thead className="bg-gray-50 text-[11px] uppercase text-gray-500">
                  <tr>
                    <th className="min-w-[220px] px-3 py-2">Evidence</th>
                    <th className="min-w-[260px] px-3 py-2">Location</th>
                    <th className="min-w-[140px] px-3 py-2">Source</th>
                    <th className="w-40 px-3 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y bg-white">
                  {artifacts.map((artifact) => (
                    <tr key={artifact.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 align-top">
                        <div className="font-medium text-gray-900">{artifact.title}</div>
                        <div className="mt-1 text-[11px] text-gray-500">{artifact.category}</div>
                        <div className="mt-1 break-all text-[11px] text-gray-400">{artifact.id}</div>
                      </td>
                      <td className="px-3 py-2 align-top text-gray-700">
                        <div className="line-clamp-3">{artifact.description || "Location unavailable."}</div>
                        {artifact.summary && <div className="mt-1 line-clamp-2 text-[11px] text-gray-500">{artifact.summary}</div>}
                      </td>
                      <td className="px-3 py-2 align-top text-gray-600">{artifact.sourceLabel || artifact.source}</td>
                      <td className="px-3 py-2 align-top">
                        <div className="flex flex-wrap gap-2">
                          <button className="rounded-md border px-2 py-1 text-[11px] font-medium hover:bg-white" type="button" onClick={() => setPreviewArtifact(artifact)}>
                            Preview
                          </button>
                          <button className="rounded-md border border-red-200 px-2 py-1 text-[11px] font-medium text-red-600 hover:bg-red-50" type="button" onClick={() => onUnlink(artifact.id)}>
                            Unlink
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!!unresolvedIds.length && (
            <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3">
              <div className="text-xs font-semibold uppercase text-amber-800">Unresolved linked IDs</div>
              <div className="mt-1 text-xs text-amber-800">These links are saved on the node, but the linked evidence is not available in the current evidence index.</div>
              <div className="mt-3 space-y-2">
                {unresolvedIds.map((id) => (
                  <div key={id} className="flex items-center gap-2 rounded border bg-white px-2 py-2 text-xs">
                    <span className="min-w-0 flex-1 break-all text-gray-700">{id}</span>
                    <button className="rounded border border-red-200 px-2 py-1 font-medium text-red-600 hover:bg-red-50" type="button" onClick={() => onUnlink(id)}>
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <EvidencePreviewModal artifact={previewArtifact} onClose={() => setPreviewArtifact(null)} />
        <div className="flex justify-end gap-2 border-t px-4 py-3">
          <button className="rounded-md border px-3 py-2 text-xs font-medium hover:bg-gray-50" type="button" onClick={onClose}>Close</button>
          <button className="rounded-md bg-[#2D7DFE] px-3 py-2 text-xs font-semibold text-white hover:bg-[#1f66d1]" type="button" onClick={onOpenLinker}>
            Manage links
          </button>
        </div>
      </div>
    </div>
  );
}

function EvidenceLinkModal({ open, groups, loading, diagnostics, safetyCase, selectedNode, selectedIds, initialLinkedIds, onClose, onApply }) {
  const [draftIds, setDraftIds] = React.useState(new Set(initialLinkedIds));
  const [query, setQuery] = React.useState("");
  const [expanded, setExpanded] = React.useState({});
  const [previewArtifact, setPreviewArtifact] = React.useState(null);
  const [recommendationLoading, setRecommendationLoading] = React.useState(false);
  const [recommendations, setRecommendations] = React.useState([]);
  const [recommendationMessage, setRecommendationMessage] = React.useState("");

  React.useEffect(() => {
    if (open) {
      setDraftIds(new Set(initialLinkedIds));
      setRecommendations([]);
      setRecommendationMessage("");
    }
  }, [initialLinkedIds, open]);

  React.useEffect(() => {
    if (open) {
      const nextExpanded = {};
      groups.forEach((group) => {
        nextExpanded[`category:${group.category}`] = false;
        Array.from(new Set(group.artifacts.map((artifact) => artifact.databaseLabel || artifact.database || "Browser memory"))).forEach((database) => {
          nextExpanded[`database:${group.category}:${database}`] = false;
        });
        Array.from(new Set(group.artifacts.map((artifact) => `${artifact.databaseLabel || artifact.database || "Browser memory"}:${artifact.storeLabel || artifact.sourceLabel || artifact.store || artifact.source || "Unknown store"}`))).forEach((key) => {
          nextExpanded[`store:${group.category}:${key}`] = false;
        });
      });
      setExpanded(nextExpanded);
    }
  }, [groups, open]);

  if (!open) return null;

  const normalizedQuery = query.trim().toLowerCase();
  const filteredGroups = groups.map((group) => ({
    ...group,
    artifacts: group.artifacts.filter((artifact) => !normalizedQuery || `${artifact.title} ${artifact.description} ${artifact.summary} ${artifact.databaseLabel} ${artifact.storeLabel} ${artifact.sourceLabel} ${artifact.database} ${artifact.store} ${artifact.source} ${artifact.type}`.toLowerCase().includes(normalizedQuery)),
  })).filter((group) => group.artifacts.length);
  const visibleIds = filteredGroups.flatMap((group) => group.artifacts.map((artifact) => artifact.id));
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => draftIds.has(id));
  const recommendationIds = recommendations.map((item) => item.id);
  const acceptedRecommendationCount = recommendationIds.filter((id) => draftIds.has(id)).length;
  const groupedByDatabaseAndStore = (artifacts) => artifacts.reduce((acc, artifact) => {
    const database = artifact.databaseLabel || artifact.database || "Browser memory";
    const store = artifact.storeLabel || artifact.sourceLabel || artifact.store || artifact.source || "Unknown store";
    if (!acc[database]) acc[database] = {};
    if (!acc[database][store]) acc[database][store] = [];
    acc[database][store].push(artifact);
    return acc;
  }, {});
  const toggleOne = (id) => {
    setDraftIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const setIds = (ids, checked) => {
    setDraftIds((current) => {
      const next = new Set(current);
      ids.forEach((id) => {
        if (checked) next.add(id);
        else next.delete(id);
      });
      return next;
    });
  };
  const rejectRecommendation = (id) => {
    setRecommendations((current) => current.filter((item) => item.id !== id));
    setDraftIds((current) => {
      const next = new Set(current);
      if (!selectedIds.has(id)) next.delete(id);
      return next;
    });
  };
  const runRecommendationScan = async () => {
    if (!selectedNode || recommendationLoading) return;
    setRecommendationLoading(true);
    setRecommendationMessage("");
    try {
      const result = await recommendEvidenceLinksForNode({ node: selectedNode, safetyCase, groups });
      setRecommendations(result.recommendations || []);
      setRecommendationMessage(result.message || "");
      if (result.recommendations?.length) {
        setIds(result.recommendations.map((item) => item.id), true);
      }
    } catch (error) {
      setRecommendations([]);
      setRecommendationMessage(error?.message || "AI scan failed.");
    } finally {
      setRecommendationLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/30 p-4">
      <div className="flex max-h-[84vh] w-full max-w-5xl flex-col rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Link xHandle Evidence</h3>
            <p className="text-xs text-gray-500">Select one or more localDB artifacts to link to this node.</p>
          </div>
          <button className="rounded-md p-1.5 text-gray-600 hover:bg-gray-100" type="button" onClick={onClose} aria-label="Close evidence picker">
            <X size={16} />
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
          <div className="relative min-w-[260px] flex-1">
            <Search className="absolute left-3 top-2.5 text-gray-400" size={15} />
            <input
              className="w-full rounded-md border py-2 pl-9 pr-3 text-sm"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search evidence..."
            />
          </div>
          <button className="rounded-md border px-3 py-2 text-xs font-medium hover:bg-gray-50" type="button" onClick={() => setIds(visibleIds, !allVisibleSelected)}>
            {allVisibleSelected ? "Clear visible" : "Select visible"}
          </button>
          <button
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-xs font-medium hover:bg-gray-50 disabled:opacity-60"
            type="button"
            onClick={runRecommendationScan}
            disabled={loading || recommendationLoading || !groups.length || !selectedNode}
          >
            <Bot size={14} /> {recommendationLoading ? "Scanning..." : "AI scan"}
          </button>
          <button className="rounded-md border px-3 py-2 text-xs font-medium hover:bg-gray-50" type="button" onClick={() => setDraftIds(new Set())}>Clear all</button>
          <div className="text-xs text-gray-500">{draftIds.size} selected</div>
        </div>
        <div className="min-h-[320px] flex-1 overflow-auto p-4">
          {(recommendationMessage || recommendations.length > 0) && (
            <div className="mb-4 rounded-md border border-[#BFD4FF] bg-[#F6F8FF] p-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-sm font-semibold text-gray-900">Recommended links</div>
                <span className="rounded bg-white px-2 py-0.5 text-[11px] text-gray-600">{acceptedRecommendationCount}/{recommendations.length} accepted</span>
                {!!recommendations.length && (
                  <>
                    <button className="ml-auto rounded border bg-white px-2 py-1 text-[11px] font-medium hover:bg-gray-50" type="button" onClick={() => setIds(recommendationIds, true)}>
                      Accept all
                    </button>
                    <button className="rounded border bg-white px-2 py-1 text-[11px] font-medium hover:bg-gray-50" type="button" onClick={() => setRecommendations([])}>
                      Dismiss all
                    </button>
                  </>
                )}
              </div>
              {recommendationMessage && <div className="mt-1 text-xs text-gray-600">{recommendationMessage}</div>}
              {!!recommendations.length && (
                <div className="mt-3 space-y-2">
                  {recommendations.map((item) => (
                    <div key={item.id} className="flex gap-3 rounded-md border bg-white p-3 text-xs">
                      <input
                        className="mt-1"
                        type="checkbox"
                        checked={draftIds.has(item.id)}
                        onChange={() => toggleOne(item.id)}
                        aria-label={`Accept recommended link ${item.title}`}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-gray-900">{item.title}</span>
                          <span className="rounded bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600">{item.category}</span>
                          <span className="rounded bg-[#ECEEFF] px-2 py-0.5 text-[11px] text-[#2D7DFE]">{item.confidence}</span>
                        </div>
                        <div className="mt-1 text-gray-600">{item.reason}</div>
                        <div className="mt-1 truncate text-[11px] text-gray-500">{item.source}</div>
                      </div>
                      <button className="h-7 rounded border px-2 text-[11px] font-medium hover:bg-gray-50" type="button" onClick={() => rejectRecommendation(item.id)}>
                        Reject
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {loading && <div className="rounded-md border border-dashed p-6 text-center text-sm text-gray-500">Loading localDB evidence...</div>}
          {!loading && !filteredGroups.length && (
            <div className="rounded-md border border-dashed p-6 text-center text-sm text-gray-500">
              <div>No linkable evidence was found.</div>
              <div className="mt-1 text-xs">Checked IndexedDB, xHandle project data, localStorage records, and uploaded evidence attachments.</div>
              {diagnostics && (
                <details className="mx-auto mt-4 max-w-2xl rounded-md border bg-white text-left">
                  <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-gray-600">Evidence scan diagnostics</summary>
                  <pre className="max-h-52 overflow-auto border-t bg-gray-50 p-3 text-[11px] text-gray-700">{JSON.stringify(diagnostics, null, 2)}</pre>
                </details>
              )}
            </div>
          )}
          <div className="space-y-3">
            {filteredGroups.map((group) => {
              const groupIds = group.artifacts.map((artifact) => artifact.id);
              const groupSelected = groupIds.every((id) => draftIds.has(id));
              const categoryKey = `category:${group.category}`;
              const databaseGroups = groupedByDatabaseAndStore(group.artifacts);
              return (
                <section key={group.category} className="rounded-md border">
                  <div className="flex items-center gap-2 border-b bg-gray-50 px-3 py-2">
                    <button
                      type="button"
                      className="text-left text-xs font-semibold uppercase text-gray-600"
                      onClick={() => setExpanded((current) => ({ ...current, [categoryKey]: !current[categoryKey] }))}
                    >
                      {expanded[categoryKey] === false ? "+" : "-"} {group.category}
                    </button>
                    <span className="rounded bg-white px-2 py-0.5 text-[11px] text-gray-500">{group.artifacts.length}</span>
                    <button className="ml-auto rounded border bg-white px-2 py-1 text-[11px] font-medium hover:bg-gray-50" type="button" onClick={() => setIds(groupIds, !groupSelected)}>
                      {groupSelected ? "Clear category" : "Select category"}
                    </button>
                  </div>
                  {expanded[categoryKey] !== false && (
                    <div className="divide-y bg-white">
                      {Object.entries(databaseGroups).sort(([a], [b]) => a.localeCompare(b)).map(([database, storeGroups]) => {
                        const databaseKey = `database:${group.category}:${database}`;
                        const databaseArtifacts = Object.values(storeGroups).flat();
                        const databaseIds = databaseArtifacts.map((artifact) => artifact.id);
                        const databaseSelected = databaseIds.length > 0 && databaseIds.every((id) => draftIds.has(id));
                        return (
                          <div key={database}>
                            <div className="flex items-center gap-2 bg-slate-100 px-4 py-2">
                              <button
                                type="button"
                                className="text-left text-xs font-semibold text-slate-800"
                                onClick={() => setExpanded((current) => ({ ...current, [databaseKey]: !current[databaseKey] }))}
                              >
                                {expanded[databaseKey] === false ? "+" : "-"} {database}
                              </button>
                              <span className="rounded bg-white px-2 py-0.5 text-[11px] text-gray-500">{databaseArtifacts.length}</span>
                              <button className="ml-auto rounded border bg-white px-2 py-1 text-[11px] font-medium hover:bg-gray-50" type="button" onClick={() => setIds(databaseIds, !databaseSelected)}>
                                {databaseSelected ? "Clear database" : "Select database"}
                              </button>
                            </div>
                            {expanded[databaseKey] !== false && Object.entries(storeGroups).sort(([a], [b]) => a.localeCompare(b)).map(([store, artifacts]) => {
                              const storeKey = `store:${group.category}:${database}:${store}`;
                              const storeIds = artifacts.map((artifact) => artifact.id);
                              const storeSelected = storeIds.length > 0 && storeIds.every((id) => draftIds.has(id));
                              return (
                                <div key={store} className="border-t">
                                  <div className="flex items-center gap-2 bg-slate-50 px-6 py-2">
                                    <button
                                      type="button"
                                      className="text-left text-xs font-semibold text-slate-700"
                                      onClick={() => setExpanded((current) => ({ ...current, [storeKey]: !current[storeKey] }))}
                                    >
                                      {expanded[storeKey] === false ? "+" : "-"} {store}
                                    </button>
                                    <span className="rounded bg-white px-2 py-0.5 text-[11px] text-gray-500">{artifacts.length}</span>
                                    <button className="ml-auto rounded border bg-white px-2 py-1 text-[11px] font-medium hover:bg-gray-50" type="button" onClick={() => setIds(storeIds, !storeSelected)}>
                                      {storeSelected ? "Clear store" : "Select store"}
                                    </button>
                                  </div>
                                  {expanded[storeKey] !== false && (
                                    <div className="overflow-x-auto">
                                      <table className="min-w-full text-left text-xs">
                                        <thead className="bg-white text-[11px] uppercase text-gray-500">
                                          <tr>
                                            <th className="w-10 px-3 py-2">Link</th>
                                            <th className="min-w-[220px] px-3 py-2">Title</th>
                                            <th className="min-w-[300px] px-3 py-2">Location</th>
                                            <th className="min-w-[160px] px-3 py-2">Source</th>
                                            <th className="min-w-[120px] px-3 py-2">Type</th>
                                            <th className="w-24 px-3 py-2">Preview</th>
                                          </tr>
                                        </thead>
                                        <tbody className="divide-y">
                                          {artifacts.map((artifact) => (
                                            <tr key={`${group.category}:${artifact.id}`} className="hover:bg-gray-50">
                                              <td className="px-3 py-2 align-top">
                                                <input type="checkbox" checked={draftIds.has(artifact.id)} onChange={() => toggleOne(artifact.id)} aria-label={`Link ${artifact.title}`} />
                                              </td>
                                              <td className="px-3 py-2 align-top">
                                                <div className="font-medium text-gray-900">{artifact.title}</div>
                                                <div className="mt-1 break-all text-[11px] text-gray-500">{artifact.id}</div>
                                                {selectedIds.has(artifact.id) && <span className="mt-1 inline-block rounded bg-[#ECEEFF] px-2 py-0.5 text-[11px] font-medium text-[#2D7DFE]">linked</span>}
                                              </td>
                                              <td className="px-3 py-2 align-top text-gray-700">
                                                <div className="line-clamp-3">{artifact.description || "Location unavailable."}</div>
                                                {artifact.summary && <div className="mt-1 line-clamp-2 text-[11px] text-gray-500">{artifact.summary}</div>}
                                              </td>
                                              <td className="px-3 py-2 align-top text-gray-600">{artifact.sourceLabel || artifact.source}</td>
                                              <td className="px-3 py-2 align-top text-gray-600">{artifact.type}</td>
                                              <td className="px-3 py-2 align-top">
                                                <button className="rounded-md border px-2 py-1 text-[11px] font-medium hover:bg-white" type="button" onClick={() => setPreviewArtifact(artifact)}>
                                                  Preview
                                                </button>
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        </div>
        <EvidencePreviewModal artifact={previewArtifact} onClose={() => setPreviewArtifact(null)} />
        <div className="flex justify-end gap-2 border-t px-4 py-3">
          <button className="rounded-md border px-3 py-2 text-xs font-medium hover:bg-gray-50" type="button" onClick={onClose}>Cancel</button>
          <button className="rounded-md bg-[#2D7DFE] px-3 py-2 text-xs font-semibold text-white hover:bg-[#1f66d1]" type="button" onClick={() => onApply(Array.from(draftIds))}>
            Apply links
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SafetyCaseInspector({ safetyCase, selectedNode, stats, onCaseChange, onNodeChange, onAddChild, onDeleteNode, onAskAI }) {
  const [linkModalOpen, setLinkModalOpen] = React.useState(false);
  const [linkedEvidenceOpen, setLinkedEvidenceOpen] = React.useState(false);
  const [evidenceGroups, setEvidenceGroups] = React.useState([]);
  const [evidenceLoading, setEvidenceLoading] = React.useState(false);
  const [evidenceDiagnostics, setEvidenceDiagnostics] = React.useState(null);
  const [attachmentSaving, setAttachmentSaving] = React.useState(false);
  const fileInputRef = React.useRef(null);

  React.useEffect(() => {
    if (!safetyCase || (!linkModalOpen && !linkedEvidenceOpen)) return;
    let cancelled = false;
    setEvidenceLoading(true);
    setEvidenceDiagnostics(null);
    loadLinkableSafetyCaseEvidence({ projectId: safetyCase.projectId, sourceProjectId: safetyCase.sourceProjectId })
      .then((groups) => {
        if (!cancelled) {
          setEvidenceGroups(groups);
          setEvidenceDiagnostics(getLastEvidenceScanDiagnostics());
        }
      })
      .catch(() => {
        if (!cancelled) {
          setEvidenceGroups([]);
          setEvidenceDiagnostics(getLastEvidenceScanDiagnostics());
        }
      })
      .finally(() => {
        if (!cancelled) setEvidenceLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [linkModalOpen, linkedEvidenceOpen, safetyCase]);

  if (!safetyCase) return null;

  if (!selectedNode) {
    return (
      <aside className="h-full w-full overflow-auto border-l bg-white p-3 xl:w-72">
        <h2 className="text-sm font-semibold text-gray-900">Safety Case</h2>
        <div className="mt-4 space-y-3">
          <label className="block text-xs font-medium text-gray-600">Name</label>
          <input className="w-full rounded-md border px-3 py-2 text-sm" value={safetyCase.name} onChange={(e) => onCaseChange({ ...safetyCase, name: e.target.value })} />
          <label className="block text-xs font-medium text-gray-600">Description</label>
          <textarea className="min-h-[96px] w-full rounded-md border px-3 py-2 text-sm" value={safetyCase.description || ""} onChange={(e) => onCaseChange({ ...safetyCase, description: e.target.value })} />
        </div>
        <div className="mt-5 grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-md bg-gray-50 p-3"><div className="text-gray-500">Claims</div><div className="text-lg font-semibold">{stats.claims}</div></div>
          <div className="rounded-md bg-gray-50 p-3"><div className="text-gray-500">Evidence</div><div className="text-lg font-semibold">{stats.evidence}</div></div>
          <div className="rounded-md bg-gray-50 p-3"><div className="text-gray-500">Unsupported</div><div className="text-lg font-semibold text-red-600">{stats.unsupported}</div></div>
          <div className="rounded-md bg-gray-50 p-3"><div className="text-gray-500">Status</div><div className="text-sm font-semibold">{stats.overall}</div></div>
        </div>
      </aside>
    );
  }

  const patch = (changes, options = {}) => onNodeChange({
    ...selectedNode,
    ...changes,
    metadata: {
      ...selectedNode.metadata,
      ...(changes.metadata || {}),
      updatedAt: new Date().toISOString(),
      lastModifiedBy: "user",
    },
  }, {
    persist: Boolean(options.persist || Object.prototype.hasOwnProperty.call(changes, "linkedArtifactIds")),
  });
  const hasDisplayItems = Array.isArray(selectedNode.metadata?.displayItems) || ["contextBox", "assumptionBox"].includes(selectedNode.metadata?.layoutRole);
  const displayItems = selectedNode.metadata?.displayItems || [];
  const updateDisplayItems = (items) => {
    patch({
      metadata: {
        displayItems: (items || [])
          .map((item) => item.trim())
          .filter(Boolean),
      },
    });
  };
  const updateDisplayItem = (index, value) => {
    const next = [...displayItems];
    next[index] = value;
    patch({ metadata: { displayItems: next } });
  };
  const linkedArtifactIds = new Set(selectedNode.linkedArtifactIds || []);
  const flatArtifacts = evidenceGroups.flatMap((group) => group.artifacts);
  const linkedProjectArtifacts = flatArtifacts.filter((artifact) => linkedArtifactIds.has(artifact.id));
  const unresolvedLinkedArtifactIds = (selectedNode.linkedArtifactIds || []).filter((id) => !flatArtifacts.some((artifact) => artifact.id === id));
  const refreshEvidenceGroups = () => {
    if (!safetyCase) return Promise.resolve([]);
    setEvidenceLoading(true);
    return loadLinkableSafetyCaseEvidence({ projectId: safetyCase.projectId, sourceProjectId: safetyCase.sourceProjectId })
      .then((groups) => {
        setEvidenceGroups(groups);
        setEvidenceDiagnostics(getLastEvidenceScanDiagnostics());
        return groups;
      })
      .catch(() => {
        setEvidenceGroups([]);
        setEvidenceDiagnostics(getLastEvidenceScanDiagnostics());
        return [];
      })
      .finally(() => setEvidenceLoading(false));
  };
  const handleAttachFiles = async (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length) return;
    setAttachmentSaving(true);
    try {
      const saved = await saveSafetyCaseEvidenceAttachments(files, {
        projectId: safetyCase.projectId || safetyCase.sourceProjectId || null,
        safetyCaseId: safetyCase.id,
        nodeId: selectedNode.id,
      });
      const artifactIds = saved.map((item) => `SafetyCaseEvidenceDB:Attachments:${item.id}`);
      patch({ linkedArtifactIds: Array.from(new Set([...(selectedNode.linkedArtifactIds || []), ...artifactIds])) }, { persist: true });
      await refreshEvidenceGroups();
    } catch (error) {
      alert(error?.message || "Unable to attach evidence file.");
    } finally {
      setAttachmentSaving(false);
    }
  };

  return (
    <aside className="h-full w-full overflow-auto border-l bg-white p-3 xl:w-80">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-900">Node Inspector</h2>
        <span className="rounded bg-gray-100 px-2 py-1 text-[11px] text-gray-600">{selectedNode.id.slice(0, 12)}</span>
      </div>
      <div className="mt-4 space-y-3">
        <label className="block text-xs font-medium text-gray-600">Type</label>
        <select className="w-full rounded-md border px-3 py-2 text-sm" value={selectedNode.type} onChange={(e) => patch({ type: e.target.value })}>
          {SAFETY_CASE_NODE_TYPES.map((type) => <option key={type} value={type}>{NODE_TYPE_LABELS[type]}</option>)}
        </select>
        <label className="block text-xs font-medium text-gray-600">Title</label>
        <input className="w-full rounded-md border px-3 py-2 text-sm" value={selectedNode.title} onChange={(e) => patch({ title: e.target.value })} />
        <label className="block text-xs font-medium text-gray-600">Description</label>
        <textarea className="min-h-[120px] w-full rounded-md border px-3 py-2 text-sm" value={selectedNode.description || ""} onChange={(e) => patch({ description: e.target.value })} />
        {hasDisplayItems && (
          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <label className="block text-xs font-medium text-gray-600">Assumptions</label>
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-md border bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                onClick={() => updateDisplayItems([...displayItems, "New assumption"])}
              >
                <Plus size={12} /> Add
              </button>
            </div>
            <div className="space-y-2">
              {displayItems.map((item, index) => (
                <div key={`${index}-${item}`} className="flex items-center gap-2">
                  <input
                    className="min-w-0 flex-1 rounded-md border px-3 py-2 text-sm"
                    value={item}
                    onChange={(e) => updateDisplayItem(index, e.target.value)}
                  />
                  <button
                    type="button"
                    className="rounded-md border border-red-200 bg-red-50 p-2 text-red-700 hover:bg-red-100"
                    aria-label={`Remove assumption ${index + 1}`}
                    onClick={() => updateDisplayItems(displayItems.filter((_, itemIndex) => itemIndex !== index))}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              {!displayItems.length && (
                <button
                  type="button"
                  className="w-full rounded-md border border-dashed px-3 py-3 text-left text-sm text-gray-500 hover:bg-gray-50"
                  onClick={() => updateDisplayItems(["New assumption"])}
                >
                  Add the first assumption
                </button>
              )}
            </div>
          </div>
        )}
        <label className="block text-xs font-medium text-gray-600">Justification</label>
        <textarea
          className="min-h-[88px] w-full rounded-md border px-3 py-2 text-sm"
          value={selectedNode.metadata?.justification || ""}
          onChange={(e) => patch({ metadata: { justification: e.target.value } })}
          placeholder="Explain why this argument step is valid, or assign the rationale used for this branch."
        />
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs font-medium text-gray-600">Status</label>
            <select className="mt-1 w-full rounded-md border px-2 py-2 text-sm" value={selectedNode.status} onChange={(e) => patch({ status: e.target.value })}>
              {SAFETY_CASE_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600">Confidence</label>
            <select className="mt-1 w-full rounded-md border px-2 py-2 text-sm" value={selectedNode.confidence} onChange={(e) => patch({ confidence: e.target.value })}>
              {SAFETY_CASE_CONFIDENCE.map((confidence) => <option key={confidence} value={confidence}>{confidence}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600">Linked evidence</label>
          <button
            type="button"
            className="mt-1 flex w-full items-center justify-between gap-2 rounded-md border bg-white px-3 py-2 text-left text-sm font-medium text-gray-700 hover:bg-gray-50"
            onClick={() => setLinkedEvidenceOpen(true)}
          >
            <span>{selectedNode.linkedArtifactIds?.length || 0} linked artifact{(selectedNode.linkedArtifactIds?.length || 0) === 1 ? "" : "s"}</span>
            <span className="text-xs text-[#2D7DFE]">View</span>
          </button>
        </div>
        <button
          type="button"
          className="inline-flex items-center justify-center gap-1.5 rounded-md border bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          onClick={() => setLinkModalOpen(true)}
        >
          <Link2 size={15} /> Link xHandle evidence
        </button>
        <input
          ref={fileInputRef}
          className="hidden"
          type="file"
          multiple
          accept=".pdf,.doc,.docx,.csv,.xls,.xlsx,.txt,.md,.json,.png,.jpg,.jpeg,.ppt,.pptx,application/pdf,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          onChange={handleAttachFiles}
        />
        <button
          type="button"
          className="inline-flex items-center justify-center gap-1.5 rounded-md border bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          onClick={() => fileInputRef.current?.click()}
          disabled={attachmentSaving}
        >
          <Upload size={15} /> {attachmentSaving ? "Attaching..." : "Attach file evidence"}
        </button>
      </div>
      <LinkedEvidenceModal
        open={linkedEvidenceOpen}
        artifacts={linkedProjectArtifacts}
        unresolvedIds={unresolvedLinkedArtifactIds}
        loading={evidenceLoading}
        onClose={() => setLinkedEvidenceOpen(false)}
        onOpenLinker={() => {
          setLinkedEvidenceOpen(false);
          setLinkModalOpen(true);
        }}
        onUnlink={(id) => patch({ linkedArtifactIds: (selectedNode.linkedArtifactIds || []).filter((item) => item !== id) }, { persist: true })}
      />
      <EvidenceLinkModal
        open={linkModalOpen}
        groups={evidenceGroups}
        loading={evidenceLoading}
        diagnostics={evidenceDiagnostics}
        safetyCase={safetyCase}
        selectedNode={selectedNode}
        selectedIds={linkedArtifactIds}
        initialLinkedIds={selectedNode.linkedArtifactIds || []}
        onClose={() => setLinkModalOpen(false)}
        onApply={(ids) => {
          patch({ linkedArtifactIds: ids }, { persist: true });
          setLinkModalOpen(false);
        }}
      />
      <div className="mt-5 grid grid-cols-2 gap-2">
        <InspectorButton icon={Plus} onClick={() => onAddChild("claim")}>Add Child</InspectorButton>
        <InspectorButton icon={Plus} onClick={() => onAddChild("evidence")}>Add Evidence</InspectorButton>
        <InspectorButton icon={Plus} onClick={() => onAddChild("context")}>Add Context</InspectorButton>
        <InspectorButton icon={Plus} onClick={() => onAddChild("assumption")}>Add Assumption</InspectorButton>
        <InspectorButton icon={Plus} onClick={() => onAddChild("justification")}>Add Justification</InspectorButton>
        <InspectorButton icon={Bot} onClick={() => onAskAI("improve")}>Improve</InspectorButton>
        <InspectorButton icon={Bot} onClick={() => onAskAI("gaps")}>Find Gaps</InspectorButton>
        <InspectorButton icon={Bot} onClick={() => onAskAI("support")}>Generate Support</InspectorButton>
        <InspectorButton icon={Trash2} danger onClick={onDeleteNode}>Delete Node</InspectorButton>
      </div>
    </aside>
  );
}
