import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { TraceabilityView } from './RequirementsViews';

beforeAll(() => { global.IS_REACT_ACT_ENVIRONMENT = true; });
afterAll(() => { delete global.IS_REACT_ACT_ENVIRONMENT; });

jest.mock('lucide-react', () => new Proxy({}, { get: (_target, key) => key === '__esModule' ? true : () => null }));

test('large trace lists page every relationship while preserving total metrics', async () => {
  const host = document.createElement('div'); document.body.appendChild(host);
  const root = createRoot(host);
  const targets = Array.from({ length: 201 }, (_, i) => ({ id: `target-${i}`, title: `Target ${i}`, module: 'Targets' }));
  const source = { id: 'source', module: 'Source', links: targets.map(target => ({ type: 'refines', toId: target.id })) };
  try {
    await act(async () => root.render(<TraceabilityView allRequirements={[source, ...targets]} selectedModule="Source" pageSize={100} />));
    const nav = () => host.querySelector('[aria-label="Relationships pages"]');
    const next = () => [...nav().querySelectorAll('button')].find(button => button.textContent === 'Next');
    expect(host.querySelectorAll('tbody tr')).toHaveLength(100);
    expect(nav().textContent).toContain('1–100 of 201');
    expect([...host.querySelectorAll('dt')].find(item => item.textContent === 'Edges').nextElementSibling.textContent).toBe('201');
    await act(async () => next().click());
    expect(nav().textContent).toContain('101–200 of 201');
    await act(async () => next().click());
    expect(host.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(host.querySelector('tbody').textContent).toContain('Target 200');
    expect(next().disabled).toBe(true);
    await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === 'Refined by').click());
    expect(host.textContent).toContain('No links found for this view.');
    await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === 'Refines').click());
    expect(nav().textContent).toContain('1–100 of 201');
  } finally { await act(async () => root.unmount()); host.remove(); }
});

test('trace selection supports keyboard and multiselect for local objects while source evidence stays read-only', async () => {
  const host = document.createElement('div'); document.body.appendChild(host);
  const root = createRoot(host), onSelect = jest.fn();
  const rows = [{ id: 'local', title: 'Local requirement', module: 'Source', links: [{ type: 'refines', toId: 'evidence' }] }, { id: 'evidence', title: 'Recorded evidence', module: 'Snapshot', links: [] }];
  try {
    await act(async () => root.render(<TraceabilityView allRequirements={rows} selectedModule="Source" selectedId="local" selectedIds={new Set(['local'])} onSelect={onSelect} canSelect={id => id === 'local'} />));
    const local = host.querySelector('[data-artifact-object-id="local"]'), evidence = host.querySelector('[data-artifact-object-id="evidence"]');
    expect(local.getAttribute('aria-pressed')).toBe('true');
    expect(evidence.getAttribute('role')).toBeNull();
    await act(async () => local.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, shiftKey: true })));
    expect(onSelect).toHaveBeenCalledWith('local', expect.objectContaining({ shiftKey: true }));
    onSelect.mockClear(); await act(async () => evidence.click()); expect(onSelect).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); host.remove(); }
});
