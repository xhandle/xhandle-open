import { CODE_ABSTRACTIONS } from './codeArchitectureAbstraction';
import React from 'react';
import { architectureCatalog, architectureSourceKey, ARCHITECTURE_KINDS } from './architectureSources';

export function ArchitectureKindSelect({ value, onChange }) {
  return <label>Architecture type<select required value={value || 'system'} onChange={event => onChange(event.target.value)}>{Object.entries(ARCHITECTURE_KINDS).map(([id, title]) => <option key={id} value={id}>{title}</option>)}</select></label>;
}
export default function ArchitectureSourcePicker({ owners, value, onChange, kind }) {
  let catalog = [], error;
  try { catalog = architectureCatalog(owners).filter(source => !kind || (source.workspaceType === 'code-architecture') === (kind === 'code-based')); }
  catch (e) { error = e.message; }
  return <fieldset><legend>Source diagrams</legend><p>Select the saved diagrams that define this work. Generated objects retain links to their source diagrams and specific elements.</p>
    {error && <p role="alert">{error}</p>}
    {!catalog.length && <p>Choose an owning project with a saved project diagram or code architecture repository.</p>}
    <div className="artifact-source-picker">{catalog.map(source => {
      const key = architectureSourceKey(source), selected = value.find(item => architectureSourceKey(item) === key);
      const change = patch => onChange(value.map(item => item === selected ? { ...item, ...patch } : item));
      return <div key={key} className="artifact-fields"><label><span><input type="checkbox" checked={!!selected} onChange={event => onChange(event.target.checked ? [...value, { projectId: source.projectId, workspaceType: source.workspaceType, ...(source.repoId ? { repoId: source.repoId, abstraction: 'csu' } : {}) }] : value.filter(item => item !== selected))} /> {source.label}</span></label>
        {selected && <label>Architecture scope — {source.projectName}<input maxLength={200} value={selected.focus || ''} onChange={event => change({ focus: event.target.value })} placeholder="All elements, or exact subsystem / function name" /></label>}
        {selected && source.workspaceType === 'code-architecture' && <label>Abstraction level — {source.projectName}<select value={selected.abstraction || ''} onChange={event => change({ abstraction: event.target.value })}>{!selected.abstraction && <option value="">Full saved graph (existing selection)</option>}{Object.entries(CODE_ABSTRACTIONS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>}
        {selected && source.workspaceType === 'functional' && <label>Diagram level — {source.projectName}<select value={selected.level || ''} onChange={event => change({ level: event.target.value })}><option value="">Not specified</option><option value="0">Level 0</option><option value="1">Level 1</option><option value="2">Level 2</option><option value="other">Other level</option></select></label>}
      </div>;
    })}</div>
  </fieldset>;
}
