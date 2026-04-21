/**
 * xHandle: llmmodule linker modal modal workflow.
 * This file implements a focused modal surface used inside the xHandle workspace to collect input, expose a feature-specific editor, or present supporting project information.
 * Modal flows keep secondary tasks close to the main engineering workspace without forcing a separate route or losing the surrounding project context.
 * Related files: src/App.js, src/components/layout/TopNavBar.jsx, src/features/settings/SettingsModal.jsx.
 */

// src/components/LLMModuleLinkerModal.jsx
import React, { useMemo, useState, useEffect, useRef } from "react";
import { X, Link2, Loader2 } from "lucide-react";
import { backendURL, buildAIAuthOpts } from "../../lib/api/backendConfig";
import { logger } from "../../lib/utils/logger";

/* ----------------------------- Local LLM helpers ----------------------------- */

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// crude token estimator (chars/4)
function estimateTokens(text) {
  return Math.ceil((text || "").length / 4);
}

// simple per-minute token window + minimal inter-call delay
let totalTokensUsed = 0;
let tokenWindowStart = Date.now();
const MAX_TOKENS_PER_MINUTE = 5000; // adjust to your tier
let lastLLMCallTimestamp = 0;
const MIN_DELAY_MS = 100; // 10 RPM ~= 6000ms; use what you prefer

async function throttleLLMCall(prompt) {
  const now = Date.now();
  const estimatedTokens = estimateTokens(prompt);

  // reset token window ~periodically
  if (now - tokenWindowStart > 60_000) {
    tokenWindowStart = now;
    totalTokensUsed = 0;
  }

  // token budget throttle
  while (totalTokensUsed + estimatedTokens > MAX_TOKENS_PER_MINUTE) {
    await sleep(300);
  }

  // min delay between calls
  const since = now - lastLLMCallTimestamp;
  if (since < MIN_DELAY_MS) {
    await sleep(MIN_DELAY_MS - since);
  }

  lastLLMCallTimestamp = Date.now();
  totalTokensUsed += estimatedTokens;

  return await fetchLLMResponse(prompt);
}

// retry wrapper
async function fetchWithRetry(prompt, retries = 3, delay = 300) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await throttleLLMCall(prompt);
      if (!response || typeof response !== "string" || response.trim() === "") {
        throw new Error("Empty or invalid response");
      }
      return response;
    } catch (err) {
      if (attempt < retries) await sleep(delay * attempt);
    }
  }
  return "(error)";
}

// ---------------------- Provider-aware chat proxy call ----------------------
// This modal sends prompts through `/api/chat` so provider selection stays
// centralized in the backend instead of being hard-coded in the client.
async function fetchLLMResponse(prompt) {
  try {
    const response = await fetch(`${backendURL}/api/chat`, {
      method: "POST",
      ...buildAIAuthOpts({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          { role: "system", content: "You are a systems traceability expert. Output STRICT JSON only. No prose before/after." },
          { role: "user", content: prompt },
        ],
        temperature: 0.3,
        // If you want token caps, pass them through:
        // max_tokens: 2000,
      }),
    });

    // 429 handling is still fine – but headers might not be present unless you forward them server-side
    if (response.status === 429) {
      logger.warn("🔁 429 Rate limit hit");
      logger.debug("📦 Headers:", {
        limitTokens: response.headers.get("x-ratelimit-limit-tokens"),
        remainingTokens: response.headers.get("x-ratelimit-remaining-tokens"),
        limitRequests: response.headers.get("x-ratelimit-limit-requests"),
        remainingRequests: response.headers.get("x-ratelimit-remaining-requests"),
        resetTokens: response.headers.get("x-ratelimit-reset-tokens"),
        resetRequests: response.headers.get("x-ratelimit-reset-requests"),
      });
    }

    const json = await response.json();
    logger.debug("📦 Raw LLM response JSON:", json);

    return json?.choices?.[0]?.message?.content?.trim() || "(empty)";
  } catch (error) {
    logger.error("🚨 Error in fetchLLMResponse:", error);
    return "(error)";
  }
}

/* ----------------------------- JSON extraction ----------------------------- */

function extractJsonFromText(text) {
  if (!text) return "";
  const trimmed = String(text).trim();

  // Strip common fenced blocks
  const fenceStripped = trimmed
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();

  if (
    (fenceStripped.startsWith("{") && fenceStripped.endsWith("}")) ||
    (fenceStripped.startsWith("[") && fenceStripped.endsWith("]"))
  ) {
    return fenceStripped;
  }

  const firstBrace = fenceStripped.indexOf("{");
  const lastBrace = fenceStripped.lastIndexOf("}");
  const firstBracket = fenceStripped.indexOf("[");
  const lastBracket = fenceStripped.lastIndexOf("]");

  let candidate = "";
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    candidate = fenceStripped.slice(firstBrace, lastBrace + 1);
  } else if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
    candidate = fenceStripped.slice(firstBracket, lastBracket + 1);
  }

  return candidate || fenceStripped;
}

/* ----------------------------- Simple relevance scorer (for risk rows) ----------------------------- */

function normalizeText(s) {
  return (s ?? "")
    .toString()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * bag renders a modal dialog. It gives users access to the main engineering workspace while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param text Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
function bag(text) {
  const toks = normalizeText(text).split(" ").filter(Boolean);
  const map = new Map();
  for (const t of toks) map.set(t, (map.get(t) ?? 0) + 1);
  return map;
}

/**
 * overlapScore renders a modal dialog. It gives users access to the main engineering workspace while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param a Input consumed by this step of the xHandle workflow.
 * @param b Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
function overlapScore(a, b) {
  let score = 0;
  for (const [k, v] of a) if (b.has(k)) score += Math.min(v, b.get(k));
  return score;
}

/**
 * describeReq renders a modal dialog. It gives users access to the main engineering workspace while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param r Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
function describeReq(r) {
  const attrs = r?.attributes ? JSON.stringify(r.attributes) : "";
  return `${r?.title ?? ""} ${attrs}`;
}

/**
 * describeRiskRow renders a modal dialog. It gives users access to the main engineering workspace while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param row Single worksheet row being normalized or rendered.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
function describeRiskRow(row) {
  // Supports both STPA and FMEA styles you've used.
  const bits = [
    row?.Module && `Module: ${row.Module}`,
    row?.Risk && `Risk: ${row.Risk}`,
    row?.Hazards && `Hazards: ${row.Hazards}`,
    row?.["Unsafe Control Actions"] && `Unsafe Control Actions: ${row["Unsafe Control Actions"]}`,
    row?.["Failure Modes"] && `Failure Modes: ${row["Failure Modes"]}`,
    row?.["What-If Scenarios"] && `What-If Scenarios: ${row["What-If Scenarios"]}`,
    row?.["Causal Factors"] && `Causal Factors: ${row["Causal Factors"]}`,
    row?.["Causal Factor"] && `Causal Factor: ${row["Causal Factor"]}`,
    row?.["Causal Pathway"] && `Causal Pathway: ${row["Causal Pathway"]}`,
    row?.["Safety Requirements/Constraints"] && `Safety Requirements/Constraints: ${row["Safety Requirements/Constraints"]}`,
    row?.["System Requirement"] && `System Requirement: ${row["System Requirement"]}`,
    row?.["AI Policy"] && `AI Policy: ${row["AI Policy"]}`,
    row?.["Failure Mode"] && `Failure Mode: ${row["Failure Mode"]}`,
    row?.["Effect"] && `Effect: ${row["Effect"]}`,
    row?.["Cause"] && `Cause: ${row["Cause"]}`,
  ].filter(Boolean);
  return bits.join(" | ");
}

/**
 * topKRiskRowsForModules renders a modal dialog. It gives users access to the main engineering workspace while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param parentReqs Input consumed by this step of the xHandle workflow.
 * @param childReqs Input consumed by this step of the xHandle workflow.
 * @param riskRows Input consumed by this step of the xHandle workflow.
 * @param k Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
function topKRiskRowsForModules(parentReqs, childReqs, riskRows, k) {
  if (!riskRows?.length) return [];
  const parentText = parentReqs.map(describeReq).join("\n");
  const childText = childReqs.map(describeReq).join("\n");
  const ab = bag(`${parentText}\n${childText}`);

  const scored = riskRows.map((row, idx) => {
    const rb = bag(describeRiskRow(row));
    return { idx, score: overlapScore(ab, rb) };
  });

  scored.sort((x, y) => y.score - x.score);
  return scored.slice(0, k).map(s => riskRows[s.idx]);
}

/* ----------------------------- UI Shell ----------------------------- */

function ModalFrame({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-[999]">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="w-full max-w-3xl rounded-2xl bg-white shadow-xl flex flex-col max-h-[80vh]">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h3 className="text-sm font-semibold">{title}</h3>
            <button className="rounded p-1 text-gray-600 hover:bg-gray-100" onClick={onClose} aria-label="Close">
              <X size={18} />
            </button>
          </div>
          <div className="p-4 overflow-y-auto">{children}</div>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------- Component ----------------------------- */

/**
 * Props:
 * - modules: Array<{ id, name }>
 * - requirementsByModule: (moduleId) => Array<{ id, title, module, moduleId?, attributes? }>
 * - onApplyLinks: async (links: Array<{ parentId, childId, type:string }>) => Promise<void>
 * - riskSummaryRows?: Array<Record<string, any>>
 * - defaultParentId?, defaultChildId?, onClose?
 */
export default function LLMModuleLinkerModal({
  modules,
  requirementsByModule,
  onApplyLinks,
  riskSummaryRows = [],
  defaultParentId = null,
  defaultChildId = null,
  onClose,
}) {
  const [parentId, setParentId] = useState(defaultParentId);
  const [childId, setChildId] = useState(defaultChildId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [useRiskCtx, setUseRiskCtx] = useState(true);
  const [kRiskRows, setKRiskRows] = useState(4);
  const [suggestions, setSuggestions] = useState(
    /** @type Array<{ parentId:string, childId:string, reason?:string, score?:number, selected:boolean }> */([])
  );

  // Progress state
  const [progressPairsReviewed, setProgressPairsReviewed] = useState(0);
  const [progressTotalPairs, setProgressTotalPairs] = useState(0);
  const [progressPct, setProgressPct] = useState(0);
  const progressTimerRef = useRef(null);

  const parentReqs = useMemo(() => (parentId ? requirementsByModule(parentId) : []), [parentId, requirementsByModule]);
  const childReqs  = useMemo(() => (childId  ? requirementsByModule(childId)  : []), [childId, requirementsByModule]);

  // Compute top-K risk rows once per selection (cheap overlap scorer)
  const topRiskRows = useMemo(() => {
    if (!useRiskCtx) return [];
    return topKRiskRowsForModules(parentReqs, childReqs, riskSummaryRows, Number(kRiskRows) || 0);
  }, [useRiskCtx, kRiskRows, parentReqs, childReqs, riskSummaryRows]);

  // ---- Progress helpers ----
  const startProgress = (totalPairs) => {
    setProgressTotalPairs(totalPairs);
    setProgressPairsReviewed(0);
    setProgressPct(totalPairs === 0 ? 100 : 0);

    if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }

    if (totalPairs === 0) return;

    const step = Math.max(1, Math.ceil(totalPairs / 50)); // ~50 steps to ~95%
    progressTimerRef.current = setInterval(() => {
      setProgressPairsReviewed((prev) => {
        const targetMax = Math.max(1, Math.floor(totalPairs * 0.95));
        const next = Math.min(prev + step, targetMax);
        setProgressPct(Math.round((next / totalPairs) * 100));
        return next;
      });
    }, 120);
  };

  const stopProgress = (succeed = true) => {
    if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
    if (succeed) {
      setProgressPairsReviewed(() => {
        setProgressPct(100);
        return progressTotalPairs;
      });
    }
  };

  // Clear timer on unmount
  useEffect(() => {
    return () => {
      if (progressTimerRef.current) {
        clearInterval(progressTimerRef.current);
        progressTimerRef.current = null;
      }
    };
  }, []);

  // Optional: reset progress when selection changes and not busy
  useEffect(() => {
    if (!busy) {
      setProgressPairsReviewed(0);
      setProgressTotalPairs(0);
      setProgressPct(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parentId, childId]);

  const buildPrompt = (pReqs, cReqs, riskRowsForThis) => {
    const parentBlock = pReqs.map(r => `- ${r.id} :: ${r.title}`).join("\n");
    const childBlock  = cReqs.map(r => `- ${r.id} :: ${r.title}`).join("\n");
    const riskBlock   = (riskRowsForThis ?? []).map((row, i) => `- R${i + 1}: ${describeRiskRow(row)}`).join("\n") || "- (none)";

    return `
Return STRICT JSON ONLY with no preface, following this schema:

{
  "links": [
    {"parentId":"<id>","childId":"<id>","reason":"<short why>","score":0.0}
  ]
}

Interpretation Guide:
- "parentId" is the higher-level requirement; "childId" refines/satisfies it.
- Only include strong, defensible mappings (avoid many-to-many noise).
- "score" is confidence 0..1 (float).
- If no links: {"links": []}.
- Prefer "satisfies/refines" semantics; if unsure, omit.

Parent module requirements:
${parentBlock || "(none)"}

Child module requirements:
${childBlock || "(none)"}

Risk/Hazard Context (top relevant rows for this module pair):
${riskBlock}
`.trim();
  };

  const handleGenerate = async () => {
    setError("");

    if (!parentId || !childId) {
      setError("Select both a Parent module and a Child module.");
      return;
    }
    if (parentId === childId) {
      setError("Parent and Child must be different modules.");
      return;
    }
    if (!parentReqs.length || !childReqs.length) {
      setError("Selected modules have no requirements to compare.");
      return;
    }

    const totalPairs = (parentReqs?.length || 0) * (childReqs?.length || 0);
    setBusy(true);
    startProgress(totalPairs);

    try {
      const prompt = buildPrompt(parentReqs, childReqs, topRiskRows);

      // Use local throttle + retry + logging
      const raw = await fetchWithRetry(prompt);

      const cleaned = extractJsonFromText(raw);
      let data;
      try {
        data = JSON.parse(cleaned);
      } catch (err) {
        logger.error("Failed to parse LLM JSON for linker:", err, { raw, cleaned });
        throw new Error("The model did not return valid JSON.");
      }

      const links = Array.isArray(data?.links) ? data.links : [];
      const parsed = links
        .filter(l => l && l.parentId && l.childId)
        .map(l => ({ ...l, selected: true }));

      setSuggestions(parsed);
      if (!parsed.length) setError("No strong links proposed by the model.");

      // Success → snap to 100%
      stopProgress(true);
    } catch (e) {
      setError(e.message || "Failed to get suggestions from LLM.");
      // Error → stop without snap
      stopProgress(false);
    } finally {
      setBusy(false);
    }
  };

  const toggleRow = (i) => {
    setSuggestions(prev => prev.map((s, idx) => (idx === i ? { ...s, selected: !s.selected } : s)));
  };

  const applySelected = async () => {
    const chosen = suggestions.filter((s) => s.selected);
    if (!chosen.length) {
      setError("Select at least one link to apply.");
      return;
    }

    let skipped = 0;
    const picks = [];

    for (const s of chosen) {
      const p = parentReqs.find((r) => r.id === s.parentId);
      const c = childReqs.find((r) => r.id === s.childId);
      if (!p || !c) { skipped++; continue; }

      const sameModule =
        (p.moduleId && c.moduleId && p.moduleId === c.moduleId) ||
        (p.module && c.module && p.module === c.module);

      if (sameModule) { skipped++; continue; }

      // Keep your existing link type; you can switch to "satisfies" if desired.
      picks.push({ parentId: s.parentId, childId: s.childId, type: "refines" });
    }

    if (!picks.length) {
      setError("No valid cross-module links to apply.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      await onApplyLinks(picks);
      if (skipped > 0) {
        logger.warn(`Skipped ${skipped} intra-module link(s).`);
      }
      onClose?.();
    } catch (e) {
      setError(e.message || "Failed to apply links.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalFrame title="LLM Module Linker" onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm">
          <div className="mb-1 text-gray-600">Parent Module</div>
          <select
            className="w-full rounded-md border px-2 py-1"
            value={parentId || ""}
            onChange={(e) => setParentId(e.target.value || null)}
          >
            <option value="">Select parent…</option>
            {modules.map(m => (<option key={m.id} value={m.id}>{m.name}</option>))}
          </select>
        </label>
        <label className="text-sm">
          <div className="mb-1 text-gray-600">Child Module</div>
          <select
            className="w-full rounded-md border px-2 py-1"
            value={childId || ""}
            onChange={(e) => setChildId(e.target.value || null)}
          >
            <option value="">Select child…</option>
            {modules.map(m => (<option key={m.id} value={m.id}>{m.name}</option>))}
          </select>
        </label>
      </div>

      {/* Risk context controls */}
      <div className="mt-3 flex items-center gap-3">
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={useRiskCtx}
            onChange={(e) => setUseRiskCtx(e.target.checked)}
          />
          Use Risk/Hazard context
        </label>
        <label className="text-sm flex items-center gap-2">
          <span className="text-gray-600">Top-K rows</span>
          <input
            type="number"
            min={0}
            max={8}
            step={1}
            value={kRiskRows}
            onChange={(e) => setKRiskRows(e.target.value)}
            className="w-16 rounded-md border px-2 py-1"
          />
        </label>
        <div className="text-xs text-gray-500">
          {useRiskCtx
            ? `Using ${topRiskRows.length} contextual row${topRiskRows.length === 1 ? "" : "s"}`
            : "Risk context disabled"}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button
          className="inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50"
          onClick={handleGenerate}
          disabled={busy || !parentId || !childId || parentId === childId}
        >
          {busy ? <Loader2 className="animate-spin" size={16} /> : <Link2 size={16} />}
          Generate suggestions
        </button>
        <div className="text-xs text-gray-500">The model proposes parent→child links; you choose which to apply.</div>
      </div>

      {/* Live review status */}
      {(busy || progressPct > 0) && (
        <div className="mt-3 rounded border bg-gray-50 p-3">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <div>
              <span className="text-gray-600">Parent requirements:</span>{" "}
              <span className="font-medium">{parentReqs.length}</span>
            </div>
            <div>
              <span className="text-gray-600">Child requirements:</span>{" "}
              <span className="font-medium">{childReqs.length}</span>
            </div>
            <div>
              <span className="text-gray-600">Pairs to review (P×C):</span>{" "}
              <span className="font-medium">{progressTotalPairs}</span>
            </div>
            {useRiskCtx && (
              <div>
                <span className="text-gray-600">Risk rows in context:</span>{" "}
                <span className="font-medium">{topRiskRows.length}</span>
              </div>
            )}
          </div>

          <div className="mt-2">
            <div className="flex justify-between text-xs text-gray-600 mb-1">
              <span>Reviewed</span>
              <span>{progressPairsReviewed} / {progressTotalPairs} ({progressPct}%)</span>
            </div>
            <div className="h-2 w-full rounded-full bg-gray-200 overflow-hidden">
              <div
                className="h-2 bg-indigo-600 transition-[width] duration-150 ease-linear"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Preview of which risk rows are being injected (optional, helpful for debug) */}
      {useRiskCtx && topRiskRows.length > 0 && (
        <div className="mt-3 rounded border bg-gray-50 p-2">
          <div className="text-xs font-medium text-gray-600 mb-1">Risk context used:</div>
          <ul className="list-disc pl-5 text-xs text-gray-700 space-y-1">
            {topRiskRows.map((r, i) => (
              <li key={i}>{describeRiskRow(r)}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Errors */}
      {error && <div className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {/* Suggestions table */}
      {!!suggestions.length && (
        <div className="mt-4">
          <div className="mb-2 text-xs text-gray-600">
            Proposed Links (toggle to include/exclude before applying)
          </div>
          <table className="w-full table-fixed border text-sm">
            <colgroup>
              <col style={{ width: "7rem" }} />
              <col />
              <col />
              <col style={{ width: "5rem" }} />
            </colgroup>
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-600">
              <tr>
                <th className="border px-2 py-1">Apply</th>
                <th className="border px-2 py-1">Parent → Child</th>
                <th className="border px-2 py-1">Reason</th>
                <th className="border px-2 py-1">Score</th>
              </tr>
            </thead>
            <tbody>
              {suggestions.map((s, i) => (
                <tr key={`${s.parentId}-${s.childId}-${i}`}>
                  <td className="border px-2 py-1">
                    <input type="checkbox" checked={s.selected} onChange={() => toggleRow(i)} />
                  </td>
                  <td className="border px-2 py-1 align-top">
                    <div className="font-medium">{s.parentId} → {s.childId}</div>
                    <div className="text-xs text-gray-500">
                      {(parentReqs.find(r => r.id === s.parentId)?.title) || "—"}<br/>
                      {(childReqs.find(r => r.id === s.childId)?.title) || "—"}
                    </div>
                  </td>
                  <td className="border px-2 py-1 align-top">{s.reason || "—"}</td>
                  <td className="border px-2 py-1 align-top">{(s.score ?? "").toString()}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-3 flex justify-end gap-2">
            <button className="rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50" onClick={onClose}>
              Cancel
            </button>
            <button
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-700 disabled:opacity-60"
              onClick={applySelected}
              disabled={busy || !parentId || !childId || parentId === childId}
            >
              Apply Links
            </button>
          </div>
        </div>
      )}
    </ModalFrame>
  );
}
