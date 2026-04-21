/**
 * xHandle: group box node diagram renderer.
 * This file supports xHandle's diagram rendering layer, which turns functional decomposition rows and related engineering data into interactive visual models.
 * Diagram components are the visual counterpart to the worksheet-driven pipelines, helping users inspect relationships, adjust layouts, and understand how system functions connect.
 * Related files: src/App.js, src/features/functional-architecture/generateFunctionalDecompositionFromGitHub.js, src/components/getLLMLayoutFromRows.js.
 */

// src/components/GroupBoxNode.jsx
export default function GroupBoxNode({ data }) {
  const { label } = data || {};
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        border: '1px solid #D5D9E0',
        borderRadius: 16,
        background: 'rgba(122, 55, 255, 0.04)',
        boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.02)',
        position: 'relative',
        pointerEvents: 'auto',   // ← allow mouse events
        cursor: 'move',          // ← show drag cursor
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 6,
          left: 8,
          padding: '2px 8px',
          fontSize: 12,
          fontWeight: 600,
          color: '#2D7DFE',
          background: 'white',
          border: '1px solid #E6E8EF',
          borderRadius: 8,
          lineHeight: 1.2,
          whiteSpace: 'nowrap',
          boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
          pointerEvents: 'none',
        }}
      >
        {label}
      </div>
    </div>
  );
}

