import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";

function slugifyHeading(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function extractPlainText(children) {
  if (children == null) return "";
  if (typeof children === "string" || typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(extractPlainText).join("");
  if (children?.props?.children) return extractPlainText(children.props.children);
  return "";
}

function downloadMarkdown(filename, markdown) {
  const blob = new Blob([markdown || ""], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function formatDate(value) {
  if (!value) return "Not generated";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

function extractHeadings(markdown) {
  const counts = new Map();
  return String(markdown || "")
    .split(/\r?\n/)
    .map((line) => {
      const match = /^(#{1,4})\s+(.+?)\s*$/.exec(line);
      if (!match) return null;
      const text = match[2].replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").trim();
      const base = slugifyHeading(text) || "section";
      const count = counts.get(base) || 0;
      counts.set(base, count + 1);
      return {
        id: count ? `${base}-${count + 1}` : base,
        text,
        level: match[1].length,
      };
    })
    .filter(Boolean);
}

function lightweightHash(text) {
  let hash = 5381;
  const input = String(text || "");
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash) ^ input.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

const REVIEW_STATUSES = {
  not_reviewed: { label: "Not Reviewed", className: "bg-slate-100 text-slate-600 border-slate-200" },
  in_review: { label: "In Review", className: "bg-blue-50 text-blue-700 border-blue-200" },
  approved: { label: "Approved", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  needs_revision: { label: "Needs Revision", className: "bg-amber-50 text-amber-800 border-amber-200" },
};

const ACTION_STATUSES = ["Open", "In Progress", "Closed"];
const ACTION_PRIORITIES = ["Medium", "High", "Low"];

function emptyReviewState(reportId) {
  return {
    reportId,
    sections: {},
    comments: [],
    actionItems: [],
  };
}

function makeId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function StatusBadge({ status }) {
  const item = REVIEW_STATUSES[status] || REVIEW_STATUSES.not_reviewed;
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${item.className}`}>
      {item.label}
    </span>
  );
}

export default function ArchitectureReportViewer({
  report,
  repoName,
  branch,
  commitSha,
  onRegenerate,
  onBackToArchitecture,
}) {
  const markdown = report?.markdown || "";
  const generatedAt = report?.generatedAt || report?.metadata?.generatedAt;
  const title = report?.metadata?.title || "Software Architecture Description";
  const bodyRef = useRef(null);
  const [activeId, setActiveId] = useState("");
  const [imagePreview, setImagePreview] = useState(null);
  const [copyState, setCopyState] = useState("Copy Markdown");
  const [renderFailed, setRenderFailed] = useState(false);
  const scrollStorageKey = `xhandle:architecture-report-scroll:${repoName || "repo"}:${branch || "main"}`;
  const reportId = useMemo(
    () => report?.id || `architecture-report:${repoName || "repo"}:${branch || "main"}:${commitSha || generatedAt || lightweightHash(markdown)}`,
    [report?.id, repoName, branch, commitSha, generatedAt, markdown]
  );
  const reviewStorageKey = `xhandle:architecture-report-review:${reportId}`;
  const [reviewMode, setReviewMode] = useState(false);
  const [selectedSectionId, setSelectedSectionId] = useState("");
  const [commentDraft, setCommentDraft] = useState("");
  const [actionDraft, setActionDraft] = useState({ title: "", description: "", priority: "Medium" });
  const [reviewState, setReviewState] = useState(() => emptyReviewState(reportId));
  const reviewLoadedRef = useRef(false);

  // The ToC is derived from Markdown headings once per document. The renderer
  // uses the same slug algorithm, so static anchor links stay stable.
  const headings = useMemo(() => extractHeadings(markdown), [markdown]);
  const reviewableHeadings = useMemo(() => headings.filter((h) => h.level <= 3), [headings]);
  const selectedSection = reviewableHeadings.find((h) => h.id === selectedSectionId) || reviewableHeadings[0] || null;

  useEffect(() => {
    if (!reviewableHeadings.length) return;
    setSelectedSectionId((current) => current && reviewableHeadings.some((h) => h.id === current) ? current : reviewableHeadings[0].id);
  }, [reviewableHeadings]);

  useEffect(() => {
    reviewLoadedRef.current = false;
    try {
      const stored = JSON.parse(localStorage.getItem(reviewStorageKey) || "null");
      setReviewState(stored?.reportId === reportId ? stored : emptyReviewState(reportId));
    } catch {
      setReviewState(emptyReviewState(reportId));
    }
    const timer = setTimeout(() => {
      reviewLoadedRef.current = true;
    }, 0);
    return () => clearTimeout(timer);
  }, [reportId, reviewStorageKey]);

  useEffect(() => {
    if (!reviewLoadedRef.current) return;
    try {
      localStorage.setItem(reviewStorageKey, JSON.stringify(reviewState));
    } catch {}
  }, [reviewState, reviewStorageKey]);

  const getSectionStatus = useCallback(
    (sectionId) => reviewState.sections?.[sectionId]?.status || "not_reviewed",
    [reviewState.sections]
  );
  const sectionComments = (sectionId) => reviewState.comments.filter((comment) => comment.sectionId === sectionId);
  const sectionActions = (sectionId) => reviewState.actionItems.filter((item) => item.sectionId === sectionId);
  const selectedComments = selectedSection ? sectionComments(selectedSection.id) : [];
  const selectedActions = selectedSection ? sectionActions(selectedSection.id) : [];

  const reviewSummary = useMemo(() => {
    const totalSections = reviewableHeadings.length;
    const statuses = reviewableHeadings.map((h) => reviewState.sections?.[h.id]?.status || "not_reviewed");
    const reviewed = statuses.filter((status) => status !== "not_reviewed").length;
    const approved = statuses.filter((status) => status === "approved").length;
    const needsRevision = statuses.filter((status) => status === "needs_revision").length;
    const unresolvedComments = reviewState.comments.filter((comment) => !comment.resolved).length;
    const openActionItems = reviewState.actionItems.filter((item) => item.status !== "Closed").length;
    return {
      totalSections,
      reviewed,
      approved,
      needsRevision,
      unresolvedComments,
      openActionItems,
      percentReviewed: totalSections ? Math.round((reviewed / totalSections) * 100) : 0,
    };
  }, [reviewState, reviewableHeadings]);

  const updateSectionStatus = (sectionId, status) => {
    const now = new Date().toISOString();
    setReviewState((current) => ({
      ...current,
      sections: {
        ...current.sections,
        [sectionId]: {
          status,
          reviewedAt: status === "not_reviewed" ? "" : now,
        },
      },
    }));
  };

  const addComment = () => {
    const text = commentDraft.trim();
    if (!text || !selectedSection) return;
    const selectedText = String(window.getSelection?.()?.toString?.() || "").trim();
    setReviewState((current) => ({
      ...current,
      comments: [
        ...current.comments,
        {
          id: makeId("comment"),
          sectionId: selectedSection.id,
          sectionTitle: selectedSection.text,
          text,
          selectedText: selectedText || "",
          createdAt: new Date().toISOString(),
          resolved: false,
        },
      ],
    }));
    setCommentDraft("");
  };

  const toggleCommentResolved = (commentId) => {
    setReviewState((current) => ({
      ...current,
      comments: current.comments.map((comment) =>
        comment.id === commentId ? { ...comment, resolved: !comment.resolved, resolvedAt: comment.resolved ? "" : new Date().toISOString() } : comment
      ),
    }));
  };

  const startActionFromComment = (comment) => {
    setSelectedSectionId(comment.sectionId);
    setActionDraft({
      title: comment.text.slice(0, 84),
      description: comment.selectedText ? `${comment.text}\n\nSelected text: ${comment.selectedText}` : comment.text,
      priority: "Medium",
    });
  };

  const addActionItem = () => {
    const title = actionDraft.title.trim();
    if (!title || !selectedSection) return;
    setReviewState((current) => ({
      ...current,
      actionItems: [
        ...current.actionItems,
        {
          id: makeId("action"),
          sectionId: selectedSection.id,
          sectionTitle: selectedSection.text,
          title,
          description: actionDraft.description.trim(),
          relatedArchitectureItem: selectedSection.text,
          priority: actionDraft.priority || "Medium",
          status: "Open",
          createdAt: new Date().toISOString(),
        },
      ],
    }));
    setActionDraft({ title: "", description: "", priority: "Medium" });
  };

  const updateActionItem = (actionId, patch) => {
    setReviewState((current) => ({
      ...current,
      actionItems: current.actionItems.map((item) => item.id === actionId ? { ...item, ...patch } : item),
    }));
  };

  useEffect(() => {
    const host = bodyRef.current;
    if (!host || !headings.length) return undefined;
    const onScroll = () => {
      const headingEls = headings
        .map((h) => document.getElementById(h.id))
        .filter(Boolean);
      let current = headingEls[0]?.id || "";
      const hostTop = host.getBoundingClientRect().top;
      for (const el of headingEls) {
        if (el.getBoundingClientRect().top - hostTop < 120) current = el.id;
      }
      setActiveId(current);
    };
    host.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => host.removeEventListener("scroll", onScroll);
  }, [headings]);

  useEffect(() => {
    const host = bodyRef.current;
    if (!host || !markdown) return undefined;
    const saved = Number(localStorage.getItem(scrollStorageKey) || 0);
    if (Number.isFinite(saved) && saved > 0) {
      setTimeout(() => {
        host.scrollTop = saved;
      }, 0);
    }
    let timer = null;
    const saveScroll = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => localStorage.setItem(scrollStorageKey, String(host.scrollTop)), 120);
    };
    host.addEventListener("scroll", saveScroll, { passive: true });
    return () => {
      if (timer) clearTimeout(timer);
      try { localStorage.setItem(scrollStorageKey, String(host.scrollTop)); } catch {}
      host.removeEventListener("scroll", saveScroll);
    };
  }, [markdown, scrollStorageKey]);

  const headingCountsRef = useRef(new Map());
  headingCountsRef.current = new Map();

  const markdownComponents = useMemo(() => {
    const makeHeading = (Tag, className) => ({ children, ...props }) => {
      const text = extractPlainText(children);
      const base = slugifyHeading(text) || "section";
      const count = headingCountsRef.current.get(base) || 0;
      headingCountsRef.current.set(base, count + 1);
      const id = count ? `${base}-${count + 1}` : base;
      const reviewable = reviewableHeadings.some((h) => h.id === id);
      const status = getSectionStatus(id);
      return (
        <div className={reviewMode && reviewable ? "group -mx-3 rounded-lg px-3 py-1 transition hover:bg-slate-50" : ""}>
          <Tag id={id} className={className} {...props}>
            <span>{children}</span>
            {reviewMode && reviewable && (
              <span className="ml-3 inline-flex translate-y-[-2px] items-center gap-2 align-middle">
                <button
                  type="button"
                  onClick={() => setSelectedSectionId(id)}
                  className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-600 shadow-sm hover:border-blue-200 hover:text-blue-700"
                >
                  Review
                </button>
                <StatusBadge status={status} />
              </span>
            )}
          </Tag>
        </div>
      );
    };

    return {
      h1: makeHeading("h1", "text-3xl font-bold tracking-tight text-slate-950 mt-2 mb-5"),
      h2: makeHeading("h2", "text-2xl font-semibold text-slate-900 mt-10 mb-4 border-b border-slate-200 pb-2"),
      h3: makeHeading("h3", "text-xl font-semibold text-slate-800 mt-8 mb-3"),
      h4: makeHeading("h4", "text-base font-semibold text-slate-700 mt-6 mb-2"),
      p: ({ children }) => <p className="my-4 leading-7 text-slate-700">{children}</p>,
      ul: ({ children }) => <ul className="my-4 ml-6 list-disc space-y-2 text-slate-700">{children}</ul>,
      ol: ({ children }) => <ol className="my-4 ml-6 list-decimal space-y-2 text-slate-700">{children}</ol>,
      li: ({ children }) => <li className="pl-1 leading-7">{children}</li>,
      a: ({ href, children }) => (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-blue-700 underline decoration-blue-300 underline-offset-2 hover:text-blue-900"
        >
          {children}
        </a>
      ),
      table: ({ children }) => (
        <div className="my-6 overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full border-collapse text-sm">{children}</table>
        </div>
      ),
      thead: ({ children }) => <thead className="bg-slate-100 text-slate-800">{children}</thead>,
      th: ({ children }) => <th className="border-b border-slate-200 px-3 py-2 text-left font-semibold">{children}</th>,
      td: ({ children }) => <td className="border-t border-slate-100 px-3 py-2 align-top text-slate-700">{children}</td>,
      code: ({ inline, children }) =>
        inline ? (
          <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[0.9em] text-slate-900">{children}</code>
        ) : (
          <code>{children}</code>
        ),
      pre: ({ children }) => (
        <pre className="my-5 overflow-x-auto rounded-lg bg-slate-950 p-4 text-sm leading-6 text-slate-100">
          {children}
        </pre>
      ),
      img: ({ src, alt }) => (
        <button
          type="button"
          onClick={() => setImagePreview({ src, alt })}
          className="my-6 block w-full rounded-lg border border-slate-200 bg-white p-2 shadow-sm"
          title="Click to enlarge diagram"
        >
          <img src={src} alt={alt || "Architecture diagram"} className="mx-auto h-auto max-h-[560px] max-w-full object-contain" />
        </button>
      ),
      blockquote: ({ children }) => (
        <blockquote className="my-5 border-l-4 border-blue-200 bg-blue-50 px-4 py-3 text-slate-700">
          {children}
        </blockquote>
      ),
    };
  }, [reviewMode, reviewableHeadings, getSectionStatus]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopyState("Copied");
      setTimeout(() => setCopyState("Copy Markdown"), 1400);
    } catch {
      setCopyState("Copy failed");
      setTimeout(() => setCopyState("Copy Markdown"), 1400);
    }
  };

  const filename = `${(repoName || "software").replace(/[^a-z0-9._-]+/gi, "-")}-architecture-description.md`;

  if (!markdown.trim()) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-2xl font-semibold text-slate-900">No Architecture Report Yet</h2>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Generate a Software Architecture Description from the current functional decomposition, Subsystem/CSCI/CSC/CSU classification,
            diagram, and source evidence.
          </p>
          <button
            type="button"
            onClick={onRegenerate}
            className="mt-5 rounded-lg bg-[#2D7DFE] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#1E61D6]"
          >
            Generate Architecture Description
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 shadow-sm">
      <div className="border-b border-slate-200 bg-white px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold text-slate-950">{title}</h2>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600">
              <span><b>Repository:</b> {repoName || report?.metadata?.repoName || "Unknown"}</span>
              <span><b>Branch:</b> {branch || report?.metadata?.branch || "Unknown"}</span>
              {(commitSha || report?.metadata?.commitSha) && (
                <span><b>Commit:</b> {(commitSha || report?.metadata?.commitSha || "").slice(0, 12)}</span>
              )}
              <span><b>Generated:</b> {formatDate(generatedAt)}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={onBackToArchitecture}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Back to Architecture
          </button>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button onClick={handleCopy} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            {copyState}
          </button>
          <button onClick={() => downloadMarkdown(filename, markdown)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Download Markdown
          </button>
          <button onClick={onRegenerate} className="rounded-lg bg-[#2D7DFE] px-3 py-2 text-sm font-semibold text-white hover:bg-[#1E61D6]">
            Regenerate Report
          </button>
          <button
            type="button"
            onClick={() => setReviewMode((value) => !value)}
            className={`rounded-lg px-3 py-2 text-sm font-semibold ${
              reviewMode ? "bg-slate-900 text-white hover:bg-slate-800" : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
            }`}
          >
            {reviewMode ? "Exit Review Mode" : "Review Mode"}
          </button>
        </div>

        {reviewMode && (
          <div className="mt-4 grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:grid-cols-3 lg:grid-cols-6">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Reviewed</div>
              <div className="mt-1 text-lg font-bold text-slate-900">{reviewSummary.percentReviewed}%</div>
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Sections</div>
              <div className="mt-1 text-lg font-bold text-slate-900">{reviewSummary.reviewed}/{reviewSummary.totalSections}</div>
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Approved</div>
              <div className="mt-1 text-lg font-bold text-emerald-700">{reviewSummary.approved}</div>
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Needs Revision</div>
              <div className="mt-1 text-lg font-bold text-amber-700">{reviewSummary.needsRevision}</div>
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Unresolved Comments</div>
              <div className="mt-1 text-lg font-bold text-slate-900">{reviewSummary.unresolvedComments}</div>
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Open Actions</div>
              <div className="mt-1 text-lg font-bold text-slate-900">{reviewSummary.openActionItems}</div>
            </div>
          </div>
        )}
      </div>

      <div className={`grid min-h-[680px] grid-cols-1 ${reviewMode ? "lg:grid-cols-[260px_minmax(0,1fr)_340px]" : "lg:grid-cols-[260px_minmax(0,1fr)]"}`}>
        <aside className="border-b border-slate-200 bg-white p-4 lg:border-b-0 lg:border-r">
          <div className="sticky top-4">
            <div className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500">Contents</div>
            <nav className="max-h-[600px] overflow-auto pr-1">
              {headings.map((h) => (
                <a
                  key={h.id}
                  href={`#${h.id}`}
                  onClick={(event) => {
                    event.preventDefault();
                    const target = document.getElementById(h.id);
                    target?.scrollIntoView({ behavior: "smooth", block: "start" });
                    setActiveId(h.id);
                  }}
                  className={`block rounded-md px-2 py-1.5 text-sm ${
                    activeId === h.id ? "bg-blue-50 font-semibold text-blue-700" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                  }`}
                  style={{ paddingLeft: `${Math.max(0, h.level - 1) * 12 + 8}px` }}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate">{h.text}</span>
                    {reviewMode && h.level <= 3 && <span className={`h-2 w-2 rounded-full ${getSectionStatus(h.id) === "approved" ? "bg-emerald-500" : getSectionStatus(h.id) === "needs_revision" ? "bg-amber-500" : getSectionStatus(h.id) === "in_review" ? "bg-blue-500" : "bg-slate-300"}`} />}
                  </span>
                </a>
              ))}
              {!headings.length && <div className="text-sm text-slate-500">No headings found.</div>}
            </nav>
          </div>
        </aside>

        <div ref={bodyRef} className="max-h-[76vh] overflow-y-auto scroll-smooth bg-slate-100 px-4 py-8">
          <article className="mx-auto max-w-[900px] rounded-xl bg-white px-8 py-9 shadow-sm ring-1 ring-slate-200 sm:px-12">
            {renderFailed ? (
              <pre className="whitespace-pre-wrap text-sm leading-6 text-slate-800">{markdown}</pre>
            ) : (
              <ErrorBoundary onError={() => setRenderFailed(true)}>
                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]} components={markdownComponents}>
                  {markdown}
                </ReactMarkdown>
              </ErrorBoundary>
            )}
          </article>
        </div>

        {reviewMode && (
          <aside className="border-t border-slate-200 bg-white lg:border-l lg:border-t-0">
            <div className="sticky top-0 max-h-[76vh] overflow-y-auto p-4">
              <div className="mb-4">
                <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Review Panel</div>
                <h3 className="mt-1 text-lg font-semibold text-slate-950">{selectedSection?.text || "Select a section"}</h3>
                {selectedSection && (
                  <div className="mt-2">
                    <StatusBadge status={getSectionStatus(selectedSection.id)} />
                  </div>
                )}
              </div>

              {selectedSection ? (
                <div className="space-y-5">
                  <section className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="mb-2 text-sm font-semibold text-slate-800">Section Status</div>
                    <div className="grid grid-cols-2 gap-2">
                      {Object.entries(REVIEW_STATUSES).map(([value, item]) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => updateSectionStatus(selectedSection.id, value)}
                          className={`rounded-lg border px-2 py-2 text-xs font-semibold ${
                            getSectionStatus(selectedSection.id) === value
                              ? item.className
                              : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                          }`}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </section>

                  <section>
                    <div className="mb-2 flex items-center justify-between">
                      <div className="text-sm font-semibold text-slate-800">Comments</div>
                      <div className="text-xs text-slate-500">{selectedComments.filter((comment) => !comment.resolved).length} unresolved</div>
                    </div>
                    <textarea
                      value={commentDraft}
                      onChange={(event) => setCommentDraft(event.target.value)}
                      placeholder="Add a review comment for this section..."
                      className="min-h-[92px] w-full resize-y rounded-lg border border-slate-200 px-3 py-2 text-sm leading-6 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
                    />
                    <button
                      type="button"
                      onClick={addComment}
                      disabled={!commentDraft.trim()}
                      className="mt-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      Add Comment
                    </button>

                    <div className="mt-3 space-y-3">
                      {selectedComments.map((comment) => (
                        <div key={comment.id} className={`rounded-xl border p-3 ${comment.resolved ? "border-slate-200 bg-slate-50" : "border-blue-100 bg-blue-50/40"}`}>
                          <div className="flex items-start justify-between gap-2">
                            <div className="text-xs text-slate-500">{formatDate(comment.createdAt)}</div>
                            <button
                              type="button"
                              onClick={() => toggleCommentResolved(comment.id)}
                              className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-600"
                            >
                              {comment.resolved ? "Resolved" : "Unresolved"}
                            </button>
                          </div>
                          {comment.selectedText && (
                            <blockquote className="mt-2 border-l-2 border-slate-300 pl-2 text-xs italic text-slate-500">
                              {comment.selectedText}
                            </blockquote>
                          )}
                          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{comment.text}</p>
                          <button
                            type="button"
                            onClick={() => startActionFromComment(comment)}
                            className="mt-2 text-xs font-semibold text-blue-700 hover:text-blue-900"
                          >
                            Create action item
                          </button>
                        </div>
                      ))}
                      {!selectedComments.length && <div className="rounded-lg border border-dashed border-slate-200 p-3 text-sm text-slate-500">No comments for this section.</div>}
                    </div>
                  </section>

                  <section>
                    <div className="mb-2 flex items-center justify-between">
                      <div className="text-sm font-semibold text-slate-800">Action Items</div>
                      <div className="text-xs text-slate-500">{selectedActions.filter((item) => item.status !== "Closed").length} open</div>
                    </div>
                    <input
                      value={actionDraft.title}
                      onChange={(event) => setActionDraft((draft) => ({ ...draft, title: event.target.value }))}
                      placeholder="Action item title"
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
                    />
                    <textarea
                      value={actionDraft.description}
                      onChange={(event) => setActionDraft((draft) => ({ ...draft, description: event.target.value }))}
                      placeholder="Description or expected resolution"
                      className="mt-2 min-h-[76px] w-full resize-y rounded-lg border border-slate-200 px-3 py-2 text-sm leading-6 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
                    />
                    <div className="mt-2 flex items-center gap-2">
                      <select
                        value={actionDraft.priority}
                        onChange={(event) => setActionDraft((draft) => ({ ...draft, priority: event.target.value }))}
                        className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm"
                      >
                        {ACTION_PRIORITIES.map((priority) => <option key={priority}>{priority}</option>)}
                      </select>
                      <button
                        type="button"
                        onClick={addActionItem}
                        disabled={!actionDraft.title.trim()}
                        className="rounded-lg bg-[#2D7DFE] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                      >
                        Add Action
                      </button>
                    </div>

                    <div className="mt-3 space-y-3">
                      {selectedActions.map((item) => (
                        <div key={item.id} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="text-sm font-semibold text-slate-900">{item.title}</div>
                              <div className="mt-1 text-xs text-slate-500">{item.priority} priority - {formatDate(item.createdAt)}</div>
                            </div>
                            <select
                              value={item.status}
                              onChange={(event) => updateActionItem(item.id, { status: event.target.value })}
                              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs"
                            >
                              {ACTION_STATUSES.map((status) => <option key={status}>{status}</option>)}
                            </select>
                          </div>
                          {item.description && <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600">{item.description}</p>}
                        </div>
                      ))}
                      {!selectedActions.length && <div className="rounded-lg border border-dashed border-slate-200 p-3 text-sm text-slate-500">No action items for this section.</div>}
                    </div>
                  </section>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-slate-200 p-4 text-sm text-slate-500">
                  Select a section heading to begin review.
                </div>
              )}
            </div>
          </aside>
        )}
      </div>

      {imagePreview && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/70 p-6" onClick={() => setImagePreview(null)}>
          <div className="max-h-full max-w-6xl overflow-auto rounded-xl bg-white p-3 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="mb-2 flex justify-end">
              <button onClick={() => setImagePreview(null)} className="rounded border px-2 py-1 text-sm text-slate-700">Close</button>
            </div>
            <img src={imagePreview.src} alt={imagePreview.alt || "Architecture diagram"} className="h-auto max-w-full" />
          </div>
        </div>
      )}
    </div>
  );
}

class ErrorBoundary extends React.Component {
  componentDidCatch(error) {
    this.props.onError?.(error);
  }

  render() {
    return this.props.children;
  }
}
