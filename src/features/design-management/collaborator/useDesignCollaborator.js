import { useEffect, useRef } from 'react';
import { getActionProvider, registerActionProvider } from '../../app/actionRegistry';
import { DESIGN_PROVIDER, DESIGN_SURFACE, DESIGN_DIAGRAM, DESIGN_REVEAL, readDesignEvidence } from './designContext';
import { prepareDesignProposal } from './designProposal';
import { applyDesignProposal, undoDesignProposal } from './designEdits';

export function useDesignSurface(state, clearSelection, scope = DESIGN_SURFACE) {
  const clearRef = useRef(clearSelection); clearRef.current = clearSelection;
  const stateRef = useRef(state); stateRef.current = state;
  // Artifact projections may rebuild their object index on an ordinary parent
  // render. Registering that new object identity notifies App, which rerenders
  // the projection again. Notify only when the bounded UI context changes.
  const signature = JSON.stringify({ ...state, ...(Array.isArray(state?.selectedIds)
    ? { selectedIds: state.selectedIds.slice(0, 24), selectedCount: state.selectedIds.length } : {}) });
  const previousSignature = useRef(signature);
  useEffect(() => registerActionProvider(scope, { getState: () => stateRef.current, clearSelection: () => clearRef.current?.() }), [scope]);
  useEffect(() => {
    if (previousSignature.current === signature) return;
    previousSignature.current = signature;
    window.dispatchEvent(new CustomEvent('xhandle:action-registry-changed', { detail: { scope } }));
  }, [scope, signature]);
}

export function designWorkspaceState({ mode, selectedId, modules }) {
  const requirements = getActionProvider('requirements');
  const library = (requirements?.getDesignState || requirements?.getState)?.() || {};
  const surface = getActionProvider(DESIGN_SURFACE)?.getState?.();
  const meta = modules.find(row => row.id === selectedId);
  let current;
  if (mode === 'sysml' && surface?.target?.kind === 'sysml') current = surface;
  else if (mode === 'natural' && selectedId && surface?.target?.id === selectedId) current = surface;
  else if (mode === 'natural' && selectedId) current = { target: { kind: meta?.templateId ? 'artifact' : 'project', id: selectedId }, title: meta?.title || 'Design document', selectedIds: [] };
  else if (mode === 'natural' && library.libraryView === 'module' && library.selectedModuleId) current = {
    target: { kind: 'module', id: library.selectedModuleId, folderId: library.activeFolderId }, title: library.selectedModule, view: library.viewMode,
    selectedIds: library.selectedRowIds || [],
  };
  const diagram = current?.view === 'diagram' ? getActionProvider(DESIGN_DIAGRAM)?.getState?.() : null;
  const sourceSelection = diagram?.artifactId === current?.target?.id ? diagram : null;
  const selectedCount = current?.selectedIds?.length || 0, selectedIds = (current?.selectedIds || []).slice(0, 24);
  const ownerIds = meta?.config?.ownerProjects?.map(owner => owner.id) || (meta?.config?.projectId ? [meta.config.projectId] : []);
  return { mode, folderId: library.activeFolderId || null, folderName: library.activeFolderName, view: current?.view || 'library',
    ...(ownerIds.length === 1 ? { organizationProjectId: ownerIds[0] } : {}),
    title: current?.title || library.activeFolderName || 'Design library', target: current?.target || null,
    selectedIds, selectedCount, selectionTruncated: selectedCount > selectedIds.length, ...(current?.cell ? { cell: current.cell } : {}),
    ...(sourceSelection ? { diagram: sourceSelection } : {}),
    activeSelections: current && (current.selectedIds?.length || current.cell || sourceSelection?.elementId) ? [{ kind: 'design-management', source: 'design-management', id: current.target.id,
      title: `${current.title} · ${selectedCount || 1} selected`,
      values: { target: current.target, view: current.view, selectedIds, selectedCount, selectionTruncated: selectedCount > selectedIds.length, ...(current.cell ? { cell: current.cell } : {}), ...(sourceSelection ? { diagram: sourceSelection } : {}) } }] : [] };
}

export function useDesignCollaborator({ mode, selectedId, modules, openArtifact, openLibrary, setMode }) {
  const inputs = useRef(null); inputs.current = { mode, selectedId, modules, openArtifact, openLibrary, setMode };
  useEffect(() => registerActionProvider(DESIGN_PROVIDER, {
    getState: () => designWorkspaceState(inputs.current),
    read: readDesignEvidence,
    prepareProposal: (raw, evidence, { threadId } = {}) => prepareDesignProposal(raw, evidence, threadId),
    executeWorkspaceActionPlan: ({ plan, threadId }) => {
      if (plan.target?.kind === 'artifact' && getActionProvider('requirements')?.getState?.().canEditArtifacts !== true) throw Error('This design document is read-only.');
      return applyDesignProposal(plan, { threadId, canEditModule: target => getActionProvider('requirements')?.canEditDesignModule?.(target) === true });
    },
    undoLastWorkspaceAction: ({ token, threadId }) => {
      if (token?.target?.kind === 'artifact' && getActionProvider('requirements')?.getState?.().canEditArtifacts !== true) throw Error('This design document is read-only.');
      return undoDesignProposal(token, { threadId, canEditModule: target => getActionProvider('requirements')?.canEditDesignModule?.(target) === true });
    },
    clearSelection: () => {
      getActionProvider(DESIGN_SURFACE)?.clearSelection?.();
      getActionProvider(DESIGN_DIAGRAM)?.clearSelection?.();
      getActionProvider('requirements')?.clearSelection?.();
    },
    openWorkspaceArtifact: async reference => {
      const target = reference.designTarget || reference.target || reference;
      if (target.kind === 'artifact' || target.kind === 'project') inputs.current.openArtifact(target.id, reference.objectId || '', target.draft);
      else if (target.kind === 'sysml') {
        inputs.current.setMode('sysml');
        setTimeout(() => window.dispatchEvent(new CustomEvent(DESIGN_REVEAL, { detail: { ...target, objectId: reference.objectId } })), 0);
      } else if (target.kind === 'module') {
        const { loadFolders } = await import('../../requirements/actions/requirementsState');
        const module = loadFolders().find(row => row.id === target.folderId)?.modules?.find(row => row.id === target.id);
        if (!module) throw Error('This design module no longer exists.');
        inputs.current.openLibrary({ folderId: target.folderId, moduleName: module.name, objectId: reference.objectId });
      } else if (target.kind === 'folder') inputs.current.openLibrary({ folderId: target.id });
      else throw Error('The design reference is unavailable.');
    },
  }), []);
  // Metadata/selection notifications already rerender App without hydrating any
  // content. Refresh the main provider on mode/library changes as well.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('xhandle:action-registry-changed', { detail: { scope: DESIGN_PROVIDER } }));
  }, [mode, selectedId, modules]);
}
