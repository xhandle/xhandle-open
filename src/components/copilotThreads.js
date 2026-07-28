// src/components/copilotThreads.js
const KEY = "xhc.threads";

export function loadThreads() {
  try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; }
}
export function saveThreads(threads) {
  localStorage.setItem(KEY, JSON.stringify(threads));
}
export function newThread(title = "New topic") {
  const t = {
    id: crypto.randomUUID(),
    title,
    pinned: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    autoTitleDone: false,
    messages: [{ role: "assistant", content: "New thread. How can I help?" }],
  };
  const all = loadThreads();
  all.unshift(t);
  saveThreads(all);
  return t;
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
