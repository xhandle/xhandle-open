import { openDB } from "idb";

const DB_NAME = "xhandle-safety-remediation";
const DB_VERSION = 2;
const STORES = {
  findings: "safetyFindings",
  patches: "patchProposals",
  decisions: "reviewDecisions",
  summaries: "summaryArtifacts",
  verificationRuns: "verificationRuns",
  evidence: "safetyRemediationEvidence",
};

const LS_KEY = "xhandle:safety-remediation:v1";
const FALLBACK_RUN_LIMIT = 8;
const FALLBACK_LOG_PREVIEW_CHARS = 1200;
const FALLBACK_ITEM_LIMIT = 80;
const FALLBACK_TEXT_PREVIEW_CHARS = 4000;
const FALLBACK_DIFF_PREVIEW_CHARS = 20000;

const emptyState = () => ({
  safetyFindings: [],
  patchProposals: [],
  reviewDecisions: [],
  summaryArtifacts: [],
  verificationRuns: [],
  safetyRemediationEvidence: [],
});

function safeParse(raw, fallback) {
  try {
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function emitChanged(detail = {}) {
  try {
    window.dispatchEvent(new CustomEvent("xhandle:safety-remediation:changed", { detail }));
    window.dispatchEvent(new CustomEvent("xhandle:data-changed", { detail: { key: LS_KEY, ...detail } }));
  } catch {}
}

async function openSafetyRemediationDB() {
  if (typeof indexedDB === "undefined") return null;
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      Object.values(STORES).forEach((storeName) => {
        if (!db.objectStoreNames.contains(storeName)) {
          const store = db.createObjectStore(storeName, { keyPath: "id" });
          store.createIndex("projectId", "projectId", { unique: false });
          store.createIndex("repoId", "repoId", { unique: false });
          if (storeName === STORES.findings) store.createIndex("architectureElementId", "architectureElementId", { unique: false });
          if (storeName === STORES.patches) store.createIndex("safetyFindingId", "safetyFindingId", { unique: false });
          if ([STORES.verificationRuns, STORES.evidence].includes(storeName)) {
            store.createIndex("safetyFindingId", "safetyFindingId", { unique: false });
            store.createIndex("patchProposalId", "patchProposalId", { unique: false });
            store.createIndex("status", "status", { unique: false });
          }
        }
      });
    },
  });
}

function loadFallbackState() {
  if (typeof localStorage === "undefined") return emptyState();
  return { ...emptyState(), ...safeParse(localStorage.getItem(LS_KEY), emptyState()) };
}

function trimText(value, maxChars = FALLBACK_LOG_PREVIEW_CHARS) {
  if (typeof value !== "string") return value || "";
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n...[truncated for local fallback storage]`;
}

function trimFallbackValue(value, key = "", depth = 0) {
  if (typeof value === "string") {
    const maxChars = key === "unifiedDiff" ? FALLBACK_DIFF_PREVIEW_CHARS : FALLBACK_TEXT_PREVIEW_CHARS;
    return trimText(value, maxChars);
  }
  if (Array.isArray(value)) {
    const maxItems = key === "affectedCodeRefs" || key === "filesChanged" ? 120 : 40;
    return value.slice(-maxItems).map((item) => trimFallbackValue(item, key, depth + 1));
  }
  if (!value || typeof value !== "object" || depth > 4) return value;
  return Object.fromEntries(
    Object.entries(value).map(([childKey, childValue]) => [
      childKey,
      trimFallbackValue(childValue, childKey, depth + 1),
    ])
  );
}

function sanitizeRecordForFallback(item) {
  return trimFallbackValue(item);
}

function sanitizeVerificationRunForFallback(run) {
  if (!run || typeof run !== "object") return run;
  return {
    ...run,
    results: Array.isArray(run.results)
      ? run.results.map((result) => ({
        ...result,
        stdout: trimText(result?.stdout),
        stderr: trimText(result?.stderr),
      }))
      : [],
  };
}

function sanitizeEvidenceForFallback(item) {
  if (!item || typeof item !== "object") return item;
  const verification = item.verification && typeof item.verification === "object"
    ? {
      ...item.verification,
      logs: Array.isArray(item.verification.logs)
        ? item.verification.logs.map((entry) => ({
          ...entry,
          stdout: trimText(entry?.stdout),
          stderr: trimText(entry?.stderr),
        }))
        : [],
    }
    : item.verification;
  return { ...item, verification };
}

function buildFallbackSnapshot(state, mode = "full") {
  const base = { ...emptyState(), ...state };
  const safetyFindings = Array.isArray(base.safetyFindings)
    ? base.safetyFindings.slice(-FALLBACK_ITEM_LIMIT).map(sanitizeRecordForFallback)
    : [];
  const patchProposals = Array.isArray(base.patchProposals)
    ? base.patchProposals.slice(-FALLBACK_ITEM_LIMIT).map(sanitizeRecordForFallback)
    : [];
  const reviewDecisions = Array.isArray(base.reviewDecisions)
    ? base.reviewDecisions.slice(-FALLBACK_ITEM_LIMIT).map(sanitizeRecordForFallback)
    : [];
  const summaryArtifacts = Array.isArray(base.summaryArtifacts)
    ? base.summaryArtifacts.slice(-FALLBACK_ITEM_LIMIT).map(sanitizeRecordForFallback)
    : [];
  const full = {
    ...base,
    safetyFindings,
    patchProposals,
    reviewDecisions,
    summaryArtifacts,
    verificationRuns: Array.isArray(base.verificationRuns)
      ? base.verificationRuns
        .slice(-FALLBACK_RUN_LIMIT)
        .map(sanitizeVerificationRunForFallback)
      : [],
    safetyRemediationEvidence: Array.isArray(base.safetyRemediationEvidence)
      ? base.safetyRemediationEvidence
        .slice(-FALLBACK_RUN_LIMIT)
        .map(sanitizeEvidenceForFallback)
      : [],
  };
  if (mode === "full") return full;
  if (mode === "compact") {
    return {
      ...full,
      summaryArtifacts: [],
      verificationRuns: full.verificationRuns.map((run) => ({ ...run, results: [] })),
      safetyRemediationEvidence: [],
    };
  }
  if (mode === "emergency") {
    return {
      ...emptyState(),
      safetyFindings: safetyFindings.slice(-20).map((finding) => ({
        id: finding.id,
        title: finding.title,
        priority: finding.priority,
        reviewStatus: finding.reviewStatus,
        implementationStatus: finding.implementationStatus,
        verificationStatus: finding.verificationStatus,
        proposedPatchId: finding.proposedPatchId,
        updatedAt: finding.updatedAt,
      })),
      patchProposals: patchProposals.slice(-20).map((patch) => ({
        id: patch.id,
        safetyFindingId: patch.safetyFindingId,
        title: patch.title,
        reviewStatus: patch.reviewStatus,
        sourceContextStatus: patch.sourceContextStatus,
        updatedAt: patch.updatedAt,
      })),
      reviewDecisions: reviewDecisions.slice(-20),
    };
  }
  return {
    ...emptyState(),
    safetyFindings,
    patchProposals: patchProposals.map((patch) => ({ ...patch, unifiedDiff: trimText(patch.unifiedDiff, 4000) })),
    reviewDecisions,
    summaryArtifacts: [],
  };
}

function saveFallbackState(state) {
  if (typeof localStorage === "undefined") return;
  for (const mode of ["full", "compact", "minimal", "emergency"]) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(buildFallbackSnapshot(state, mode)));
      return;
    } catch (error) {
      if (mode === "emergency") {
        try {
          localStorage.removeItem(LS_KEY);
          localStorage.setItem(LS_KEY, JSON.stringify(buildFallbackSnapshot(state, mode)));
          return;
        } catch (finalError) {
          console.warn("[safety-remediation] localStorage save failed", finalError);
        }
      }
    }
  }
}

async function readStore(storeName) {
  try {
    const db = await openSafetyRemediationDB();
    if (!db) return loadFallbackState()[storeName] || [];
    return await db.getAll(storeName);
  } catch (error) {
    console.warn(`[safety-remediation] IndexedDB read failed for ${storeName}`, error);
    return loadFallbackState()[storeName] || [];
  }
}

async function writeStore(storeName, rows) {
  const state = loadFallbackState();
  state[storeName] = Array.isArray(rows) ? rows : [];
  saveFallbackState(state);
  try {
    const db = await openSafetyRemediationDB();
    if (!db) return state[storeName];
    const tx = db.transaction(storeName, "readwrite");
    await tx.store.clear();
    await Promise.all(state[storeName].map((row) => tx.store.put(row)));
    await tx.done;
  } catch (error) {
    console.warn(`[safety-remediation] IndexedDB write failed for ${storeName}; fallback retained`, error);
  }
  emitChanged({ storeName });
  return state[storeName];
}

async function upsertRows(storeName, incoming) {
  const rows = Array.isArray(incoming) ? incoming : [incoming].filter(Boolean);
  const existing = await readStore(storeName);
  const byId = new Map(existing.map((row) => [row.id, row]));
  rows.forEach((row) => byId.set(row.id, row));
  await writeStore(storeName, Array.from(byId.values()));
  return rows;
}

async function patchFindings(ids, patchOrUpdater) {
  const idList = Array.isArray(ids) ? ids.filter(Boolean) : [ids].filter(Boolean);
  const idSet = new Set(idList);
  if (!idSet.size) return [];
  const rows = await readStore(STORES.findings);
  const now = new Date().toISOString();
  const next = rows.map((row) => {
    if (!idSet.has(row.id)) return row;
    const patch = typeof patchOrUpdater === "function" ? patchOrUpdater(row, now) : patchOrUpdater;
    return { ...row, ...patch, updatedAt: now };
  });
  await writeStore(STORES.findings, next);
  return next.filter((row) => idSet.has(row.id));
}

export const safetyRemediationStore = {
  async loadAll() {
    const [safetyFindings, patchProposals, reviewDecisions, summaryArtifacts, verificationRuns, safetyRemediationEvidence] = await Promise.all([
      readStore(STORES.findings),
      readStore(STORES.patches),
      readStore(STORES.decisions),
      readStore(STORES.summaries),
      readStore(STORES.verificationRuns),
      readStore(STORES.evidence),
    ]);
    return { safetyFindings, patchProposals, reviewDecisions, summaryArtifacts, verificationRuns, safetyRemediationEvidence };
  },
  loadFindings: () => readStore(STORES.findings),
  loadPatchProposals: () => readStore(STORES.patches),
  loadReviewDecisions: () => readStore(STORES.decisions),
  loadSummaryArtifacts: () => readStore(STORES.summaries),
  loadVerificationRuns: () => readStore(STORES.verificationRuns),
  loadSafetyRemediationEvidence: () => readStore(STORES.evidence),
  upsertFindings: (items) => upsertRows(STORES.findings, items),
  upsertPatchProposals: (items) => upsertRows(STORES.patches, items),
  upsertReviewDecisions: (items) => upsertRows(STORES.decisions, items),
  upsertSummaryArtifacts: (items) => upsertRows(STORES.summaries, items),
  upsertVerificationRuns: (items) => upsertRows(STORES.verificationRuns, items),
  upsertSafetyRemediationEvidence: (items) => upsertRows(STORES.evidence, items),
  async loadVerificationRunsForFinding(safetyFindingId) {
    const rows = await readStore(STORES.verificationRuns);
    return rows
      .filter((row) => row.safetyFindingId === safetyFindingId)
      .sort((a, b) => (Date.parse(b.completedAt || b.startedAt || 0) || 0) - (Date.parse(a.completedAt || a.startedAt || 0) || 0));
  },
  async updateFinding(id, patch) {
    const rows = await readStore(STORES.findings);
    const next = rows.map((row) => (row.id === id ? { ...row, ...patch, updatedAt: new Date().toISOString() } : row));
    await writeStore(STORES.findings, next);
    return next.find((row) => row.id === id) || null;
  },
  async updateFindingOrganization(id, patch) {
    const [updated] = await patchFindings(id, patch);
    return updated || null;
  },
  bulkUpdateFindings: (ids, patch) => patchFindings(ids, patch),
  async archiveFinding(id) {
    const [updated] = await patchFindings(id, (_row, now) => ({ archivedAt: now, deletedAt: null }));
    return updated || null;
  },
  async restoreFinding(id) {
    const [updated] = await patchFindings(id, { archivedAt: null, deletedAt: null });
    return updated || null;
  },
  async softDeleteFinding(id) {
    const [updated] = await patchFindings(id, (_row, now) => ({ deletedAt: now }));
    return updated || null;
  },
  async restoreDeletedFinding(id) {
    const [updated] = await patchFindings(id, { archivedAt: null, deletedAt: null });
    return updated || null;
  },
  async deleteFindings(ids) {
    const idSet = new Set((Array.isArray(ids) ? ids : [ids]).filter(Boolean));
    if (!idSet.size) return { deletedFindingIds: [], deletedPatchIds: [] };
    const [findings, patches, decisions, verificationRuns, evidence] = await Promise.all([
      readStore(STORES.findings),
      readStore(STORES.patches),
      readStore(STORES.decisions),
      readStore(STORES.verificationRuns),
      readStore(STORES.evidence),
    ]);
    const deletedPatchIds = new Set(patches.filter((row) => idSet.has(row.safetyFindingId)).map((row) => row.id).filter(Boolean));
    await Promise.all([
      writeStore(STORES.findings, findings.filter((row) => !idSet.has(row.id))),
      writeStore(STORES.patches, patches.filter((row) => !idSet.has(row.safetyFindingId))),
      writeStore(STORES.decisions, decisions.filter((row) => !idSet.has(row.targetId) && !deletedPatchIds.has(row.targetId))),
      writeStore(STORES.verificationRuns, verificationRuns.filter((row) => !idSet.has(row.safetyFindingId) && !deletedPatchIds.has(row.patchProposalId))),
      writeStore(STORES.evidence, evidence.filter((row) => !idSet.has(row.safetyFindingId) && !deletedPatchIds.has(row.patchProposalId))),
    ]);
    return { deletedFindingIds: Array.from(idSet), deletedPatchIds: Array.from(deletedPatchIds) };
  },
  async loadActiveFindings() {
    const rows = await readStore(STORES.findings);
    return rows.filter((row) => !row.archivedAt && !row.deletedAt);
  },
  async loadArchivedFindings() {
    const rows = await readStore(STORES.findings);
    return rows.filter((row) => row.archivedAt && !row.deletedAt);
  },
  async loadDeletedFindings() {
    const rows = await readStore(STORES.findings);
    return rows.filter((row) => row.deletedAt);
  },
  async updatePatchProposal(id, patch) {
    const rows = await readStore(STORES.patches);
    const next = rows.map((row) => (row.id === id ? { ...row, ...patch, updatedAt: new Date().toISOString() } : row));
    await writeStore(STORES.patches, next);
    return next.find((row) => row.id === id) || null;
  },
  async updateVerificationRun(id, patch) {
    const rows = await readStore(STORES.verificationRuns);
    const next = rows.map((row) => (row.id === id ? { ...row, ...patch, updatedAt: new Date().toISOString() } : row));
    await writeStore(STORES.verificationRuns, next);
    return next.find((row) => row.id === id) || null;
  },
};

export { DB_NAME as SAFETY_REMEDIATION_DB_NAME, STORES as SAFETY_REMEDIATION_STORES };
