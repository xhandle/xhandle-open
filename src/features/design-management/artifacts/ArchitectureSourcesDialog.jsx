import React, { useState } from 'react';
import ArchitectureSourcePicker from './ArchitectureSourcePicker';
import { architectureSourceKey } from './architectureSources';
import { configOwners } from './artifactSources';
import { updateArchitectureSources } from './architectureSourceUpdates';

export default function ArchitectureSourcesDialog({ meta, onClose, onSaved }) {
  const [sources, setSources] = useState(() => [...new Map((meta.members ? meta.members.flatMap(member => member.config.architectureSources || []) : meta.config.architectureSources || []).map(source => [architectureSourceKey(source), source])).values()]);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  return <div className="artifact-modal" role="dialog" aria-modal="true" aria-label="Manage source diagrams"><form className="artifact-form" onSubmit={async event => { event.preventDefault(); setBusy(true); setError(''); try { await updateArchitectureSources(meta.id, sources); onSaved?.(); onClose(); } catch (e) { setError(e.message); } finally { setBusy(false); } }}>
    <h2>Source diagrams — {meta.title}</h2><p>Changing this selection starts a fresh proposal. Accepted revisions and their original source links remain available.</p>
    <ArchitectureSourcePicker owners={configOwners(meta.config)} value={sources} onChange={setSources} kind={meta.templateId === 'architecture' ? meta.config.architectureKind : null} />
    {error && <p role="alert" className="artifact-error">{error}</p>}
    <div className="artifact-actions"><button type="button" disabled={busy} onClick={onClose}>Cancel</button><button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save source diagrams'}</button></div>
  </form></div>;
}
