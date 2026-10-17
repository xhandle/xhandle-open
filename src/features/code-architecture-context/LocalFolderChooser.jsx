import React, { useEffect, useRef, useState } from 'react';
import { chooseLocalFolder, connectLocalFolder, getLocalFolderSession, reuseLocalFolderConnection } from './localCodeSource';

export default function LocalFolderChooser({ source, onChange, disabled, connections = [], onPendingChange }) {
  const inputRef = useRef(null);
  const reconnectRef = useRef(null);
  const mounted = useRef(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(null);
  useEffect(() => { onPendingChange?.(Boolean(pending)); return () => onPendingChange?.(false); }, [pending, onPendingChange]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let current = true;
    if (source.sourceId) getLocalFolderSession({ sourceId: source.sourceId }).then(
      () => { if (current) setMessage('Folder available for analysis.'); },
      () => { if (current) setMessage('Reconnect the folder to analyze again. Saved results remain available.'); },
    );
    return () => { current = false; };
  }, [source.sourceId]); // Access is checked again when analyzing.

  const accept = ({ source: candidate, scan }, confirmed = false) => {
    if (!mounted.current) return;
    const candidates = [...connections, source].filter((entry, index, all) => entry.sourceType === 'local' && entry.sourceId &&
      entry.sourceId !== candidate.sourceId && entry.folderName === candidate.folderName && all.findIndex(other => other.sourceId === entry.sourceId) === index);
    if (!confirmed && candidate.sourceId !== source.sourceId && candidates.length) { setPending({ candidate, scan, candidates }); return; }
    setPending(null);
    onChange({ ...candidate, snapshotId: candidate.sourceId === source.sourceId ? source.snapshotId || '' : '' });
    setMessage(`${scan.entries.length} eligible files; ${scan.skipped.length} excluded entries. Source content is read only when needed.`);
  };
  const choose = async reconnect => {
    setPending(null);
    reconnectRef.current = reconnect ? source.sourceId : undefined;
    if (typeof window.showDirectoryPicker !== 'function') { inputRef.current.click(); return; }
    setBusy(true);
    try { await accept(await chooseLocalFolder(reconnectRef.current)); }
    catch (error) { if (error.name !== 'AbortError' && mounted.current) setMessage(error.message); }
    finally { if (mounted.current) setBusy(false); }
  };
  return <div className="space-y-2 rounded-lg border p-3">
    <div className="text-sm font-medium">{source.folderName || 'No local project folder selected'}</div>
    <div className="flex gap-2">
      <button type="button" disabled={disabled || busy} onClick={() => choose(false)} className="rounded border px-3 py-2 text-sm">{source.sourceId ? 'Choose different folder' : 'Choose folder'}</button>
      {source.sourceId && <button type="button" disabled={disabled || busy} onClick={() => choose(true)} className="rounded border px-3 py-2 text-sm">Reconnect folder</button>}
    </div>
    <input ref={inputRef} type="file" webkitdirectory="" multiple hidden aria-label="Select local project folder" onChange={async event => {
      const files = Array.from(event.target.files || []);
      event.target.value = '';
      if (!files.length) return;
      setBusy(true);
      try { accept(await connectLocalFolder({ files, sourceId: reconnectRef.current })); }
      catch (error) { if (mounted.current) setMessage(error.message); }
      finally { if (mounted.current) setBusy(false); }
    }} />
    <p role="status" className="text-xs text-slate-600">{busy ? 'Reading folder…' : message}</p>
    {pending && <div className="space-y-2 rounded border border-amber-300 p-3">
      <p className="text-sm">A connection named {pending.candidate.folderName} already exists. Is this the same folder? Reuse its connection to keep the saved analysis together.</p>
      {pending.candidates.map(entry => <button key={entry.sourceId} type="button" disabled={disabled || busy} className="block rounded border px-3 py-2 text-sm" onClick={async () => {
        setBusy(true);
        try { accept(await reuseLocalFolderConnection(pending.candidate, entry), true); }
        catch (error) { if (mounted.current) setMessage(error.message); }
        finally { if (mounted.current) setBusy(false); }
      }}>Use existing connection{entry.lastAnalyzedAt ? ` — analyzed ${new Date(entry.lastAnalyzedAt).toLocaleString()}` : ' — no recorded analysis'}</button>)}
      <button type="button" disabled={disabled || busy} className="rounded border px-3 py-2 text-sm" onClick={() => accept({ source: pending.candidate, scan: pending.scan }, true)}>Add as a separate source</button>
      <button type="button" disabled={disabled || busy} className="ml-2 rounded border px-3 py-2 text-sm" onClick={() => setPending(null)}>Cancel selection</button>
    </div>}
    <p className="text-xs text-slate-500">Read-only access. Select the same project when reconnecting. Browsers without persistent folder access require reselection after reload. Analysis sends selected code and context to your xHandle AI backend; selecting a folder does not start analysis.</p>
  </div>;
}
