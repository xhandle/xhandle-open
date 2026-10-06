import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import CodeAnalysisCoverageNotice from './CodeAnalysisCoverageNotice';
import { summarizeCodeAnalysisCoverage } from './codeAnalysisCoverage';

global.IS_REACT_ACT_ENVIRONMENT = true;
it('shows model-only coverage, empty extraction and parse errors without claiming completion', () => {
  const host = document.createElement('div');
  const root = createRoot(host);
  try {
    act(() => root.render(<CodeAnalysisCoverageNotice coverage={summarizeCodeAnalysisCoverage({
      'a.cpp': {supported: false, modelOnly: 0},
      'b.py': {supported: true, parseErrors: [{line: 1}], unresolvedTargets: 2},
    })} />));
    expect(host.querySelector('summary').textContent).toContain('1 files with syntax inventory · 1 with model extraction · 1 with parse errors');
    expect(host.textContent).toContain('call completeness is unverified');
    expect(host.textContent).toContain('produced no published relationships');
    expect(host.textContent).toContain('2 call targets remain unresolved');
    expect(host.querySelector('details').open).toBe(false);
    act(() => root.render(<CodeAnalysisCoverageNotice />));
    expect(host.textContent).toBe('');
  } finally { act(() => root.unmount()); }
});
