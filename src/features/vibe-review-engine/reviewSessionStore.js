/**
 * The storage layer shared by every Vibe Review domain.
 *
 * Hazard analysis and functional decomposition previously kept byte-identical
 * copies of this logic -- quota fallback, cross-context merging, stack handling,
 * retention, audit append -- and had already drifted apart once (only one of
 * them recovered a session stranded mid-apply). Configuring one store instead
 * of copying it is what stops that happening again.
 *
 * Each thread holds a STACK of sessions. A cascade follow-up or a prerequisite
 * review suspends its parent and runs in front of it, so the parent stays
 * stored exactly once with the active review on top, rather than being copied
 * by value into its child.
 */

/** Bump when the persisted session shape changes in a way readers must know about. */
export const REVIEW_SESSION_SCHEMA_VERSION = 2;

/**
 * Decisions carry full before/after row detail so the Review Center can show
 * them. That is unbounded and this is browser storage, so older entries are
 * reduced. Undo normally touches only the most recent decision, but repeated
 * undo walks backwards through the list -- so a domain must declare which
 * fields are genuinely reconstructible, and anything its restore path reads
 * has to stay. Hazard undo restores from previousGovernedFields; functional
 * undo rebuilds the row itself from previousRow and affectedRows, so those
 * cannot be trimmed there.
 */
const FULL_DETAIL_DECISIONS = 25;

export function compactReviewSession(session, trimmableFields = [], keepFullDetail = FULL_DETAIL_DECISIONS) {
  const decisions = session?.decisions;
  if (!trimmableFields.length) return session;
  if (!Array.isArray(decisions) || decisions.length <= keepFullDetail) return session;
  const cutoff = decisions.length - keepFullDetail;
  return {
    ...session,
    decisions: decisions.map((decision, index) => {
      if (index >= cutoff || !decision) return decision;
      const trimmed = { ...decision };
      trimmableFields.forEach((field) => delete trimmed[field]);
      return { ...trimmed, detailTrimmed: true };
    }),
  };
}

export function createReviewSessionStore({
  key,
  auditKey,
  states,
  /** Applied to the active session on read, e.g. to make a stranded apply retryable. */
  reviveActive = (session) => session,
  runtimeId,
  auditLimit = 250,
  retainedStacks = 16,
  /** A review nests at most prerequisite -> follow-up; beyond that is a cycle. */
  maxStackDepth = 4,
  /** Decision fields safe to drop from older entries; must exclude anything undo reads. */
  trimmableDecisionFields = [],
}) {
  const defaultStorage = () => (typeof localStorage !== "undefined" ? localStorage : null);
  const volatileMapsByStorage = new WeakMap();
  const nullStorageMaps = {};

  const terminalStates = [states.COMPLETED, states.CANCELLED];
  const restStates = [...terminalStates, states.PAUSED];

  function volatileMaps(storage) {
    if (!storage || (typeof storage !== "object" && typeof storage !== "function")) return nullStorageMaps;
    if (!volatileMapsByStorage.has(storage)) volatileMapsByStorage.set(storage, {});
    return volatileMapsByStorage.get(storage);
  }

  function browserSessionStorage(storage) {
    try {
      return typeof localStorage !== "undefined" && storage === localStorage && typeof sessionStorage !== "undefined"
        ? sessionStorage
        : null;
    } catch {
      return null;
    }
  }

  function parseMap(storage, storageKey) {
    try { return JSON.parse(storage?.getItem(storageKey) || "{}") || {}; } catch { return {}; }
  }

  const recordTimestamp = (item) => {
    const active = Array.isArray(item) ? item[item.length - 1] : item;
    return Date.parse(active?.updatedAt || 0) || 0;
  };

  /**
   * Merge the three copies of a session map by recency rather than by layer.
   *
   * The in-memory overlay exists so an active review survives a storage quota
   * failure, but spreading it last made it shadow every key it held: a session
   * advanced in another tab became permanently invisible here, and the next
   * save wrote this context's stale copy back over it. Ties favour the later
   * layer, preserving the previous behaviour for same-millisecond writes.
   */
  function mergeSessionMaps(...maps) {
    return maps.reduce((result, map) => {
      Object.entries(map || {}).forEach(([mapKey, value]) => {
        const existing = result[mapKey];
        if (!existing || recordTimestamp(value) >= recordTimestamp(existing)) result[mapKey] = value;
      });
      return result;
    }, {});
  }

  function loadMap(storage, storageKey) {
    const persistent = parseMap(storage, storageKey);
    const tabFallback = parseMap(browserSessionStorage(storage), storageKey);
    const volatile = volatileMaps(storage)[storageKey] || {};
    // Audit records are append-only arrays, not versioned session objects.
    if (storageKey === auditKey) return { ...persistent, ...tabFallback, ...volatile };
    return mergeSessionMaps(persistent, tabFallback, volatile);
  }

  function persistMap(storage, storageKey, map) {
    volatileMaps(storage)[storageKey] = map;
    try {
      storage?.setItem(storageKey, JSON.stringify(map));
      try { browserSessionStorage(storage)?.removeItem(storageKey); } catch {}
      return "persistent";
    } catch {
      try {
        browserSessionStorage(storage)?.setItem(storageKey, JSON.stringify(map));
        return "session";
      } catch {
        // The volatile copy keeps the active review usable when both browser
        // storage areas are full. Applied decisions persist in the owning
        // artifact store regardless.
        return "memory";
      }
    }
  }

  const stackKey = (projectId, threadId) => `${projectId}:${threadId}`;

  /** Accepts the pre-stack shape (a bare session) and lifts it into a stack. */
  function normalizeStack(value) {
    if (Array.isArray(value)) return value.filter(Boolean);
    return value ? [value] : [];
  }

  function retainStacks(map) {
    const isTerminal = (stack) => terminalStates.includes(stack[stack.length - 1]?.state);
    const sorted = Object.entries(map)
      .map(([mapKey, value]) => [mapKey, normalizeStack(value)])
      .filter(([, stack]) => stack.length)
      .sort(([, a], [, b]) => recordTimestamp(b) - recordTimestamp(a));
    const unfinished = sorted.filter(([, stack]) => !isTerminal(stack));
    const terminal = sorted.filter(([, stack]) => isTerminal(stack));
    return Object.fromEntries([
      ...unfinished,
      ...terminal.slice(0, Math.max(0, retainedStacks - unfinished.length)),
    ]);
  }

  function writeStack(storage, projectId, threadId, stack) {
    const map = loadMap(storage, key);
    const mapKey = stackKey(projectId, threadId);
    if (stack.length) map[mapKey] = stack.map((entry) => compactReviewSession(entry, trimmableDecisionFields));
    else delete map[mapKey];
    persistMap(storage, key, retainStacks(map));
  }

  /** Stamp the current schema version so a later reader can migrate knowingly. */
  const versioned = (session) => ({ ...session, schemaVersion: REVIEW_SESSION_SCHEMA_VERSION });

  function readStack(projectId, threadId, storage = defaultStorage()) {
    return normalizeStack(loadMap(storage, key)[stackKey(projectId, threadId)]);
  }

  function recoveredIfStranded(session) {
    if (!session) return null;
    if (!restStates.includes(session.state) && session.runtimeId !== runtimeId) {
      return { ...session, state: states.PAUSED, recoveredAfterRestart: true };
    }
    return reviveActive(session);
  }

  return {
    REVIEW_SESSION_SCHEMA_VERSION,
    readStack,

    /**
     * Persist a session in place. A session already on the stack is updated
     * where it stands; an unrecognised one starts a new stack, because
     * beginning a review deliberately supersedes whatever came before.
     */
    saveSession(session, storage = defaultStorage()) {
      const stack = readStack(session.projectId, session.threadId, storage);
      const index = stack.findIndex((entry) => String(entry?.id || "") === String(session.id || ""));
      const stamped = versioned(session);
      writeStack(storage, session.projectId, session.threadId,
        index >= 0 ? stack.map((entry, position) => (position === index ? stamped : entry)) : [stamped]);
      return session;
    },

    /** Suspend the active review and run `child` in front of it. */
    pushSession(child, storage = defaultStorage()) {
      const stack = readStack(child.projectId, child.threadId, storage);
      if (stack.length >= maxStackDepth) {
        // Refuse rather than grow without bound: every nested session persists
        // another full copy of its queue and decisions, and an unbounded stack
        // is how a re-entrant cascade turns into storage exhaustion.
        throw new Error(`This review has nested ${stack.length} levels deep without finishing one. Finish or stop the open review before starting another.`);
      }
      const parent = stack[stack.length - 1] || null;
      const linked = versioned({ ...child, parentSessionId: parent?.id || "" });
      writeStack(storage, child.projectId, child.threadId, [...stack, linked]);
      return linked;
    },

    /** Finish the active review and return the one it suspended, or null. */
    popSession(projectId, threadId, storage = defaultStorage()) {
      const stack = readStack(projectId, threadId, storage);
      if (!stack.length) return null;
      const remaining = stack.slice(0, -1);
      writeStack(storage, projectId, threadId, remaining);
      return remaining[remaining.length - 1] || null;
    },

    loadSession(projectId, threadId, storage = defaultStorage()) {
      const stack = readStack(projectId, threadId, storage);
      return recoveredIfStranded(stack[stack.length - 1] || null);
    },

    findSessionById(sessionId, storage = defaultStorage()) {
      const match = Object.values(loadMap(storage, key))
        .flatMap((value) => normalizeStack(value))
        .find((item) => String(item?.id || "") === String(sessionId || "")) || null;
      return recoveredIfStranded(match);
    },

    appendAudit(record, storage = defaultStorage()) {
      const map = loadMap(storage, auditKey);
      const projectId = String(record.projectId || "");
      map[projectId] = [...(map[projectId] || []), record].slice(-auditLimit);
      persistMap(storage, auditKey, map);
      return record;
    },

    loadAudit(projectId, storage = defaultStorage()) {
      return loadMap(storage, auditKey)[String(projectId)] || [];
    },
  };
}
