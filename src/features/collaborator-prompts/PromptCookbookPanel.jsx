import React, {useCallback, useEffect, useId, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {BookOpen, Search, Sparkles, X} from 'lucide-react';
import {PROMPT_COOKBOOK, COOKBOOK_WORKFLOW_NOTE, searchCookbook, suggestCookbookPrompt} from './promptCookbook';

export default function PromptCookbookPanel({open, onClose, onUse, context = {}, requestSuggestion, returnFocusRef}) {
  const [tab, setTab] = useState('browse');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [goal, setGoal] = useState('');
  const [detail, setDetail] = useState('');
  const [preview, setPreview] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const dialogRef = useRef(null), requestRef = useRef(null), sequence = useRef(0);
  const scopeKey = JSON.stringify(context), latestScope = useRef(scopeKey);
  latestScope.current = scopeKey;
  const titleId = useId(), panelId = useId();
  const results = searchCookbook(search, category);
  const cancel = useCallback(() => { sequence.current++; requestRef.current?.abort(); requestRef.current = null; setPending(false); }, []);
  const close = useCallback(() => { cancel(); onClose(); }, [cancel, onClose]);

  useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const previousFocus = document.activeElement;
    dialogRef.current?.querySelector('[data-cookbook-initial]')?.focus();
    const onKey = event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
      if (event.key !== 'Tab') return;
      const controls = [...dialogRef.current.querySelectorAll('button:not(:disabled),input,select,textarea,[tabindex="0"]')].filter(el => el.tabIndex >= 0);
      const first = controls[0], last = controls.at(-1);
      if (!dialogRef.current.contains(document.activeElement)) { event.preventDefault(); first?.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      sequence.current++; requestRef.current?.abort(); requestRef.current = null;
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKey, true);
      const target = returnFocusRef?.current || previousFocus;
      if (target?.isConnected) target.focus();
    };
  }, [open, close, returnFocusRef]);

  useEffect(() => { if (!open) { sequence.current++; requestRef.current?.abort(); setPending(false); } }, [open]);
  useEffect(() => {
    sequence.current++; requestRef.current?.abort(); requestRef.current = null; setPending(false);
  }, [scopeKey]);

  const changeTab = next => { cancel(); setTab(next); setError(''); };
  const choose = recipe => {
    cancel(); setResult({kind: 'suggestion', recipe, explanation: recipe.description, scopeKey, origin: 'browse'}); setPreview(recipe.prompt); setError('');
  };
  async function suggest() {
    requestRef.current?.abort();
    const controller = new AbortController(), version = ++sequence.current, scopeAtStart = scopeKey;
    requestRef.current = controller; setPending(true); setError('');
    try {
      const response = await suggestCookbookPrompt({goal, clarification: result?.kind === 'clarification' ? {question: result.question, answer: detail} : undefined, context, request: requestSuggestion, signal: controller.signal});
      if (version !== sequence.current || controller.signal.aborted || latestScope.current !== scopeAtStart) return;
      setResult({...response, scopeKey: scopeAtStart, origin: 'helper', goal, detail});
      if (response.kind === 'suggestion') setPreview(response.prompt);
    } catch (failure) {
      if (version !== sequence.current || controller.signal.aborted) return;
      setError(`Could not prepare a suggestion. ${String(failure?.message || 'Try again or browse the cookbook.').slice(0, 400)} Your conversation draft is unchanged.`);
    } finally { if (version === sequence.current) { setPending(false); requestRef.current = null; } }
  }
  if (!open) return null;
  const stale = result && result.scopeKey !== scopeKey;
  const goalStale = result?.kind === 'suggestion' && result.origin === 'helper' && (result.goal !== goal || result.detail !== detail);
  const canUse = result?.kind === 'suggestion' && preview.trim() && !pending && !stale && !goalStale;
  const contextParts = [context.project, context.view, context.tab, context.method].filter(Boolean);
  const tabs = [['browse', 'Browse prompts'], ['help', 'Help me write a prompt']];
  return createPortal(<div className="fixed inset-0 z-[1250] flex items-center justify-center bg-black/50 p-3 sm:p-5" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
    <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} className="flex max-h-[calc(100dvh-2rem)] w-full max-w-5xl min-w-0 flex-col overflow-hidden rounded-xl border border-slate-300 bg-white text-slate-900 shadow-2xl">
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 p-4">
        <div><h2 id={titleId} className="flex items-center gap-2 text-lg font-semibold"><BookOpen className="h-5 w-5" />Prompt Cookbook</h2><p className="mt-1 text-sm text-slate-600">Find a useful starting point, then edit the prompt before sending.</p></div>
        <button type="button" aria-label="Close Prompt Cookbook" onClick={close} className="rounded-md border border-slate-300 p-2 text-slate-600 hover:bg-slate-100"><X className="h-4 w-4" /></button>
      </header>
      <div className="shrink-0 border-b border-slate-200 px-4 py-3">
        <div role="tablist" aria-label="Prompt Cookbook tools" className="flex flex-wrap gap-2">{tabs.map(([id, label], index) => <button type="button" key={id} role="tab" id={`${panelId}-${id}-tab`} aria-controls={`${panelId}-${id}`} aria-selected={tab === id} tabIndex={tab === id ? 0 : -1} onClick={() => changeTab(id)} onKeyDown={event => {
          const target = event.key === 'ArrowRight' ? (index + 1) % 2 : event.key === 'ArrowLeft' ? (index + 1) % 2 : event.key === 'Home' ? 0 : event.key === 'End' ? 1 : null;
          if (target !== null) { event.preventDefault(); changeTab(tabs[target][0]); document.getElementById(`${panelId}-${tabs[target][0]}-tab`)?.focus(); }
        }} className={`rounded-md border px-3 py-2 text-sm ${tab === id ? 'border-indigo-400 bg-indigo-50 text-indigo-800' : 'border-slate-200 hover:bg-slate-50'}`}>{label}</button>)}</div>
        <p className="mt-2 break-words text-xs text-slate-600" aria-label="Prompt workspace context">{contextParts.length ? `Current workspace: ${[...new Set(contextParts)].join(' · ')}` : 'Open the relevant project and view when your task depends on saved data.'}{context.selections?.length ? ` · ${context.selections.length} selected reference${context.selections.length === 1 ? '' : 's'}` : ''}</p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
        <div role="tabpanel" id={`${panelId}-${tab}`} aria-labelledby={`${panelId}-${tab}-tab`}>
          {tab === 'browse' ? <>
            <div className="mb-3 flex flex-wrap items-end gap-3">
              <label className="min-w-0 flex-[1_1_240px] text-sm"><span className="mb-1 flex items-center gap-1"><Search className="h-4 w-4" />Search prompts</span><input data-cookbook-initial type="search" value={search} onChange={event => setSearch(event.target.value)} className="w-full rounded-md border border-slate-300 bg-white px-3 py-2" placeholder="Try connectivity, ownership, or hazard review" /></label>
              <label className="min-w-0 max-w-full flex-[1_1_220px] text-sm">Category<select aria-label="Cookbook category" value={category} onChange={event => setCategory(event.target.value)} className="mt-1 block w-full max-w-full rounded-md border border-slate-300 bg-white px-3 py-2"><option value="">All categories</option>{PROMPT_COOKBOOK.map(group => <option key={group.id} value={group.id}>{group.title}</option>)}</select></label>
            </div>
            <p role="status" className="mb-2 text-xs text-slate-600">{results.length} matching prompt{results.length === 1 ? '' : 's'}</p>
            <div className="grid max-h-64 gap-2 overflow-y-auto rounded-md border border-slate-200 p-2 sm:grid-cols-2">{results.map(recipe => <button type="button" key={recipe.id} aria-pressed={result?.recipe?.id === recipe.id} onClick={() => choose(recipe)} className={`rounded-lg border p-3 text-left ${result?.recipe?.id === recipe.id ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200 bg-slate-50 hover:bg-slate-100'}`}><span className="block text-sm font-semibold">{recipe.title}</span><span className="mt-1 block text-xs text-slate-600">{recipe.description}</span><span className="mt-2 inline-block rounded bg-white px-2 py-1 text-xs font-medium text-indigo-800">{recipe.mode}</span></button>)}{!results.length && <p className="p-4 text-sm text-slate-600">No matching prompts. Try fewer words or another category.</p>}</div>
          </> : <>
            <p className="mb-3 text-sm text-slate-600">Describe the outcome you want. Suggest prompt uses your configured AI provider and the workspace labels shown above. It does not run the task or inspect saved records.</p>
            <label className="block text-sm font-medium">Your goal<textarea data-cookbook-initial value={goal} maxLength={3000} onChange={event => { cancel(); setGoal(event.target.value); setDetail(''); setResult(current => current?.origin === 'helper' && current.kind !== 'suggestion' ? null : current); setError(''); }} rows={3} className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2" placeholder="For example: find missing connections while preserving every existing row" /></label>
            {result?.kind === 'clarification' && !stale && <label className="mt-3 block text-sm font-medium">{result.question}<textarea aria-label="Additional detail" value={detail} maxLength={800} onChange={event => { cancel(); setDetail(event.target.value); setError(''); }} rows={2} className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2" /></label>}
            <div className="mt-3 flex flex-wrap items-center gap-2"><button type="button" onClick={suggest} disabled={pending || !goal.trim() || !requestSuggestion} className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"><Sparkles className="h-4 w-4" />{pending ? 'Preparing suggestion…' : 'Suggest prompt'}</button>{pending && <button type="button" onClick={cancel} className="rounded-md border border-slate-300 px-3 py-2 text-sm">Cancel suggestion</button>}</div>
            {!requestSuggestion && <p className="mt-2 text-sm text-slate-600">Prompt suggestions are unavailable in this view. You can still browse the cookbook.</p>}
            {pending && <p role="status" className="mt-2 text-sm text-slate-600">Preparing an editable prompt. Your conversation draft is unchanged.</p>}
          </>}
          {error && <p role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
          {goalStale && <p role="status" className="mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-800">Your goal changed. Request a new suggestion, or choose a cookbook example.</p>}
          {stale && <p role="status" className="mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-800">The workspace changed. Select a recipe again or request a new suggestion before using this draft.</p>}
          {result?.kind === 'unsupported' && !stale && <p role="status" className="mt-3 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">{result.explanation}</p>}
          {result?.kind === 'suggestion' && <div className="mt-4 space-y-2"><div className="text-sm font-semibold">{result.recipe.title} <span className="ml-2 text-xs font-normal text-indigo-800">{result.recipe.mode}</span></div><p className="text-sm text-slate-600">{result.explanation}</p><label className="block text-sm font-medium">Prompt preview<textarea value={preview} onChange={event => setPreview(event.target.value)} maxLength={8000} rows={5} className="mt-1 w-full resize-y rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal" /></label></div>}
        </div>
        <p className="mt-4 text-xs leading-5 text-slate-600">{COOKBOOK_WORKFLOW_NOTE}</p>
      </div>
      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-4 py-3"><p className="max-w-xl text-xs text-slate-600">Use prompt adds this below any existing conversation draft. Nothing is sent until you choose Send.</p><div className="flex items-center gap-2"><button type="button" onClick={close} className="rounded-md border border-slate-300 px-3 py-2 text-sm">Cancel</button><button type="button" disabled={!canUse} onClick={() => { if (canUse) onUse(preview); }} className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">Use prompt</button></div></footer>
    </section>
  </div>, document.body);
}
