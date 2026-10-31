import {useCallback, useLayoutEffect, useMemo, useRef, useState} from 'react';
import HazardRowHeightIndex from './hazardRowHeightIndex';

const ROW_HEIGHT = 160;
const GROUP_HEIGHT = 48;
const OVERSCAN = 600;
const PREFETCH_ROWS = 150;
const EMPTY = [];

function bodyOrigin(table) {
  const body = table?.tBodies?.[0];
  if (!body) return 0;
  return Math.max(0, (body.getBoundingClientRect().top - table.getBoundingClientRect().top) || 0);
}

// The model contains only group labels and source row coordinates. Cells are
// supplied independently by a bounded cache; filling that cache never rebuilds
// the full scroll geometry. Measured row heights are small numeric metadata.
export default function useContinuousHazardRowWindow(
  groups, collapsed, columns, widths, tableRef, datasetKey, {enabled = true, rowsByIndex} = {},
) {
  const [viewport, setViewport] = useState({top: 0, height: 800});
  const [measurementRevision, setMeasurementRevision] = useState(0);
  const measured = useRef(new Map());
  const current = useRef(null), anchor = useRef(null), pending = useRef(null);
  const scrollCorrection = useRef(null);
  const measurementFrame = useRef(null), measurementCommitPending = useRef(false);
  const model = useMemo(() => {
    const entries = [], byKey = new Map(), byRow = new Map(), heights = [];
    const add = entry => {
      const index = entries.length;
      entries.push(entry);
      byKey.set(entry.key, index);
      if (entry.item) byRow.set(entry.item.rowIndex, index);
      const saved = measured.current.get(entry.key);
      heights.push(saved?.datasetKey === datasetKey && saved.columns === columns && saved.widths === widths
        ? saved.height : entry.item ? ROW_HEIGHT : GROUP_HEIGHT);
    };
    if (enabled) for (const group of groups) {
      const parentKey = `group:${group.key}`;
      add({key: parentKey, group});
      if (!collapsed.has(group.key)) for (const item of group.items) {
        add({key: `row:${item.rowIndex}`, parentKey, item});
      }
    }
    return {entries, byKey, byRow, heights: new HazardRowHeightIndex(heights), datasetKey};
  }, [enabled, groups, collapsed, columns, widths, datasetKey]);

  const sameDataset = enabled && current.current?.model.datasetKey === datasetKey;
  let retained = sameDataset ? anchor.current : null;
  if (retained && !model.byKey.has(retained.key)) {
    const old = current.current.model;
    const index = old.byKey.get(retained.key);
    const previous = old.entries[index];
    const parentIndex = model.byKey.get(previous?.parentKey);
    let replacement = parentIndex == null ? null : model.entries[parentIndex];
    // Reconciliation happens only when group membership changes, never on a
    // scroll frame. Prefer the collapsed parent, then a surviving nearby row.
    if (!replacement) {
      for (let i = (index ?? -1) + 1; i < old.entries.length && !replacement; i++) {
        const found = model.byKey.get(old.entries[i].key);
        if (found != null) replacement = model.entries[found];
      }
      for (let i = (index ?? old.entries.length) - 1; i >= 0 && !replacement; i--) {
        const found = model.byKey.get(old.entries[i].key);
        if (found != null) replacement = model.entries[found];
      }
    }
    retained = replacement ? {key: replacement.key, delta: 0} : null;
  }
  const retainedIndex = retained ? model.byKey.get(retained.key) : null;
  const delta = retainedIndex == null ? 0 : Math.max(0, Math.min(retained.delta, model.heights.heights[retainedIndex] - 1));
  if (retainedIndex != null && delta !== retained.delta) {
    const saved = measured.current.get(retained.key);
    // Estimated heights only keep a resized row mounted. Permanently clip the
    // reader's offset only after that row is measured with the current columns.
    if (saved?.datasetKey === datasetKey && saved.columns === columns && saved.widths === widths) {
      retained = {...retained, delta};
    }
  }
  const requestedTop = retained?.atEnd
    ? Math.max(0, model.heights.total - viewport.height)
    : retainedIndex == null ? (sameDataset ? viewport.top : 0) : model.heights.offset(retainedIndex) + delta;
  const top = Math.max(0, Math.min(requestedTop, Math.max(0, model.heights.total - viewport.height)));
  const start = model.heights.indexAt(Math.max(0, top - OVERSCAN));
  const end = model.entries.length ? Math.min(model.entries.length, model.heights.indexAt(top + viewport.height + OVERSCAN) + 1) : 0;
  const visible = useMemo(() => {
    let offset = model.heights.offset(start);
    return model.entries.slice(start, end).map((entry, i) => {
      const height = model.heights.heights[start + i];
      const result = {...entry, offset, height, index: start + i};
      offset += height;
      return result;
    });
    // Measurements mutate the prefix index in place, without replacing entries.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, start, end, measurementRevision]);
  const visibleKey = visible.map(entry => entry.key).join('|');
  const viewportStart = model.heights.indexAt(top);
  const lastViewportEntry = model.heights.indexAt(top + viewport.height);
  const viewportEnd = model.entries.length ? Math.min(model.entries.length,
    lastViewportEntry + (model.heights.offset(lastViewportEntry) < top + viewport.height ? 1 : 0)) : 0;
  const viewportRowIndices = useMemo(() => {
    if (!enabled) return EMPTY;
    const result = [];
    for (let index = viewportStart; index < viewportEnd; index++) {
      const item = model.entries[index].item;
      if (item) result.push(item.rowIndex);
    }
    return result;
  }, [enabled, model, viewportStart, viewportEnd]);
  const requestedRowIndices = useMemo(() => {
    if (!enabled) return EMPTY;
    const result = viewportRowIndices.slice(0, PREFETCH_ROWS);
    const add = index => {
      const item = model.entries[index]?.item;
      if (item && result.length < PREFETCH_ROWS) result.push(item.rowIndex);
    };
    // Actual viewport cells must outrank overscan: unusually large offscreen
    // cells must not consume the cache budget before the user's visible rows.
    let left = viewportStart - 1, right = viewportEnd;
    while (result.length < PREFETCH_ROWS && (left >= start || right < end)) {
      if (right < end) add(right++);
      if (left >= start) add(left--);
    }
    // Then prefetch nearby coordinates in both directions.
    let before = start - 1, after = end, scanned = 0;
    while (result.length < PREFETCH_ROWS && scanned < PREFETCH_ROWS * 2 && (before >= 0 || after < model.entries.length)) {
      for (const index of [after++, before--]) {
        const item = model.entries[index]?.item;
        if (item && result.length < PREFETCH_ROWS) result.push(item.rowIndex);
      }
      scanned += 2;
    }
    return result;
  }, [enabled, model, start, end, viewportStart, viewportEnd, viewportRowIndices]);

  useLayoutEffect(() => {
    if (!enabled) { current.current = null; anchor.current = null; pending.current = null; scrollCorrection.current = null; return; }
    const root = tableRef.current?.parentElement;
    if (!sameDataset) {
      measured.current.clear();
      pending.current = null;
      scrollCorrection.current = null;
      setViewport({top: 0, height: root?.clientHeight || 800});
    }
    current.current = {model};
    anchor.current = retained;
    if (pending.current && !model.byKey.has(pending.current.key)) pending.current = null;
    if (root) {
      const scrollTop = retained?.atEnd && root.clientHeight > 0
        ? Math.max(0, root.scrollHeight - root.clientHeight)
        : top ? top + bodyOrigin(tableRef.current) : 0;
      if (Math.abs(root.scrollTop - scrollTop) > 1) root.scrollTop = scrollTop;
      scrollCorrection.current = root.scrollTop;
    }
  }, [enabled, tableRef, model, sameDataset, retained, top]);

  const captureViewport = useCallback(() => {
    const latest = current.current?.model, table = tableRef.current, root = table?.parentElement;
    if (!latest || !root) return null;
    const contentTop = Math.max(0, root.scrollTop - bodyOrigin(table));
    const index = latest.heights.indexAt(contentTop), entry = latest.entries[index];
    const height = root.clientHeight || 800;
    // A thumb dragged to the end means "show the final row", not "keep the
    // old first visible row". Newly loaded variable-height rows can otherwise
    // leave the last rows below the viewport while the scrollbar settles.
    const nativeMaximum = root.scrollHeight - root.clientHeight;
    const atEnd = root.clientHeight > 0 && nativeMaximum > 0
      ? Math.abs(root.scrollTop - nativeMaximum) < 0.5
      : latest.heights.total > height && contentTop >= latest.heights.total - height - 0.5;
    // A browser scroll event also follows our own temporary estimated-height
    // correction. It must not replace a retained logical offset (e.g.1500px)
    // with the estimate's clipped position (e.g.159px) before actual measurement.
    if (scrollCorrection.current == null || Math.abs(root.scrollTop - scrollCorrection.current) >= 0.5) {
      scrollCorrection.current = null;
      anchor.current = entry ? {key: entry.key, delta: contentTop - latest.heights.offset(index), atEnd} : null;
    }
    return {top: contentTop, height};
  }, [tableRef]);
  const update = useCallback(() => {
    const next = captureViewport();
    if (next) setViewport(previous => previous.top === next.top && previous.height === next.height ? previous : next);
  }, [captureViewport]);

  const hasEntries = model.entries.length > 0;
  useLayoutEffect(() => {
    if (!enabled) return undefined;
    const root = tableRef.current?.parentElement;
    if (!root) return undefined;
    let frame;
    const schedule = () => {
      // A storage response can commit before the next animation frame. Capture
      // the user's actual anchor now so that commit cannot move scrolling back.
      captureViewport();
      if (!frame) frame = requestAnimationFrame(() => { frame = null; update(); });
    };
    root.addEventListener('scroll', schedule, {passive: true});
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    observer?.observe(root);
    update();
    return () => { root.removeEventListener('scroll', schedule); observer?.disconnect(); cancelAnimationFrame(frame); };
  }, [enabled, tableRef, update, captureViewport, hasEntries]);

  const reveal = useCallback((rowIndex, onReady) => {
    const latest = current.current?.model, root = tableRef.current?.parentElement;
    const index = latest?.byRow.get(rowIndex);
    if (index == null || !root) return false;
    const key = latest.entries[index].key;
    anchor.current = {key, delta: 0};
    pending.current = {key, datasetKey: latest.datasetKey, onReady};
    setViewport({top: latest.heights.offset(index), height: root.clientHeight || 800});
    return true;
  }, [tableRef]);

  const finishReveal = useCallback(() => {
    const request = pending.current, latest = current.current?.model;
    if (!request || !latest || measurementFrame.current != null || measurementCommitPending.current) return;
    if (request.datasetKey !== latest.datasetKey || !latest.byKey.has(request.key)) { pending.current = null; return; }
    const element = Array.from(tableRef.current?.querySelectorAll('tbody > tr[data-window-key]:not([data-hazard-loading-row])') || [])
      .find(row => row.dataset.windowKey === request.key);
    if (element) { pending.current = null; request.onReady?.(element); }
  }, [tableRef]);

  useLayoutEffect(() => {
    if (!enabled) return undefined;
    const table = tableRef.current;
    if (!table) return undefined;
    let active = true, frame = null;
    const measure = () => {
      const completedFrame = frame;
      frame = null;
      if (!active || current.current?.model !== model) return;
      if (measurementFrame.current === completedFrame) measurementFrame.current = null;
      // Preserve an explicit row target while an estimated end position is
      // clamped; measurements can then move that target into the viewport.
      if (!pending.current) captureViewport();
      let changed = false;
      table.querySelectorAll('tbody > tr[data-window-key]:not([data-hazard-loading-row])').forEach(row => {
        const key = row.dataset.windowKey, index = model.byKey.get(key);
        if (index == null) return;
        const height = row.getBoundingClientRect().height;
        if (!(height > 0)) return;
        measured.current.set(key, {height, columns, widths, datasetKey});
        if (Math.abs(model.heights.heights[index] - height) > 1) {
          model.heights.set(index, height);
          changed = true;
        }
      });
      if (changed) {
        measurementCommitPending.current = true;
        setMeasurementRevision(value => value + 1);
      } else finishReveal();
    };
    const schedule = () => {
      if (!active || frame != null) return;
      frame = requestAnimationFrame(measure);
      measurementFrame.current = frame;
    };
    // Measuring and publishing during the layout commit recursively rerenders
    // when a changed window wraps differently or reveals more estimated rows.
    // Do both together once per animation frame so React can finish its commit.
    schedule();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    table.querySelectorAll('tbody > tr[data-window-key]:not([data-hazard-loading-row])').forEach(row => observer?.observe(row));
    return () => {
      active = false;
      observer?.disconnect();
      cancelAnimationFrame(frame);
      if (measurementFrame.current === frame) measurementFrame.current = null;
    };
  }, [enabled, tableRef, model, columns, widths, datasetKey, visibleKey, rowsByIndex, captureViewport, finishReveal]);

  useLayoutEffect(() => {
    measurementCommitPending.current = false;
    if (enabled) finishReveal();
  });
  useLayoutEffect(() => () => { pending.current = null; scrollCorrection.current = null; }, []);

  const first = visible[0]?.offset || 0, last = visible[visible.length - 1];
  return {
    visible, top: first, bottom: last ? Math.max(0, model.heights.total - last.offset - last.height) : 0,
    reveal, revision: visibleKey, preparing: false, error: null,
    requestedRowIndices, viewportRowIndices, totalEntries: model.entries.length,
  };
}
