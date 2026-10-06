import { summarizeCodeAnalysisCoverage } from '../code-architecture-context/codeAnalysisCoverage';
// Portable provenance, separate from editable labels and descriptions.
export function architectureEvidenceColumns(row) {
  const e = row.relationshipEvidence || {};
  return {
    'Trace ID': row.traceId || '',
    'Canonical Relationship ID': row.canonicalRelationshipId || '',
    'Lineage Status': row.lineage?.status || 'legacy-unverified',
    'Run Fingerprint': row.lineage?.runFingerprint || '',
    'Evidence Status': e.supported ? 'Source syntax' : 'Unverified proposal or legacy row',
    'Evidence Version': e.version || '',
    'Extraction Method': e.extractionMethod || (e.supported ? 'source-syntax' : ''),
    'Evidence Limitation': e.limitation || '',
    'Relationship Kind': e.kind || '',
    'Canonical From': e.from || '',
    'Canonical To': e.to || '',
    'Target Resolution': e.targetResolution || (e.supported ? 'Legacy lexical evidence' : ''),
    'Source Lines': (e.lines || []).join(', '),
    'Source Text SHA-256': e.textDigest || '',
    'Hazard Eligibility': row.hazardAnalysisEligibility || '',
    'Eligibility Source': row.hazardAnalysisEligibilitySource || '',
    'Eligibility Policy Version': row.classificationPolicyVersion ?? '',
    'Eligibility Rationale': row.hazardAnalysisEligibilityRationale || '',
  };
}
export function architectureCoverageSheets(records = []) {
  const runs = [], files = [], relationships = [], proposals = [];
  for (const run of records) {
    const ledgers = Object.values(run.relationshipLedger || {});
    const coverage = summarizeCodeAnalysisCoverage(run.relationshipLedger, run.inputManifest);
    runs.push({
      'Run Fingerprint': run.fingerprint || '', 'Comparison Fingerprint': run.comparisonFingerprint || '',
      'Analysis Version': run.analysisVersion || 'source-equivalence-v1',
      'Source Type': run.source?.sourceType || '', 'Snapshot': run.source?.snapshotId || '',
      'Status': run.status || '', 'Published At': run.publishedAt || '',
      'Files With Syntax Inventory': coverage.syntaxFiles,
      'Files With Model Extraction Only': coverage.modelOnlyFiles,
      'Model Files Without Published Relationships': coverage.emptyModelFiles,
      'Files Without Coverage Record': coverage.unrecordedFiles,
      'Requested Settings': JSON.stringify(run.generationSettings || {}),
      'Effective Settings': JSON.stringify(run.effectiveSettings || {}),
      'Parse Errors': ledgers.reduce((n, l) => n + (l.parseErrors || []).length, 0),
      'Unresolved Call Targets': ledgers.reduce((n, l) => n + (l.unresolvedTargets || 0), 0),
      'Model-only Proposals': ledgers.reduce((n, l) => n + (l.modelOnly || 0), 0),
      'Published Calls': ledgers.length && ledgers.every(l => l.decompositionScopeVersion && l.supported) ? ledgers.reduce((n,l) => n + l.publishedCalls, 0) : '',
      'Published Syntax Calls': ledgers.filter(l => l.supported).reduce((n,l) => n + (l.publishedCalls || 0), 0),
      'Published Model Relationships': ledgers.filter(l => !l.supported).reduce((n,l) => n + (l.modelOnly || 0), 0),
      'Inventory Relationships Outside Call View': ledgers.every(l => l.decompositionScopeVersion) ? ledgers.reduce((n,l) => n + l.excludedRelationships, 0) : '',
      'Proposals Held for Review': ledgers.reduce((n,l) => n + (l.reviewProposals || []).length, 0),
      'Model-only Proposals Before Deduplication': ledgers.reduce((n, l) => n + (l.modelOnlyBeforeDedup ?? l.modelOnly ?? 0), 0),
      'Proposal Count Basis': ledgers.length && ledgers.every(l => l.proposalCountBasis === 'published-after-deduplication') ? 'Published after deduplication' : 'Legacy/pre-deduplication counts may be included',
      'Coverage Meaning': `Status describes selected-file processing, not a complete semantic call graph. ${coverage.limitation}`,
    });
    const inputs = new Map((run.inputManifest || []).map(file => [file.path, file]));
    const selection = new Map((run.selectionManifest || []).map(file => [file.path, file]));
    for (const path of inputs.keys()) if (!selection.has(path)) selection.set(path, { path, disposition: 'legacy-selection-unspecified' });
    for (const file of selection.values()) {
      const input = inputs.get(file.path) || {}, ledger = run.relationshipLedger?.[file.path];
      files.push({
        'Run Fingerprint': run.fingerprint || '', Path: file.path, Disposition: file.disposition || '',
        'Byte SHA-256': input.contentDigest || '', 'Text SHA-256': input.textDigest || '',
        Decoding: typeof input.decoding === 'object' ? JSON.stringify(input.decoding) : input.decoding || '',
        'Inventory Version': ledger?.version || '', 'Syntax Inventory Available': ledger?.supported ? 'Yes' : 'No',
        Definitions: ledger?.definitionCount ?? '', 'Call Expressions': ledger?.callExpressionCount ?? '',
        'Source Relationships': ledger?.supported ? ledger.relationships?.length ?? '' : '',
        'Published Calls': ledger?.supported ? ledger.publishedCalls ?? '' : '',
        'Extraction Method': !ledger ? 'No coverage record' : ledger.supported ? 'Source syntax' : 'Model extraction; completeness unverified',
        'Inventory Relationships Outside Call View': ledger?.excludedRelationships ?? '',
        'Proposals Held for Review': ledger?.reviewProposals?.length ?? '',
        'Unresolved Call Targets': ledger?.unresolvedTargets ?? '', 'Model-only Proposals': ledger?.modelOnly ?? '',
        'Model-only Proposals Before Deduplication': ledger?.modelOnlyBeforeDedup ?? ledger?.modelOnly ?? '',
        'Proposal Count Basis': ledger?.proposalCountBasis || 'legacy-pre-deduplication',
        'Parse Error Lines': (ledger?.parseErrors || []).map(error => error.line).join(', '),
        Limitations: ledger?.limitation || 'No syntax coverage record available.',
      });
      for (const e of ledger?.relationships || []) relationships.push({
        'Run Fingerprint':run.fingerprint || '', 'Canonical Relationship ID':e.canonicalId,
        'Function (From)':e.from, 'Function (To)':e.to, 'Source File':e.fromFile,
        'Relationship Kind':e.kind, 'Source Lines':(e.lines || []).join(', '),
        'Target Resolution':e.targetResolution || '',
        'Call View Disposition':e.decompositionDisposition || 'legacy-scope-unspecified',
      });
      for (const row of ledger?.reviewProposals || []) proposals.push({
        'Run Fingerprint':run.fingerprint || '', 'Origin File':file.path,
        'Function (From)':row.from, 'From File':row.fromFile, 'Control Action':row.action,
        'Function (To)':row.to, 'To File':row.toFile,
        'From Details':row.fromDetails || '', 'Control Action Details':row.controlActionDetails || '', 'To Details':row.toDetails || '',
        Disposition:row.decompositionDisposition, 'Evidence Status':'Unverified model proposal; not a published call',
      });
    }
    for (const exclusion of run.adapterExclusions || []) files.push({
      'Run Fingerprint': run.fingerprint || '', Path: exclusion.path || '', Disposition: 'adapter-excluded',
      Limitations: exclusion.reason || JSON.stringify(exclusion),
    });
  }
  return { runs: runs.length ? runs : [{ Notice: 'No run manifest available. Source equivalence and coverage cannot be established from this legacy export.' }], files, relationships, proposals };
}
