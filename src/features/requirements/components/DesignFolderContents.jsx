import React, { useState } from 'react';
import { Briefcase, FileText, Folder, Layers } from 'lucide-react';

const typeLabel = { folder: 'Folder', project: 'Systems engineering project', artifact: 'Engineering artifact', module: 'Module' };
const icons = { folder: Folder, project: Briefcase, artifact: FileText, module: Layers };

export default function DesignFolderContents({ folder, items, onOpen, onSaveDetails, onRemove, canEditItem }) {
  const [dialog, setDialog] = useState(null);
  const [title, setTitle] = useState(''), [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const show = (action, item) => {
    setTitle(item.name); setDescription(item.description || item.config?.description || '');
    setError(''); setDialog({ action, item });
  };
  const submit = async event => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      if (dialog.action === 'edit') await onSaveDetails(dialog.item, { title: title.trim(), description: description.trim() });
      else await onRemove(dialog.item);
      setDialog(null);
    } catch (error) { setError(error.message); }
    finally { setBusy(false); }
  };
  const entries = [...items].sort((a, b) => a.name.localeCompare(b.name));
  return <section className="flex min-h-0 flex-1 flex-col" aria-label="Folder contents">
    <header className="flex flex-wrap items-start justify-between gap-3 border-b pb-4">
      <div><p className="text-xs uppercase tracking-wide text-gray-500">Folder contents</p><h2 className="text-xl font-semibold">{folder?.name || 'Design library'}</h2>
        {folder?.description && <p className="mt-2 whitespace-pre-wrap text-sm text-gray-600">{folder.description}</p>}
        <p className="mt-1 text-sm text-gray-500">{entries.length} {entries.length === 1 ? 'item' : 'items'}</p></div>
      {folder && canEditItem({ ...folder, kind: 'folder' }) && <button type="button" className="rounded border px-3 py-2 text-sm hover:bg-gray-50" onClick={() => show('edit', { ...folder, kind: 'folder' })}>Edit folder details</button>}
    </header>
    <div className="min-h-0 flex-1 overflow-auto py-4">
      {entries.length ? <table className="w-full text-left text-sm"><thead className="border-b text-gray-600"><tr><th className="p-3">Name</th><th className="p-3">Type</th><th className="p-3">Description</th><th className="p-3">Actions</th></tr></thead>
        <tbody>{entries.map(item => {
          const Icon = icons[item.kind];
          return <tr key={`${item.kind}:${item.id}`} className="border-b align-top" data-folder-item-id={item.id}>
            <td className="p-3"><button type="button" className="flex items-start gap-2 text-left font-medium text-indigo-700 hover:underline" onClick={() => onOpen(item)}><Icon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />{item.name}</button></td>
            <td className="p-3">{typeLabel[item.kind]}</td><td className="max-w-md whitespace-pre-wrap break-words p-3">{item.description || item.config?.description || '—'}</td>
            <td className="p-3"><div className="flex flex-wrap gap-2">
              <button type="button" aria-label={`Open ${item.name}`} className="rounded border px-2 py-1 hover:bg-gray-50" onClick={() => onOpen(item)}>Open</button>
              {canEditItem(item) && <><button type="button" aria-label={`Edit details for ${item.name}`} className="rounded border px-2 py-1 hover:bg-gray-50" onClick={() => show('edit', item)}>Edit details</button>
                <button type="button" aria-label={`Remove ${item.name}`} className="rounded border px-2 py-1 text-red-700 hover:bg-red-50" onClick={() => show('remove', item)}>Remove</button></>}
            </div></td>
          </tr>;
        })}</tbody></table> : <p className="rounded-lg border border-dashed p-8 text-center text-sm text-gray-500">{folder ? 'This folder is empty. Add a subfolder or generate a project or engineering artifact here.' : 'Create a folder to organize your projects and engineering artifacts.'}</p>}
    </div>
    {dialog && <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={dialog.action === 'edit' ? 'Edit item details' : 'Remove item'}><form className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl" onSubmit={submit}>
      <h3 className="mb-4 text-lg font-semibold">{dialog.action === 'edit' ? 'Edit details' : `Remove ${dialog.item.name}?`}</h3>
      {dialog.action === 'edit' ? <>
        <label className="mb-3 block text-sm">Title<input autoFocus required maxLength={200} className="mt-1 block w-full rounded border p-2" value={title} onChange={event => setTitle(event.target.value)} /></label>
        <label className="mb-3 block text-sm">Description<textarea rows={4} maxLength={4000} className="mt-1 block w-full rounded border p-2" value={description} onChange={event => setDescription(event.target.value)} /></label>
      </> : <p className="mb-4 text-sm text-gray-600">{dialog.item.kind === 'project' ? 'This permanently deletes the project and all its generated documents, drafts, revisions and baselines. Source projects and modules are kept.' : dialog.item.kind === 'artifact' ? 'This permanently deletes the artifact, drafts, revisions and baselines. It also removes any project membership. Source modules are kept.' : dialog.item.kind === 'folder' ? 'This deletes the folder. Remove its contents first; only empty folders can be removed here.' : 'This permanently deletes the module and its requirements and baselines.'}</p>}
      {error && <p role="alert" className="mb-3 text-sm text-red-700">{error}</p>}
      <div className="flex justify-end gap-2"><button type="button" disabled={busy} className="rounded border px-3 py-2 text-sm" onClick={() => setDialog(null)}>Cancel</button><button type="submit" disabled={busy || (dialog.action === 'edit' && !title.trim())} className={`rounded px-3 py-2 text-sm text-white disabled:opacity-40 ${dialog.action === 'edit' ? 'bg-indigo-600' : 'bg-red-700'}`}>{busy ? 'Saving…' : dialog.action === 'edit' ? 'Save details' : 'Permanently remove'}</button></div>
    </form></div>}
  </section>;
}
