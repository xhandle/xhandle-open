import React from 'react';
import { BriefcaseBusiness, FolderGit2, Compass, ListChecks, Layers3, FileCode2, Cpu, DraftingCompass, Component,
  Cable, Network, Workflow, TriangleAlert, ShieldCheck, Waypoints, History, Library, FileText, FileQuestion, CheckCheck, Box } from 'lucide-react';

const artifactIcons = {
  conops: ['operations', Compass, '#7c3aed'],
  'system-spec': ['system-requirements', ListChecks, '#2563eb'],
  'subsystem-spec': ['subsystem-requirements', Layers3, '#0891b2'],
  'software-spec': ['software-requirements', FileCode2, '#0d9488'],
  'hardware-spec': ['hardware-requirements', Cpu, '#c2410c'],
  'system-design': ['system-design', DraftingCompass, '#4f46e5'],
  'subsystem-design': ['subsystem-design', Component, '#9333ea'],
  'interface-spec': ['interfaces', Cable, '#0369a1'],
  architecture: ['architecture', Network, '#4f46e5'],
  'hazard-tracking-list': ['hazards', TriangleAlert, '#b45309'],
  'safety-requirements': ['safety-requirements', ShieldCheck, '#15803d'],
  'traceability-matrix': ['traceability', Waypoints, '#6d28d9'],
};
const typeIcons = {
  'systems-engineering-project': ['project', BriefcaseBusiness, '#4338ca'],
  'owning-project': ['source-project', FolderGit2, '#2563eb'],
  'architecture-diagram': ['diagram', Workflow, '#4f46e5'],
  'supporting-sources': ['sources', Library, '#64748b'],
  'source-snapshot': ['saved-source', History, '#a16207'],
  'hazard-tracking-record': ['hazard-record', TriangleAlert, '#b45309'],
  'architecture-element': ['architecture-element', Box, '#4f46e5'],
  requirement: ['requirement', CheckCheck, '#2563eb'],
  unavailable: ['unavailable', FileQuestion, '#b45309'],
};

export function traceIconDefinition(node, metadata) {
  const template = metadata?.templateId || node.templateId;
  if (node.type === 'artifact' && template === 'architecture' && metadata?.config?.architectureKind === 'code-based') return ['code-architecture', Cpu, '#7c3aed'];
  return (node.type === 'artifact' && artifactIcons[template]) || typeIcons[node.type] || ['document', FileText, '#64748b'];
}

export default function TraceArtifactIcon({ node, metadata }) {
  const [name, Icon, color] = traceIconDefinition(node, metadata);
  return <span className="project-trace-icon" data-icon={name} style={{ color }}><Icon aria-hidden="true" size={44} strokeWidth={1.6} /></span>;
}
