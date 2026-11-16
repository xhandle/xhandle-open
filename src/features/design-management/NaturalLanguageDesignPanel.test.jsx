import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import NaturalLanguageDesignPanel from './NaturalLanguageDesignPanel';
import ArtifactActionsPopover from './artifacts/ArtifactActionsPopover';

test('workspace actions occupy one overflow control and retain every callback and source hint', async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div'); document.body.appendChild(host); const root = createRoot(host);
  const callbacks = Object.fromEntries(['onGenerateProject', 'onGenerateArtifact', 'onTraceabilityProfiles', 'onGenerateSysML', 'onAnalyzeGaps'].map(key => [key, jest.fn()]));
  try {
    await act(async () => root.render(<NaturalLanguageDesignPanel {...callbacks} activeDesignContext={{ activeFolderName: 'Designs', selectedModule: 'Commands', rows: [1, 2] }} />));
    const trigger = host.querySelector('[aria-label="Design Management actions"]');
    expect(host.querySelectorAll('.design-toolbar-actions button')).toHaveLength(1); expect(trigger.textContent).toBe('…');
    for (const [label, callback] of [['Generate systems engineering project', 'onGenerateProject'], ['Generate engineering artifact', 'onGenerateArtifact'], ['Traceability profiles', 'onTraceabilityProfiles'], ['Generate SysML v2 Model', 'onGenerateSysML'], ['Analyze Model Gaps', 'onAnalyzeGaps']]) {
      await act(async () => trigger.click());
      const action = [...document.querySelectorAll('.design-actions-list button')].find(button => button.textContent === label);
      const group = action.closest('details');
      expect(group.open).toBe(false);
      await act(async () => group.querySelector('summary').click());
      expect(group.open).toBe(true);
      if (callback === 'onGenerateSysML') expect(action.title).toBe('SysML source: Designs / Commands · 2 visible rows');
      await act(async () => action.click());
      expect(callbacks[callback]).toHaveBeenCalledTimes(1); expect(trigger.getAttribute('aria-expanded')).toBe('false');
    }
  } finally { await act(async () => root.unmount()); host.remove(); }
});

test('one toolbar disclosure combines the current folder, project, artifact or matrix with workspace actions', async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div'); document.body.appendChild(host); const root = createRoot(host);
  const generate = jest.fn(), edit = jest.fn();
  const render = async (label, readOnly = false) => act(async () => root.render(
    <NaturalLanguageDesignPanel onGenerateArtifact={generate}>
      <header data-current-header="true"><h2>{label}</h2>{!readOnly && <ArtifactActionsPopover key={label} primary label={label}>
        {close => <button onClick={() => { close(); edit(label); }}>Edit current item</button>}
      </ArtifactActionsPopover>}</header>
      <ArtifactActionsPopover label="Actions for a list row">{close => <button onClick={close}>Open row</button>}</ArtifactActionsPopover>
    </NaturalLanguageDesignPanel>));
  try {
    for (const label of ['Folder actions for Architectures', 'Project actions', 'Artifact actions', 'Matrix actions']) {
      await render(label);
      const toolbar = host.querySelector('.design-toolbar-actions');
      expect(toolbar.querySelectorAll('button')).toHaveLength(1);
      expect(host.querySelector('[data-current-header] button')).toBeNull();
      const trigger = toolbar.querySelector('button'); expect(trigger.getAttribute('aria-label')).toBe(label);
      await act(async () => trigger.click());
      const panel = document.querySelector('.artifact-actions-popover');
      expect(panel.textContent).toContain('Edit current item'); expect(panel.textContent).toContain('Generate engineering artifact');
      await act(async () => [...panel.querySelectorAll('button')].find(button => button.textContent === 'Edit current item').click());
      expect(edit).toHaveBeenLastCalledWith(label); expect(trigger.getAttribute('aria-expanded')).toBe('false');
      await act(async () => trigger.click());
      const create = document.querySelector('.artifact-actions-popover details');
      await act(async () => create.querySelector('summary').click());
      await act(async () => [...create.querySelectorAll('button')].find(button => button.textContent === 'Generate engineering artifact').click());
      expect(trigger.getAttribute('aria-expanded')).toBe('false');
      // Row and sidebar disclosures keep their own scope and are not merged.
      const row = host.querySelector('[aria-label="Actions for a list row"]');
      await act(async () => row.click()); expect(document.querySelector('.artifact-actions-popover').textContent).not.toContain('Generate engineering artifact');
      await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    }
    expect(generate).toHaveBeenCalledTimes(4);
    await render('Read-only folder', true);
    const fallback = host.querySelector('.design-toolbar-actions button');
    expect(fallback.getAttribute('aria-label')).toBe('Design Management actions');
    expect(host.querySelectorAll('.design-toolbar-actions button')).toHaveLength(1);
  } finally { await act(async () => root.unmount()); host.remove(); }
});
