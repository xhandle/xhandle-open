import PagedDetails from './PagedDetails';
import React, { useEffect, useState } from 'react';
import { compareObjects } from './artifactModel';
import { requestArtifactWorker } from './requestArtifactWorker';

export default function ArtifactComparison({ before, after, historical = false }) {
  const [result, setResult] = useState(null);
  useEffect(() => {
    const controller = new AbortController();
    setResult(null);
    // New drafts have no existing evidence to compare or hash.
    const request = !before.length || typeof Worker === 'undefined'
      ? Promise.resolve(compareObjects(before, after))
      : requestArtifactWorker('compare', { before, after }, { signal: controller.signal });
    request.then(edits => { if (!controller.signal.aborted) setResult({ edits }); }, error => { if (!controller.signal.aborted) setResult({ error: error.message }); });
    return () => controller.abort();
  }, [before, after]);
  if (!result) return <p role="status">Comparing saved document and supporting evidence…</p>;
  if (result.error) return <p role="alert">{result.error}</p>;
  return <div>{!historical && <strong>{result.edits.length} object changes proposed.</strong>}<PagedDetails title={`Compare with ${historical ? 'selected' : 'accepted'} revision`} items={result.edits} renderItem={d => <div key={d.id}><strong>{d.change}: {d.title}</strong>{d.before && <p>Before: {d.before}</p>}{d.after && <p>{historical ? 'Current' : 'After'}: {d.after}</p>}</div>} /></div>;
}
