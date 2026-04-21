/* eslint-disable react-hooks/exhaustive-deps */
/**
 * xHandle: vn vtrace diagram traceability and V&V workflow.
 * This file belongs to xHandle's traceability and verification layer, where requirements, evidence, tests, and audit views are correlated into navigable engineering artifacts.
 * The traceability feature closes the loop between hazards, mitigations, requirements, and verification activities so downstream plans and reports stay connected to the modeled system.
 * Related files: src/components/RequirementsManager.jsx, src/lib/storage/requirementsStore.ts, src/features/traceability/utils/aiPlanGen.js, src/features/traceability/utils/aiTestGen.js.
 */

  import React, { useMemo, useRef, useEffect, useState, useCallback } from "react";
  import ReactFlow, { Background, Controls, Handle, Position } from "reactflow";
  import "reactflow/dist/style.css";

  const BRAND = {
    blue: "#2D7DFE",
    blueSoft: "#E6F0FF",
    blueDim: "#CFE0FF",
    text: "#0B1B4D",
    warn: "#F59E0B",
    white: "#FFFFFF",
  };


  // req, haz, test
  const colColor = (idx) => ["#E0F7FA", "#FFF9C4", "#EDE9FE"][idx % 3];

/**
 * estimateHeight renders a React component. It gives users access to requirement traceability and verification planning while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param txt Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
  const estimateHeight = (txt) => {
    const s = String(txt || "");
    const lines = Math.ceil(s.length / 34);
    return Math.max(56, 18 + lines * 17);
  };

/**
 * lower renders a React component. It gives users access to requirement traceability and verification planning while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param s Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
  const lower = (s) => String(s || "").toLowerCase();
/**
 * norm renders a React component. It gives users access to requirement traceability and verification planning while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param s Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
  const norm = (s) => String(s ?? "").toLowerCase().trim().replace(/\s+/g, " ");





  /* ---------- Custom node with left/right handles ---------- */
  function PillNode({ data, style }) {
    return (
      <div
        style={{
          ...style,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          lineHeight: 1.25,
        }}
      >
        <Handle type="target" position={Position.Left} style={{ background: BRAND.blue, width: 8, height: 8 }} />
        <div style={{ padding: 4 }}>{data?.label}</div>
        <Handle type="source" position={Position.Right} style={{ background: BRAND.blue, width: 8, height: 8 }} />
      </div>
    );
  }

  const nodeTypes = { pill: PillNode };

  /* ---------- Column inference based on content (header-agnostic) ---------- */
  function inferSummaryColumns(analysisResult, knownReqTitles = []) {
    const tbl = analysisResult?.Summary;
    const out = { hasSummary: Array.isArray(tbl) && tbl.length >= 2, hazardIdx: -1, reqIdxes: [], hazardRowCount: 0 };
    if (!out.hasSummary) return out;

    const [headers, ...rows] = tbl;
    const colCount = headers.length;

    const normLoc = (s) => String(s ?? "").toLowerCase().trim();
    const isIdLike = (s) => /^[a-z]{2,5}-?\d{1,5}$/i.test(String(s || ""));
    const longTextScore = (s) => (String(s || "").length >= 40 ? 1 : 0);
    const hasShall = (s) => /\bshall\b/i.test(String(s || ""));
    const hazKeywords = /\b(hazard|failure|risk|scenario|loss|effect|accident|threat)\b/i;
    const reqCue = /\b(requirement|req|shall)\b/i;

    const reqTitleSet = new Set((knownReqTitles || []).map((t) => normLoc(t)));

    const hazardScores = Array(colCount).fill(0);
    const reqScores = Array(colCount).fill(0);

    for (let i = 0; i < colCount; i++) {
      const head = String(headers[i] || "");
      let haz = hazKeywords.test(head) ? 3 : 0;
      let req = reqCue.test(head) ? 2 : 0;

      let nonEmpty = 0, idLikeCount = 0;

      for (const r of rows) {
        const v = r[i];
        if (v == null || v === "") continue;
        nonEmpty++;
        if (isIdLike(v)) idLikeCount++;

        const sv = String(v);
        // hazard-ish
        haz += hazKeywords.test(sv) ? 3 : longTextScore(sv);
        // req-ish
        const n = normLoc(sv);
        if (reqTitleSet.has(n)) req += 3;
        else if (hasShall(sv)) req += 2;
        else req += longTextScore(sv);
      }

      if (nonEmpty > 0 && idLikeCount / nonEmpty > 0.5) { haz -= 2; req -= 2; }

      // mild boost for descriptive columns
      const longBoost = rows.reduce((a, r) => a + longTextScore(r[i]), 0);
      haz += Math.min(3, longBoost);
      req += Math.min(3, longBoost);

      hazardScores[i] = haz;
      reqScores[i] = req;
    }

    const bestHazIdx = hazardScores.map((s, i) => [s, i]).sort((a, b) => b[0] - a[0])[0]?.[1] ?? -1;
    const reqOrder = reqScores
      .map((s, i) => [s, i])
      .sort((a, b) => b[0] - a[0])
      .map(([, i]) => i)
      .filter((i) => i !== bestHazIdx);

    out.hazardIdx = bestHazIdx;
    out.reqIdxes = reqOrder.slice(0, 2);
    out.hazardRowCount = bestHazIdx >= 0 ? rows.filter((r) => String(r[bestHazIdx] || "").trim()).length : 0;
    return out;
  }

  /* ---------- Summary diagnostics wrapper (for empty-state messaging) ---------- */
  function inspectSummary(analysisResult, knownReqTitles = []) {
    const inf = inferSummaryColumns(analysisResult, knownReqTitles);
    return {
      hasSummary: inf.hasSummary,
      canInferHazards: inf.hazardIdx >= 0 && inf.hazardRowCount > 0,
      canInferReqs: Array.isArray(inf.reqIdxes) && inf.reqIdxes.length > 0,
      hazardRowCount: inf.hazardRowCount,
    };
  }

  /* ---------------- Hazard parsing (one hazard per row; header-agnostic) ---------------- */
  function parseHazardsFromSummary(analysisResult, knownReqTitles = []) {
    const tbl = analysisResult?.Summary;
    if (!Array.isArray(tbl) || tbl.length < 2) return [];

    const [, ...rows] = tbl;
    const { hazardIdx } = inferSummaryColumns(analysisResult, knownReqTitles);
    if (hazardIdx < 0) return [];

    return rows.map((r, i) => {
      const id = `HZ-${String(i + 1).padStart(3, "0")}`;
      const title = String(r[hazardIdx] ?? `Hazard ${i + 1}`);
      return { id, title };
    });
  }


  /* Build Requirement Title -> [Hazard Title] mapping (header-agnostic) */
  function buildReqToHazFromSummary(analysisResult, knownReqTitles = []) {
    const map = new Map();
    const tbl = analysisResult?.Summary;
    if (!Array.isArray(tbl) || tbl.length < 2) return map;

    const [, ...rows] = tbl;
    const { hazardIdx, reqIdxes } = inferSummaryColumns(analysisResult, knownReqTitles);
    if (hazardIdx < 0 || !reqIdxes.length) return map;

    const norm = (s) => String(s ?? "").toLowerCase().trim().replace(/\s+/g, " ");
    const add = (reqTitle, hazTitle) => {
      const k = norm(reqTitle);
      if (!k || !hazTitle) return;
      if (!map.has(k)) map.set(k, new Set());
      map.get(k).add(hazTitle);
    };

    rows.forEach((r) => {
      const hz = String(r[hazardIdx] ?? "").trim();
      if (!hz) return;

      for (const ridx of reqIdxes) {
        const reqTitle = String(r[ridx] ?? "").trim();
        if (reqTitle) add(reqTitle, hz);
      }
    });

    // normalize sets to sorted arrays
    const out = new Map();
    map.forEach((set, k) => out.set(k, Array.from(set).sort((a, b) => a.localeCompare(b))));
    return out;
  }



/**
 * Chip renders a React component. It gives users access to requirement traceability and verification planning while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param children Input consumed by this step of the xHandle workflow.
 * @param onClick Callback used to notify the surrounding workflow about progress or user actions.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
  const Chip = ({ children, onClick }) => (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick?.(e); }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "4px 8px",
        borderRadius: 999,
        border: `1px solid ${BRAND.blueDim}`,
        background: BRAND.white,
        fontSize: 12,
        cursor: "pointer",
        marginRight: 6,
        marginBottom: 6,
      }}
    >
      {children}
    </button>
  );

/**
 * KV renders a React component. It gives users access to requirement traceability and verification planning while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param k Input consumed by this step of the xHandle workflow.
 * @param v Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
  const KV = ({ k, v }) => (
    <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: 10, marginBottom: 6 }}>
      <div style={{ color: "#6b7280" }}>{k}</div>
      <div>{v ?? "—"}</div>
    </div>
  );

/**
 * copy renders a React component. It gives users access to requirement traceability and verification planning while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param text Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
  async function copy(text) {
    try {
      await navigator.clipboard.writeText(String(text ?? ""));
    } catch {}
  }

/**
 * RichDetailModal renders a React component. It gives users access to requirement traceability and verification planning while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param open Input consumed by this step of the xHandle workflow.
 * @param title Input consumed by this step of the xHandle workflow.
 * @param onClose Callback used to notify the surrounding workflow about progress or user actions.
 * @param tabs Input consumed by this step of the xHandle workflow.
 * @param actions Input consumed by this step of the xHandle workflow.
 * @param footer Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
  function RichDetailModal({
    open,
    title,
    onClose,
    tabs = [],
    actions = [],
    footer = null,
  }) {
    const [active, setActive] = React.useState(0);

    React.useEffect(() => {
      if (!open) return;
      const onKey = (e) => {
        if (e.key === "Escape") onClose?.();
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "w") onClose?.();
      };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }, [open, onClose]);

    if (!open) return null;

    return (
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.28)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 50,
          padding: 16,
        }}
      >
        <div
          style={{
            maxWidth: 920,
            width: "100%",
            background: BRAND.white,
            borderRadius: 12,
            border: `1px solid ${BRAND.blueDim}`,
            boxShadow: "0 12px 30px rgba(0,0,0,0.18)",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            maxHeight: "86vh",
          }}
        >
          <header
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "12px 16px",
              borderBottom: `1px solid ${BRAND.blueDim}`,
              background: "#FAFBFF",
            }}
          >
            <div style={{ fontWeight: 700, color: BRAND.text }}>{title}</div>
            <div style={{ display: "flex", gap: 8 }}>
            {actions?.map((a) => (
    <button
      key={a.key}
      type="button"
      onClick={(e) => { e.stopPropagation(); a.onClick?.(e); }}
      title={a.title}
      style={{
        fontSize: 12,
        padding: "6px 10px",
        borderRadius: 8,
        border: `1px solid ${BRAND.blueDim}`,
        background: BRAND.white,
        cursor: "pointer",
      }}
    >
      {a.label}
    </button>
  ))}
              <button
                onClick={onClose}
                style={{
                  fontSize: 12,
                  padding: "6px 10px",
                  borderRadius: 8,
                  border: `1px solid ${BRAND.blueDim}`,
                  background: BRAND.white,
                  cursor: "pointer",
                }}
              >
                Close
              </button>
            </div>
          </header>

          {tabs.length > 0 && (
            <div
              style={{
                borderBottom: `1px solid ${BRAND.blueDim}`,
                padding: "8px 12px",
                display: "flex",
                gap: 8,
              }}
            >
              {tabs.map((t, i) => {
                const activeTab = i === active;
                return (
                  <button
                    key={t.key || i}
                    onClick={() => setActive(i)}
                    style={{
                      fontSize: 12,
                      padding: "6px 10px",
                      borderRadius: 8,
                      border: `1px solid ${activeTab ? BRAND.blue : BRAND.blueDim}`,
                      background: activeTab ? BRAND.blueSoft : BRAND.white,
                      cursor: "pointer",
                      color: BRAND.text,
                    }}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
          )}

          <div style={{ padding: 16, overflow: "auto" }}>
            {tabs[active]?.content || null}
          </div>

          {footer && (
            <div style={{ padding: 12, borderTop: `1px solid ${BRAND.blueDim}`, background: "#FAFBFF" }}>
              {footer}
            </div>
          )}
        </div>
      </div>
    );
  }

  export default function VnVTraceDiagram({
    tests = [],
    requirements = [],
    analysisResult,
    selectedTestId,
    onSelectTest,
    onIsolatePick,
    filters = { kinds: new Set(), priorities: new Set(), reqQuery: "", hazQuery: "" },
    isolate = { enabled: false, rootId: null },
    projects = [],
    onProjectFilterChange,
    height = 560,
  }) {
    const graphRef = useRef(null);
    const rf = useRef(null);
    const [viewMode, setViewMode] = useState("diagram");
    const [containerWidth, setContainerWidth] = useState(1200);

    
    /* Modal state */
    const [detailOpen, setDetailOpen] = useState(false);
    const [detailTitle, setDetailTitle] = useState("");
    const [detailTabs, setDetailTabs] = useState([]);
    const [detailActions, setDetailActions] = useState([]);

    /* Sidebar multiselect state (store underlying IDs) */
    const [selHazards, setSelHazards] = useState(new Set());
    const [selReqs, setSelReqs] = useState(new Set());
    const [selTests, setSelTests] = useState(new Set());
    const [hazSearch, setHazSearch] = useState("");
    const [reqSearch, setReqSearch] = useState("");
    const [testSearch, setTestSearch] = useState("");
    const [sidebarOpen, setSidebarOpen] = useState(true);

    const availableProjects = useMemo(() => {
      const map = new Map();
      projects.forEach((p) => map.set(p.id, p.name || p.id));
      tests.forEach((t) => {
        if (t?.projectId) map.set(t.projectId, t.projectName || map.get(t.projectId) || t.projectId);
      });
      requirements.forEach((r) => {
        if (r?.projectId) map.set(r.projectId, r.projectName || map.get(r.projectId) || r.projectId);
      });
      return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
    }, [projects, tests, requirements]);

    const [selectedProjects, setSelectedProjects] = useState(() => new Set());
    useEffect(() => {
      const all = new Set(availableProjects.map((p) => p.id));
      setSelectedProjects((prev) => {
        if (prev.size === 0) return all;
        const next = new Set([...prev].filter((id) => all.has(id)));
        return next.size ? next : all;
      });
    }, [availableProjects]);

    useEffect(() => {
      onProjectFilterChange?.(Array.from(selectedProjects));
    }, [selectedProjects, onProjectFilterChange]);

    /* Size measurement */
    useEffect(() => {
      if (!graphRef.current) return;
      const ro = new ResizeObserver((entries) => {
        for (const e of entries) {
          const w = Math.max(360, Math.floor(e.contentRect.width));
          setContainerWidth(w);
        }
      });
      ro.observe(graphRef.current);
      return () => ro.disconnect();
    }, []);

    /* Apply project filter */
    const scopedRequirements = useMemo(() => {
      if (!selectedProjects.size) return requirements;
      return requirements.filter((r) => !r.projectId || selectedProjects.has(r.projectId));
    }, [requirements, selectedProjects]);

    const scopedTests = useMemo(() => {
      if (!selectedProjects.size) return tests;
      return tests.filter((t) => !t.projectId || selectedProjects.has(t.projectId));
    }, [tests, selectedProjects]);

    /* Requirement titles by id */
    const reqById = useMemo(() => {
      const m = new Map();
      (scopedRequirements || []).forEach((r) => {
        const id = r.id || r.tag || r.title;
        const title = r.title || r.name || r.id;
        m.set(id, title);
      });
      return m;
    }, [scopedRequirements]);

    // Map: requirement id -> full object (optional, handy later)
// Extract the sentence that contains "shall" (fallback to the whole text/title)
const extractShallSentence = (text) => {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  const parts = s.split(/(?<=[.!?])\s+/);
  const hit = parts.find((p) => /\bshall\b/i.test(p));
  return (hit || s).trim();
};

// What to display for each requirement (prefer the "shall" sentence)
const reqDisplayById = useMemo(() => {
  const m = new Map();
  (scopedRequirements || []).forEach((r) => {
    const id = r.id || r.tag || r.title;
    const source =
      r.text || r.statement || r.description || r.body || r.title || r.name || r.id;
    m.set(id, extractShallSentence(source));
  });
  return m;
}, [scopedRequirements]);

    const knownReqTitles = useMemo(() => Array.from(reqById.values()), [reqById]);

    // Diagnostics about the provided analysisResult + tests (header-agnostic)
  const summaryInfo = useMemo(
    () => inspectSummary(analysisResult, knownReqTitles),
    [analysisResult, knownReqTitles]
  );
  const noTests = !Array.isArray(tests) || tests.length === 0;

  const emptyStateMessage = (() => {
    if (noTests && !summaryInfo.canInferHazards) {
      return "No generated tests and hazards could not be inferred from the Summary sheet.";
    }
    if (noTests) return "No generated tests. Click “AI: Generate Tests” to create test cases.";
    if (!summaryInfo.hasSummary) return "No hazard analysis Summary found. Run your hazard analysis to populate the Summary sheet.";
    if (!summaryInfo.canInferHazards) return "Could not infer a Hazard-like column from the Summary sheet. Add a column with hazard/risk/scenario content.";
    if (!summaryInfo.canInferReqs) return "Could not infer Requirement-like columns from the Summary sheet.";
    if (summaryInfo.hazardRowCount === 0) return "The Summary sheet contains no hazard rows.";
    return null;
  })();

    /* Hazards and maps */
    const allHazards = useMemo(() => parseHazardsFromSummary(analysisResult, knownReqTitles), [analysisResult, knownReqTitles]);

    const hazTitleById = useMemo(() => {
      const m = new Map();
      (allHazards || []).forEach((h) => m.set(h.id, h.title));
      return m;
    }, [allHazards]);

    const hazIdByTitle = useMemo(() => {
      const m = new Map();
      (allHazards || []).forEach((h) => m.set(norm(h.title), h.id));
      return m;
    }, [allHazards]);

    const reqToHazTitles = useMemo(() => buildReqToHazFromSummary(analysisResult, knownReqTitles), [analysisResult, knownReqTitles]);

    /* ---------- CONSOLIDATED GROUPS (for diagram + sidebar) ---------- */
    const consolidateByLabel = (pairs) => {
      const map = new Map();
      for (const { id, label } of pairs) {
        const k = norm(label);
        if (!k) continue;
        if (!map.has(k)) map.set(k, { key: k, label, ids: [] });
        map.get(k).ids.push(id);
        if ((map.get(k).label || "").length < label.length) map.get(k).label = label;
      }
      return Array.from(map.values());
    };

    const reqGroups = useMemo(() => {
      const pairs = [];
      reqById.forEach((title, id) => pairs.push({ id, label: String(title || "").trim() }));
      return consolidateByLabel(pairs);
    }, [reqById]);

    const hazGroups = useMemo(() => {
      const pairs = (allHazards || []).map((h) => ({ id: h.id, label: String(h.title || "").trim() }));
      return consolidateByLabel(pairs);
    }, [allHazards]);

    const reqKeyById = useMemo(() => {
      const m = new Map();
      reqGroups.forEach((g) => g.ids.forEach((id) => m.set(id, g.key)));
      return m;
    }, [reqGroups]);

    const hazKeyById = useMemo(() => {
      const m = new Map();
      hazGroups.forEach((g) => g.ids.forEach((id) => m.set(id, g.key)));
      return m;
    }, [hazGroups]);

    const reqLabelByKey = useMemo(() => {
      const m = new Map();
      reqGroups.forEach((g) => m.set(g.key, g.label));
      return m;
    }, [reqGroups]);

    const hazLabelByKey = useMemo(() => {
      const m = new Map();
      hazGroups.forEach((g) => m.set(g.key, g.label));
      return m;
    }, [hazGroups]);

    // Group keys that actually appear in at least one generated (scoped) test
const tracedKeySets = useMemo(() => {
  const reqKeys = new Set();
  const hazKeys = new Set();

  const resolveHazardsAll = (t) => {
    if (Array.isArray(t.links?.hazardIds) && t.links.hazardIds.length) return t.links.hazardIds;

    const rid = t.links?.requirementId || (t.links?.requirementRefs || [])[0];
    const reqTitle = reqById.get(rid) || rid || "";
    const titles = reqToHazTitles.get(norm(reqTitle)) || [];
    const ids = titles.map((title) => hazIdByTitle.get(norm(title))).filter(Boolean);
    if (ids.length) return Array.from(new Set(ids));

    const hay = `${t.name} ${reqTitle}`.toLowerCase();
    const hits = [];
    for (const h of allHazards) if (hay.includes(lower(h.title))) hits.push(h.id);
    return Array.from(new Set(hits));
  };

  (scopedTests || []).forEach((t) => {
    // requirement key
    const rid = t.links?.requirementId || (t.links?.requirementRefs || [])[0];
    const rkey = rid ? (reqKeyById.get(rid) || norm(reqById.get(rid) || rid)) : null;
    if (rkey) reqKeys.add(rkey);

    // hazard keys
    resolveHazardsAll(t).forEach((hid) => {
      const hk = hazKeyById.get(hid) || norm(hazTitleById.get(hid) || hid);
      if (hk) hazKeys.add(hk);
    });
  });

  return { reqKeys, hazKeys };
}, [
  scopedTests,
  reqKeyById, reqById,
  hazKeyById, hazTitleById,
  reqToHazTitles, hazIdByTitle, allHazards
]);

    // turn selected requirement IDs into requirement GROUP KEYS
  const selReqKeys = useMemo(() => {
    if (!selReqs.size) return new Set();
    const out = new Set();
    selReqs.forEach((rid) => {
      const key = reqKeyById.get(rid) || norm(reqById.get(rid) || rid);
      if (key) out.add(key);
    });
    return out;
  }, [selReqs, reqKeyById, reqById]);

  // turn selected hazard IDs into hazard GROUP KEYS
  const selHazKeys = useMemo(() => {
    if (!selHazards.size) return new Set();
    const out = new Set();
    selHazards.forEach((hid) => {
      const key = hazKeyById.get(hid) || norm(hazTitleById.get(hid) || hid);
      if (key) out.add(key);
    });
    return out;
  }, [selHazards, hazKeyById, hazTitleById]);

  // Auto-select ALL hazards on first load (or when groups change) if none selected
  useEffect(() => {
    if (selHazards.size === 0 && hazGroups.length > 0) {
      const allIds = new Set();
      hazGroups.forEach((g) => g.ids.forEach((id) => allIds.add(id)));
      setSelHazards(allIds);
    }
  }, [hazGroups]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-select ALL requirements on first load (or when groups change) if none selected
  useEffect(() => {
    if (selReqs.size === 0 && reqGroups.length > 0) {
      const allIds = new Set();
      reqGroups.forEach((g) => g.ids.forEach((id) => allIds.add(id)));
      setSelReqs(allIds);
    }
  }, [reqGroups]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-select ALL tests on first load (or when tests list changes) if none selected
  useEffect(() => {
    if (selTests.size === 0 && (tests || []).length > 0) {
      setSelTests(new Set((tests || []).map((t) => t.id)));
    }
  }, [tests]); // eslint-disable-line react-hooks/exhaustive-deps

    /* Filters + hazard resolution + SIDEBAR selections */
    const filteredTests = useMemo(() => {
      const kinds = filters.kinds && filters.kinds.size ? filters.kinds : null;
      const prios = filters.priorities && filters.priorities.size ? filters.priorities : null;
      const rq = lower(filters.reqQuery || "");
      const hq = lower(filters.hazQuery || "");

      const resolveHazards = (t) => {
        if (Array.isArray(t.links?.hazardIds) && t.links.hazardIds.length) return t.links.hazardIds;

        const rid = t.links?.requirementId || (t.links?.requirementRefs || [])[0];
        const reqTitle = reqById.get(rid) || rid || "";
        const titles = reqToHazTitles.get(norm(reqTitle)) || [];
        const ids = titles.map((title) => hazIdByTitle.get(norm(title))).filter(Boolean);
        if (ids.length) return Array.from(new Set(ids));

        const hay = `${t.name} ${reqTitle}`.toLowerCase();
        const hits = [];
        for (const h of allHazards) {
          if (hay.includes(lower(h.title))) hits.push(h.id);
        }
        return Array.from(new Set(hits));
      };

      return (scopedTests || [])
    .filter((t) => {
      if (kinds && !kinds.has(t.kind)) return false;
      if (prios && !prios.has(t.priority)) return false;

      const rid = t.links?.requirementId || (t.links?.requirementRefs || [])[0];
      const reqTitle = (reqById.get(rid) || rid || "").toString();

      const hazIds = resolveHazards(t);
      const hazTitlesJoined = hazIds.map((id) => hazTitleById.get(id) || id).join(" ");

      // text filters
      if (rq && !lower(reqTitle).includes(rq)) return false;
      if (hq && !lower(hazTitlesJoined).includes(hq)) return false;

      // --- NEW: normalize to group keys for selection filtering ---
      const rkey = rid ? (reqKeyById.get(rid) || norm(reqById.get(rid) || rid)) : null;
      const hkeys = Array.from(
        new Set(hazIds.map((hid) => hazKeyById.get(hid) || norm(hazTitleById.get(hid) || hid)))
      );

      if (!selTests.has(t.id)) return false;
      if (!rkey || !selReqKeys.has(rkey)) return false;
      if (!hkeys.some((hk) => selHazKeys.has(hk))) return false;
      

      return true;
    })
    .map((t) => ({
          ...t,
          _hazardIdsResolved: (() => {
            const ids = Array.from(
              new Set(
                (Array.isArray(t.links?.hazardIds) && t.links.hazardIds.length
                  ? t.links.hazardIds
                  : (() => {
                      const rid = t.links?.requirementId || (t.links?.requirementRefs || [])[0];
                      const reqTitle = reqById.get(rid) || rid || "";
                      const titles = reqToHazTitles.get(norm(reqTitle)) || [];
                      const found = titles.map((title) => hazIdByTitle.get(norm(title))).filter(Boolean);
                      if (found.length) return found;
                      const hay = `${t.name} ${reqTitle}`.toLowerCase();
                      const hits = [];
                      for (const h of allHazards) if (hay.includes(lower(h.title))) hits.push(h.id);
                      return hits;
                    })())
              )
            );
            return ids;
          })(),
          _label: `${t.kind || "TEST"} • ${t.name}`,
          _height: estimateHeight(`${t.kind || "TEST"} • ${t.name}`),
        }));
    }, [
      scopedTests,
      filters,
      reqById,
      allHazards,
      hazTitleById,
      hazIdByTitle,
      reqToHazTitles,
      selTests,
      selHazKeys, selReqKeys,       // <-- add
      reqKeyById, hazKeyById,
    ]);


    /* ---------- Relationship maps for both diagram & modal ---------- */
    const relations = useMemo(() => {
      // Build maps: reqKey -> tests[], hazardKey -> reqKeys[]
      const testsByReqKey = new Map();
      const reqKeysByHazKey = new Map();
      const hazKeysByReqKey = new Map(); // reverse lookup for modal
      const push = (m, k, v) => {
        if (!m.has(k)) m.set(k, []);
        m.get(k).push(v);
      };

      filteredTests.forEach((t) => {
        const rid = t.links?.requirementId || (t.links?.requirementRefs || [])[0];
        const rkey = rid ? (reqKeyById.get(rid) || norm(reqById.get(rid) || rid)) : null;
        if (!rkey) return;
        push(testsByReqKey, rkey, t);

        const hkeys = Array.from(
          new Set(
            (t._hazardIdsResolved || []).map((hid) => hazKeyById.get(hid) || norm(hazTitleById.get(hid) || hid))
          )
        );
        hkeys.forEach((hk) => {
          push(reqKeysByHazKey, hk, rkey);
          push(hazKeysByReqKey, rkey, hk);
        });
      });

      // dedup arrays
      for (const [k, v] of reqKeysByHazKey) reqKeysByHazKey.set(k, Array.from(new Set(v)));
      for (const [k, v] of hazKeysByReqKey) hazKeysByReqKey.set(k, Array.from(new Set(v)));

      return { testsByReqKey, reqKeysByHazKey, hazKeysByReqKey };
    }, [filteredTests, reqKeyById, reqById, hazKeyById, hazTitleById]);

    /* --------------------- Build nodes / edges (CONSOLIDATED) --------------------- */
    // The diagram layout is intentionally keyed off the consolidated relation maps and
    // visible selection state rather than every intermediate sidebar grouping helper.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const data = useMemo(() => {
      // geometry (wider column spacing)
      const HAZ_W = 260, REQ_W = 260, TST_W = 300;

      // Big, responsive gaps between columns
      const COL_GAP_BASE = 220;                 // minimum visual gap in px
      const H2R_GAP = Math.max(COL_GAP_BASE, Math.round(containerWidth * 0.18)); // Hazard → Req
      const R2T_GAP = Math.max(COL_GAP_BASE + 60, Math.round(containerWidth * 0.22)); // Req → Test

      const GAP_Y = 20;
      const TEST_GAP_Y = 40;
      const X_HAZ = 0;
      const X_REQ = X_HAZ + HAZ_W + H2R_GAP;
      const X_TST = X_REQ + REQ_W + R2T_GAP;

      const makeNode = (id, label, width, colorIdx, highlight=false) => ({
        id,
        type: "pill",
        width,
        height: estimateHeight(label),
        data: { label },
        position: { x: 0, y: 0 },
        draggable: false,
        style: {
          background: colColor(colorIdx),
          border: `1.5px solid ${highlight ? BRAND.warn : BRAND.blue}`,
          color: BRAND.text,
          padding: 8,
          borderRadius: 10,
          width,
          boxShadow: highlight ? "0 8px 20px rgba(245,158,11,0.25)" : "0 4px 14px rgba(13,60,180,0.10)",
        },
      });
      const edges = [];
      const addEdge = (a,b) => edges.push({
        id: `${a}->${b}`,
        source: a,
        target: b,
        type: "bezier",
        animated: false,
        style: { stroke: BRAND.blue, strokeWidth: 1.1, opacity: 0.9 },
        markerEnd: { type: "arrowclosed", color: BRAND.blue },
      });

      const hazardKeys = Array
        .from(relations.reqKeysByHazKey.keys())
        .sort((a,b)=>(hazLabelByKey.get(a)||a).localeCompare(hazLabelByKey.get(b)||b));

      const blocks = hazardKeys.map((hkey) => {
        const hLabel = hazLabelByKey.get(hkey) || hkey;
        const rkeys = (relations.reqKeysByHazKey.get(hkey) || [])
          .sort((a,b)=>(reqLabelByKey.get(a)||a).localeCompare(reqLabelByKey.get(b)||b));

        const rows = rkeys.map((rkey) => {
          const reqLabel = reqLabelByKey.get(rkey) || rkey;
          const tests = Array.from(new Map((relations.testsByReqKey.get(rkey) || []).map(t => [t.id, t])).values());

          const testHeights = tests.map(t => t._height || estimateHeight(t._label));
          const testStackHeight = testHeights.length
            ? testHeights.reduce((a, h) => a + h, 0) + (testHeights.length - 1) * TEST_GAP_Y
            : 0;

          const reqH = estimateHeight(reqLabel);
          const rowH = Math.max(reqH, testStackHeight || 56) + GAP_Y;

          return { rkey, reqLabel, tests, rowH, testHeights, testStackHeight };
        });

        const blockHeight = rows.length ? rows.reduce((a,b)=>a + b.rowH, 0) - GAP_Y : estimateHeight(hLabel);
        return { hkey, hLabel, rows, blockHeight };
      });

      // ---- Symmetric, even-spacing layout (center each hazard block on a row) ----
const blocksSorted = [...blocks].sort((a, b) => b.blockHeight - a.blockHeight);

const H_MARGIN = 12;                                   // top/bottom margin
const laneHeight = Math.max(0, height - H_MARGIN * 2); // available vertical space
const rowCount = Math.max(1, blocksSorted.length);
const step = laneHeight / (rowCount + 1);              // equal spacing between centers

// placements: [{ topY, block }]
const placements = blocksSorted.map((block, i) => {
  const centerY = H_MARGIN + (i + 1) * step;           // evenly spaced centers
  const topY = centerY - block.blockHeight / 2;        // center the whole block on its row
  return { topY, block };
});


      const nodes = [];
      placements.forEach(({ topY, block }) => {
        const baseY = topY;

        const hNode = makeNode(`hazg:${block.hkey}`, block.hLabel, HAZ_W, 1);
        hNode.position = { x: X_HAZ, y: baseY + Math.max(0, (block.blockHeight - hNode.height)/2) };
        nodes.push(hNode);

        let y = baseY;
        block.rows.forEach((row) => {
          const { rkey, reqLabel, rowH, tests, testStackHeight } = row;

          const rNode = makeNode(`reqg:${rkey}`, reqLabel, REQ_W, 0);
          rNode.position = { x: X_REQ, y: y + Math.max(0, (rowH - GAP_Y - rNode.height) / 2) };
          nodes.push(rNode);
          addEdge(hNode.id, rNode.id);

          const stackH = testStackHeight || 0;
          const tStartY = y + Math.max(0, (rowH - stackH) / 2);
          let tY = tStartY;

          const placed = new Set();
          tests.forEach((t) => {
            if (placed.has(t.id)) return;
            placed.add(t.id);
            const tn = makeNode(`test:${t.id}`, t._label, TST_W, 2, t.id === selectedTestId);
            tn.position = { x: X_TST, y: tY };
            nodes.push(tn);
            addEdge(rNode.id, tn.id);
            tY += tn.height + TEST_GAP_Y;
          });

          y += rowH;
        });
      });

      if (isolate.enabled && isolate.rootId) {
        const keep = new Set();
        const adj = new Map();
        edges.forEach((e) => {
          if (!adj.has(e.source)) adj.set(e.source, []);
          if (!adj.has(e.target)) adj.set(e.target, []);
          adj.get(e.source).push(e.target);
          adj.get(e.target).push(e.source);
        });
        const q = [isolate.rootId];
        keep.add(isolate.rootId);
        while (q.length) {
          const cur = q.shift();
          for (const nxt of adj.get(cur) || []) if (!keep.has(nxt)) { keep.add(nxt); q.push(nxt); }
        }
        const keptNodes = nodes.filter((n) => keep.has(n.id));
        const kept = new Set(keptNodes.map((n) => n.id));
        const keptEdges = edges.filter((e) => kept.has(e.source) && kept.has(e.target));
        return { nodes: keptNodes, edges: keptEdges };
      }

      return { nodes, edges };
    }, [
      relations,
      selectedTestId, isolate.enabled, isolate.rootId,
      containerWidth, height, reqLabelByKey, hazLabelByKey,
    ]);

    useEffect(() => {
      if (viewMode !== "diagram") return;
      const t = setTimeout(() => {
        rf.current?.fitView?.({ padding: 0.12, duration: 320 });
      }, 200);
      return () => clearTimeout(t);
    }, [
      viewMode,
      data.nodes.length,
      data.edges.length,
      selectedTestId,
      isolate.enabled,
      isolate.rootId,
      height,
      containerWidth,
      sidebarOpen,
    ]);

    /* -------------------- UI: Sidebar (CONSOLIDATED lists) -------------------- */
    const sidebarHazards = useMemo(() => {
      let groups = hazGroups.filter((g) => tracedKeySets.hazKeys.has(g.key));
      if (hazSearch) groups = groups.filter((g) => lower(g.label).includes(lower(hazSearch)));
      return [...groups].sort((a, b) => a.label.localeCompare(b.label));
    }, [hazGroups, hazSearch, tracedKeySets.hazKeys]);
    
    

  // Requirements sidebar list: only requirements present in the filtered view
  const sidebarReqs = useMemo(() => {
    let groups = reqGroups.filter((g) => tracedKeySets.reqKeys.has(g.key));
    if (reqSearch) groups = groups.filter((g) => lower(g.label).includes(lower(reqSearch)));
    return [...groups].sort((a, b) => a.label.localeCompare(b.label));
  }, [reqGroups, reqSearch, tracedKeySets.reqKeys]);
  


  // Tests sidebar list: only tests present in the filtered view
  const sidebarTests = useMemo(() => {
    const pairs = (tests || []).map((t) => ({ id: t.id, label: String(t.name || "").trim() }));
    const groups = (() => {
      const map = new Map();
      for (const { id, label } of pairs) {
        const k = norm(label);
        if (!k) continue;
        if (!map.has(k)) map.set(k, { key: k, label, ids: [] });
        map.get(k).ids.push(id);
        if ((map.get(k).label || "").length < label.length) map.get(k).label = label;
      }
      return Array.from(map.values());
    })();

    const filtered = testSearch
      ? groups.filter((g) => lower(g.label).includes(lower(testSearch)))
      : groups;

    return filtered.sort((a, b) => a.label.localeCompare(b.label));
  }, [tests, testSearch]);



    const toggleGroup = (setter, ids) =>
      setter((prev) => {
        const n = new Set(prev);
        const allOn = ids.every((id) => n.has(id));
        if (allOn) ids.forEach((id) => n.delete(id));
        else ids.forEach((id) => n.add(id));
        return n;
      });

    const setAllGroups = (setter, groups) => {
      const n = new Set();
      groups.forEach((g) => g.ids.forEach((id) => n.add(id)));
      setter(n);
    };
    const clearAll = (setter) => setter(new Set());

    /* ---------- Double-click handler to open modal ---------- */
    // This modal callback intentionally follows the normalized trace maps above; the
    // current dependency list is kept stable to avoid unnecessary modal churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const openDetailsForNode = useCallback((node) => {
      if (!node) return;
    
      const id = node.id || "";
      const isTest = id.startsWith("test:");
      const isReq = id.startsWith("reqg:");
      const isHaz = id.startsWith("hazg:");
    
      // TEST
      // TEST
if (isTest) {
  const testId = id.slice(5);
  const t = filteredTests.find((x) => x.id === testId);
  if (!t) return;

  const rid = t.links?.requirementId || (t.links?.requirementRefs || [])[0];
  const reqTitleRaw = (reqById.get(rid) || rid || "—").toString();
  const reqDisplay = reqDisplayById.get(rid) || reqTitleRaw;

  // hazards from resolved IDs
  const hazFromIds = Array.from(
    new Set(
      (t._hazardIdsResolved || []).map((hid) =>
        String(hazTitleById.get(hid) || hid).trim().replace(/\s+/g, " ")
      )
    )
  );

  // hazards from Summary mapping via requirement title
  const mappedFromReq = reqToHazTitles.get(norm(reqTitleRaw)) || [];

  // final titles (union)
  const hazTitles = Array.from(new Set([...hazFromIds, ...mappedFromReq]));

  const onChangeField = (field, value) => {
    t[field] = value;
    openDetailsForNode({ id: `test:${testId}` }); // simple refresh
  };

  const actions = [
    { key: "copy-id", label: "Copy ID", title: "Copy Test ID", onClick: () => copy(testId) },
    {
      key: "copy-link",
      label: "Copy Deep Link",
      title: "Copy a link to this test",
      onClick: () => copy(`${window.location.origin}${window.location.pathname}#test:${testId}`)
    },
    {
      key: "isolate",
      label: "Isolate in Graph",
      title: "Focus connected nodes",
      onClick: () => onIsolatePick?.(`test:${testId}`),
    },
    rid
      ? {
          key: "jump-req",
          label: "Go to Requirement",
          title: "Center requirement node",
          onClick: () => onIsolatePick?.(`reqg:${reqKeyById.get(rid) || norm(reqTitleRaw)}`),
        }
      : null,
  ].filter(Boolean);

  const OverviewTab = (
    <div style={{ display: "grid", gap: 10 }}>
      <KV k="Name" v={t.name} />
      <KV
        k="Kind"
        v={
          <select
            value={t.kind || ""}
            onChange={(e) => onChangeField("kind", e.target.value)}
            style={{ border: `1px solid ${BRAND.blueDim}`, borderRadius: 6, padding: "4px 6px", fontSize: 12 }}
          >
            <option value="">—</option>
            <option>UNIT</option>
            <option>INTEGRATION</option>
            <option>SYSTEM</option>
            <option>ACCEPTANCE</option>
          </select>
        }
      />
      <KV
        k="Priority"
        v={
          <select
            value={t.priority || ""}
            onChange={(e) => onChangeField("priority", e.target.value)}
            style={{ border: `1px solid ${BRAND.blueDim}`, borderRadius: 6, padding: "4px 6px", fontSize: 12 }}
          >
            <option>Low</option>
            <option>Medium</option>
            <option>High</option>
            <option>Critical</option>
          </select>
        }
      />
      <KV
        k="Status"
        v={
          <select
            value={t.status || "Not Run"}
            onChange={(e) => onChangeField("status", e.target.value)}
            style={{ border: `1px solid ${BRAND.blueDim}`, borderRadius: 6, padding: "4px 6px", fontSize: 12 }}
          >
            <option>Not Run</option>
            <option>Blocked</option>
            <option>In Progress</option>
            <option>Passed</option>
            <option>Failed</option>
          </select>
        }
      />
      {t.projectId && <KV k="Project" v={`${t.projectName || t.projectId}`} />}
      <KV
        k="Requirement"
        v={
          rid ? (
            <Chip
              onClick={() => {
                setSelReqs(new Set([rid]));
                setViewMode("diagram");
                onIsolatePick?.(`reqg:${reqKeyById.get(rid) || norm(reqTitleRaw)}`);
              }}
            >
              {reqDisplay}
            </Chip>
          ) : (
            "—"
          )
        }
      />
      <KV
        k="Hazards"
        v={
          hazTitles.length ? (
            <div>
              {hazTitles.map((ht) => (
                <Chip
                  key={ht}
                  onClick={() => {
                    const hk = hazKeyById.get(hazIdByTitle.get(norm(ht))) || norm(ht);
                    if (hk) onIsolatePick?.(`hazg:${hk}`);
                    setViewMode("diagram");
                  }}
                >
                  {ht}
                </Chip>
              ))}
            </div>
          ) : (
            "—"
          )
        }
      />
    </div>
  );

  const LinksTab = (
    <div>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>Traceability</div>
      <div style={{ marginBottom: 8 }}>
        <b>Requirement</b>: {reqDisplay || "—"}
      </div>
      <div>
        <b>Hazards</b>:
        <div style={{ marginTop: 6 }}>
          {hazTitles.length ? hazTitles.map((ht) => <Chip key={ht}>{ht}</Chip>) : "—"}
        </div>
      </div>
    </div>
  );

  const HistoryTab = (
    <div>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>Run History</div>
      {Array.isArray(t.runs) && t.runs.length ? (
        <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
          {/* your history table remains unchanged */}
        </table>
      ) : (
        <div style={{ color: "#6b7280" }}>No runs recorded</div>
      )}
    </div>
  );

  const CommentsTab = (
    <div>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>Comments</div>
      {/* your existing comments code unchanged */}
    </div>
  );

  const tabs = [
    { key: "ov", label: "Overview", content: OverviewTab },
    { key: "lk", label: "Links", content: LinksTab },
    { key: "hist", label: "History", content: HistoryTab },
    { key: "cmt", label: "Comments", content: CommentsTab },
  ];

  setDetailTitle(`Test • ${t.name}`);
  setDetailActions(actions);
  setDetailTabs(tabs);
  setDetailOpen(true);
  return;
}
   
      // REQUIREMENT
      if (isReq) {
        const rkey = id.slice(5);
        const rLabel = reqLabelByKey.get(rkey) || rkey;
        const reqTests = relations.testsByReqKey.get(rkey) || [];
        const hazKeys = relations.hazKeysByReqKey.get(rkey) || [];
        const hazLabels = hazKeys.map((hk) => hazLabelByKey.get(hk) || hk);
    
        const actions = [
          { key: "copy-id", label: "Copy Key", title: "Copy Requirement Key", onClick: () => copy(rkey) },
          { key: "isolate", label: "Isolate in Graph", title: "Focus connected nodes", onClick: () => onIsolatePick?.(`reqg:${rkey}`) },
        ];
    
        const Overview = (
          <div style={{ display: "grid", gap: 10 }}>
            <KV k="Title" v={rLabel} />
            <KV
              k="Hazards"
              v={
                hazLabels.length ? (
                  <div>
                    {hazLabels.map((ht) => (
                      <Chip
                        key={ht}
                        onClick={() => {
                          const hk = hazKeyById.get(hazIdByTitle.get(norm(ht))) || norm(ht);
                          if (hk) onIsolatePick?.(`hazg:${hk}`);
                          setViewMode("diagram");
                        }}
                      >
                        {ht}
                      </Chip>
                    ))}
                  </div>
                ) : "—"
              }
            />
            <div>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Tests ({reqTests.length})</div>
              <ul style={{ marginLeft: 18 }}>
                {reqTests.map((t) => (
                  <li key={t.id}>
                    <Chip onClick={() => onIsolatePick?.(`test:${t.id}`)}>{t.name}</Chip>
                  </li>
                ))}
                {!reqTests.length && <li style={{ color: "#6b7280" }}>No linked tests</li>}
              </ul>
            </div>
          </div>
        );
    
        const tabs = [{ key: "ov", label: "Overview", content: Overview }];
    
        setDetailTitle(`Requirement • ${rLabel}`);
        setDetailActions(actions);
        setDetailTabs(tabs);
        setDetailOpen(true);
        return;
      }
    
      // HAZARD
      if (isHaz) {
        const hkey = id.slice(5);
        const hLabel = hazLabelByKey.get(hkey) || hkey;
        const rkeys = relations.reqKeysByHazKey.get(hkey) || [];
        const reqLabels = rkeys.map((rk) => reqLabelByKey.get(rk) || rk);
    
        const testsUnderHaz = [];
        rkeys.forEach((rk) => (relations.testsByReqKey.get(rk) || []).forEach((t) => testsUnderHaz.push(t)));
        const uniqueTests = Array.from(new Map(testsUnderHaz.map((t) => [t.id, t])).values());
    
        const actions = [
          { key: "copy-id", label: "Copy Key", title: "Copy Hazard Key", onClick: () => copy(hkey) },
          { key: "isolate", label: "Isolate in Graph", title: "Focus connected nodes", onClick: () => onIsolatePick?.(`hazg:${hkey}`) },
        ];
    
        const Overview = (
          <div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Requirements ({reqLabels.length})</div>
            <div style={{ marginBottom: 10 }}>
              {reqLabels.length ? reqLabels.map((rl) => <Chip key={rl} onClick={() => onIsolatePick?.(`reqg:${norm(rl)}`)}>{rl}</Chip>) : (
                <div style={{ color: "#6b7280" }}>No linked requirements</div>
              )}
            </div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Tests ({uniqueTests.length})</div>
            <div>
              {uniqueTests.length ? uniqueTests.map((t) => <Chip key={t.id} onClick={() => onIsolatePick?.(`test:${t.id}`)}>{t.name}</Chip>) : (
                <div style={{ color: "#6b7280" }}>No linked tests</div>
              )}
            </div>
          </div>
        );
    
        const tabs = [{ key: "ov", label: "Overview", content: Overview }];
    
        setDetailTitle(`Hazard • ${hLabel}`);
        setDetailActions(actions);
        setDetailTabs(tabs);
        setDetailOpen(true);
      }
    }, [
      filteredTests,
      reqById,
      hazTitleById,
      reqLabelByKey,
      hazLabelByKey,
      relations,
      onIsolatePick,
      hazKeyById,
      hazIdByTitle,
      reqToHazTitles,
      setSelReqs,
      setViewMode,
      reqKeyById,
      reqDisplayById,
    ]);
    
    return (
      <div
        ref={graphRef}
        style={{
          height,
          border: `1px solid ${BRAND.blueDim}`,
          borderRadius: 12,
          background: "#fff",
          width: "100%",
          overflow: "hidden",
          contain: "layout paint size",
          display: "flex",
        }}
      >
        {/* Sidebar */}
        <aside
    style={{
      width: sidebarOpen ? 300 : 0,
      borderRight: sidebarOpen ? `1px solid ${BRAND.blueDim}` : "none",
      padding: sidebarOpen ? 10 : 0,
      overflow: "auto",
      transition: "width 180ms ease, padding 180ms ease, border-color 180ms ease",
    }}
    aria-hidden={!sidebarOpen}
  >
  {sidebarOpen && tests.length === 0 && (
    <div
      style={{
        color: "#6b7280",
        fontSize: 13,
        padding: 12,
        textAlign: "center",
        lineHeight: 1.4,
      }}
    >
      No test cases detected.<br />
      Run <b>AI: Generate Tests</b> first to enable filters.
    </div>
  )}


  {sidebarOpen && tests.length > 0 && (
      <>
        <div style={{ fontWeight: 600, color: BRAND.text, marginBottom: 8 }}>
          Filter by Selection
        </div>

        {/* Hazards */}
        <section style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontWeight: 600, color: BRAND.text }}>Hazards</div>
            <div style={{ fontSize: 12, color: "#6b7280" }}>{selHazards.size || 0} ids selected</div>
          </div>
          <input
            placeholder="search hazards…"
            value={hazSearch}
            onChange={(e) => setHazSearch(e.target.value)}
            style={{ width: "100%", margin: "6px 0 8px", border: `1px solid ${BRAND.blueDim}`, borderRadius: 6, padding: "6px 8px", fontSize: 12 }}
          />
          <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
            <button
              onClick={() => setAllGroups(setSelHazards, sidebarHazards)}
              style={{ fontSize: 12, padding: "4px 8px", border: `1px solid ${BRAND.blueDim}`, borderRadius: 6, background: BRAND.white, cursor: "pointer" }}
            >
              All
            </button>
            <button
              onClick={() => clearAll(setSelHazards)}
              style={{ fontSize: 12, padding: "4px 8px", border: `1px solid ${BRAND.blueDim}`, borderRadius: 6, background: BRAND.white, cursor: "pointer" }}
            >
              None
            </button>
          </div>
          <div style={{ maxHeight: 160, overflow: "auto", border: `1px solid ${BRAND.blueDim}`, borderRadius: 8, padding: 6 }}>
            {sidebarHazards.map((g) => (
              <label key={g.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, padding: "2px 0" }}>
                <input
                  type="checkbox"
                  checked={g.ids.every((id) => selHazards.has(id))}
                  onChange={() => toggleGroup(setSelHazards, g.ids)}
                />
                <span>{g.label}</span>
                {g.ids.length > 1 && <span style={{ fontSize: 11, color: "#6b7280" }}>({g.ids.length})</span>}
              </label>
            ))}
            {!sidebarHazards.length && <div style={{ fontSize: 12, color: "#9ca3af" }}>No hazards</div>}
          </div>
        </section>

        {/* Requirements */}
        <section style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontWeight: 600, color: BRAND.text }}>Requirements</div>
            <div style={{ fontSize: 12, color: "#6b7280" }}>{selReqs.size || 0} ids selected</div>
          </div>
          <input
            placeholder="search requirements…"
            value={reqSearch}
            onChange={(e) => setReqSearch(e.target.value)}
            style={{ width: "100%", margin: "6px 0 8px", border: `1px solid ${BRAND.blueDim}`, borderRadius: 6, padding: "6px 8px", fontSize: 12 }}
          />
          <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
            <button
              onClick={() => setAllGroups(setSelReqs, sidebarReqs)}
              style={{ fontSize: 12, padding: "4px 8px", border: `1px solid ${BRAND.blueDim}`, borderRadius: 6, background: BRAND.white, cursor: "pointer" }}
            >
              All
            </button>
            <button
              onClick={() => clearAll(setSelReqs)}
              style={{ fontSize: 12, padding: "4px 8px", border: `1px solid ${BRAND.blueDim}`, borderRadius: 6, background: BRAND.white, cursor: "pointer" }}
            >
              None
            </button>
          </div>
          <div style={{ maxHeight: 160, overflow: "auto", border: `1px solid ${BRAND.blueDim}`, borderRadius: 8, padding: 6 }}>
            {sidebarReqs.map((g) => (
              <label key={g.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, padding: "2px 0" }}>
                <input
                  type="checkbox"
                  checked={g.ids.every((id) => selReqs.has(id))}
                  onChange={() => toggleGroup(setSelReqs, g.ids)}
                />
                <span>{g.label}</span>
                {g.ids.length > 1 && <span style={{ fontSize: 11, color: "#6b7280" }}>({g.ids.length})</span>}
              </label>
            ))}
            {!sidebarReqs.length && <div style={{ fontSize: 12, color: "#9ca3af" }}>No requirements</div>}
          </div>
        </section>

        {/* Tests */}
        <section>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontWeight: 600, color: BRAND.text }}>Tests</div>
            <div style={{ fontSize: 12, color: "#6b7280" }}>{selTests.size || 0} ids selected</div>
          </div>
          <input
            placeholder="search tests…"
            value={testSearch}
            onChange={(e) => setTestSearch(e.target.value)}
            style={{ width: "100%", margin: "6px 0 8px", border: `1px solid ${BRAND.blueDim}`, borderRadius: 6, padding: "6px 8px", fontSize: 12 }}
          />
          <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
            <button
              onClick={() => setAllGroups(setSelTests, sidebarTests)}
              style={{ fontSize: 12, padding: "4px 8px", border: `1px solid ${BRAND.blueDim}`, borderRadius: 6, background: BRAND.white, cursor: "pointer" }}
            >
              All
            </button>
            <button
              onClick={() => clearAll(setSelTests)}
              style={{ fontSize: 12, padding: "4px 8px", border: `1px solid ${BRAND.blueDim}`, borderRadius: 6, background: BRAND.white, cursor: "pointer" }}
            >
              None
            </button>
          </div>
          <div style={{ maxHeight: 160, overflow: "auto", border: `1px solid ${BRAND.blueDim}`, borderRadius: 8, padding: 6 }}>
            {sidebarTests.map((g) => (
              <label key={g.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, padding: "2px 0" }}>
                <input
                  type="checkbox"
                  checked={g.ids.every((id) => selTests.has(id))}
                  onChange={() => toggleGroup(setSelTests, g.ids)}
                />
                <span>{g.label}</span>
                {g.ids.length > 1 && <span style={{ fontSize: 11, color: "#6b7280" }}>({g.ids.length})</span>}
              </label>
            ))}
            {!sidebarTests.length && <div style={{ fontSize: 12, color: "#9ca3af" }}>No tests</div>}
          </div>
        </section>
      </>
    )}
  </aside>

        {/* Right panel */}
        <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
          {/* Top-right controls: Sidebar toggle + View toggle */}
          <div
            style={{
              position: "absolute",
              top: 10,
              right: 10,
              zIndex: 8,
              pointerEvents: "auto",
            }}
          >
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => setSidebarOpen((o) => !o)}
                style={{
                  fontSize: 12,
                  padding: "6px 10px",
                  borderRadius: 8,
                  border: `1px solid ${BRAND.blueDim}`,
                  background: BRAND.white,
                  color: BRAND.text,
                  boxShadow: "0 2px 6px rgba(0,0,0,0.05)",
                  cursor: "pointer",
                }}
                title={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
                aria-pressed={sidebarOpen}
              >
                {sidebarOpen ? "Hide Filters" : "Show Filters"}
              </button>

              <button
                onClick={() => setViewMode((v) => (v === "diagram" ? "table" : "diagram"))}
                style={{
                  fontSize: 12,
                  padding: "6px 10px",
                  borderRadius: 8,
                  border: `1px solid ${BRAND.blueDim}`,
                  background: BRAND.white,
                  color: BRAND.text,
                  boxShadow: "0 2px 6px rgba(0,0,0,0.05)",
                  cursor: "pointer",
                }}
                title={viewMode === "diagram" ? "Switch to table view" : "Switch to diagram view"}
              >
                {viewMode === "diagram" ? "Table View" : "Diagram View"}
              </button>
            </div>
          </div>

          {/* Legend */}
          {viewMode === "diagram" && (
            <div
              style={{
                position: "absolute",
                top: 46,
                left: 10,
                zIndex: 5,
                pointerEvents: "none",
              }}
              aria-hidden="true"
            >
              <div
                style={{
                  background: BRAND.white,
                  border: `1px solid ${BRAND.blueDim}`,
                  borderRadius: 10,
                  padding: "6px 8px",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
                  fontSize: 12,
                  color: BRAND.text,
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Legend</div>
                <div style={{ display: "grid", gap: 4 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ width: 14, height: 14, background: colColor(1), border: `1px solid ${BRAND.blue}`, borderRadius: 3, display: "inline-block" }} />
                    <span>Hazard</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ width: 14, height: 14, background: colColor(0), border: `1px solid ${BRAND.blue}`, borderRadius: 3, display: "inline-block" }} />
                    <span>Requirement</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ width: 14, height: 14, background: colColor(2), border: `1px solid ${BRAND.blue}`, borderRadius: 3, display: "inline-block" }} />
                    <span>Test</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Diagram or table */}
          <div style={{ height: "100%", width: "100%" }}>
          {viewMode === "diagram" ? (
    (emptyStateMessage || (data.nodes.length === 0 && data.edges.length === 0)) ? (
      <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div style={{
          maxWidth: 640,
          width: "100%",
          background: "#fff",
          border: `1px solid ${BRAND.blueDim}`,
          borderRadius: 12,
          boxShadow: "0 2px 10px rgba(0,0,0,0.06)",
          padding: 16,
          color: BRAND.text,
          textAlign: "center"
        }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Nothing to visualize</div>
          <div style={{ fontSize: 13, lineHeight: 1.5 }}>
            {emptyStateMessage || "No connected hazards, requirements, or tests matched your filters."}
          </div>
        </div>
      </div>
    ) : (
      <ReactFlow
        nodes={data.nodes}
        edges={data.edges}
        onInit={(inst) => (rf.current = inst)}
        onNodeClick={(_, node) => {
          if (isolate.enabled) onIsolatePick?.(node?.id || null);
        }}
        onNodeDoubleClick={(e, node) => {
          e.preventDefault();
          e.stopPropagation();
          openDetailsForNode(node);
        }}
        nodesDraggable={false}
        elementsSelectable={false}
        zoomOnScroll={false}
        panOnScroll={false}
        fitView
        fitViewOptions={{ padding: 0.1 }}
        zoomOnDoubleClick={false}
        minZoom={0.3}
        maxZoom={1.3}
        nodeTypes={nodeTypes}
        style={{ background: "#fff", height: "100%" }}
      >
        <Background variant="dots" gap={18} size={1} color={BRAND.blueDim} />
        <Controls
          showInteractive={false}
          position="bottom-right"
          style={{ background: BRAND.white, borderRadius: 8, border: `1px solid ${BRAND.blueDim}` }}
        />
      </ReactFlow>
    )
  ) : (
              <div style={{ height: "100%", overflow: "auto", padding: 12 }}>
                <table className="w-full table-fixed text-sm">
                <thead
    style={{
      position: "sticky",
      top: 0,
      zIndex: 2,
      background: "#fff",                 // keep text readable over rows
      boxShadow: "0 2px 0 0 rgba(207,224,255,0.8)", // subtle divider under header
    }}
  >
    <tr>
      {["Test", "Kind", "Priority", "Requirement", "Hazards"].map((h) => (
        <th
          key={h}
          className="px-3 py-2 text-left font-medium"
          style={{ borderBottom: "1px solid #CFE0FF", background: "#fff" }} // extra safety on each cell
        >
          {h}
        </th>
      ))}
    </tr>
  </thead>

                  <tbody>
                    {filteredTests.map((t) => {
                      const rid = t.links?.requirementId || (t.links?.requirementRefs || [])[0];
                      const reqDisplay = reqDisplayById.get(rid) || reqById.get(rid) || rid || "—";
                      const hTitles = Array.from(
                        new Set(
                          (t._hazardIdsResolved || []).map((hid) =>
                            String(hazTitleById.get(hid) || hid).trim().replace(/\s+/g, " ")
                          )
                        )
                      );
                      return (
                        <tr
                          key={t.id}
                          className="odd:bg-gray-50 cursor-pointer"
                          onDoubleClick={() => {
                            openDetailsForNode({ id: `test:${t.id}` });
                          }}
                          title="Double-click for details"
                        >
                          <td className="px-3 py-2 border-b">{t.name}</td>
                          <td className="px-3 py-2 border-b">{t.kind}</td>
                          <td className="px-3 py-2 border-b">{t.priority}</td>
                          <td className="px-3 py-2 border-b">{reqDisplay}</td>
                          <td className="px-3 py-2 border-b">{hTitles.join(", ") || "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Details Modal */}
        <RichDetailModal
    open={detailOpen}
    title={detailTitle}
    tabs={detailTabs}
    actions={detailActions}
    onClose={() => setDetailOpen(false)}
  />
      </div>
    );
  }
