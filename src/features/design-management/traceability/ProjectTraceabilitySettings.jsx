import React, { useEffect, useState } from 'react';
import DesignDialogForm from '../../requirements/components/DesignDialogForm';
import MatrixSetupFields from './MatrixSetupFields';
import { assignment, assignProfile } from './traceabilityRepository';
import { requestTraceAssessment } from './requestTraceAssessment';
import { semanticHash } from '../artifacts/artifactModel';

export default function ProjectTraceabilitySettings({ program, onClose }) {
  const [saved, setSaved] = useState(null), [config, setConfig] = useState(null), [preview, setPreview] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { let alive = true; assignment(program.id).then(value => { if (alive) { setSaved(value); setConfig({ profile: value.selection, bindings: Object.values(value.bindings).some(ids => ids.length) ? value.bindings : null, scopeId: program.id, stage: 'definition' }); } }).catch(error => { if (alive) setError(error.message); }); return () => { alive = false; }; }, [program.id]);
  const assess = async () => {
    setBusy(true); setError('');
    try {
      const result = await requestTraceAssessment(null, { config });
      setPreview({ key: semanticHash(config), summary: result.summary, invalid: result.findings.length });
    } catch (error) { setError(error.message); } finally { setBusy(false); }
  };
  return <div className="artifact-modal" role="dialog" aria-modal="true" aria-label="Project traceability profile"><DesignDialogForm onSubmit={async event => { event.preventDefault(); setBusy(true); setError(''); try { if (!preview || preview.key !== semanticHash(config)) throw Error('Preview the rule impact before applying the profile.'); await assignProfile(program.id, saved.version, config.profile, config.bindings); onClose(); } catch (error) { setError(error.message); } finally { setBusy(false); } }} footer={<div className="trace-actions"><button type="button" disabled={busy} onClick={onClose}>Cancel</button><button type="button" disabled={busy || !config?.bindings} onClick={assess}>Preview rule impact</button><button disabled={busy || !preview || preview.key !== semanticHash(config)}>Apply project profile</button></div>}>
    <h2>Traceability profile — {program.title}</h2><p>Choose a pinned profile and role bindings for new matrices. Existing matrices and saved assessments retain their own pinned configuration. Existing relationships remain available for review.</p>{error && <p role="alert">{error}</p>}
    {config && <MatrixSetupFields config={config} owner={program} onChange={patch => { setConfig(value => ({ ...value, ...patch })); setPreview(null); }} />}
    {preview && <p role="status">Impact preview: {Object.entries(preview.summary).map(([key, count]) => `${key}: ${count}`).join(' · ')} · Invalid relationships: {preview.invalid}</p>}
  </DesignDialogForm></div>;
}
