import React, { useState } from 'react';
import { updateDocumentDetails } from './artifactRepository';

export default function DocumentDetailsDialog({ meta, onClose }) {
  const [title, setTitle] = useState(meta.title);
  const [description, setDescription] = useState(meta.description || meta.config.description || '');
  const [version] = useState(meta.detailsVersion || 0);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const submit = async event => {
    event.preventDefault(); setBusy(true); setError('');
    try { await updateDocumentDetails(meta.id, version, { title, description }); onClose(); }
    catch (error) { setError(error.message); }
    finally { setBusy(false); }
  };
  return <div className="artifact-modal" role="dialog" aria-modal="true" aria-label="Edit details"><form className="artifact-form" onSubmit={submit}>
    <h2>Edit {meta.recordType === 'systems-engineering-project' ? 'project' : 'document'} details</h2>
    <label>Title<input autoFocus required maxLength={200} value={title} onChange={event => setTitle(event.target.value)} /></label>
    <label>Description<textarea rows={4} maxLength={4000} value={description} onChange={event => setDescription(event.target.value)} /></label>
    <p>A short description helps people understand the purpose of this {meta.recordType === 'systems-engineering-project' ? 'project' : 'document'}.</p>
    {error && <p role="alert" className="artifact-error">{error}</p>}
    <div className="artifact-actions"><button type="button" disabled={busy} onClick={onClose}>Cancel</button><button className="primary" disabled={busy || !title.trim()}>{busy ? 'Saving…' : 'Save details'}</button></div>
  </form></div>;
}
