import { folderDestinations } from './folderDestinations';
import HazardAnalysisNotice, { useHazardAnalysisStatus } from './HazardAnalysisNotice';
import { isSafetyArtifact } from './safetyArtifactTypes';
import ArchitectureSourcePicker, { ArchitectureKindSelect } from './ArchitectureSourcePicker';
import React, { useState } from 'react';
import { saveFolders } from '../../requirements/actions/requirementsState';
import { ARTIFACT_TEMPLATES, newId } from './artifactModel';
import { availableProjects, ownerKey, readArray, sourceCatalog } from './artifactSources';
import { createEngineeringProject } from './engineeringProjectRepository';

export default function EngineeringProjectDialog({ activeFolderId, onClose, onCreated, libraryProjects = [] }) {
  const [catalog, setCatalog] = useState(() => { try { return { projects: availableProjects(), folders: readArray('xhandle:req-projects'), sources: sourceCatalog() }; } catch (error) { return { projects: [], folders: [], sources: [], error: error.message }; } });
  const [name, setName] = useState('');
  const [system, setSystem] = useState('');
  const [folderId, setFolderId] = useState(activeFolderId || '');
  const [newFolder, setNewFolder] = useState(null);
  const [owners, setOwners] = useState([]);
  const [notes, setNotes] = useState('');
  const [projectNotes, setProjectNotes] = useState({});
  const [sources, setSources] = useState([]);
  const [architectureSources, setArchitectureSources] = useState([]);
  const makeDocument = template => ({ key: newId(), templateId: template.id, architectureKind: 'system', title: template.name, subsystem: '', endpointA: '', endpointB: '' });
  const [artifacts, setArtifacts] = useState(() => ARTIFACT_TEMPLATES.slice(0, 2).map(makeDocument));
  const [error, setError] = useState(catalog.error || '');
  const [busy, setBusy] = useState(false);
  const safety = artifacts.some(item => isSafetyArtifact(item.templateId));
  const hazardStatus = useHazardAnalysisStatus(owners, safety);
  const changeItem = (key, patch) => setArtifacts(items => items.map(item => item.key === key ? { ...item, ...patch } : item));
  const toggleOwner = project => {
    const key = ownerKey(project), selected = owners.some(owner => ownerKey(owner) === key);
    setOwners(selected ? owners.filter(owner => ownerKey(owner) !== key) : [...owners, { id: project.id, workspaceType: project.workspaceType }]);
    if (selected) setArchitectureSources(items => items.filter(item => !(item.projectId === project.id && item.workspaceType === project.workspaceType)));
    if (selected) setSources(rows => rows.map(row => row.ownerProject && ownerKey(row.ownerProject) === key ? { ...row, ownerProject: null } : row));
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
    try { const id = await createEngineeringProject({ name, system, folderId, owners, notes, projectNotes, sources, architectureSources, artifacts }); onCreated(id); onClose(); }
    catch (error) { setError(error.message); } finally { setBusy(false); }
  };
  return <div className="artifact-modal" role="dialog" aria-modal="true" aria-label="Generate systems engineering project"><form className="artifact-form" onSubmit={submit}>
    <h2>Generate a systems engineering project</h2><p>Select the documents and owning projects. Documents will be generated together with project ownership and cross-document traceability.</p>
    {error && <p role="alert" className="artifact-error">{error}</p>}
    <label>Project name<input required maxLength={200} value={name} onChange={e => setName(e.target.value)} /></label>
    <div className="artifact-fields"><label>System<input required value={system} onChange={e => setSystem(e.target.value)} /></label><label>Destination folder<select required value={folderId} onChange={e => setFolderId(e.target.value)}><option value="">Choose folder</option>{folderDestinations(catalog.folders, libraryProjects).map(folder => <option key={folder.id} value={folder.id}>{folder.path}</option>)}</select></label></div>
    <button type="button" disabled={busy} onClick={() => setNewFolder({ name: '', parentId: folderId })}>Create destination folder</button>
    {newFolder && <fieldset><legend>New destination folder</legend><label className="block my-2">Folder name<input autoFocus maxLength={200} value={newFolder.name} onChange={e => setNewFolder({ ...newFolder, name: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); createDestination(); } }} /></label><label className="block my-2">Parent folder<select value={newFolder.parentId} onChange={e => setNewFolder({ ...newFolder, parentId: e.target.value })}><option value="">Top level</option>{folderDestinations(catalog.folders, libraryProjects).map(folder => <option key={folder.id} value={folder.id}>{folder.path}</option>)}</select></label><div className="artifact-actions"><button type="button" disabled={busy || !newFolder.name.trim()} onClick={createDestination}>Create folder</button><button type="button" onClick={() => setNewFolder(null)}>Cancel new folder</button></div></fieldset>}
    <fieldset><legend>Owning source projects</legend><div className="artifact-source-picker">{catalog.projects.map(project => <label key={ownerKey(project)}><input type="checkbox" checked={owners.some(owner => ownerKey(owner) === ownerKey(project))} onChange={() => toggleOwner(project)} />{project.name} ({project.workspaceType})</label>)}</div></fieldset>
    <ArchitectureSourcePicker owners={owners} value={architectureSources} onChange={setArchitectureSources} />
    {owners.map(owner => <label key={ownerKey(owner)}>Source notes — {catalog.projects.find(project => ownerKey(project) === ownerKey(owner))?.name}<textarea rows={3} maxLength={20000} value={projectNotes[ownerKey(owner)] || ''} onChange={e => setProjectNotes({ ...projectNotes, [ownerKey(owner)]: e.target.value })} placeholder="Engineering facts, requirements and decisions from this source project" /></label>)}
    <fieldset><legend>Source modules and their owners</legend><p>Assign each selected source module to its owning project. Ownership links identify provenance; source content supplies engineering evidence.</p>{catalog.sources.map(source => {
      const selected = sources.find(row => row.folderId === source.folderId && row.moduleId === source.moduleId);
      return <div key={`${source.folderId}/${source.moduleId}`} className="artifact-fields"><label><span><input type="checkbox" checked={!!selected} onChange={() => setSources(selected ? sources.filter(row => row !== selected) : [...sources, { folderId: source.folderId, moduleId: source.moduleId, ownerProject: owners.length === 1 ? owners[0] : null }])} /> {source.label}</span></label>{selected && <label>Source owner<select required value={selected.ownerProject ? ownerKey(selected.ownerProject) : ''} onChange={e => setSources(sources.map(row => row === selected ? { ...row, ownerProject: owners.find(owner => ownerKey(owner) === e.target.value) } : row))}><option value="">Choose owning project</option>{owners.map(owner => <option key={ownerKey(owner)} value={ownerKey(owner)}>{catalog.projects.find(project => ownerKey(project) === ownerKey(owner))?.name}</option>)}</select></label>}</div>;
    })}</fieldset>
    <label>Shared project context<textarea rows={3} maxLength={20000} value={notes} onChange={e => setNotes(e.target.value)} placeholder="System boundary, program goals and shared constraints" /></label>
    <fieldset><legend>Artifacts to generate</legend><p>Check the document types to include. Customize their titles and scopes below.</p>
      <div className="artifact-actions"><button type="button" onClick={() => setArtifacts(items => [...items, ...ARTIFACT_TEMPLATES.filter(template => !items.some(item => item.templateId === template.id)).map(makeDocument)])}>Select all document types</button><button type="button" onClick={() => setArtifacts([])}>Clear selection</button></div>
      <div className="grid gap-2 sm:grid-cols-2 my-3">{ARTIFACT_TEMPLATES.map(template => <label key={template.id} className="rounded border p-3"><span><input type="checkbox" checked={artifacts.some(item => item.templateId === template.id)} onChange={e => setArtifacts(items => e.target.checked ? [...items, makeDocument(template)] : items.filter(item => item.templateId !== template.id))} /> {template.name}</span></label>)}</div>
      {ARTIFACT_TEMPLATES.filter(template => artifacts.some(item => item.templateId === template.id)).map(template => <div key={template.id} className="rounded border p-3 mb-3"><h3 className="font-semibold">{template.name}</h3>
        {artifacts.filter(item => item.templateId === template.id).map((item, index, instances) => <div key={item.key} className="py-2"><label>Document title<input required maxLength={200} value={item.title} onChange={e => changeItem(item.key, { title: e.target.value })} /></label>
          {template.id === 'architecture' && <ArchitectureKindSelect value={item.architectureKind} onChange={architectureKind => changeItem(item.key, { architectureKind })} />}
          {template.scope === 'subsystem' && <label>Subsystem<input required value={item.subsystem} onChange={e => changeItem(item.key, { subsystem: e.target.value })} /></label>}
          {template.scope === 'interface' && <div className="artifact-fields"><label>Endpoint A<input required value={item.endpointA} onChange={e => changeItem(item.key, { endpointA: e.target.value })} /></label><label>Endpoint B<input required value={item.endpointB} onChange={e => changeItem(item.key, { endpointB: e.target.value })} /></label></div>}
          {instances.length > 1 && <button type="button" onClick={() => setArtifacts(items => items.filter(row => row.key !== item.key))}>Remove instance {index + 1}</button>}
        </div>)}
        {(template.scope === 'subsystem' || template.scope === 'interface' || template.scope === 'architecture') && <button type="button" disabled={artifacts.length >= 24} onClick={() => setArtifacts(items => [...items, makeDocument(template)])}>Add another {template.scope} — {template.name}</button>}
      </div>)}
      <p>{artifacts.length} documents selected. Earlier document types become drafting inputs for later ones.</p>
      {artifacts.some(item => item.templateId === 'safety-requirements') && <p>Safety Requirements uses the consolidated Hazard Tracking List. That document is included automatically if needed and generated first.</p>}
    </fieldset>
    {safety && <HazardAnalysisNotice status={hazardStatus} />}
    <div className="artifact-actions"><button type="button" disabled={busy} onClick={onClose}>Cancel</button><button className="primary" disabled={busy || !artifacts.length || !hazardStatus.ready}>{busy ? 'Creating…' : 'Create systems engineering project'}</button></div>
  </form></div>;
}
