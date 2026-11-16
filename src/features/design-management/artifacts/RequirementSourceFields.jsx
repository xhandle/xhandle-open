import React, { useEffect, useState } from 'react';
import { ARTIFACT_CHANGED, listArtifacts } from './artifactRepository';
import { matchesRequirementSource } from './requirementDerivationSources';
import { upstreamRequirementTemplate } from './requirementDerivation';
import { getTemplate } from './artifactModel';

export default function RequirementSourceFields({ config, onChange }) {
  const parent = upstreamRequirementTemplate(config), title = getTemplate(parent).name;
  const [state, setState] = useState({ loading: true, rows: [] });
  const identity = JSON.stringify([parent, config.projectId, config.workspaceType, config.system, config.ownerProjects, config.programId]);
  useEffect(() => {
    let alive = true;
    const refresh = () => {
      setState({ loading: true, rows: [] });
      listArtifacts().then(rows => { if (alive) setState({ loading: false, rows: rows.filter(meta => matchesRequirementSource(meta, config)) }); }, error => { if (alive) setState({ loading: false, rows: [], error: error.message }); });
    };
    refresh(); window.addEventListener(ARTIFACT_CHANGED, refresh);
    return () => { alive = false; window.removeEventListener(ARTIFACT_CHANGED, refresh); };
    // Only source identity changes should restart this metadata-only lookup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity]);
  const sourceId = config.requirementSourceArtifactId || (parent === 'system-spec' ? config.systemRequirementsArtifactId : '') || '';
  const selected = state.rows.some(meta => meta.id === sourceId) ? sourceId : state.rows.length === 1 ? state.rows[0].id : '';
  useEffect(() => { if (!state.loading && selected !== sourceId) onChange(selected); }, [state.loading, selected, sourceId, onChange]);
  return <fieldset><legend>Source {title}</legend>
    {state.loading ? <p role="status">Finding {title}…</p> : state.error ? <p role="alert">{state.error}</p> : state.rows.length ?
      <label>{title}<select required value={selected} onChange={event => onChange(event.target.value)}><option value="">Choose {title}</option>{state.rows.map(meta => <option key={meta.id} value={meta.id}>{meta.title}</option>)}</select></label> :
      <p role="alert">Create and generate a {title} for this project and system first.</p>}
  </fieldset>;
}
