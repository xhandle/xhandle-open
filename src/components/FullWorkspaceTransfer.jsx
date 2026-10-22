import { useEffect, useRef, useState } from 'react';
import { downloadWorkspaceTransfer, inspectWorkspaceTransfer, importWorkspaceTransfer, getWorkspaceRecovery, recoverPreviousWorkspace } from '../lib/fullWorkspaceTransfer';

export default function FullWorkspaceTransfer({ onBusyChange, backupBusy = false }) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const [percent, setPercent] = useState(null);
  const reportProgress = (text, completion) => { setMessage(text); if (Number.isFinite(completion)) setPercent(completion); };
  const [includeCredentials, setIncludeCredentials] = useState(false), [restoreCredentials, setRestoreCredentials] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false), [preview, setPreview] = useState(null);
  const [recovery, setRecovery] = useState(null), [reloadNeeded, setReloadNeeded] = useState(false);
  const [recoveryChecked, setRecoveryChecked] = useState(false);
  const fileInput = useRef(null), inFlight = useRef(false);
  useEffect(() => {
    let alive = true;
    getWorkspaceRecovery().then(value => { if (alive) { setRecovery(value); setRecoveryChecked(true); } }).catch(() => { if (alive) setMessage('Workspace recovery storage is unavailable. Full transfer cannot proceed.'); });
    return () => { alive = false; };
  }, []);
  useEffect(() => { onBusyChange?.(busy || !!recovery || reloadNeeded); }, [busy, recovery, reloadNeeded, onBusyChange]);
  const run = async action => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setPercent(null); setMessage('Preparing workspace transfer…');
    try { await action(); }
    catch (error) { setPercent(null); setMessage(error.message || 'Workspace transfer failed.'); }
    finally {
      try { setRecovery(await getWorkspaceRecovery()); } catch { setRecovery({ unavailable: true }); setMessage('Could not check workspace recovery. Keep this window open and retry recovery.'); }
      inFlight.current = false; setBusy(false);
    }
  };
  const selectFile = event => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    setPreview(null); setRestoreCredentials(false);
    run(async () => { const { envelope, summary } = await inspectWorkspaceTransfer(file); setPreview({ envelope, summary }); setMessage('File validated. Review the contents before replacing this installation’s workspace.'); });
  };
  const importFile = () => {
    if (!preview || !acknowledged) return;
    const counts = preview.summary;
    if (!window.confirm(`Replace this installation’s entire workspace with ${counts.projects} project(s), ${counts.records} database record(s), and ${counts.baselines} server baseline(s)?\n\nA local recovery checkpoint will be saved first. ${restoreCredentials ? 'Saved credentials in the file will also be restored.' : 'Your existing credentials will be kept.'}\n\nDo not close xHandle until this finishes.`)) return;
    run(async () => {
      try { await importWorkspaceTransfer(preview.envelope, { restoreCredentials, onProgress: setMessage }); }
      finally { setReloadNeeded(true); }
    });
  };
  const disabled = busy || backupBusy || !recoveryChecked || !!recovery || reloadNeeded;
  return <div className="rounded-2xl border border-blue-200 bg-blue-50/40 p-4 space-y-3" aria-label="Full workspace transfer">
    <h3 className="text-sm font-semibold text-slate-900">Full workspace export and import</h3>
    <p className="text-sm text-slate-600">Move your saved workspace from xhandle-open to xHandle Desktop, or between installations. Includes projects, analyses and history, requirements, diagrams, traceability, saved source indexes, evidence attachments, preferences, and local-server baselines and settings.</p>
    <p className="text-xs text-slate-600">Update both installations first and keep the local API server running. External source folders and backup-folder permissions must be reconnected after import. Files never saved in xHandle, cookies, environment credentials, and running jobs are not transferred.</p>
    <label className="flex gap-2 text-sm"><input type="checkbox" checked={acknowledged} disabled={busy || !!recovery || reloadNeeded} onChange={event => setAcknowledged(event.target.checked)} />I have saved my work, finished or canceled active analyses, and closed other xHandle tabs.</label>
    <label className="flex gap-2 text-sm"><input type="checkbox" checked={includeCredentials} disabled={disabled} onChange={event => setIncludeCredentials(event.target.checked)} />Include saved API keys and integration tokens in the export</label>
    <p className="text-xs text-slate-600">The exported file is not encrypted and contains private workspace data. Keep it private{includeCredentials ? ', including the saved credentials it contains' : ''}.</p>
    <div className="flex flex-wrap gap-2">
      <button className="px-3 py-2 rounded-lg bg-blue-600 text-white disabled:opacity-50" disabled={disabled || !acknowledged} onClick={() => run(async () => { const manifest = await downloadWorkspaceTransfer({ includeCredentials, onProgress: reportProgress }); setMessage(`Export complete. Download started: ${manifest.summary.projects} project(s), ${manifest.summary.records} database record(s), ${manifest.summary.baselines} server baseline(s).`); })}>Export Full Workspace</button>
      <button className="px-3 py-2 rounded-lg border bg-white disabled:opacity-50" disabled={disabled} onClick={() => fileInput.current?.click()}>Choose Full Workspace File</button>
      <input ref={fileInput} type="file" accept="application/json,.json" hidden aria-label="Choose full workspace file" disabled={disabled} onChange={selectFile} />
    </div>
    {preview && <div className="rounded-lg border bg-white p-3 space-y-2 text-sm">
      <div className="font-medium">Import preview</div>
      <div>{preview.summary.projects} project(s) · {preview.summary.databases} databases · {preview.summary.records} records · {preview.summary.settings} settings · {preview.summary.baselines} server baseline(s)</div>
      <div className="text-xs text-slate-600">Exported {new Date(preview.envelope.manifest.createdAt).toLocaleString()}. Import replaces the entire destination workspace; it does not merge projects.</div>
      {preview.envelope.manifest.includeCredentials && <label className="flex gap-2"><input type="checkbox" checked={restoreCredentials} disabled={disabled} onChange={event => setRestoreCredentials(event.target.checked)} />Restore saved API keys and integration tokens from this file (replaces current credentials)</label>}
      <button className="px-3 py-2 rounded-lg border border-amber-400 bg-amber-50 disabled:opacity-50" disabled={disabled || !acknowledged} onClick={importFile}>Import and Replace Workspace</button>
    </div>}
    {recovery && <div className="rounded-lg border border-amber-400 bg-amber-50 p-3 space-y-2 text-sm" role="alert">
      <div>A previous import needs recovery. Restore the checkpoint before continuing to work.</div>
      <button className="px-3 py-2 rounded-lg border bg-white disabled:opacity-50" disabled={busy} onClick={() => run(async () => { await recoverPreviousWorkspace({ onProgress: setMessage }); setRecovery(null); setReloadNeeded(true); setMessage('Previous workspace recovered. Reload xHandle to continue.'); })}>Recover Previous Workspace</button>
    </div>}
    {(busy || percent !== null) && <div>
      <progress className="w-full" aria-label="Workspace transfer progress" max="100" value={percent ?? undefined} />
      {percent !== null && <p className="text-sm font-medium" aria-live="polite">{percent}% complete</p>}
      {busy && percent !== null && <p className="text-xs text-slate-600">Progress reflects completed stages and may pause while large databases or attachments are processed. Keep xHandle open.</p>}
    </div>}
    {!!message && <p className="text-sm whitespace-pre-wrap" role="status" aria-live="polite">{message}</p>}
    {reloadNeeded && !recovery && !busy && <button className="px-3 py-2 rounded-lg bg-blue-600 text-white" onClick={() => window.location.reload()}>Reload xHandle</button>}
  </div>;
}
