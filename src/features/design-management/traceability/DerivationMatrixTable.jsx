import React, { useMemo } from 'react';
import EngineeringArtifactTable from '../../code-architecture-assurance/EngineeringArtifactTable';
import { LINEAGE_COLUMNS, LINEAGE_FLOW, LINEAGE_STAGES } from './derivationLineage';

export default function DerivationMatrixTable({ lineage, identity, onOpen, loading, focusObjectId }) {
  const byId = useMemo(() => new Map((lineage?.nodes || []).map(node => [node.id, node])), [lineage]);
  const focus = focusObjectId ? (lineage?.rows || []).filter(row => row.id === focusObjectId || Object.values(row.cellNodes).some(ids => Object.values(ids).includes(focusObjectId))).map(row => row.id) : [];
  return <div className="trace-linear-matrix">
    <p className="trace-flow">{LINEAGE_FLOW}</p>
    <div className="trace-chain-counts"><span>Chains: {lineage?.summary.chains || 0}</span><span>Complete: {lineage?.summary.complete || 0}</span><span>Open: {lineage?.summary.open || 0}</span>{LINEAGE_STAGES.map(stage => <span key={stage.id}>{stage.label}: {lineage?.stageCounts[stage.id] || 0}</span>)}</div>
    <EngineeringArtifactTable rows={lineage?.rows || []} columns={LINEAGE_COLUMNS} storageKey={`design-lineage:${identity}`} loading={loading} loadingLabel="Loading traceability matrix" preparationLabel="Preparing traceability matrix" copyLabel="Copy traceability matrix table" showActions={false} showReview={false} readOnly highlightedRowIds={focus} focusRequestKey={focusObjectId}
      onOpenTrace={({ row, column, value }) => { const node = byId.get(row.cellNodes[column.key]?.[value]); if (node) onOpen(node); }} emptyMessage="No derivation sources are available yet. Select source artifacts or generate the project's documents first." />
  </div>;
}
