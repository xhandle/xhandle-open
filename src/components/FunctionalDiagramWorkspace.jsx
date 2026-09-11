import React, { useEffect, useRef, useState } from 'react';

export const FUNCTIONAL_VIEW_MODES = Object.freeze({
  DIAGRAM: 'diagram',
  TABLE: 'table',
  SPLIT: 'split',
});

const VIEW_OPTIONS = [
  [FUNCTIONAL_VIEW_MODES.DIAGRAM, 'Diagram'],
  [FUNCTIONAL_VIEW_MODES.TABLE, 'Table'],
  [FUNCTIONAL_VIEW_MODES.SPLIT, 'Split'],
];

const modeShowsDiagram = (mode) => mode !== FUNCTIONAL_VIEW_MODES.TABLE;

export default function FunctionalDiagramWorkspace({
  viewMode,
  onViewModeChange,
  onDiagramResize,
  diagram,
  table,
  tableActions,
}) {
  const [diagramPercent, setDiagramPercent] = useState(50);
  const workspaceRef = useRef(null);
  const previousModeRef = useRef(viewMode);

  useEffect(() => {
    const previousMode = previousModeRef.current;
    previousModeRef.current = viewMode;
    if (previousMode === viewMode || !modeShowsDiagram(viewMode)) return undefined;

    const frame = window.requestAnimationFrame(() => onDiagramResize?.());
    return () => window.cancelAnimationFrame(frame);
  }, [onDiagramResize, viewMode]);

  const startResize = (event) => {
    if (viewMode !== FUNCTIONAL_VIEW_MODES.SPLIT || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const workspace = workspaceRef.current;
    if (!workspace) return;

    const update = (clientX) => {
      const bounds = workspace.getBoundingClientRect();
      if (!bounds.width) return;
      const nextPercent = ((clientX - bounds.left) / bounds.width) * 100;
      setDiagramPercent(Math.min(75, Math.max(25, nextPercent)));
    };
    const handleMove = (moveEvent) => update(moveEvent.clientX);
    const handleUp = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      onDiagramResize?.();
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp, { once: true });
  };

  const diagramVisible = modeShowsDiagram(viewMode);
  const tableVisible = viewMode !== FUNCTIONAL_VIEW_MODES.DIAGRAM;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden" data-testid="functional-workspace">
      <div className="mb-3 flex shrink-0 flex-wrap items-center justify-center gap-3">
        {tableVisible && tableActions}
        <div
          className="inline-flex rounded-lg border border-gray-200 bg-gray-100 p-1 shadow-sm"
          role="radiogroup"
          aria-label="Functional diagram view"
        >
          {VIEW_OPTIONS.map(([mode, label]) => {
            const selected = viewMode === mode;
            return (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onViewModeChange(mode)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7A37FF] focus-visible:ring-offset-2 ${
                  selected ? 'bg-[#7A37FF] text-white shadow-sm' : 'text-gray-700 hover:bg-white'
                }`}
              >
                {label}{mode === FUNCTIONAL_VIEW_MODES.SPLIT ? ' view' : ''}
              </button>
            );
          })}
        </div>
      </div>

      <div ref={workspaceRef} className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden md:flex-row md:gap-0">
        <section
          aria-label="Functional architecture diagram"
          className={`${diagramVisible ? 'flex' : 'hidden'} min-h-0 min-w-0 flex-col overflow-hidden`}
          style={{ flexBasis: viewMode === FUNCTIONAL_VIEW_MODES.SPLIT ? `${diagramPercent}%` : '100%' }}
        >
          {diagram}
        </section>

        {viewMode === FUNCTIONAL_VIEW_MODES.SPLIT && (
          <div
            role="separator"
            aria-label="Resize diagram and table panes"
            aria-orientation="vertical"
            aria-valuemin={25}
            aria-valuemax={75}
            aria-valuenow={Math.round(diagramPercent)}
            tabIndex={0}
            onPointerDown={startResize}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
              event.preventDefault();
              setDiagramPercent((value) => Math.min(75, Math.max(25, value + (event.key === 'ArrowRight' ? 5 : -5))));
              window.requestAnimationFrame(() => onDiagramResize?.());
            }}
            className="group hidden w-3 shrink-0 cursor-col-resize items-stretch justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7A37FF] md:flex"
          >
            <span className="w-px bg-gray-200 transition-colors group-hover:bg-[#7A37FF]" />
          </div>
        )}

        <section
          aria-label="Functional decomposition table"
          className={`${tableVisible ? 'flex' : 'hidden'} min-h-0 min-w-0 flex-col overflow-hidden`}
          style={{ flexBasis: viewMode === FUNCTIONAL_VIEW_MODES.SPLIT ? `${100 - diagramPercent}%` : '100%' }}
        >
          {table}
        </section>
      </div>
    </div>
  );
}
