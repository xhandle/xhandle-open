function primaryFile(cell) {
  if (!cell || typeof cell !== 'string') return '';
  const first = cell.split(/[,;]+/)[0].trim();
  return first;
}

const FUNCTION_GROUP_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'into', 'onto', 'this', 'that', 'these', 'those',
  'data', 'system', 'module', 'service', 'handler', 'manager', 'process', 'control', 'action',
  'send', 'receive', 'handle', 'update', 'processes', 'manage', 'manages', 'provide', 'provides',
  'execute', 'executes', 'compute', 'computes', 'read', 'reads', 'write', 'writes',
]);

function tokenizeFunctionLabel(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s/-]/g, ' ')
    .split(/[\s/-]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !FUNCTION_GROUP_STOPWORDS.has(token));
}

function humanizeToken(token) {
  return String(token || '').replace(/^\w/, (ch) => ch.toUpperCase());
}

export function inferFunctionGroupForFile(file, rows) {
  const tokenCounts = new Map();
  const phraseCounts = new Map();

  for (const row of rows || []) {
    const associations = [
      { file: primaryFile(row.fromFile), fn: row.fromFunction },
      { file: primaryFile(row.toFile), fn: row.toFunction },
    ];
    for (const assoc of associations) {
      if (assoc.file !== file || !assoc.fn) continue;
      const phrase = String(assoc.fn).trim();
      if (phrase) phraseCounts.set(phrase, (phraseCounts.get(phrase) || 0) + 1);
      for (const token of tokenizeFunctionLabel(assoc.fn)) {
        tokenCounts.set(token, (tokenCounts.get(token) || 0) + 1);
      }
    }
  }

  const topTokens = Array.from(tokenCounts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 2)
    .map(([token]) => humanizeToken(token));

  if (topTokens.length >= 2) return `${topTokens[0]} / ${topTokens[1]}`;
  if (topTokens.length === 1) return topTokens[0];

  const topPhrase = Array.from(phraseCounts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
  if (topPhrase) return topPhrase;

  const parts = String(file || '').split('/').filter(Boolean);
  if (parts.length > 1) return parts[parts.length - 2];
  return 'General';
}

export function computeFunctionGroupsByFile(rows) {
  const byFile = new Map();
  for (const row of rows || []) {
    for (const file of new Set([primaryFile(row.fromFile), primaryFile(row.toFile)])) {
      if (!byFile.has(file)) byFile.set(file, []);
      byFile.get(file).push(row);
    }
  }
  return new Map(Array.from(byFile, ([file, fileRows]) => [file, inferFunctionGroupForFile(file, fileRows)]));
}

export function cleanArchLabel(value, fallback) {
  const text = String(value || '').trim();
  return text || fallback;
}

export function archPath(row) {
  const arch = row?.architecture || {};
  return {
    subsystem: cleanArchLabel(arch.subsystem, 'Application Subsystem'),
    csci: cleanArchLabel(arch.csci, 'Application Software'),
    csc: cleanArchLabel(arch.csc, 'Core Components'),
    csu: cleanArchLabel(arch.csu, cleanArchLabel(row?.fromFunction || row?.toFunction, 'Functional Unit')),
    descriptions: arch.descriptions || {},
  };
}

export function computeArchitectureByFunction(rows) {
  const map = new Map();
  const accumulated = new Map();
  for (const row of rows || []) {
    const arch = archPath(row);
    const refs = [row.rowRef].filter(Boolean);
    const files = [
      primaryFile(row.fromFile),
      primaryFile(row.toFile),
      ...(row.codeEvidence?.files || []).map((file) => file.filePath),
    ].filter(Boolean);
    const evidence = {
      rowRefs: refs,
      files: Array.from(new Set(files)),
      imports: Array.from(new Set((row.codeEvidence?.files || []).flatMap((file) => file.imports || []))).slice(0, 8),
      exports: Array.from(new Set((row.codeEvidence?.files || []).flatMap((file) => file.exports || []))).slice(0, 8),
      sourceFunctions: Array.from(
        new Map(
          [
            ...(row.sourceEvidence?.functions || []),
            ...(row.codeEvidence?.sourceFunctions || []),
            ...(row.codeEvidence?.files || []).flatMap((file) => file.sourceFunctions || []),
          ]
            .filter((fn) => fn?.functionName && fn?.filePath)
            .map((fn) => [`${fn.filePath}:${fn.functionName}:${fn.startLine || ''}`, fn])
        ).values()
      ).slice(0, 30),
      rationale: row.architecture?.rationale || '',
    };

    [row.fromFunction, row.toFunction].filter(Boolean).forEach((fn) => {
      if (!map.has(fn)) {
        accumulated.set(fn, { refs: new Set(refs), files: new Set(files) });
        map.set(fn, { ...arch, evidence });
        return;
      }
      const current = map.get(fn);
      refs.forEach(ref => accumulated.get(fn).refs.add(ref));
      files.forEach(file => accumulated.get(fn).files.add(file));
      map.set(fn, {
        ...current,
        evidence: {
          rowRefs: current.evidence.rowRefs,
          files: current.evidence.files,
          imports: Array.from(new Set([...(current.evidence?.imports || []), ...evidence.imports])).slice(0, 8),
          exports: Array.from(new Set([...(current.evidence?.exports || []), ...evidence.exports])).slice(0, 8),
          sourceFunctions: Array.from(
            new Map(
              [...(current.evidence?.sourceFunctions || []), ...evidence.sourceFunctions]
                .filter((fn) => fn?.functionName && fn?.filePath)
                .map((fn) => [`${fn.filePath}:${fn.functionName}:${fn.startLine || ''}`, fn])
            ).values()
          ).slice(0, 30),
          rationale: current.evidence?.rationale || evidence.rationale,
        },
      });
    });
  }
  for (const [fn, value] of map) {
    value.evidence = { ...value.evidence, rowRefs: [...accumulated.get(fn).refs], files: [...accumulated.get(fn).files] };
  }
  return map;
}
