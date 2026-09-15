// src/components/GroupBoxNode.jsx
import { Handle, Position } from 'reactflow';

const hiddenHandleStyle = {
  width: 8,
  height: 8,
  opacity: 0,
  border: 'none',
  background: 'transparent',
};

export default function GroupBoxNode({ data }) {
  const { label, groupKind, traceActive, systemElementColor } = data || {};
  const isFunctionGroup = groupKind === 'function';
  const palette = {
    csci: {
      border: '1px solid #2563EB',
      background: 'rgba(37, 99, 235, 0.05)',
      color: '#1D4ED8',
      size: 13,
      weight: 700,
      radius: 18,
    },
    csc: {
      border: '1px solid #14B8A6',
      background: 'rgba(20, 184, 166, 0.055)',
      color: '#0F766E',
      size: 12,
      weight: 700,
      radius: 16,
    },
    csu: {
      border: '1px solid #A855F7',
      background: 'rgba(168, 85, 247, 0.045)',
      color: '#7E22CE',
      size: 12,
      weight: 650,
      radius: 14,
    },
  };
  const arch = palette[groupKind];
  const systemElementStyle = groupKind === 'subsystem' && systemElementColor
    ? {
        border: `2px solid ${systemElementColor}`,
        background: `${systemElementColor}14`,
        color: systemElementColor,
      }
    : null;
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        border: systemElementStyle?.border || arch?.border || (isFunctionGroup ? '1px solid #BFD6FF' : '1px solid #D5D9E0'),
        borderRadius: arch?.radius || (isFunctionGroup ? 20 : 16),
        background: systemElementStyle?.background || arch?.background || (isFunctionGroup ? 'rgba(45, 125, 254, 0.05)' : 'rgba(122, 55, 255, 0.04)'),
        boxShadow: traceActive
          ? 'inset 0 0 0 2px rgba(20,184,166,0.75), 0 0 0 3px rgba(20,184,166,0.18)'
          : 'inset 0 0 0 1px rgba(0,0,0,0.02)',
        position: 'relative',
        pointerEvents: 'none',
      }}
    >
      <Handle type="target" position={Position.Left} id="left-target-0" style={hiddenHandleStyle} />
      <Handle type="source" position={Position.Left} id="left-source-0" style={hiddenHandleStyle} />
      <Handle type="target" position={Position.Right} id="right-target-0" style={hiddenHandleStyle} />
      <Handle type="source" position={Position.Right} id="right-source-0" style={hiddenHandleStyle} />
      <Handle type="target" position={Position.Top} id="top-target-0" style={hiddenHandleStyle} />
      <Handle type="source" position={Position.Top} id="top-source-0" style={hiddenHandleStyle} />
      <Handle type="target" position={Position.Bottom} id="bottom-target-0" style={hiddenHandleStyle} />
      <Handle type="source" position={Position.Bottom} id="bottom-source-0" style={hiddenHandleStyle} />
      <div
        style={{
          position: 'absolute',
          top: 6,
          left: 8,
          padding: '2px 8px',
          fontSize: arch?.size || (isFunctionGroup ? 13 : 12),
          fontWeight: arch?.weight || 600,
          color: systemElementStyle?.color || arch?.color || (isFunctionGroup ? '#1E61D6' : '#2D7DFE'),
          background: 'white',
          border: systemElementStyle?.color ? `1px solid ${systemElementStyle.color}` : '1px solid #E6E8EF',
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
