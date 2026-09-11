import React, { act, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import FunctionalDiagramWorkspace from './FunctionalDiagramWorkspace';

global.IS_REACT_ACT_ENVIRONMENT = true;

function DiagramMountProbe({ onMount }) {
  useEffect(() => onMount(), [onMount]);
  return <div data-testid="diagram">diagram</div>;
}

function StatefulWorkspace({ onDiagramMount = () => {} }) {
  const [viewMode, setViewMode] = useState('diagram');
  return (
    <FunctionalDiagramWorkspace
      viewMode={viewMode}
      onViewModeChange={setViewMode}
      diagram={<DiagramMountProbe onMount={onDiagramMount} />}
      table={<div data-testid="table">table</div>}
    />
  );
}

let host;
let root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const renderWorkspace = (props = {}) => {
  act(() => root.render(<StatefulWorkspace {...props} />));
};

const clickView = (label) => {
  const button = [...host.querySelectorAll('[role="radio"]')]
    .find((candidate) => candidate.textContent === label);
  act(() => button.click());
  return button;
};

test('split mode renders exactly one diagram and one table', () => {
  renderWorkspace();
  const splitButton = clickView('Split view');

  expect(host.querySelectorAll('[data-testid="diagram"]')).toHaveLength(1);
  expect(host.querySelectorAll('[data-testid="table"]')).toHaveLength(1);
  expect(splitButton.getAttribute('aria-checked')).toBe('true');
  expect(host.querySelectorAll('[role="separator"]')).toHaveLength(1);
});

test('switching view modes does not remount the diagram', () => {
  const onDiagramMount = jest.fn();
  renderWorkspace({ onDiagramMount });

  clickView('Table');
  clickView('Split view');
  clickView('Diagram');

  expect(onDiagramMount).toHaveBeenCalledTimes(1);
});
