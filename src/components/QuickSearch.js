import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search } from 'lucide-react';
import { QUICK_SEARCH_COLLECT, filterSearchEntries, tableSearchEntries } from './quickSearchUtils';
import './quickSearch.css';

const isFindShortcut = event => (event.metaKey || event.ctrlKey)
  && !event.shiftKey && !event.altKey && event.key?.toLowerCase() === 'f';

export default function QuickSearch() {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState([]);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const returnFocus = useRef(null);
  const dialogRef = useRef(null);
  const resultsRef = useRef(null);
  const pendingKeyAction = useRef(null);
  const findTimer = useRef(null);
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  const shortcut = mac ? '⌘F' : 'Ctrl+F';
  const matches = useMemo(() => filterSearchEntries(entries, query), [entries, query]);
  const results = matches.slice(0, 100);
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
  useLayoutEffect(() => {
    if (resultsRef.current) resultsRef.current.scrollTop = 0;
  }, [query, open]);
  useLayoutEffect(() => {
    const list = resultsRef.current;
    const option = list?.querySelector('[aria-selected="true"]');
    if (!option) return;
    const bounds = list.getBoundingClientRect();
    const item = option.getBoundingClientRect();
    // scrollIntoView may scroll ancestors, including the page behind the modal.
    // Adjust only this list so search navigation cannot move the canvas/page.
    if (item.top < bounds.top) list.scrollTop -= bounds.top - item.top;
    else if (item.bottom > bounds.bottom) list.scrollTop += item.bottom - bounds.bottom;
  }, [active, matches, open]);

  const choose = entry => { close(); entry.activate(query); };
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
                if (event.key === 'Enter' && results[active]) {
                  event.preventDefault();
                  const entry = results[active];
                  pendingKeyAction.current = { key: event.key, run: () => choose(entry) };
                }
              }}
              role="combobox" aria-label="Search current view" aria-expanded="true"
              aria-controls="quick-search-results" aria-autocomplete="list"
              aria-activedescendant={results[active] ? `quick-search-result-${active}` : undefined}
              placeholder="Search tables and diagram elements…"
              className="w-full rounded-lg border px-3 py-2 bg-transparent" />
            <p className="mt-2 text-xs text-gray-500">Search the current view. Table filters and collapsed groups are respected. ↑ ↓ to navigate; Enter to jump.</p>
          </div>
          <div role="status" className="px-4 py-2 text-xs text-gray-500">
            {!query.trim() ? 'Type to search.' : `${matches.length} matches${matches.length > 100 ? ' — showing the first 100; refine your search for more.' : ''}`}
          </div>
          <ul ref={resultsRef} id="quick-search-results" role="listbox" aria-label="Search results" className="max-h-[50vh] overflow-auto p-2">
            {results.map((entry, index) => <li key={entry.id} id={`quick-search-result-${index}`}
              role="option" aria-selected={index === active}
              onMouseDown={event => event.preventDefault()} onClick={() => choose(entry)}
              className={`cursor-pointer rounded-lg p-3 ${index === active ? 'bg-blue-50 text-blue-900 dark:bg-blue-950 dark:text-blue-100' : ''}`}>
              <div className="text-xs font-semibold">{entry.kind} · {entry.label}</div>
              <div className="mt-1 text-sm line-clamp-2">{entry.text.slice(0, 600)}</div>
            </li>)}
          </ul>
        </div>
      </div>, document.body)}
  </>;
}
