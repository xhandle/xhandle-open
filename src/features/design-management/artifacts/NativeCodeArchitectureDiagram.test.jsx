import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import NativeCodeArchitectureDiagram from './NativeCodeArchitectureDiagram';

const mockProps = [];
jest.mock('./NativeArchitectureDiagram', () => {
  const React = require('react');
  return React.forwardRef(function Canvas(props, ref) {
    mockProps.push(props);
    React.useImperativeHandle(ref, () => ({ flushPresentation: jest.fn(), isReady: () => true }));
    return <div data-projects-canvas />;
  });
});
beforeEach(() => { global.IS_REACT_ACT_ENVIRONMENT = true; mockProps.length = 0; });
const node = { id: 'target', label: 'Target', displayArchitecture: { subsystem: 'Control', csci: 'Application', csc: 'Planner', csu: 'Unit' } };
const snapshot = { nodes: [node], edges: [] };

test('metadata refresh preserves shared canvas identity; changed revisions reload', async () => {
  const host = document.createElement('div'), root = createRoot(host);
  const diagram = { id: 'saved', diagramHash: 'revision-1', abstraction: 'csc', snapshot };
  try {
    await act(async () => root.render(<NativeCodeArchitectureDiagram diagram={diagram} />));
    const first = mockProps.at(-1).diagram;
    await act(async () => root.render(<NativeCodeArchitectureDiagram diagram={JSON.parse(JSON.stringify(diagram))} />));
    expect(mockProps.at(-1).diagram).toBe(first);
    await act(async () => root.render(<NativeCodeArchitectureDiagram diagram={{ ...diagram, diagramHash: 'revision-2' }} />));
    expect(mockProps.at(-1).diagram).not.toBe(first);
  } finally { act(() => root.unmount()); }
});

test.each(['functional', 'csc'])('%s artifacts use the Projects canvas, preserving focus, inspection and presentation saves', async abstraction => {
  const host = document.createElement('div'), root = createRoot(host), onSelect = jest.fn(), onPresentationChange = jest.fn();
  const diagram = { id: 'saved', abstraction, snapshot };
  try {
    await act(async () => root.render(<NativeCodeArchitectureDiagram diagram={diagram} editable focusId="target" onSelect={onSelect} onPresentationChange={onPresentationChange} />));
    const props = mockProps.at(-1);
    expect(host.querySelector('[data-projects-canvas]')).not.toBeNull();
    expect(props).toMatchObject({ editable: true, onPresentationChange });
    const focused = props.diagram.snapshot.nodes.find(item => item.id === props.focusId);
    expect(focused.group).toBe(false);
    props.onSelect(focused.id);
    expect(onSelect).toHaveBeenCalledWith('target');
  } finally { act(() => root.unmount()); }
});
