/**
 * xHandle: agent monitor agent infrastructure.
 * This file defines the runtime-side structures that support xHandle's agent model, including task descriptions, monitoring hooks, and capability metadata.
 * These modules provide the shared contract between agent UIs and the orchestration logic that decides what an AI assistant should do, how it reports progress, and how task state is represented.
 * Related files: src/features/agents/xAgent/XAgentCenter.jsx, src/components/agentController.js, src/components/agentActions.js.
 */

// AgentMonitor.js (Polling-only)
// 24/7 monitoring via resilient polling (no WebSocket / no SSE)
// - Emits CustomEvents: "agent:heartbeat", "agent:alert", "agent:status"
// - Persists last-seen pings to localStorage so multiple tabs stay in sync.
// - Adaptive backoff on errors, immediate retry on visibility/online.

let pollTimer = null;
let lastPingAt = 0;

// Config: baseline interval (ms). Prefer runtime var, then env, then default.
const BASE_POLL_MS =
  (typeof window !== "undefined" && Number(window.__XHANDLE_POLL_MS__)) ||
  (typeof process !== "undefined" && Number(process?.env?.REACT_APP_AGENT_POLL_MS)) ||
  15000; // 15s

const MAX_BACKOFF_MS = 60000; // 60s cap
let currentPollMs = BASE_POLL_MS;

/**
 * emit encapsulates a focused piece of agent orchestration workflow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param type Input consumed by this step of the xHandle workflow.
 * @param detail Input consumed by this step of the xHandle workflow.
 * @returns the value that the next step in this workflow consumes.
 */
function emit(type, detail) {
  // Dispatch app-wide event
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(type, { detail }));
  }
  // Persist last event for cross-tab sync
  try {
    localStorage.setItem(`agents:last:${type}`, JSON.stringify({ t: Date.now(), detail }));
  } catch {}
}

/**
 * clearPoll encapsulates a focused piece of agent orchestration workflow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @returns the value that the next step in this workflow consumes.
 */
function clearPoll() {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
}

/**
 * schedulePoll encapsulates a focused piece of agent orchestration workflow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param fn Input consumed by this step of the xHandle workflow.
 * @param delay Input consumed by this step of the xHandle workflow.
 * @returns the value that the next step in this workflow consumes.
 */
function schedulePoll(fn, delay = currentPollMs) {
  clearPoll();
  pollTimer = setTimeout(fn, Math.max(1000, delay)); // never <1s
}

/**
 * onPollSuccess encapsulates a focused piece of agent orchestration workflow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param status Input consumed by this step of the xHandle workflow.
 * @returns the value that the next step in this workflow consumes.
 */
function onPollSuccess(status) {
  // Reset backoff after a good poll
  currentPollMs = BASE_POLL_MS;

  // Update status + heartbeat
  lastPingAt = Date.now();
  if (status) {
    emit("agent:status", status);
  }
  emit("agent:heartbeat", { at: lastPingAt, via: "poll" });

  // Schedule next poll at baseline
  schedulePoll(() => doPoll(), currentPollMs);
}

/**
 * onPollError encapsulates a focused piece of agent orchestration workflow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param err Input consumed by this step of the xHandle workflow.
 * @returns the value that the next step in this workflow consumes.
 */
function onPollError(err) {
  // Inform UI (non-fatal)
  emit("agent:alert", { level: "warn", message: `Polling error: ${String(err)}` });

  // Increase backoff (1.5x) up to cap
  currentPollMs = Math.min(Math.floor(currentPollMs * 1.5), MAX_BACKOFF_MS);

  // Schedule next poll with backoff
  schedulePoll(() => doPoll(), currentPollMs);
}

/**
 * doPoll encapsulates a focused piece of agent orchestration workflow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param fetchStatus Input consumed by this step of the xHandle workflow.
 * @returns Promise resolving to the value that the next step in this workflow consumes.
 */
async function doPoll(fetchStatus) {
  if (typeof fetchStatus !== "function") return onPollError("fetchStatus not provided");
  try {
    const status = await fetchStatus(); // expected { kind, status, heartbeat } or similar
    onPollSuccess(status);
  } catch (e) {
    onPollError(e);
  }
}

/**
 * initAgentMonitor establishes the prerequisite runtime state this module needs before higher-level work can proceed. In xHandle that usually means preparing storage, event bridges, or shared runtime infrastructure before a feature starts using it.
 * @param fetchStatus Input consumed by this step of the xHandle workflow.
 * @returns the value that the next step in this workflow consumes.
 */
export function initAgentMonitor({ fetchStatus }) {
  // Initial state notification (optional, helps UI show "connecting"/"degraded")
  emit("agent:status", { kind: "system", status: "polling" });

  // Kick off first poll shortly after init
  schedulePoll(() => doPoll(fetchStatus), 500);

  // Visibility heartbeat & eager poll when tab becomes visible
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        emit("agent:heartbeat", { at: Date.now(), via: "visibility" });
        // If we were backing off, do a quick poll now
        schedulePoll(() => doPoll(fetchStatus), 250);
      }
    });
  }

  // Network awareness: when back online, poll immediately
  if (typeof window !== "undefined") {
    window.addEventListener("online", () => {
      emit("agent:alert", { level: "info", message: "Network online — polling now" });
      currentPollMs = BASE_POLL_MS; // reset backoff
      schedulePoll(() => doPoll(fetchStatus), 250);
    });
  }

  // “still alive” checker (UI can display ‘stale’ after 60s)
  setInterval(() => {
    const stale = Date.now() - lastPingAt > 60000; // 60s without heartbeat
    if (stale) {
      emit("agent:alert", {
        level: "info",
        message: "No heartbeat in 60s (network idle or backend slow)",
      });
    }
  }, 20000); // check every 20s
}
