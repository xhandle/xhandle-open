import { useEffect, useState, useCallback } from 'react';
import { getWorkspaceRecovery, hasPendingWorkspaceTransfer, recoverPreviousWorkspace } from '../lib/fullWorkspaceTransfer';

// Mount the normal workspace only after a pending import has been recovered.
// Normal startup does not open recovery storage unless a transfer marked it.
export default function WorkspaceTransferGate({ children }) {
  const [blocked, setBlocked] = useState(() => hasPendingWorkspaceTransfer());
  const [checking, setChecking] = useState(blocked), [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('An interrupted workspace import was detected. Recover the previous workspace before opening xHandle.');
  const [recovered, setRecovered] = useState(false), [checkError, setCheckError] = useState(false);
  const check = useCallback(async () => {
    setChecking(true); setCheckError(false);
    try { if (!await getWorkspaceRecovery()) setBlocked(false); }
    catch { setCheckError(true); setMessage('Could not check the workspace recovery checkpoint. Retry before opening the workspace.'); }
    finally { setChecking(false); }
  }, []);
  useEffect(() => { if (blocked) check(); }, [blocked, check]); // The pending flag is sampled before App mounts.
  if (!blocked) return children;
  return <main className="mx-auto max-w-xl p-8 space-y-4" role="alert">
    <h1 className="text-xl font-semibold">Workspace import recovery</h1>
    <p aria-live="polite">{message}</p>
    {(checking || busy) && <progress aria-label="Recovering workspace" />}
    {checkError && <button disabled={checking} className="rounded-lg border px-4 py-2" onClick={check}>Retry Recovery Check</button>}
    {!checking && !checkError && !recovered && <button className="rounded-lg bg-blue-600 text-white px-4 py-2 disabled:opacity-50" disabled={busy} onClick={async () => {
      setBusy(true);
      try { await recoverPreviousWorkspace({ onProgress: setMessage }); setRecovered(true); setMessage('Previous workspace recovered. Reload xHandle to continue.'); }
      catch (error) { setMessage(error.message || 'Recovery could not finish. Keep this window open and try again.'); }
      finally { setBusy(false); }
    }}>Recover Previous Workspace</button>}
    {recovered && <button className="rounded-lg bg-blue-600 text-white px-4 py-2" onClick={() => window.location.reload()}>Reload xHandle</button>}
  </main>;
}
