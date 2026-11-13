import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import ArtifactDocumentLayout from './ArtifactDocumentLayout';
jest.mock('lucide-react', () => ({ ChevronLeft: () => null, ChevronRight: () => null }));

test('contents navigate only the document and collapse without losing the reading position', async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<ArtifactDocumentLayout sections={[{ id: 'scope', title: 'Scope' }]}><article><section id="scope"><h2>Scope</h2></section></article></ArtifactDocumentLayout>));
    const reader = host.querySelector('.artifact-document-reader');
    const target = host.querySelector('#scope');
    reader.scrollTop = 50;
    reader.getBoundingClientRect = () => ({ top: 100 });
    target.getBoundingClientRect = () => ({ top: 400 });
    const hash = window.location.hash;
    await act(async () => host.querySelector('a').click());
    expect(reader.scrollTop).toBe(330);
    expect(window.location.hash).toBe(hash);
    expect(document.activeElement).toBe(target);
    await act(async () => host.querySelector('button').click());
    expect(host.querySelector('nav').hidden).toBe(true);
    expect(host.querySelector('button').getAttribute('aria-label')).toBe('Show document outline');
    expect(reader.scrollTop).toBe(330);
    await act(async () => host.querySelector('button').click());
    expect(host.querySelector('nav').hidden).toBe(false);
    expect(reader.scrollTop).toBe(330);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
