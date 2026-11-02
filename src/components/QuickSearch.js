import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search } from 'lucide-react';
import { QUICK_SEARCH_COLLECT, filterSearchEntries, tableSearchEntries } from './quickSearchUtils';
import './quickSearch.css';
import QuickSearchResults from './QuickSearchResults';
import { diagramNavigatorGroups, diagramNavigatorRows } from './diagramNavigator';

const isFindShortcut = event => (event.metaKey || event.ctrlKey)
  && !event.shiftKey && !event.altKey && event.key?.toLowerCase() === 'f';

export default function QuickSearch() {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState([]);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [expanded, setExpanded] = useState(() => new Set());
  const inputRef = useRef(null);
  const returnFocus = useRef(null);
  const dialogRef = useRef(null);
  const pendingKeyAction = useRef(null);
  const findTimer = useRef(null);
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  const shortcut = mac ? '⌘F' : 'Ctrl+F';
  const matches = useMemo(() => filterSearchEntries(entries, query), [entries, query]);
  const groups = useMemo(() => diagramNavigatorGroups(entries), [entries]);
  const browse = !query.trim() && groups.length > 0;
  const results = useMemo(() => browse ? diagramNavigatorRows(groups, expanded) : matches, [browse, groups, expanded, matches]);
  const close = () => {
    pendingKeyAction.current = null;
    clearTimeout(findTimer.current);
    findTimer.current = null;
    setOpen(false);
    setEntries([]);
    returnFocus.current?.focus?.({ preventScroll: true });
  };
  const show = useCallback(() => {
    returnFocus.current = document.activeElement;
    const collected = tableSearchEntries();
    window.dispatchEvent(new CustomEvent(QUICK_SEARCH_COLLECT, { detail: { entries: collected } }));
    setEntries(collected);
    setExpanded(new Set());
    setQuery('');
    setActive(0);
    setOpen(true);
  }, []);
  const scheduleFind = useCallback(() => {
    if (findTimer.current !== null) return;
    // macOS can omit F's keyup while Command is held. Defer past keydown
    // instead of relying on keyup, keeping Safari's input inspection safe.
    findTimer.current = setTimeout(() => {
      findTimer.current = null;
      if (inputRef.current) inputRef.current.focus();
      else show();
    }, 0);
  }, [show]);
  useEffect(() => {
    const onKeyDown = event => {
      if (event.isComposing || !isFindShortcut(event)) return;
      event.preventDefault();
      if (!event.repeat) scheduleFind();
    };
    const cancel = () => {
      clearTimeout(findTimer.current);
      findTimer.current = null;
      pendingKeyAction.current = null;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('blur', cancel);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('blur', cancel);
      cancel();
    };
  }, [scheduleFind]);
  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);
  const toggleGroup = (entry, index) => {
    setActive(index);
    setExpanded(current => {
      const next = new Set(current);
      if (next.has(entry.id)) next.delete(entry.id); else next.add(entry.id);
      return next;
    });
  };
  const choose = (entry, index = active) => {
    if (entry.group) { toggleGroup(entry, index); return; }
    close(); entry.activate(query);
  };
  return <>
    <button type="button" onClick={show} title={`Quick search (${shortcut})`}
      aria-label="Quick search" aria-keyshortcuts="Meta+F Control+F"
      className="inline-flex items-center gap-2 h-8 px-3 rounded-md border text-xs text-gray-700 dark:text-zinc-100">
      <Search size={15} /><span className="hidden sm:inline">Search</span><kbd>{shortcut}</kbd>
    </button>
    {open && createPortal(
      <div data-quick-search className="fixed inset-0 z-[100000] flex items-start justify-center bg-black/30 p-4 pt-[12vh]"
        onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
        <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="quick-search-title"
          className="w-full max-w-2xl rounded-xl border bg-white text-gray-900 shadow-2xl dark:bg-zinc-900 dark:text-zinc-100"
          onKeyDown={event => {
            // Search keystrokes must not reach the canvas's delete/selection
            // shortcuts or other keyboard handlers behind the modal.
            event.stopPropagation();
            if (event.nativeEvent.isComposing) return;
            if (event.key === 'Escape') {
              event.preventDefault();
              pendingKeyAction.current = { key: event.key, run: close };
            }
            if (isFindShortcut(event)) {
              event.preventDefault();
              if (!event.repeat) scheduleFind();
            }
            if (event.key === 'Tab') {
              const focusable = Array.from(dialogRef.current.querySelectorAll('input, button'));
              const index = focusable.indexOf(document.activeElement);
              const next = (index + (event.shiftKey ? -1 : 1) + focusable.length) % focusable.length;
              event.preventDefault();
              pendingKeyAction.current = { key: event.key, run: () => focusable[next]?.focus() };
            }
          }}
          onKeyUp={event => {
            // The canvas can receive a modifier press before Cmd/Ctrl+F opens
            // search. Let its release clear zoom/selection state even though
            // focus moved here; keep typing and action keys inside the dialog.
            if (['Meta', 'Control', 'Shift', 'Alt'].includes(event.key)) return;
            event.stopPropagation();
            const pending = pendingKeyAction.current;
            if (!pending || pending.key !== event.key) return;
            pendingKeyAction.current = null;
            if (event.nativeEvent.isComposing) return;
            event.preventDefault();
            pending.run();
          }}>
          <div className="p-4 border-b">
            <div className="flex items-center justify-between mb-3">
              <h2 id="quick-search-title" className="font-semibold">Quick search</h2>
              <button type="button" onClick={close} className="text-sm border rounded px-2 py-1">Close · Esc</button>
            </div>
            <input ref={inputRef} type="search" name="xhandle-quick-search"
              autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false} value={query}
              onChange={event => { setQuery(event.target.value); setActive(0); }}
              onKeyDown={event => {
                if (event.nativeEvent.isComposing) return;
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault();
                  setActive(index => results.length ? (index + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length : 0);
                }
                if (['Home', 'End'].includes(event.key) && !query && results.length) {
                  event.preventDefault();
                  setActive(event.key === 'Home' ? 0 : results.length - 1);
                }
                if (browse && ['ArrowLeft', 'ArrowRight'].includes(event.key) && results[active]) {
                  event.preventDefault();
                  const entry = results[active];
                  if (entry.group) {
                    if (entry.expanded !== (event.key === 'ArrowRight')) toggleGroup(entry, active);
                    else if (entry.expanded && event.key === 'ArrowRight') setActive(active + 1);
                  } else if (event.key === 'ArrowLeft') setActive(results.findIndex(row => row.id === entry.parentId));
                }
                if (event.key === 'Enter' && results[active]) {
                  event.preventDefault();
                  const entry = results[active];
                  pendingKeyAction.current = { key: event.key, run: () => choose(entry) };
                }
              }}
              role="combobox" aria-label="Search current view" aria-expanded="true"
              aria-haspopup={browse ? 'tree' : 'listbox'}
              aria-controls="quick-search-results" aria-autocomplete="list"
              aria-activedescendant={results[active] ? `quick-search-result-${active}` : undefined}
              placeholder="Search tables and diagram elements…"
              className="w-full rounded-lg border px-3 py-2 bg-transparent" />
            <p className="mt-2 text-xs text-gray-500">{groups.length ? 'Browse diagram elements or type to search. ← → expand or collapse. ' : 'Search the current view. Table filters and collapsed groups are respected. '}↑ ↓ to navigate; Enter to jump.</p>
          </div>
          <div role="status" className="px-4 py-2 text-xs text-gray-500">
            {browse ? `Diagram navigator · ${groups.reduce((count, group) => count + group.entries.length, 0)} elements` : !query.trim() ? 'Type to search.' : `${matches.length} matches`}
          </div>
          <QuickSearchResults rows={results} active={active} browse={browse} onChoose={choose} resetKey={query} />
        </div>
      </div>, document.body)}
  </>;
}
