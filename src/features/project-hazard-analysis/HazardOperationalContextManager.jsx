import React, { useEffect, useState } from "react";
import { Loader2, Plus, Sparkles, Trash2, X } from "lucide-react";
import { normalizeHazardOperationalContexts } from "./hazardOperationalContexts";

function newContext() {
  return {
    id: `context-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    scenario: "",
    mode: "",
    conditions: "",
    assumptions: "",
  };
}

export default function HazardOperationalContextManager({ open, contexts = [], onClose, onSave, onGenerate }) {
  const [drafts, setDrafts] = useState([]);
  const [description, setDescription] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generationError, setGenerationError] = useState("");

  useEffect(() => {
    if (open) {
      setDrafts(normalizeHazardOperationalContexts(contexts));
      setGenerationError("");
    }
  }, [contexts, open]);

  if (!open) return null;

  const update = (id, field, value) => {
    setDrafts((current) => current.map((context) => (
      context.id === id ? { ...context, [field]: value } : context
    )));
  };

  const save = () => {
    const incomplete = drafts.some((context) => !String(context.scenario || "").trim() || !String(context.mode || "").trim());
    if (incomplete) {
      window.alert("Each operational context needs both a scenario and a mode.");
      return;
    }
    onSave(normalizeHazardOperationalContexts(drafts));
    onClose();
  };

  const generate = async () => {
    if (!String(description || "").trim() || generating || !onGenerate) return;
    setGenerating(true);
    setGenerationError("");
    try {
      const suggestions = await onGenerate(description, drafts);
      const existingPairs = new Set(drafts.map((context) => `${context.scenario.toLowerCase()}::${context.mode.toLowerCase()}`));
      const additions = normalizeHazardOperationalContexts(suggestions).filter((context) => {
        const identity = `${context.scenario.toLowerCase()}::${context.mode.toLowerCase()}`;
        if (existingPairs.has(identity)) return false;
        existingPairs.add(identity);
        return true;
      });
      setDrafts((current) => [...current, ...additions]);
      if (!additions.length) setGenerationError("The AI did not propose any new scenario–mode combinations.");
    } catch (error) {
      setGenerationError(error?.message || "Unable to generate operational contexts.");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex justify-end bg-slate-950/30" role="presentation" onMouseDown={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="hazard-context-title"
        className="flex h-full w-full max-w-xl flex-col bg-white shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-gray-200 px-6 py-5">
          <div>
            <h2 id="hazard-context-title" className="text-lg font-semibold text-gray-950">Operational contexts</h2>
            <p className="mt-1 text-sm text-gray-600">
              Define only applicable scenario–mode combinations. Each combination is analyzed independently.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-2 text-gray-500 hover:bg-gray-100" aria-label="Close operational contexts">
            <X size={18} />
          </button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto p-6">
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-blue-950">
              <Sparkles size={16} /> Generate with AI
            </div>
            <p className="mt-1 text-xs leading-5 text-blue-900/80">
              Describe the system, mission, environment, operating concept, or conditions that should shape the analysis. Suggestions remain editable until you save.
            </p>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Example: A delivery robot operates on sidewalks and crosswalks in autonomous, remote-assisted, degraded-sensor, and maintenance conditions…"
              rows={4}
              className="mt-3 w-full resize-y rounded-md border border-blue-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-400 focus:outline-none"
            />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs text-blue-900/70">Uses the configured AI provider and the project’s functional architecture.</span>
              <button
                type="button"
                onClick={generate}
                disabled={generating || !String(description || "").trim() || !onGenerate}
                className="inline-flex items-center gap-2 rounded-md bg-[#2D7DFE] px-3 py-2 text-sm font-medium text-white hover:bg-[#1E61D6] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {generating ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                {generating ? "Generating…" : "Generate suggestions"}
              </button>
            </div>
            {generationError && <p role="alert" className="mt-2 text-xs font-medium text-rose-700">{generationError}</p>}
          </div>
          {drafts.length === 0 && (
            <div className="rounded-xl border border-dashed border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
              No context is configured. Hazard generation will use an “Unspecified scenario · Unspecified mode” context until you add one.
            </div>
          )}
          {drafts.map((context, index) => (
            <article key={context.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-gray-900">Context {index + 1}</div>
                <button
                  type="button"
                  onClick={() => setDrafts((current) => current.filter((item) => item.id !== context.id))}
                  className="rounded-md p-1.5 text-gray-400 hover:bg-rose-50 hover:text-rose-600"
                  aria-label={`Delete context ${index + 1}`}
                >
                  <Trash2 size={16} />
                </button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs font-medium text-gray-700">
                  Operational scenario
                  <input value={context.scenario} onChange={(event) => update(context.id, "scenario", event.target.value)} placeholder="Urban intersection approach" className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-normal" />
                </label>
                <label className="text-xs font-medium text-gray-700">
                  Operational mode
                  <input value={context.mode} onChange={(event) => update(context.id, "mode", event.target.value)} placeholder="Autonomous operation" className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-normal" />
                </label>
              </div>
              <label className="mt-3 block text-xs font-medium text-gray-700">
                Operating conditions
                <textarea value={context.conditions} onChange={(event) => update(context.id, "conditions", event.target.value)} placeholder="Weather, speed, environment, actors, mission phase…" rows={2} className="mt-1 w-full resize-y rounded-md border border-gray-300 px-3 py-2 text-sm font-normal" />
              </label>
              <label className="mt-3 block text-xs font-medium text-gray-700">
                Assumptions
                <textarea value={context.assumptions} onChange={(event) => update(context.id, "assumptions", event.target.value)} placeholder="Relevant constraints and assumptions…" rows={2} className="mt-1 w-full resize-y rounded-md border border-gray-300 px-3 py-2 text-sm font-normal" />
              </label>
            </article>
          ))}
          <button type="button" onClick={() => setDrafts((current) => [...current, newContext()])} className="inline-flex items-center gap-2 rounded-md border border-[#2D7DFE] bg-white px-3 py-2 text-sm font-medium text-[#1c5fde] hover:bg-blue-50">
            <Plus size={16} /> Add context
          </button>
        </div>

        <footer className="flex justify-end gap-2 border-t border-gray-200 px-6 py-4">
          <button type="button" onClick={onClose} disabled={generating} className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60">Cancel</button>
          <button type="button" onClick={save} disabled={generating} className="rounded-md bg-[#2D7DFE] px-4 py-2 text-sm font-medium text-white hover:bg-[#1E61D6] disabled:opacity-60">Save contexts</button>
        </footer>
      </section>
    </div>
  );
}
