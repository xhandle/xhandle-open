import React, { useEffect, useState } from 'react';
import MatrixSetupFields from './MatrixSetupFields';
import { LINEAGE_FLOW, LINEAGE_STAGES, lineageProfile, lineageRole } from './derivationLineage';
import { suggestBindings, traceCatalog, scopeKey } from './traceabilityRepository';

export default function LineageSourceFields({ config, owner, onChange }) {
  const [catalog, setCatalog] = useState([]), [error, setError] = useState('');
  const scope = config.scopeId || (owner ? scopeKey(owner) : '');
  useEffect(() => { let alive = true; setCatalog([]); setError(''); traceCatalog(scope).then(rows => { if (alive) setCatalog(rows); }).catch(error => { if (alive) setError(error.message); }); return () => { alive = false; }; }, [scope]);
  const suggested = suggestBindings(lineageProfile, catalog, { ...owner, scopeId: scope });
  const ids = [...new Set(Object.values(suggested).flat())], selected = config.lineageSources == null ? ids : config.lineageSources;
  return <fieldset className="trace-lineage-sources"><legend>Project sources</legend>
    <p>Inputs are limited to artifacts in this Design Management project. The matrix follows their saved derivation chain automatically. Select the documents to include; there is no need to create role bindings or engineering links to display their recorded sources.</p>
    <p className="trace-flow">{LINEAGE_FLOW}</p>
    {error && <p role="alert">{error}</p>}
    <label><input type="checkbox" checked={config.lineageSources == null} onChange={event => onChange({ lineageSources: event.target.checked ? null : ids })} /> Include this project’s matching artifacts automatically</label>
    {LINEAGE_STAGES.map(stage => {
      const choices = catalog.filter(meta => suggested[lineageRole(stage)]?.includes(meta.id));
      return <div className="trace-source-stage" key={stage.id}><strong>{stage.label}</strong>{choices.length ? choices.map(meta => <label className="trace-choice" key={meta.id}><input type="checkbox" checked={selected.includes(meta.id)} onChange={event => onChange({ lineageSources: event.target.checked ? [...new Set([...selected, meta.id])] : selected.filter(id => id !== meta.id) })} />{meta.title}</label>) : <p>No source artifact yet. This step will appear as a gap.</p>}</div>;
    })}
    <details className="trace-advanced"><summary>Advanced rule profile and coverage settings</summary><MatrixSetupFields config={config} owner={owner} onChange={onChange} /></details>
  </fieldset>;
}
