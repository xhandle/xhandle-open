/**
 * xHandle: vn vcenter pro traceability and V&V workflow.
 * This file belongs to xHandle's traceability and verification layer, where requirements, evidence, tests, and audit views are correlated into navigable engineering artifacts.
 * The traceability feature closes the loop between hazards, mitigations, requirements, and verification activities so downstream plans and reports stay connected to the modeled system.
 * Related files: src/components/RequirementsManager.jsx, src/lib/storage/requirementsStore.ts, src/features/traceability/utils/aiPlanGen.js, src/features/traceability/utils/aiTestGen.js.
 */

// src/components/VnVCenterPro.jsx
import React, { useMemo, useState, useCallback } from "react";
import { exportEvidenceJSON, exportJUnitXML } from "../../vnv";
import VnVTraceDiagram from "./VnVTraceDiagram";
import { generateTestsBulk, generateTestsForRequirement } from "./utils/aiTestGen";
import { generateTestPlan, exportTestPlanJSON, exportTestPlanMarkdown } from "./utils/aiPlanGen";
import TestPlanViewer, { OpenPlansButton } from "./TestPlanViewer";
import { logger } from "../../lib/utils/logger";

/**
 * Button renders a interactive button surface. It gives users access to requirement traceability and verification planning while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param className Input consumed by this step of the xHandle workflow.
 * @param p Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
const Button = ({ className = "", ...p }) => (
  <button className={`px-3 py-2 text-sm rounded border bg-white hover:bg-gray-50 ${className}`} {...p} />
);

const BRAND = {
  blue: "#2D7DFE",
  blueDim: "#CFE0FF",
  text: "#0B1B4D",
  warn: "#F59E0B",
  white: "#FFFFFF",
};

// helpers to find columns and normalize text
const norm = (s) => String(s ?? "").toLowerCase().trim().replace(/\s+/g, " ");


// --- Shared "Projects" picker (mirrors Risk Register UX) ---
const ProjectsPicker = ({ projects = [], vnvHubFilters, setVnvHubFilters, label = "Projects" }) => {
  const projectIds = vnvHubFilters.projectIds ?? null;
  const projectCountLabel =
    projectIds === null ? "All" :
    (projectIds.length === 0 ? "None" : projectIds.length);

  return (
    <details className="ml-auto w-full md:w-auto">
      <summary className="text-sm px-2 py-1 rounded border cursor-pointer list-none inline-flex items-center gap-2 hover:bg-gray-50">
        {label} ({projectCountLabel})
      </summary>
      <div className="mt-2 p-3 rounded-xl border bg-white shadow-sm w-[min(320px,90vw)] max-h-64 overflow-auto">
        <div className="flex gap-2 mb-2">
          <button
            className="text-xs px-2 py-1 rounded border hover:bg-gray-50"
            onClick={() => setVnvHubFilters((f) => ({ ...f, projectIds: projects.map(p => p.id) }))}
          >
            Select all
          </button>
          <button
            className="text-xs px-2 py-1 rounded border hover:bg-gray-50"
            onClick={() => setVnvHubFilters((f) => ({ ...f, projectIds: [] }))}
          >
            None
          </button>
        </div>
        <div className="space-y-1">
          {projects.map((p) => {
            const checked =
              projectIds === null
                ? true
                : projectIds.includes(p.id);
            return (
              <label key={p.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => {
                    setVnvHubFilters((f) => {
                      const current = f.projectIds == null ? [] : (f.projectIds || []);
                      const set = new Set(current);
                      if (set.has(p.id)) set.delete(p.id); else set.add(p.id);
                      return { ...f, projectIds: Array.from(set) };
                    });
                  }}
                />
                <span className="truncate">{p.name}</span>
              </label>
            );
          })}
        </div>
      </div>
    </details>
  );
};

// --- CoveragePanel (drop-in) ---
function CoveragePanel({
  cov,
  onOpenDetails,
  onGenerateSummary,
  buildReqUrl = (id) => `/requirements/${encodeURIComponent(id)}`,
  buildHazardUrl = (id) => `/hazards/${encodeURIComponent(id)}`,
  buildStrategyUrl = (name) => `/strategies/${encodeURIComponent(name)}`,
}) {
  if (!cov) {
    return (
      <div className="rounded-2xl border bg-white p-4">
        <h2 className="text-lg font-semibold mb-2">Coverage</h2>
        <div className="text-sm text-gray-500">Generate to see coverage.</div>
      </div>
    );
  }

  const pct = (covered, total) => (total > 0 ? Math.round((covered / total) * 100) : 0);
  const stats = [
    { key: "requirements", label: "Requirements", ...cov.requirements },
    { key: "hazards", label: "Hazards", ...cov.hazards },
    { key: "tests", label: "Tests", ...cov.tests },
  ];
  

  return (
    <div className="rounded-2xl border bg-white p-4">
      <h2 className="text-lg font-semibold mb-3">Coverage</h2>

      {/* Top chips */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
      {stats.map((s) => {
          const percent = pct(s.covered ?? 0, s.total ?? 0);
          const ring =
            percent === 100 ? "ring-green-200 bg-green-50" :
            percent >= 70   ? "ring-blue-200 bg-blue-50"  :
            percent > 0     ? "ring-amber-200 bg-amber-50" :
                              "ring-gray-200 bg-gray-50";
          return (
<button
  key={s.key}
  type="button"
  className={`text-left rounded-xl border ring-1 ${ring} p-3 focus:outline-none focus:ring-2 focus:ring-blue-400`}
  title={`Double-click to generate ${s.label} summary`}
  onDoubleClick={() => onGenerateSummary?.(s.key)}
  onKeyDown={(e) => {
       if (e.key === "Enter" || e.key === " ") {
         e.preventDefault();
         onGenerateSummary?.(s.key);
       }
    }}>

              <div className="flex items-baseline justify-between">
                <span className="text-sm text-gray-600">{s.label}</span>
                <span className="text-xs text-gray-500">{percent}%</span>
              </div>
              <div className="mt-1 text-xl font-semibold">
                {(s.covered ?? 0)}/{(s.total ?? 0)}
              </div>
              <div className="mt-2 h-1.5 w-full rounded-full bg-gray-200 overflow-hidden">
                <div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${percent}%` }} />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function VnVCenterPro({
  activeProject,
  activeProjectId,
  analysisResult,
  riskRegister,
  requirements,
  vnvArtifacts,
  setVnvArtifacts,
  saveProjectPatch,
  projects,
}) {
  const buildReqUrl = useCallback((id) => `/app/req/${encodeURIComponent(id)}`, []);
  const buildHazardUrl = useCallback((id) => `/app/hazard/${encodeURIComponent(id)}`, []);
  const buildStrategyUrl = useCallback((name) => `/app/strategy/${encodeURIComponent(name)}`, []);

  const openCoverageDetails = useCallback((section, key) => {
    if (section === "requirements") {
      setReqQuery(key || "");
      setFullscreen(true);
    } else if (section === "hazards") {
      setHazQuery(key || "");
      setFullscreen(true);
    } else if (section === "strategy") {
      setKindFilter(new Set(key ? [key] : []));
      setFullscreen(true);
    }
  }, []);

  // AI modal (multiselect for tests)
  const [aiOpen, setAiOpen] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiProgress, setAiProgress] = useState({ n: 0, total: 0, current: null });
  const [aiFilter, setAiFilter] = useState("");
  const [selectedReqIds, setSelectedReqIds] = useState([]);

  // AI Test Plan
  const [planBusy, setPlanBusy] = useState(false);
  const [planViewerOpen, setPlanViewerOpen] = useState(false);

  const [selectedTestId, setSelectedTestId] = useState(null);
  const [details, setDetails] = useState({ open: false, test: null, traceRow: null });
  const [summaryModal, setSummaryModal] = useState({
    open: false,
    section: null,
    title: "",
    body: null,
  });

  // Diagram filters
  const [kindFilter, setKindFilter] = useState(new Set());         // empty = all
  const [prioFilter] = useState(new Set());         // empty = all
  const [reqQuery, setReqQuery] = useState("");
  const [hazQuery, setHazQuery] = useState("");
  // ---- V&V hub filters (tri-state projects + query; matches Risk Register semantics) ----
  const [vnvHubFilters, setVnvHubFilters] = useState({
    query: "",
    projectIds: null, // null -> All, [] -> None, [ids...] -> Explicit
  });

  // If a row has no projectId, we treat it as "always included" to be backward compatible
  const inSelectedProjects = useCallback((row) => {
    const pid = row?.projectId;
    const sel = vnvHubFilters.projectIds;
    if (!pid) return true;
    if (sel === null) return true;                   // All
    if (Array.isArray(sel) && sel.length === 0) return false; // None
    return sel.includes(pid);
  }, [vnvHubFilters.projectIds]);

  const matchesQuery = useCallback((hay) => {
    const q = vnvHubFilters.query?.trim()?.toLowerCase();
    if (!q) return true;
    return String(hay || "").toLowerCase().includes(q);
  }, [vnvHubFilters.query]);

  // Isolate trace + fullscreen
  const [isoEnabled, setIsoEnabled] = useState(false);
  const [isoRootId, setIsoRootId] = useState(null);
  const [fullscreen, setFullscreen] = useState(false);

  // Selection for delete
  const [, setSelectedForDelete] = useState(new Set());
    // Header-agnostic summary diagnostics
    const knownReqTitlesVnv = useMemo(
      () => (Array.isArray(requirements) ? requirements.map((r) => r.title || r.name || r.id || r.tag || "") : []),
      [requirements]
    );
  
    function inferSummaryColumnsLocal() {
      const tbl = analysisResult?.Summary;
      const out = { hasSummary: Array.isArray(tbl) && tbl.length >= 2, hazardIdx: -1, reqIdxes: [], hazardRowCount: 0 };
      if (!out.hasSummary) return out;
  
      const [headers, ...rows] = tbl;
      const hazKeywords = /\b(hazard|failure|risk|scenario|loss|effect|accident|threat)\b/i;
      const reqCue = /\b(requirement|req|shall)\b/i;
      const norm = (s) => String(s ?? "").toLowerCase().trim();
      const reqTitleSet = new Set(knownReqTitlesVnv.map((t) => norm(t)));
      const longText = (s) => (String(s || "").length >= 40 ? 1 : 0);
      const hasShall = (s) => /\bshall\b/i.test(String(s || ""));
      const isIdLike = (s) => /^[a-z]{2,5}-?\d{1,5}$/i.test(String(s || ""));
  
      const colCount = headers.length;
      const hazScore = Array(colCount).fill(0);
      const reqScore = Array(colCount).fill(0);
  
      for (let i = 0; i < colCount; i++) {
        let hz = hazKeywords.test(String(headers[i] || "")) ? 3 : 0;
        let rq = reqCue.test(String(headers[i] || "")) ? 2 : 0;
  
        let nonEmpty = 0, idLike = 0;
        for (const r of rows) {
          const v = r[i];
          if (v == null || v === "") continue;
          nonEmpty++;
          if (isIdLike(v)) idLike++;
  
          if (hazKeywords.test(String(v))) hz += 3;
          else hz += longText(v);
  
          const n = norm(v);
          if (reqTitleSet.has(n)) rq += 3;
          else if (hasShall(v)) rq += 2;
          else rq += longText(v);
        }
        if (nonEmpty > 0 && idLike / nonEmpty > 0.5) { hz -= 2; rq -= 2; }
  
        hazScore[i] = hz;
        reqScore[i] = rq;
      }
  
      const bestHaz = hazScore.map((s, i) => [s, i]).sort((a, b) => b[0] - a[0])[0]?.[1] ?? -1;
      const reqOrder = reqScore.map((s, i) => [s, i]).sort((a, b) => b[0] - a[0]).map(([, i]) => i).filter((i) => i !== bestHaz);
  
      out.hazardIdx = bestHaz;
      out.reqIdxes = reqOrder.slice(0, 2);
      out.hazardRowCount = bestHaz >= 0 ? rows.filter((r) => String(r[bestHaz] || "").trim()).length : 0;
  
      return out;
    }
  
    const sumInf = useMemo(inferSummaryColumnsLocal, [analysisResult, knownReqTitlesVnv]);
  
    const noTestsYet = !(vnvArtifacts?.tests || []).length;
    const missingHazardsMsg = !sumInf.hasSummary
      ? "No hazard analysis Summary found. Run your hazard analysis to populate the Summary sheet."
      : (sumInf.hazardIdx < 0 || sumInf.hazardRowCount === 0)
        ? "Could not infer a Hazard-like column from the Summary sheet."
        : (!sumInf.reqIdxes.length ? "Could not infer Requirement-like columns from the Summary sheet." : null);
  // Header-agnostic summary diagnostics

  const tests = useMemo(() => vnvArtifacts?.tests || [], [vnvArtifacts?.tests]);
  const cov = vnvArtifacts?.coverage;
  const testPlan = vnvArtifacts?.testPlan || null;
    // Lightweight coverage recompute
    const recomputeCoverage = useCallback((allTests) => {
      const testsArr = Array.isArray(allTests) ? allTests : [];
    
      const reqIdsCovered = new Set(
        testsArr.map(t => t.links?.requirementId).filter(Boolean)
      );
    
      const hazIdsCovered = new Set();
      testsArr.forEach(t => (t.links?.hazardIds || []).forEach(h => hazIdsCovered.add(h)));
    
      const reqTotal = Array.isArray(requirements) ? requirements.length : 0;
      const hazTotal = Array.isArray(riskRegister) ? riskRegister.length : 0;
    
      // Tests coverage: count tests that have at least one link (req or hazard)
      const testTotal = testsArr.length;
      const testCovered = testsArr.filter(t => {
        const hasReq = !!t.links?.requirementId;
        const hasHaz = Array.isArray(t.links?.hazardIds) && t.links.hazardIds.length > 0;
        return hasReq || hasHaz;
      }).length;
    
      return {
        requirements: { total: reqTotal, covered: reqIdsCovered.size },
        hazards:      { total: hazTotal, covered: hazIdsCovered.size },
        tests:        { total: testTotal, covered: testCovered },
        gaps: {
          requirements: (requirements || [])
            .filter(r => !reqIdsCovered.has(r.id || r.tag || r.title))
            .map(r => r.id || r.tag || r.title),
          hazards: (riskRegister || [])
            .filter(h => !hazIdsCovered.has(h.id || h.tag || h.title))
            .map(h => h.id || h.tag || h.title),
        }
      };
    }, [requirements, riskRegister]);
    

  // ---- Filtered data for all four views (drives diagram, coverage, trace table, tests table) ----
  const testsFiltered = useMemo(() => {
    return (tests || []).filter(inSelectedProjects).filter((t) => {
      const hay = `${t.id||""} ${t.name||""} ${t.kind||""} ${t.priority||""} ${t.objective||t.description||""} ${t.links?.requirementId||""} ${(t.links?.hazardIds||[]).join(" ")}`;
      return matchesQuery(hay);
    });
  }, [tests, inSelectedProjects, matchesQuery]);

  const requirementsFilteredForViews = useMemo(() => {
    return (requirements || []).filter(inSelectedProjects).filter((r) => {
      const rid = r.id || r.tag || r.title;
      const hay = `${rid||""} ${r.title||r.name||""} ${r.description||""} ${r.module||""}`;
      return matchesQuery(hay);
    });
  }, [requirements, inSelectedProjects, matchesQuery]);

  // Rebuild trace from filtered tests so the table stays consistent with filters
  // Recompute coverage based on filtered tests (do not mutate stored cov)
  const covFiltered = useMemo(() => recomputeCoverage(testsFiltered), [testsFiltered, recomputeCoverage]);

  const generateCoverageSummary = useCallback((section) => {
    // Derive filtered sets already computed above
    const tsts = testsFiltered || [];
    const covNow =
      covFiltered || {
        requirements: { total: 0, covered: 0 },
        hazards: { total: 0, covered: 0 },
        tests: { total: 0, covered: 0 },
        gaps: { requirements: [], hazards: [] },
      };
  
    const groupCount = (arr, pick) => {
      const m = new Map();
      arr.forEach((x) => {
        const k = pick(x) || "—";
        m.set(k, (m.get(k) || 0) + 1);
      });
      return Array.from(m.entries()).sort((a, b) =>
        String(a[0]).localeCompare(String(b[0]))
      );
    };
  
    if (section === "requirements") {
      const { total, covered } = covNow.requirements || { total: 0, covered: 0 };
      const gaps = covNow.gaps?.requirements || [];
  
      setSummaryModal({
        open: true,
        section,
        title: "Requirements Summary",
        body: (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="rounded border p-3">
                <div className="text-gray-500">Total</div>
                <div className="text-xl font-semibold">{total}</div>
              </div>
              <div className="rounded border p-3">
                <div className="text-gray-500">Covered by Tests</div>
                <div className="text-xl font-semibold">{covered}</div>
              </div>
              <div className="rounded border p-3">
                <div className="text-gray-500">Coverage</div>
                <div className="text-xl font-semibold">
                  {total > 0 ? Math.round((covered / total) * 100) : 0}%
                </div>
              </div>
            </div>
  
            <div className="rounded border p-3">
              <div className="font-medium mb-2">
                Uncovered Requirements — {gaps.length}
              </div>
              <div className="max-h-64 overflow-auto pr-2">
                {gaps.length ? (
                  <ul className="list-disc ml-5 space-y-1">
                    {gaps.slice(0, 50).map((id) => (
                      <li key={id} className="font-mono text-xs">
                        {id}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-gray-500">None 🎉</div>
                )}
                {gaps.length > 50 && (
                  <div className="text-xs text-gray-500 mt-2">
                    + {gaps.length - 50} more…
                  </div>
                )}
              </div>
            </div>
          </div>
        ),
      });
      return;
    }
  
    if (section === "hazards") {
      const { total, covered } = covNow.hazards || { total: 0, covered: 0 };
      const gaps = covNow.gaps?.hazards || [];
  
      setSummaryModal({
        open: true,
        section,
        title: "Hazards Summary",
        body: (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="rounded border p-3">
                <div className="text-gray-500">Total</div>
                <div className="text-xl font-semibold">{total}</div>
              </div>
              <div className="rounded border p-3">
                <div className="text-gray-500">Covered by Tests</div>
                <div className="text-xl font-semibold">{covered}</div>
              </div>
              <div className="rounded border p-3">
                <div className="text-gray-500">Coverage</div>
                <div className="text-xl font-semibold">
                  {total > 0 ? Math.round((covered / total) * 100) : 0}%
                </div>
              </div>
            </div>
  
            <div className="rounded border p-3">
              <div className="font-medium mb-2">Uncovered Hazards — {gaps.length}</div>
              <div className="max-h-64 overflow-auto pr-2">
                {gaps.length ? (
                  <ul className="list-disc ml-5 space-y-1">
                    {gaps.slice(0, 50).map((id) => (
                      <li key={id} className="font-mono text-xs">
                        {id}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-gray-500">None 🎉</div>
                )}
                {gaps.length > 50 && (
                  <div className="text-xs text-gray-500 mt-2">
                    + {gaps.length - 50} more…
                  </div>
                )}
              </div>
            </div>
          </div>
        ),
      });
      return;
    }
  
    if (section === "tests") {
      const { total, covered } = covNow.tests || { total: 0, covered: 0 };
      const orphan = tsts.filter((t) => {
        const hasReq = !!t.links?.requirementId;
        const hasHaz =
          Array.isArray(t.links?.hazardIds) && t.links.hazardIds.length > 0;
        return !(hasReq || hasHaz);
      });
  
      const byKind = groupCount(tsts, (x) => x.kind);
      const byPrio = groupCount(tsts, (x) => String(x.priority).toUpperCase());
  
      setSummaryModal({
        open: true,
        section,
        title: "Tests Summary",
        body: (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="rounded border p-3">
                <div className="text-gray-500">Total</div>
                <div className="text-xl font-semibold">{total}</div>
              </div>
              <div className="rounded border p-3">
                <div className="text-gray-500">Linked (Req or Hazard)</div>
                <div className="text-xl font-semibold">{covered}</div>
              </div>
              <div className="rounded border p-3">
                <div className="text-gray-500">Link Coverage</div>
                <div className="text-xl font-semibold">
                  {total > 0 ? Math.round((covered / total) * 100) : 0}%
                </div>
              </div>
            </div>
  
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded border p-3">
                <div className="font-medium mb-2">By Kind</div>
                {byKind.length ? (
                  <ul className="space-y-1">
                    {byKind.map(([k, v]) => (
                      <li key={k}>
                        <span className="font-mono text-xs">{k}</span> — {v}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-gray-500">No kinds found.</div>
                )}
              </div>
              <div className="rounded border p-3">
                <div className="font-medium mb-2">By Priority</div>
                {byPrio.length ? (
                  <ul className="space-y-1">
                    {byPrio.map(([k, v]) => (
                      <li key={k}>
                        <span className="font-mono text-xs">{k}</span> — {v}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-gray-500">No priorities found.</div>
                )}
              </div>
            </div>
  
            <div className="rounded border p-3">
              <div className="font-medium mb-2">
                Orphan Tests (no links) — {orphan.length}
              </div>
              {orphan.length ? (
                <ul className="list-disc ml-5 space-y-1">
                  {orphan.slice(0, 50).map((t) => (
                    <li key={t.id}>
                      <span className="font-mono text-xs">{t.id}</span>
                      {t.name ? <> — {t.name}</> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="text-gray-500">None 🎉</div>
              )}
              {orphan.length > 50 && (
                <div className="text-xs text-gray-500 mt-2">
                  + {orphan.length - 50} more…
                </div>
              )}
            </div>
          </div>
        ),
      });
    }
  }, [testsFiltered, covFiltered, setSummaryModal]);
  
  

  // Requirement title lookup (id -> title)
  const reqTitleById = useMemo(() => {
    const m = new Map();
    (requirements || []).forEach((r) => m.set(r.id || r.tag || r.title, r.title || r.name || r.id));
    return m;
  }, [requirements]);

  // Map Requirement Title -> [Hazard Titles] from Hazard Analysis.
  const reqToHazTitles = useMemo(() => {
    const tbl = analysisResult?.Summary;
    const out = new Map();
    if (!Array.isArray(tbl) || tbl.length < 2) return out;

    const [, ...rows] = tbl;
    const { hazardIdx, reqIdxes } = sumInf;
    if (hazardIdx < 0 || !reqIdxes.length) return out;

    const norm = (s) => String(s ?? "").toLowerCase().trim().replace(/\s+/g, " ");
    const acc = new Map();

    rows.forEach((r) => {
      const hz = String(r[hazardIdx] ?? "").trim();
      if (!hz) return;
      for (const ridx of reqIdxes) {
        const reqTitle = String(r[ridx] ?? "").trim();
        if (!reqTitle) continue;
        const key = norm(reqTitle);
        if (!acc.has(key)) acc.set(key, new Set());
        acc.get(key).add(hz);
      }
    });

    acc.forEach((set, k) => out.set(k, Array.from(set).sort((a, b) => a.localeCompare(b))));
    return out;
  }, [analysisResult, sumInf]);


  const hazTitleById = useMemo(() => new Map(), []);

  const openTestDetails = (t) => setDetails({ open: true, test: t, traceRow: null });
  const closeDetails = () => setDetails({ open: false, test: null, traceRow: null });

  // Ref-friendly accessor for reqToHazTitles
  const reqToHazTitlesRef = useCallback(() => reqToHazTitles, [reqToHazTitles]);

  // Rebuild a simple trace table (TestId, Requirement, Hazards)
  const rebuildTrace = useCallback((allTests) => {
    const rows = [];
    allTests.forEach(t => {
      const req = t.links?.requirementId || "—";
      const haz = (t.links?.hazardIds || []).join(", ");
      rows.push({ TestId: t.id, Requirement: req, Hazards: haz });
    });
    return rows;
  }, []);

  // Merge + persist (tests -> vnvArtifacts)
  const upsertTests = useCallback((newTests) => {
    if (!newTests?.length) return;
    const existing = vnvArtifacts?.tests || [];
    const byId = new Map(existing.map(t => [t.id, t]));
    newTests.forEach(t => byId.set(t.id, t));
    const merged = Array.from(byId.values());

    const next = {
      ...(vnvArtifacts || {}),
      tests: merged,
      trace: rebuildTrace(merged),
      coverage: recomputeCoverage(merged),
      summary: {
        ...(vnvArtifacts?.summary || {}),
        generatedAt: new Date().toISOString(),
        totals: {
          requirements: Array.isArray(requirements) ? requirements.length : 0,
          hazards: Array.isArray(riskRegister) ? riskRegister.length : 0,
          testCases: merged.length,
          procedures: vnvArtifacts?.procedures?.length || 0,
          datasets: vnvArtifacts?.datasets?.length || 0,
        },
      },
    };

    setVnvArtifacts(next);
    if (activeProjectId) saveProjectPatch(activeProjectId, { vnvArtifacts: next });
  }, [vnvArtifacts, rebuildTrace, recomputeCoverage, requirements, riskRegister, activeProjectId, saveProjectPatch, setVnvArtifacts]);

  // Delete + persist tests
  const deleteTests = useCallback((idsToDelete) => {
    if (!Array.isArray(idsToDelete) || idsToDelete.length === 0) return;
    const existing = vnvArtifacts?.tests || [];
    const setIds = new Set(idsToDelete);
    const remaining = existing.filter(t => !setIds.has(t.id));

    const next = {
      ...(vnvArtifacts || {}),
      tests: remaining,
      trace: rebuildTrace(remaining),
      coverage: recomputeCoverage(remaining),
      summary: {
        ...(vnvArtifacts?.summary || {}),
        generatedAt: new Date().toISOString(),
        totals: {
          requirements: Array.isArray(requirements) ? requirements.length : 0,
          hazards: Array.isArray(riskRegister) ? riskRegister.length : 0,
          testCases: remaining.length,
          procedures: vnvArtifacts?.procedures?.length || 0,
          datasets: vnvArtifacts?.datasets?.length || 0,
        },
      },
    };

    setSelectedForDelete(new Set());
    if (selectedTestId && setIds.has(selectedTestId)) setSelectedTestId(null);

    setVnvArtifacts(next);
    if (activeProjectId) saveProjectPatch(activeProjectId, { vnvArtifacts: next });
  }, [vnvArtifacts, rebuildTrace, recomputeCoverage, requirements, riskRegister, activeProjectId, saveProjectPatch, setVnvArtifacts, selectedTestId]);

  // —— display helpers ——
  const hazardsForTest = useCallback((t) => {
    if (t?.links?.hazardIds?.length) {
      return t.links.hazardIds.map((h) => hazTitleById.get(h) || String(h)).filter(Boolean);
    }
    const reqId = t?.links?.requirementId;
    const reqTitle = reqTitleById.get(reqId) || reqId || "";
    if (!reqTitle) return [];
    const titles = reqToHazTitles.get(norm(reqTitle)) || [];
    return titles;
  }, [hazTitleById, reqTitleById, reqToHazTitles]);

  // --- Multiselect helpers (for AI modal) ---
  const idOfReq = useCallback((r) => r.id || r.tag || r.title, []);

  const [filteredRequirements, setFilteredRequirements] = useState([]);
  React.useEffect(() => {
    const list = Array.isArray(requirements) ? requirements : [];
    const q = aiFilter?.toLowerCase() || "";
    const filtered = q
      ? list.filter((r) => {
          const label = `${idOfReq(r)} ${r.title || r.name || ""}`.toLowerCase();
          return label.includes(q);
        })
      : list;
    setFilteredRequirements(filtered);
  }, [requirements, aiFilter, idOfReq]);

  const allVisibleSelected = filteredRequirements.length > 0 &&
    filteredRequirements.every((r) => selectedReqIds.includes(idOfReq(r)));

  const toggleOneReq = useCallback((id) => {
    setSelectedReqIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }, []);

  const toggleAllVisible = useCallback(() => {
    setSelectedReqIds((prev) => {
      const ids = filteredRequirements.map(idOfReq);
      const every = ids.every((id) => prev.includes(id));
      if (every) {
        return prev.filter((id) => !ids.includes(id));
      }
      const set = new Set(prev);
      ids.forEach((id) => set.add(id));
      return Array.from(set);
    });
  }, [filteredRequirements, idOfReq]);

  const selectedRequirements = useMemo(() => {
    const s = new Set(selectedReqIds);
    return (Array.isArray(requirements) ? requirements : []).filter((r) => s.has(idOfReq(r)));
  }, [requirements, selectedReqIds, idOfReq]);

  // ---- Persist Test Plan into artifacts ----
  const savePlanIntoArtifacts = useCallback((plan) => {
    const next = {
      ...(vnvArtifacts || {}),
      testPlan: plan,
      summary: {
        ...(vnvArtifacts?.summary || {}),
        generatedAt: new Date().toISOString(),
      },
    };
    setVnvArtifacts(next);
    if (activeProjectId) saveProjectPatch(activeProjectId, { vnvArtifacts: next });
  }, [vnvArtifacts, setVnvArtifacts, activeProjectId, saveProjectPatch]);

  // ---- Compose context for Plan generation (lightweight) ----
  const buildPlanContext = useCallback(() => {
    const covReq = cov?.requirements || { total: (requirements || []).length, covered: 0 };
    const covHaz = cov?.hazards || { total: (riskRegister || []).length, covered: 0 };
    const kinds = Array.from(new Set((tests || []).map(t => t.kind).filter(Boolean)));
    const priocount = (p) => (tests || []).filter(t => String(t.priority).toUpperCase() === p).length;

    return {
      coverage: { requirements: covReq, hazards: covHaz },
      testKinds: kinds,
      priority: { P0: priocount("P0"), P1: priocount("P1"), P2: priocount("P2") },
    };
  }, [cov, requirements, riskRegister, tests]);

  return (
    <div
      className="flex flex-col gap-4 p-3 overflow-y-auto"
      style={{ maxHeight: "100vh" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Verification & Validation</h1>
          <p className="text-gray-500 text-sm">Risk-driven, multi-strategy generation; exportable evidence & JUnit.</p>
        </div>
        <div className="flex gap-2">

          <Button
            className="border-blue-600 text-blue-700 bg-white hover:bg-blue-50"
            onClick={() => { setAiOpen(true); setAiFilter(""); }}
            disabled={!Array.isArray(requirements) || !requirements.length}
            title="AI-generate tests for one or more requirements"
          >
            AI: Generate Tests
          </Button>

          <Button
            className="border-emerald-600 text-emerald-700 bg-white hover:bg-emerald-50"
            onClick={async () => {
              if (!(tests || []).length) {
                alert("You need generated test cases first.");
                return;
              }
              try {
                setPlanBusy(true);
                const plan = await generateTestPlan({
                  projectName: activeProject?.name || "Project",
                  tests,
                  requirements,
                  riskRegister,
                  context: JSON.stringify(buildPlanContext()),
                });
                savePlanIntoArtifacts(plan);
                setPlanViewerOpen(true);
              } catch (err) {
                logger.error(err);
                alert(`AI Test Plan generation failed: ${err?.message || err}`);
              } finally {
                setPlanBusy(false);
              }
            }}
            disabled={!(tests || []).length || planBusy}
            title="AI-generate a complete test plan from tests, risks and requirements"
          >
            {planBusy ? "Planning…" : "AI: Generate Test Plan"}
          </Button>
          <OpenPlansButton
           onSelect={(rec) => {
             // rec = { id, name, plan, documentHtml, updatedAt }
             // Persist into this project’s artifacts and open the viewer.
             savePlanIntoArtifacts(rec.plan);
             setPlanViewerOpen(true);
           }}
         />

          {!!tests.length && (
            <>
              <Button onClick={() => exportEvidenceJSON(vnvArtifacts?.evidence)}>Evidence JSON</Button>
              <Button onClick={() => exportJUnitXML(tests)}>JUnit XML</Button>
            </>
          )}
        </div>
      </div>

        {/* Coverage */}
        <CoveragePanel
        cov={covFiltered}
        onOpenDetails={openCoverageDetails}
        onGenerateSummary={(section) => generateCoverageSummary(section)}
        buildReqUrl={buildReqUrl}
        buildHazardUrl={buildHazardUrl}
        buildStrategyUrl={buildStrategyUrl}
      />


            {/* V&V Filters (mirrors Risk Register mini-toolbar) */}
            <div className="rounded-2xl border bg-white p-3">
        <div className="flex flex-wrap gap-2 items-center">
          <input
            className="border rounded px-2 py-1 text-sm w-full md:w-64"
            placeholder="Search tests / reqs / hazards…"
            value={vnvHubFilters.query}
            onChange={(e) => setVnvHubFilters((f) => ({ ...f, query: e.target.value }))}
          />
          {/* If you have projects from parent, pass them here; otherwise pass [] */}
          <ProjectsPicker
  projects={projects || []}
  vnvHubFilters={vnvHubFilters}
  setVnvHubFilters={setVnvHubFilters}
/>
          <button
            onClick={() => setVnvHubFilters({ query: "", projectIds: null })}
            className="ml-auto px-3 py-2 rounded border text-sm hover:bg-gray-50"
            title="Reset V&V filters"
          >
            Clear Filters
          </button>
        </div>
      </div>
      {/* Diagram card with FILTERS + ISOLATE + FULLSCREEN */}
      <div className="rounded-2xl border bg-white p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Traceability Diagram (Req ⇄ Haz ⇄ Test)</h2>
          <div className="flex items-center gap-2">
            <label className="text-sm flex items-center gap-2">
              <input type="checkbox" checked={isoEnabled} onChange={(e)=>{ setIsoEnabled(e.target.checked); if(!e.target.checked) setIsoRootId(null); }} />
              Isolate trace
            </label>
            <Button onClick={()=>setFullscreen(true)}>Fullscreen</Button>
          </div>
        </div>

        {noTestsYet || missingHazardsMsg ? (
  <div className="text-sm text-gray-600 rounded-xl border p-3 bg-white">
    <div className="font-medium mb-1">Nothing to visualize</div>
    <div>
      {noTestsYet && (
        <div>There are no generated tests. Click <b>“AI: Generate Tests”</b> to create test cases.</div>
      )}
      {missingHazardsMsg && (
        <div className="mt-1">{missingHazardsMsg}</div>
      )}
    </div>
  </div>
) : (
  <VnVTraceDiagram
    tests={testsFiltered}
    requirements={requirementsFilteredForViews}
    analysisResult={analysisResult}
    selectedTestId={selectedTestId}
    onSelectTest={(id) => {
      setSelectedTestId(id);
      const t = tests.find((x) => x.id === id);
      if (t) openTestDetails(t);
    }}
    onIsolatePick={(nodeId)=> setIsoRootId(nodeId)}
    filters={{
      kinds: kindFilter,
      priorities: prioFilter,
      reqQuery,
      hazQuery,
    }}
    isolate={{ enabled: isoEnabled, rootId: isoRootId }}
    height={fullscreen ? 720 : 460}
  />
)}

      </div>

      {/* Fullscreen overlay (diagram only) */}
      {fullscreen && (
  <div
    className="fixed inset-0 z-[9999]"
    style={{ background:"rgba(0,0,0,0.45)", paddingTop: 72 }} // push content down ~72px
  >
<div
  className="absolute left-6 right-6 bottom-6 rounded-2xl bg-white border"
  style={{ borderColor: BRAND.blueDim, top: 72 }} // align with the overlay padding
>
              <div className="flex items-center justify-between px-4 py-2 border-b" style={{ borderColor: BRAND.blueDim }}>
              <div className="text-sm text-gray-600">Traceability Diagram — Fullscreen</div>
              <div className="flex items-center gap-2">
                <label className="text-sm flex items-center gap-2">
                  <input type="checkbox" checked={isoEnabled} onChange={(e)=>{ setIsoEnabled(e.target.checked); if(!e.target.checked) setIsoRootId(null); }} />
                  Isolate trace
                </label>
                <Button onClick={()=>setFullscreen(false)}>Close</Button>
              </div>
            </div>
            <div className="p-3">
              <VnVTraceDiagram
                tests={testsFiltered}
  requirements={requirementsFilteredForViews}
                analysisResult={analysisResult}
                selectedTestId={selectedTestId}
                onSelectTest={(id) => {
                  setSelectedTestId(id);
                  const t = tests.find((x) => x.id === id);
                  if (t) openTestDetails(t);
                }}
                onIsolatePick={(nodeId)=> setIsoRootId(nodeId)}
                filters={{ kinds: kindFilter, priorities: prioFilter, reqQuery, hazQuery }}
                isolate={{ enabled: isoEnabled, rootId: isoRootId }}
                height={window.innerHeight - 180}
              />
            </div>
          </div>
        </div>
      )}

      {/* DETAILS MODAL */}
      {details.open && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.35)" }}
          onClick={closeDetails}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="relative w-[min(96vw,980px)] max-w-[980px] rounded-2xl overflow-hidden shadow-2xl"
            style={{ background: BRAND.white, border: `1px solid ${BRAND.blueDim}` }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-3 text-white flex items-center justify-between" style={{ background: BRAND.blue }}>
              <div className="text-lg font-semibold">
                {details.test ? `Test Details — ${details.test.name}` : "Trace Details"}
              </div>
              <button
                onClick={closeDetails}
                className="text-white/90 hover:text-white text-xl leading-none"
                aria-label="Close"
                title="Close"
              >
                ×
              </button>
            </div>

            <div className="p-6 space-y-4 text-sm">
              {details.test && (() => {
                const t = details.test;
                const reqId = t?.links?.requirementId;
                const reqTitle = reqTitleById.get(reqId) || reqId || "";
                const hazTitles = hazardsForTest(t);
                return (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="rounded-lg border p-3">
                        <div className="text-gray-500">ID</div>
                        <div className="font-mono">{t.id}</div>
                      </div>
                      <div className="rounded-lg border p-3">
                        <div className="text-gray-500">Kind / Priority</div>
                        <div>{t.kind || "—"} • {t.priority || "—"}</div>
                      </div>
                    </div>

                    <div className="rounded-lg border p-3">
                      <div className="text-gray-500 mb-1">Objective</div>
                      <div>{t.objective || t.description || "—"}</div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="rounded-lg border p-3">
                        <div className="text-gray-500 mb-1">Requirement</div>
                        <div>{reqId ? `${reqId} — ${reqTitle}` : "—"}</div>
                      </div>
                      <div className="rounded-lg border p-3">
                        <div className="text-gray-500 mb-1">Hazards</div>
                        <div>{hazTitles.length ? hazTitles.join(" | ") : "—"}</div>
                      </div>
                    </div>

                    <div className="rounded-lg border p-3">
                      <div className="text-gray-500 mb-1">Steps</div>
                      <ol className="list-decimal ml-5 space-y-1">
                        {(t.steps || t.design?.steps || []).map((s, i) => <li key={i}>{s}</li>)}
                      </ol>
                    </div>

                    <div className="rounded-lg border p-3">
                      <div className="text-gray-500 mb-1">Oracle / Acceptance</div>
                      <div>
                        {t.oracle?.type
                          ? `${t.oracle.type} — ${typeof t.oracle.rule === "string" ? t.oracle.rule : JSON.stringify(t.oracle.rule)}`
                          : (t.acceptanceCriteria || t.design?.expectedResult || "—")}
                      </div>
                    </div>

                    {(t.params && Object.keys(t.params).length > 0) && (
                      <div className="rounded-lg border p-3">
                        <div className="text-gray-500 mb-1">Parameters</div>
                        <pre className="text-xs whitespace-pre-wrap">{JSON.stringify(t.params, null, 2)}</pre>
                      </div>
                    )}

                    <div className="flex justify-between">
                      <Button
                        className="text-white"
                        style={{ background: "#DC2626", borderColor: "#DC2626" }}
                        onClick={() => {
                          const ok = window.confirm(`Delete test "${t.name || t.id}"? This cannot be undone.`);
                          if (ok) {
                            deleteTests([t.id]);
                            setDetails({ open: false, test: null, traceRow: null });
                          }
                        }}
                        title="Delete this test"
                      >
                        Delete Test
                      </Button>

                      <Button
                        className="text-white"
                        style={{ background: BRAND.warn, borderColor: BRAND.warn }}
                        onClick={() => {
                          setSelectedTestId(t.id);
                          setIsoEnabled(true);
                          setIsoRootId(`test:${t.id}`);
                          closeDetails();
                        }}
                        title="Highlight in diagram"
                      >
                        Highlight in Diagram
                      </Button>
                    </div>
                  </>
                );
              })()}

              {!details.test && details.traceRow && (
                <div className="rounded-lg border p-3">
                  <pre className="text-xs whitespace-pre-wrap">{JSON.stringify(details.traceRow, null, 2)}</pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

{summaryModal.open && (
  <div
    className="fixed inset-0 z-[9999] flex items-center justify-center"
    style={{ background: "rgba(0,0,0,0.35)" }}
    onClick={() => setSummaryModal({ open:false, section:null, title:"", body:null })}
  >
    <div
      role="dialog"
      aria-modal="true"
      className="relative w-[min(96vw,980px)] max-w-[980px] rounded-2xl overflow-hidden shadow-2xl"
      style={{ background: BRAND.white, border: `1px solid ${BRAND.blueDim}` }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="px-6 py-3 text-white flex items-center justify-between" style={{ background: BRAND.blue }}>
        <div className="text-lg font-semibold">{summaryModal.title}</div>
        <button
          onClick={() => setSummaryModal({ open:false, section:null, title:"", body:null })}
          className="text-white/90 hover:text-white text-xl leading-none"
          aria-label="Close"
          title="Close"
        >
          ×
        </button>
      </div>
      <div className="p-6 text-sm max-h-[70vh] overflow-auto">
  {summaryModal.body}
</div>

      <div className="px-6 pb-4 flex justify-end">
        <Button onClick={() => setSummaryModal({ open:false, section:null, title:"", body:null })}>
          Close
        </Button>
      </div>
    </div>
  </div>
)}


      {/* AI GENERATION MODAL (Multiselect for Tests) */}
      {aiOpen && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.35)" }}
          onClick={() => !aiBusy && setAiOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="relative max-w-[900px] rounded-2xl overflow-hidden shadow-2xl"
            style={{ background: BRAND.white, border: `1px solid ${BRAND.blueDim}`, width: "min(96vw, 900px)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-3 text-white flex items-center justify-between" style={{ background: BRAND.blue }}>
              <div className="text-lg font-semibold">AI Test Generation — Select Requirements</div>
              <button
                onClick={() => !aiBusy && setAiOpen(false)}
                className="text-white/90 hover:text-white text-xl leading-none"
                aria-label="Close"
                title="Close"
              >
                ×
              </button>
            </div>

            <div className="p-6 space-y-4 text-sm">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="md:col-span-1 space-y-3">
                  <input
                    type="text"
                    className="w-full border rounded-lg px-3 py-2"
                    value={aiFilter}
                    onChange={(e) => setAiFilter(e.target.value)}
                    placeholder="Search requirements…"
                    disabled={aiBusy}
                  />
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleAllVisible}
                      disabled={aiBusy || filteredRequirements.length === 0}
                    />
                    <span>Select all visible</span>
                  </label>
                  <div className="text-xs text-gray-500">
                    Selected: {selectedReqIds.length} / {Array.isArray(requirements) ? requirements.length : 0}
                  </div>
                  {!!aiProgress.total && (
                    <div className="border rounded-lg p-3">
                      <div className="text-xs text-gray-500 mb-1">
                        Progress: {aiProgress.n}/{aiProgress.total}
                      </div>
                      <div className="h-2 bg-gray-200 rounded">
                        <div
                          className="h-2 bg-blue-500 rounded"
                          style={{ width: `${aiProgress.total ? Math.round((aiProgress.n / aiProgress.total) * 100) : 0}%` }}
                        />
                      </div>
                      {aiProgress.current && (
                        <div className="mt-2 text-xs text-gray-600">
                          Current: {aiProgress.current.id || aiProgress.current.tag || aiProgress.current.title}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="md:col-span-2">
                  <div className="h-[320px] overflow-auto rounded-lg border">
                    <table className="min-w-full text-sm">
                      <thead className="sticky top-0 bg-white">
                        <tr>
                          <th className="px-3 py-2 border-b text-left font-medium w-10">Pick</th>
                          <th className="px-3 py-2 border-b text-left font-medium">Requirement</th>
                          <th className="px-3 py-2 border-b text-left font-medium">Title</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredRequirements.map((r) => {
                          const rid = idOfReq(r);
                          const picked = selectedReqIds.includes(rid);
                          return (
                            <tr key={rid} className="odd:bg-gray-50">
                              <td className="px-3 py-2 border-b">
                                <input
                                  type="checkbox"
                                  checked={picked}
                                  onChange={() => toggleOneReq(rid)}
                                  disabled={aiBusy}
                                />
                              </td>
                              <td className="px-3 py-2 border-b font-mono text-xs">{rid}</td>
                              <td className="px-3 py-2 border-b">{r.title || r.name || "—"}</td>
                            </tr>
                          );
                        })}
                        {filteredRequirements.length === 0 && (
                          <tr>
                            <td colSpan={3} className="px-3 py-6 text-center text-gray-500">
                              No requirements match your search.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <Button onClick={() => setAiOpen(false)} disabled={aiBusy}>Close</Button>
                <Button
                  className="text-white"
                  style={{ background: BRAND.blue, borderColor: BRAND.blue }}
                  disabled={selectedReqIds.length === 0 || aiBusy}
                  onClick={async () => {
                    try {
                      if (selectedReqIds.length === 0) return;
                      setAiBusy(true);

                      const selected = selectedRequirements;
                      const total = selected.length;
                      setAiProgress({ n: 0, total, current: null });

                      if (total === 1) {
                        const req = selected[0];
                        const m = reqToHazTitlesRef();
                        const key = String((req?.title || req?.name || req?.id || "")).toLowerCase().trim().replace(/\s+/g, " ");
                        const hazards = Array.from(m.get(key) || []);
                        const newTests = await generateTestsForRequirement({
                          requirement: req,
                          hazardTitles: hazards,
                          systemContext: activeProject?.name ? `Project: ${activeProject.name}` : "",
                          projectName: activeProject?.name || "Project",
                        });
                        if (!Array.isArray(newTests) || newTests.length === 0) {
                          throw new Error("AI returned no test cases for the selected requirement.");
                        }
                        upsertTests(newTests);
                      } else {
                        const newTests = await generateTestsBulk({
                          requirements: selected,
                          reqToHazTitles: reqToHazTitlesRef(),
                          systemContext: activeProject?.name ? `Project: ${activeProject.name}` : "",
                          projectName: activeProject?.name || "Project",
                          onProgress: (n, totalN, current) => setAiProgress({ n, total: totalN, current }),
                        });
                        if (!Array.isArray(newTests) || newTests.length === 0) {
                          throw new Error("AI returned no test cases for the selected requirements.");
                        }
                        upsertTests(newTests);
                      }

                      setAiBusy(false);
                      setAiOpen(false);
                      setSelectedReqIds([]);
                      setAiFilter("");
                    } catch (err) {
                      logger.error(err);
                      alert(`AI generation failed: ${err?.message || err}`);
                      setAiBusy(false);
                    }
                  }}
                >
                  {aiBusy ? "Generating…" : "Generate Tests"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Test Plan Viewer */}
      {planViewerOpen && testPlan && (
        <TestPlanViewer
          plan={testPlan}
          onClose={() => setPlanViewerOpen(false)}
          onExportJSON={() => exportTestPlanJSON(testPlan)}
          onExportMD={() => exportTestPlanMarkdown(testPlan)}
          onSaveDocument={(html) => {
                       // Merge the edited HTML back into the plan and persist
                       const merged = { ...(testPlan || {}), documentHtml: html };
                       savePlanIntoArtifacts(merged);
                     }}
        />
      )}
    </div>
  );
}
