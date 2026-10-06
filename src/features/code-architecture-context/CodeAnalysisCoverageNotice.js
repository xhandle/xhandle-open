import React from 'react';

export default function CodeAnalysisCoverageNotice({ coverage }) {
  if (!coverage) return null;
  return <details className="rounded-lg border bg-gray-50 px-3 py-2 text-xs text-gray-600">
    <summary className="cursor-pointer">Source coverage: {coverage.syntaxFiles} files with syntax inventory · {coverage.modelOnlyFiles} with model extraction · {coverage.parseErrorFiles} with parse errors</summary>
    <p className="mt-2">{coverage.limitation}</p>
    {coverage.emptyModelFiles > 0 && <p className="mt-1">{coverage.emptyModelFiles} model-extracted files produced no published relationships; their call coverage remains unknown.</p>}
    {coverage.unrecordedFiles > 0 && <p className="mt-1">{coverage.unrecordedFiles} files have no coverage record.</p>}
    {coverage.parseErrorFiles > 0 && <p className="mt-1">Parse errors can leave calls unaccounted for. See the workbook coverage sheets for affected files.</p>}
    <p className="mt-1">{coverage.unresolvedTargets} call targets remain unresolved. Coverage applies to selected files; file selections and exclusions are recorded in the workbook.</p>
  </details>;
}
