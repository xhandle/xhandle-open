import DesignDialogForm from '../../requirements/components/DesignDialogForm';
import { ProfileSelect } from '../traceability/TraceabilityProfilesDialog';
import { defaultSelection } from '../traceability/traceabilityRepository';
import { folderDestinations } from './folderDestinations';
import ArchitectureSourcePicker, { ArchitectureKindSelect } from './ArchitectureSourcePicker';
import React, { useEffect, useState } from 'react';
import { saveFolders } from '../../requirements/actions/requirementsState';
import { CREATABLE_ARTIFACT_TEMPLATES as ARTIFACT_TEMPLATES, getTemplate, newId } from './artifactModel';
import { availableProjects, ownerKey, readArray } from './artifactSources';
import { createEngineeringProject } from './engineeringProjectRepository';
import { requirementDerivationMode, requirementDerivationFlow, requirementPrerequisites, upstreamRequirementTemplate } from './requirementDerivation';

const makeDocument = template => ({ key: newId(), templateId: template.id, architectureKind: 'system', title: template.name, subsystem: '', endpointA: '', endpointB: '' });

export default function EngineeringProjectDialog({ activeFolderId, onClose, onCreated, libraryProjects = [] }) {
  const [catalog, setCatalog] = useState(() => { try { return { projects: availableProjects(), folders: readArray('xhandle:req-projects') }; } catch (error) { return { projects: [], folders: [], error: error.message }; } });
  const [name, setName] = useState('');
  const [system, setSystem] = useState('');
  const [folderId, setFolderId] = useState(activeFolderId || '');
  const [newFolder, setNewFolder] = useState(null);
  const [owners, setOwners] = useState([]);
  const [traceabilityProfile, setTraceabilityProfile] = useState(defaultSelection);
  const [architectureSources, setArchitectureSources] = useState([]);
  const [artifacts, setArtifacts] = useState(() => ['conops', 'system-spec'].map(id => makeDocument(getTemplate(id))));
  const [error, setError] = useState(catalog.error || '');
  const [busy, setBusy] = useState(false);
  const mode = requirementDerivationMode({ architectureSources, owners });
  useEffect(() => setArtifacts(items => {
    const next = requirementPrerequisites(items, { requirementDerivation: mode });
    return next.length === items.length ? items : next.map(item => item.key ? item : makeDocument(getTemplate(item.templateId)));
  }), [mode]);
  const changeItem = (key, patch) => setArtifacts(items => items.map(item => item.key === key ? { ...item, ...patch } : item));
  const toggleDocument = (template, checked) => setArtifacts(items => {
    if (!checked) {
      const removed = new Set([template.id]);
      for (let index = 0; index < items.length; index++) for (const item of items) if (removed.has(upstreamRequirementTemplate({ ...item, requirementDerivation: mode }))) removed.add(item.templateId);
      return items.filter(item => !removed.has(item.templateId));
    }
    const next = [...items, makeDocument(template)];
    return requirementPrerequisites(next, { requirementDerivation: mode }).map(item => item.key ? item : makeDocument(getTemplate(item.templateId)));
  });
  const toggleOwner = project => {
    const key = ownerKey(project), selected = owners.some(owner => ownerKey(owner) === key);
    setOwners(selected ? owners.filter(owner => ownerKey(owner) !== key) : [...owners, { id: project.id, workspaceType: project.workspaceType }]);
    if (selected) setArchitectureSources(items => items.filter(item => !(item.projectId === project.id && item.workspaceType === project.workspaceType)));
  };
  const createDestination = () => {
    setError('');
    try {
      const name = newFolder.name.trim();
      if (!name || name.length > 200) throw new Error('Enter a folder name (up to 200 characters).');
      const folders = readArray('xhandle:req-projects');
      if (newFolder.parentId && !folders.some(folder => folder.id === newFolder.parentId)) throw new Error('The parent folder is unavailable.');
      const folder = { id: `FOL-${newId()}`, name, parentId: newFolder.parentId || null, modules: [], roles: { Owner: [], Editor: [], Viewer: [] }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      saveFolders([...folders, folder], { source: 'engineering-project-dialog', folderId: folder.id });
      setCatalog(current => ({ ...current, folders: [...folders, folder] }));
      setFolderId(folder.id); setNewFolder(null);
    } catch (error) { setError(error.message); }
  };
  const submit = async event => {
    event.preventDefault(); setBusy(true); setError('');
    try { const id = await createEngineeringProject({ name, system, folderId, owners, architectureSources, artifacts, traceabilityProfile }); onCreated(id); onClose(); }
    catch (error) { setError(error.message); } finally { setBusy(false); }
  };
  return <div className="artifact-modal" role="dialog" aria-modal="true" aria-label="Generate systems engineering project"><DesignDialogForm className="artifact-form" onSubmit={submit} footer={<div className="artifact-actions"><button type="button" disabled={busy} onClick={onClose}>Cancel</button><button className="primary" disabled={busy || !artifacts.length}>{busy ? 'Creating…' : 'Create systems engineering project'}</button></div>}>
    <h2>Generate a systems engineering project</h2><p>Select the documents and owning projects. Documents will be generated together with project ownership and cross-document traceability.</p>
    {error && <p role="alert" className="artifact-error">{error}</p>}
    <label>Project name<input required maxLength={200} value={name} onChange={e => setName(e.target.value)} /></label>
    <ProfileSelect value={traceabilityProfile} onChange={setTraceabilityProfile} />
    <div className="artifact-fields"><label>System<input required value={system} onChange={e => setSystem(e.target.value)} /></label><label>Destination folder<select required value={folderId} onChange={e => setFolderId(e.target.value)}><option value="">Choose folder</option>{folderDestinations(catalog.folders, libraryProjects).map(folder => <option key={folder.id} value={folder.id}>{folder.path}</option>)}</select></label></div>
    <button type="button" disabled={busy} onClick={() => setNewFolder({ name: '', parentId: folderId })}>Create destination folder</button>
    {newFolder && <fieldset><legend>New destination folder</legend><label className="block my-2">Folder name<input autoFocus maxLength={200} value={newFolder.name} onChange={e => setNewFolder({ ...newFolder, name: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); createDestination(); } }} /></label><label className="block my-2">Parent folder<select value={newFolder.parentId} onChange={e => setNewFolder({ ...newFolder, parentId: e.target.value })}><option value="">Top level</option>{folderDestinations(catalog.folders, libraryProjects).map(folder => <option key={folder.id} value={folder.id}>{folder.path}</option>)}</select></label><div className="artifact-actions"><button type="button" disabled={busy || !newFolder.name.trim()} onClick={createDestination}>Create folder</button><button type="button" onClick={() => setNewFolder(null)}>Cancel new folder</button></div></fieldset>}
    <fieldset><legend>Owning source projects</legend><div className="artifact-source-picker">{catalog.projects.map(project => <label key={ownerKey(project)}><input type="checkbox" checked={owners.some(owner => ownerKey(owner) === ownerKey(project))} onChange={() => toggleOwner(project)} />{project.name} ({project.workspaceType})</label>)}</div></fieldset>
    <ArchitectureSourcePicker owners={owners} value={architectureSources} onChange={setArchitectureSources} showScopeFields={false} />
    <fieldset><legend>Artifacts to generate</legend><p>Check the document types to include. Customize their titles and scopes below.</p>
      <div className="artifact-actions"><button type="button" onClick={() => setArtifacts(items => [...items, ...ARTIFACT_TEMPLATES.filter(template => !items.some(item => item.templateId === template.id)).map(makeDocument)])}>Select all document types</button><button type="button" onClick={() => setArtifacts([])}>Clear selection</button></div>
      <div className="grid gap-2 sm:grid-cols-2 my-3">{ARTIFACT_TEMPLATES.map(template => <label key={template.id} className="rounded border p-3"><span><input type="checkbox" checked={artifacts.some(item => item.templateId === template.id)} onChange={e => toggleDocument(template, e.target.checked)} /> {template.name}</span></label>)}</div>
      {ARTIFACT_TEMPLATES.filter(template => artifacts.some(item => item.templateId === template.id)).map(template => <div key={template.id} className="rounded border p-3 mb-3"><h3 className="font-semibold">{template.name}</h3>
        {artifacts.filter(item => item.templateId === template.id).map((item, index, instances) => <div key={item.key} className="py-2"><label>Document title<input required maxLength={200} value={item.title} onChange={e => changeItem(item.key, { title: e.target.value })} /></label>
          {template.id === 'architecture' && <ArchitectureKindSelect value={item.architectureKind} onChange={architectureKind => changeItem(item.key, { architectureKind })} />}
          {template.scope === 'subsystem' && <label>Subsystem<input required value={item.subsystem} onChange={e => changeItem(item.key, { subsystem: e.target.value })} /></label>}
          {template.scope === 'interface' && <div className="artifact-fields"><label>Endpoint A<input required value={item.endpointA} onChange={e => changeItem(item.key, { endpointA: e.target.value })} /></label><label>Endpoint B<input required value={item.endpointB} onChange={e => changeItem(item.key, { endpointB: e.target.value })} /></label></div>}
          {instances.length > 1 && <button type="button" onClick={() => setArtifacts(items => items.filter(row => row.key !== item.key))}>Remove instance {index + 1}</button>}
        </div>)}
        {(template.scope === 'subsystem' || template.scope === 'interface' || template.scope === 'architecture') && <button type="button" disabled={artifacts.length >= 24} onClick={() => setArtifacts(items => [...items, makeDocument(template)])}>Add another {template.scope} — {template.name}</button>}
      </div>)}
      <p>{artifacts.length} documents selected. {requirementDerivationFlow({ requirementDerivation: mode })}.</p>
    </fieldset>

  </DesignDialogForm></div>;
}
