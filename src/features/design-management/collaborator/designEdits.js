import { readDesignTarget } from './designContext';
import { applyDesignActions, designVersion, undoDesignActions, verifyDesignSave } from './designProposal';
import { saveObjects, saveDraftObjects } from '../artifacts/artifactRepository';
import { saveRequirements, loadRequirements, loadFolders } from '../../requirements/actions/requirementsState';
import { saveSysMLV2Model } from '../SysMLV2Modeler/sysmlV2Store';
import { SYSML_ELEMENT_TYPES, SYSML_RELATIONSHIP_TYPES } from '../SysMLV2Modeler/sysmlV2Types';
import { validateModuleRows } from '../../requirements/actions/normalizeModuleRows';

const MODULE_UNDO_KEY = 'xhandle.designManagement.collaboratorModuleUndo';
const moduleRows = (rows, data) => rows.filter(row => (row.folderId ?? row.projectId) === data.folder.id && (row.moduleId === data.module.id || (!row.moduleId && row.module === data.module.name)));
const assertEditableModule = (data, canEditModule) => {
  if (!canEditModule?.(data.target)) throw Error('This design module is read-only. Open an editable module before applying changes.');
  if (!loadFolders().some(folder => folder.id === data.folder.id && folder.modules?.some(module => module.id === data.module.id))) throw Error('The target module no longer exists.');
};

async function commit(data, objects, edit, canEditModule) {
  if (data.target.kind === 'artifact') {
    if (data.readOnly) throw Error('Pause generation before applying design changes.');
    if (data.target.draft) await saveDraftObjects(data.target.id, data.job, objects, { collaboratorEdit: edit });
    else await saveObjects(data.target.id, data.meta.revision, objects, { collaboratorEdit: edit });
  } else if (data.target.kind === 'sysml') {
    // No async work between the second read and localStorage's atomic setItem.
    // Keep diagram geometry and trace links; only canonical objects change.
    const current = await readDesignTarget(data.target);
    if (designVersion(current) !== designVersion(data)) throw Error('The model changed. Review a fresh proposal.');
    saveSysMLV2Model({ ...current.model, collaboratorEdit: edit,
      elements: objects.filter(row => SYSML_ELEMENT_TYPES.includes(row.type)), relationships: objects.filter(row => SYSML_RELATIONSHIP_TYPES.includes(row.type)) }, { preserveProject: true });
  } else {
    assertEditableModule(data, canEditModule);
    const all = loadRequirements();
    if (designVersion({ ...data, objects: moduleRows(all, data) }) !== designVersion(data)) throw Error('The module changed. Review a fresh proposal.');
    const ids = new Set(data.objects.map(row => row.id));
    const remaining = all.filter(row => !ids.has(row.id));
    const removed = new Set(data.objects.filter(row => !objects.some(next => next.id === row.id)).map(row => row.id));
    if (remaining.some(row => row.links?.some(link => removed.has(link.toId) || removed.has(link.targetId)))) throw Error('Another module links to this requirement. Remove that link before deleting it.');
    validateModuleRows(objects, remaining, data.folder.id, data.module.id, data.module.name);
    const now = new Date().toISOString(), before = new Map(data.objects.map(row => [row.id, row]));
    const audited = objects.map(row => {
      const prior = before.get(row.id);
      if (JSON.stringify(row) === JSON.stringify(prior)) return row;
      return { ...row, updatedAt: now, version: (prior?.version || 0) + 1, history: [...(prior?.history || []), ...(prior ? [{
        at: now, version: prior.version || 1, title: prior.title, attributes: prior.attributes, reason: edit.undone ? 'Undid Collaborator edit' : 'Collaborator edit',
      }] : [])] };
    });
    const previousUndo = localStorage.getItem(MODULE_UNDO_KEY);
    localStorage.setItem(MODULE_UNDO_KEY, JSON.stringify({ target: data.target, edit }));
    try { saveRequirements([...remaining, ...audited], { source: 'design-collaborator' }); }
    catch (error) {
      if (previousUndo === null) localStorage.removeItem(MODULE_UNDO_KEY); else localStorage.setItem(MODULE_UNDO_KEY, previousUndo);
      throw error;
    }
  }
  return readDesignTarget(data.target);
}

let applying = false;
export async function applyDesignProposal(plan, { threadId, canEditModule } = {}) {
  if (applying) throw Error('A design edit is already being saved.');
  applying = true;
  try {
    if (plan?.domain !== 'design-management' || plan.threadId !== threadId || plan.completed || !plan.id) throw Error('This proposal is no longer pending in this conversation.');
    const data = await readDesignTarget(plan.target);
    if (designVersion(data) !== plan.version) throw Error('This design changed after the proposal was prepared. Ask Collaborator for a fresh proposal.');
    const result = applyDesignActions(data, plan.actions);
    const edit = { id: plan.id, threadId, undo: result.undo };
    const saved = await commit(data, result.objects, edit, canEditModule);
    // Verify the actual persisted changed fields, allowing canonical repository
    // normalization (e.g. safety-requirement organization and HTR numbering).
    verifyDesignSave(saved, plan.actions);
    return { summary: `Saved ${plan.actions.length} design change${plan.actions.length === 1 ? '' : 's'} in ${data.title}.`, target: data.target,
      undo: { editId: edit.id, target: data.target, version: designVersion(saved), threadId } };
  } finally { applying = false; }
}

export async function undoDesignProposal(token, { threadId, canEditModule } = {}) {
  if (applying) throw Error('A design edit is already being saved.');
  applying = true;
  try {
    if (!token || token.threadId !== threadId) throw Error('There is no design edit to undo in this conversation.');
    const data = await readDesignTarget(token.target);
    if (designVersion(data) !== token.version) throw Error('The design has changed since this edit. Undo will not overwrite newer work.');
    let edit = data.target.kind === 'artifact' ? (data.target.draft ? data.job : data.revision)?.collaboratorEdit : data.model?.collaboratorEdit;
    if (data.target.kind === 'module') {
      const stored = JSON.parse(localStorage.getItem(MODULE_UNDO_KEY) || 'null');
      if (stored?.target.id === data.target.id && stored?.target.folderId === data.target.folderId) edit = stored.edit;
    }
    if (!edit || edit.id !== token.editId || edit.threadId !== threadId || edit.undone) throw Error('This design edit has already been undone or superseded.');
    await commit(data, undoDesignActions(data.objects, edit.undo), { ...edit, undo: [], undone: true }, canEditModule);
    return { summary: `Undid the Collaborator edit in ${data.title}.`, target: data.target };
  } finally { applying = false; }
}
