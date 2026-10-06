import React, { useEffect, useState } from 'react';
import { readLatestArchitectureCheckpoint, readArchitectureCheckpoint } from './codeArchitectureStorage';

export default function ArchitectureRunRecovery({ scope, loading, hasPublishedRows, onResume }) {
  const [checkpoint, setCheckpoint] = useState(null);
  const [error, setError] = useState('');
  const [retrying, setRetrying] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    setCheckpoint(null);
    if (!loading && scope) readLatestArchitectureCheckpoint(scope).then(value => {
      if (active) setCheckpoint(value);
    }).catch(e => { if (active) setError(`Unable to read saved analysis progress: ${e.message}`); });
    return () => { active = false; };
  }, [scope, loading, refresh]);
  if (loading || (!checkpoint && !error)) return null;
  const resume = async () => {
    setRetrying(true); setError('');
    try { await onResume(checkpoint); }
    catch (e) { setError(e.message || 'Unable to retry this analysis.'); }
    finally { setRetrying(false); setRefresh(value => value + 1); }
  };
  const download = async () => {
    try {
      const value = await readArchitectureCheckpoint(checkpoint.key);
      if (!value) throw new Error('This checkpoint is no longer available.');
      const url = URL.createObjectURL(new Blob([JSON.stringify({status:value.phase || 'incomplete',...value}, null, 2)], {type:'application/json'}));
      const link = document.createElement('a'); link.href = url; link.download = 'architecture-checkpoint.json'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setError(e.message); }
  };
  return <section aria-label="Incomplete architecture analysis" className="shrink-0 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-slate-800">
    {checkpoint && <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <strong>{checkpoint.publicationReady ? 'Analysis complete — save pending' : 'Analysis unfinished — progress saved'}</strong>
        <div className="flex gap-2">
          <button className="rounded border bg-white px-3 py-1.5" disabled={retrying} onClick={download}>Export checkpoint</button>
          <button className="rounded bg-blue-600 px-3 py-1.5 text-white disabled:opacity-50" disabled={retrying} onClick={resume}>{retrying ? 'Retrying…' : (checkpoint.publicationReady ? 'Retry save' : 'Retry incomplete analysis')}</button>
        </div>
      </div>
      {checkpoint.durable === false && <p role="alert">Completed results are only in memory. Export them before refreshing; browser storage could not retain them.</p>}
      <p className="mt-2">{checkpoint.completed} of {checkpoint.total} files completed. {checkpoint.failedFiles.length} failed. {checkpoint.rowCount} draft relationships saved.</p>
      <p>{hasPublishedRows ? 'Your last completed architecture remains available below.' : 'No completed architecture has been published yet.'} Saved draft relationships are available for inspection; they are not used in downstream analysis.</p>
      {checkpoint.failedFiles.length > 0 && <details className="mt-2"><summary className="cursor-pointer font-semibold">File failure details</summary>
        <ul className="max-h-48 overflow-auto pl-5 list-disc">{checkpoint.failedFiles.map(file => <li key={file.path}><strong>{file.path}</strong>: {file.message}</li>)}</ul>
      </details>}
      {checkpoint.rowCount > 0 && <details className="mt-2"><summary className="cursor-pointer font-semibold">Preview saved draft relationships</summary>
        <div className="max-h-64 overflow-auto"><table className="w-full text-left"><thead><tr><th>Function (From)</th><th>Control Action</th><th>Function (To)</th></tr></thead>
          <tbody>{checkpoint.rows.map((row,index) => <tr key={index}><td>{row.from}</td><td>{row.action}</td><td>{row.to}</td></tr>)}</tbody></table></div>
        {checkpoint.rowCount > checkpoint.rows.length && <p>Showing the first {checkpoint.rows.length} relationships. Export the checkpoint to inspect all saved progress.</p>}
      </details>}
    </>}
    {error && <p role="alert" className="mt-2 text-red-700">{error}</p>}
  </section>;
}
