// src/utils/copilotContextBus.js
const KEY = "xhandle.copilotRegionContext";

export function pushRegionContext(payload) {
  try {
    const arr = JSON.parse(localStorage.getItem(KEY) || "[]");
    arr.push(payload);
    localStorage.setItem(KEY, JSON.stringify(arr));
  } catch {}
}

export function popAllRegionContext() {
  try {
    const arr = JSON.parse(localStorage.getItem(KEY) || "[]");
    localStorage.removeItem(KEY);
    return arr;
  } catch {
    return [];
  }
}
