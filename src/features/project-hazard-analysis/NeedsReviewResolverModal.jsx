import React from "react";
import { AlertTriangle, CheckCircle2, Loader2, ShieldQuestion, Sparkles, X } from "lucide-react";

export default function NeedsReviewResolverModal({
  open,
  groups = [],
  answers = {},
  busyGroupId = "",
  draftingGroupId = "",
  status = null,
  onAnswerChange,
  onDraftAnswer,
  onResolveGroup,
  onResolveAnswered,
  onCancel,
  onClose,
}) {
  if (!open) return null;
  const unresolvedCount = groups.reduce((total, group) => total + group.affectedRowIndexes.length, 0);
  const answeredGroups = groups.filter((group) => String(answers?.[group.id]?.answer || "").trim());
  const busy = Boolean(busyGroupId || draftingGroupId);

  return (
    <div className="fixed inset-0 z-[1500] flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="needs-review-title">
      <div className="flex max-h-[calc(100vh-2rem)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex shrink-0 items-start justify-between gap-4 border-b px-6 py-5">
          <div>
            <div className="flex items-center gap-2">
              <ShieldQuestion className="text-amber-600" size={22} />
              <h2 id="needs-review-title" className="text-lg font-semibold text-gray-900">Resolve Needs Review</h2>
            </div>
            <p className="mt-1 max-w-3xl text-sm text-gray-600">
              Answer a small set of architecture questions once. xHandle will re-evaluate only the {unresolvedCount} affected row{unresolvedCount === 1 ? "" : "s"}, independently and in their original operational contexts.
            </p>
          </div>
          <button type="button" onClick={busy ? onCancel : onClose} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100" aria-label={busy ? "Cancel Needs Review resolution" : "Close Needs Review resolver"}>
            <X size={19} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50 px-6 py-5">
          {status?.message && (
            <div className={`mb-4 rounded-xl border px-4 py-3 text-sm ${
              status.kind === "error"
                ? "border-red-200 bg-red-50 text-red-800"
                : status.kind === "success"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-blue-200 bg-blue-50 text-blue-800"
            }`}>
              {status.message}
            </div>
          )}

          {!groups.length ? (
            <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-emerald-200 bg-white p-8 text-center">
              <CheckCircle2 size={34} className="text-emerald-600" />
              <h3 className="mt-3 font-semibold text-gray-900">No unresolved rows</h3>
              <p className="mt-1 text-sm text-gray-600">Every generated hazard-analysis row currently has a definitive disposition.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {groups.map((group) => {
                const answer = answers?.[group.id]?.answer || "";
                const groupBusy = busyGroupId === group.id;
                const groupDrafting = draftingGroupId === group.id;
                return (
                  <section key={group.id} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="rounded-md bg-amber-100 px-2 py-1 text-xs font-bold text-amber-800">{group.id}</span>
                          <h3 className="font-semibold text-gray-900">{group.title}</h3>
                        </div>
                        <p className="mt-3 text-sm font-medium text-gray-900">{group.question}</p>
                        <p className="mt-1 text-xs leading-5 text-gray-600">{group.guidance}</p>
                      </div>
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                        {group.affectedRowIndexes.length} row{group.affectedRowIndexes.length === 1 ? "" : "s"}
                      </span>
                    </div>

                    <details className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                      <summary className="cursor-pointer font-medium">Affected scope: {group.interfaces.length} interface{group.interfaces.length === 1 ? "" : "s"} across {group.contexts.length || 1} context{group.contexts.length === 1 ? "" : "s"}</summary>
                      <div className="mt-2 grid gap-1">
                        {group.interfaces.slice(0, 12).map((value) => <div key={value}>• {value}</div>)}
                        {group.interfaces.length > 12 && <div>• …and {group.interfaces.length - 12} more</div>}
                      </div>
                    </details>

                    {group.scopeChanged && (
                      <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                        <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                        The affected scope changed since this answer was last applied. Review the evidence before running it again.
                      </div>
                    )}

                    <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-gray-600" htmlFor={`needs-review-answer-${group.id}`}>Project architecture evidence</label>
                    <textarea
                      id={`needs-review-answer-${group.id}`}
                      value={answer}
                      onChange={(event) => onAnswerChange(group.id, event.target.value, group.scopeSignature)}
                      disabled={busy}
                      rows={5}
                      placeholder="Describe the confirmed design behavior and its evidence. If it is not defined or not known, say so explicitly—xHandle will preserve Needs Review where appropriate."
                      className="mt-2 w-full resize-y rounded-xl border border-gray-300 px-3 py-2 text-sm leading-6 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-gray-50"
                    />
                    <div className="mt-3 flex items-center justify-between gap-3">
                      <span className="text-xs text-gray-500">The selected AI provider and model will reassess only these linked rows.</span>
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onDraftAnswer(group.id)}
                          disabled={busy}
                          className="inline-flex items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-sm font-medium text-violet-700 hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-50"
                          title="Use the selected AI model to review available project evidence and draft an editable answer"
                        >
                          {groupDrafting ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                          {groupDrafting ? "Reviewing…" : "Review with AI"}
                        </button>
                        <button
                          type="button"
                          onClick={() => onResolveGroup(group.id)}
                          disabled={busy || !String(answer).trim()}
                          className="inline-flex items-center gap-2 rounded-lg bg-[#2D7DFE] px-4 py-2 text-sm font-medium text-white hover:bg-[#1C5FDE] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {groupBusy && <Loader2 size={16} className="animate-spin" />}
                          {groupBusy ? "Re-evaluating…" : `Resolve ${group.affectedRowIndexes.length} rows`}
                        </button>
                      </div>
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-t bg-white px-6 py-4">
          <p className="text-xs text-gray-500">Answers are saved with this project and remain editable.</p>
          <div className="flex items-center gap-2">
            <button type="button" onClick={busy ? onCancel : onClose} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">{busy ? "Cancel" : "Close"}</button>
            {groups.length > 0 && (
              <button
                type="button"
                onClick={onResolveAnswered}
                disabled={busy || !answeredGroups.length}
                className="inline-flex items-center gap-2 rounded-lg bg-[#7A37FF] px-4 py-2 text-sm font-medium text-white hover:bg-[#5E2AD1] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busyGroupId === "all" && <Loader2 size={16} className="animate-spin" />}
                Resolve answered questions
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
