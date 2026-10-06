// Processing every selected file is not a claim of complete call-graph coverage.
export function summarizeCodeAnalysisCoverage(ledger = {}, inputManifest = []) {
  const paths = [...new Set([...inputManifest.map(file => file.path), ...Object.keys(ledger)])];
  const summary = { version: 1, files: paths.length, syntaxFiles: 0, modelOnlyFiles: 0, unrecordedFiles: 0,
    parseErrorFiles: 0, emptyModelFiles: 0, unresolvedTargets: 0 };
  for (const path of paths) {
    const file = ledger[path];
    if (!file) { summary.unrecordedFiles++; continue; }
    if (file.supported) summary.syntaxFiles++;
    else {
      summary.modelOnlyFiles++;
      if ((file.modelOnly || 0) === 0) summary.emptyModelFiles++;
    }
    if (file.parseErrors?.length) summary.parseErrorFiles++;
    summary.unresolvedTargets += file.unresolvedTargets || 0;
  }
  summary.limitation = 'Syntax inventory is available for Python only. Other languages use model extraction; call completeness is unverified. Empty model output does not establish absence of calls. Syntax evidence does not prove runtime dispatch or reachability.';
  return summary;
}
