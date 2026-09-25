// src/components/copilotThreads.js
const KEY = "xhc.threads";
const MAX_THREADS = 20;
const MAX_MESSAGES_PER_THREAD = 80;
// Large engineering tables routinely exceed 12k characters. Keep complete
// recent responses and let the thread-level quota perform the eventual trim.
const MAX_MESSAGE_CONTENT_CHARS = 64000;
const MAX_STORAGE_CHARS = 3_500_000;
const SESSION_FALLBACK_KEY = `${KEY}.sessionFallback`;
const REVIEW_SESSION_KEYS = [
  "xhandle.hazardVibeReview.sessions.v1",
  "xhandle.functionalVibeReview.sessions.v1",
];
let volatileThreads = null;

function unfinishedReviewThreadIds() {
  const ids = new Set();
  const storages = [];
  try { if (typeof localStorage !== "undefined") storages.push(localStorage); } catch {}
  try { if (typeof sessionStorage !== "undefined") storages.push(sessionStorage); } catch {}
  storages.forEach((storage) => REVIEW_SESSION_KEYS.forEach((key) => {
    try {
      const sessions = JSON.parse(storage.getItem(key) || "{}");
      // A thread holds a STACK of review sessions (a cascade follow-up suspends
      // its parent). Older records are a single bare session, so accept both:
      // reading only the object shape silently protected nothing, and active
      // review threads were pruned under the storage pressure a long review
      // creates -- which is precisely when their history matters most.
      Object.values(sessions || {}).forEach((value) => {
        (Array.isArray(value) ? value : [value]).forEach((session) => {
          if (!session?.threadId || ["completed", "cancelled"].includes(String(session.state || "").toLowerCase())) return;
          ids.add(String(session.threadId));
        });
      });
    } catch {}
  }));
  return ids;
}

function truncateText(value, maxChars = MAX_MESSAGE_CONTENT_CHARS) {
  const text = String(value || "");
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[Message truncated in saved history to keep local storage healthy.]`;
}

function compactMessageForStorage(message = {}, aggressive = false) {
  const next = { ...message };
  const contentLimit = aggressive ? 16000 : MAX_MESSAGE_CONTENT_CHARS;
  if (typeof next.content === "string") next.content = truncateText(next.content, contentLimit);

  // Captured screenshots/data URLs can be several MB each. They are useful for
  // the active request, but storing them in thread history quickly exceeds
  // localStorage quota and can crash the collaborator input path.
  if (typeof next.imageDataUrl === "string") {
    next.imageDataUrl = "[Image omitted from saved history]";
  }
  if (Array.isArray(next.attachments)) {
    next.attachments = next.attachments.map((attachment) => {
      if (!attachment || typeof attachment !== "object") return attachment;
      const copy = { ...attachment };
      if (typeof copy.imageDataUrl === "string" || typeof copy.dataUrl === "string") {
        delete copy.imageDataUrl;
        delete copy.dataUrl;
        copy.omittedFromHistory = true;
      }
      if (typeof copy.text === "string") copy.text = truncateText(copy.text, aggressive ? 2000 : 6000);
      return copy;
    });
  }
  if (Array.isArray(next.context)) {
    next.context = next.context.map((item) => {
      if (!item || typeof item !== "object") return item;
      const copy = { ...item };
      if (typeof copy.imageDataUrl === "string" || typeof copy.dataUrl === "string") {
        delete copy.imageDataUrl;
        delete copy.dataUrl;
        copy.omittedFromHistory = true;
      }
      if (typeof copy.text === "string") copy.text = truncateText(copy.text, aggressive ? 2000 : 6000);
      if (typeof copy.tableMarkdown === "string") copy.tableMarkdown = truncateText(copy.tableMarkdown, aggressive ? 3000 : 8000);
      return copy;
    });
  }
  return next;
}

function sortThreadsForRetention(threads = []) {
  return [...(Array.isArray(threads) ? threads : [])].sort((a, b) => {
    if (Boolean(a?.pinned) !== Boolean(b?.pinned)) return a?.pinned ? -1 : 1;
    return Number(b?.updatedAt || b?.createdAt || 0) - Number(a?.updatedAt || a?.createdAt || 0);
  });
}

function compactThreadsForStorage(threads = [], aggressive = false) {
  const threadLimit = aggressive ? 8 : MAX_THREADS;
  const messageLimit = aggressive ? 30 : MAX_MESSAGES_PER_THREAD;
  const protectedIds = unfinishedReviewThreadIds();
  const sorted = sortThreadsForRetention(threads);
  const protectedThreads = sorted.filter((thread) => protectedIds.has(String(thread?.id || "")));
  const otherThreads = sorted.filter((thread) => !protectedIds.has(String(thread?.id || "")));
  const retained = [...protectedThreads, ...otherThreads.slice(0, Math.max(0, threadLimit - protectedThreads.length))];
  return retained.map((thread) => {
    const messages = Array.isArray(thread?.messages) ? thread.messages : [];
    return {
      ...thread,
      title: truncateText(thread?.title || "New topic", 160),
      messages: messages.slice(-messageLimit).map((message) => compactMessageForStorage(message, aggressive)),
    };
  });
}

function serializeThreadsForStorage(threads = [], aggressive = false) {
  let compacted = compactThreadsForStorage(threads, aggressive);
  let serialized = JSON.stringify(compacted);
  while (serialized.length > MAX_STORAGE_CHARS && compacted.length > 1) {
    const protectedIds = unfinishedReviewThreadIds();
    const protectedCount = compacted.filter((thread) => protectedIds.has(String(thread?.id || ""))).length;
    const nextLength = Math.max(protectedCount, Math.max(1, compacted.length - 2));
    if (nextLength >= compacted.length) break;
    compacted = compactThreadsForStorage(compacted.slice(0, nextLength), true);
    serialized = JSON.stringify(compacted);
  }
  if (serialized.length > MAX_STORAGE_CHARS) {
    compacted = compactThreadsForStorage(compacted, true);
    serialized = JSON.stringify(compacted);
  }
  return { compacted, serialized };
}

export function loadThreads() {
  const read = (storage, key) => {
    try {
      const raw = storage?.getItem(key);
      if (raw == null) return null;
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  };
  // Each fallback is a complete snapshot, not a partial overlay. Prefer the
  // newest in-process snapshot, then this tab's session snapshot, then the
  // durable origin snapshot. This also preserves thread deletions.
  if (Array.isArray(volatileThreads)) return sortThreadsForRetention(volatileThreads);
  const tabSnapshot = read(typeof sessionStorage !== "undefined" ? sessionStorage : null, SESSION_FALLBACK_KEY);
  if (tabSnapshot) return sortThreadsForRetention(tabSnapshot);
  return sortThreadsForRetention(read(typeof localStorage !== "undefined" ? localStorage : null, KEY) || []);
}
export function saveThreads(threads) {
  if (typeof localStorage === "undefined") return compactThreadsForStorage(threads);
  let prepared = serializeThreadsForStorage(threads);
  try {
    localStorage.setItem(KEY, prepared.serialized);
    try { sessionStorage?.removeItem(SESSION_FALLBACK_KEY); } catch {}
    volatileThreads = null;
    return prepared.compacted;
  } catch (error) {}

  prepared = serializeThreadsForStorage(threads, true);
  try {
    localStorage.setItem(KEY, prepared.serialized);
    try { sessionStorage?.removeItem(SESSION_FALLBACK_KEY); } catch {}
    volatileThreads = null;
    return prepared.compacted;
  } catch {
    try {
      sessionStorage?.setItem(SESSION_FALLBACK_KEY, prepared.serialized);
      volatileThreads = null;
      return prepared.compacted;
    } catch {}
  }

  // Last-resort recovery keeps the active queue and its newest card available
  // for this tab even when the origin has exhausted both browser stores.
  const fallback = compactThreadsForStorage(threads, true).slice(0, 3).map((thread) => ({
    ...thread,
    messages: (thread.messages || []).slice(-10),
  }));
  volatileThreads = fallback;
  return fallback;
}
export function newThread(title = "New topic", options = {}) {
  const greeting = String(options?.greeting || "").trim() || "New thread. How can I help?";
  const t = {
    id: crypto.randomUUID(),
    title,
    pinned: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    autoTitleDone: false,
    messages: [{ role: "assistant", content: greeting }],
  };
  const all = loadThreads();
  all.unshift(t);
  saveThreads(all);
  return t;
}
export function ensureThread(id, title = "Recovered review", options = {}) {
  const threadId = String(id || "").trim();
  if (!threadId) return null;
  const all = loadThreads();
  const existing = all.find((thread) => String(thread?.id || "") === threadId);
  if (existing) return existing;
  const greeting = String(options?.greeting || "").trim()
    || "This Collaborator thread was restored from an unfinished review session. Resume the review to continue where you left off.";
  const restored = {
    id: threadId,
    title: String(title || "Recovered review").trim() || "Recovered review",
    pinned: false,
    protectedByReview: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    autoTitleDone: true,
    messages: [{ role: "assistant", content: greeting }],
  };
  all.unshift(restored);
  saveThreads(all);
  return restored;
}
export function renameThread(id, title) {
  const all = loadThreads();
  const i = all.findIndex(t => t.id === id);
  if (i >= 0) { all[i].title = title || all[i].title; all[i].updatedAt = Date.now(); saveThreads(all); }
}
export function deleteThread(id) {
  const all = loadThreads().filter(t => t.id !== id);
  saveThreads(all);
}
export function togglePin(id) {
  const all = loadThreads();
  const i = all.findIndex(t => t.id === id);
  if (i >= 0) { all[i].pinned = !all[i].pinned; all[i].updatedAt = Date.now(); saveThreads(all); }
}
export function appendMessage(id, msg) {
  const all = loadThreads();
  const i = all.findIndex(t => t.id === id);
  if (i >= 0) {
    all[i].messages.push(msg);
    all[i].updatedAt = Date.now();
    saveThreads(all);
    return all[i];
  }
  return null;
}
export function setMessages(id, messages) {
  const all = loadThreads();
  const i = all.findIndex(t => t.id === id);
  if (i >= 0) {
    all[i].messages = messages;
    all[i].updatedAt = Date.now();
    saveThreads(all);
  }
}
