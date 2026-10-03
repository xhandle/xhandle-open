import { openRecoveryDatabase } from './durableRecovery';
import { notifyBackupDataChanged } from './localBackupEvents';

export const ATTACHMENT_PREVIEW_DB = 'xhandle-collaborator-attachments';
const STORE = 'previews';
const pending = new Map();
// Keep a bounded session fallback if browser storage is unavailable.
const fallback = new Map();
const MAX_FALLBACK_CHARS = 10_000_000;

function remember(id, value) {
  fallback.set(id, value);
  let size = 0;
  for (const [key, item] of [...fallback].reverse()) {
    size += (item.text?.length || 0) + (item.imageDataUrl?.length || 0);
    if (size > MAX_FALLBACK_CHARS) fallback.delete(key);
  }
}

async function record(id, value, remove = false) {
  const db = await openRecoveryDatabase(ATTACHMENT_PREVIEW_DB, 1, {
    upgrade(database) { database.createObjectStore(STORE); },
  }, 3000);
  let timer;
  try {
    const tx = db.transaction(STORE, value || remove ? 'readwrite' : 'readonly');
    tx.done.catch(() => {});
    return await Promise.race([
      (async () => {
        const result = remove ? await tx.store.delete(id) : value ? await tx.store.put(value, id) : await tx.store.get(id);
        await tx.done;
        if (value || remove) notifyBackupDataChanged({ database: ATTACHMENT_PREVIEW_DB });
        return result;
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          try { tx.abort(); } catch {}
          reject(new Error('Attachment storage timed out.'));
        }, 3000);
      }),
    ]);
  } finally { clearTimeout(timer); db.close(); }
}

export function buildAttachmentPreview(context, name) {
  return {
    name,
    type: context.file?.type || (context.tableMarkdown ? 'text/markdown' : 'text/plain'),
    text: context.fileText ?? context.tableMarkdown ?? context.text ?? '',
    imageDataUrl: context.imageDataUrl || '',
    downloadable: !context.unsupportedPreview,
  };
}

export function retainAttachmentPreviews(message, contexts) {
  if (!message.attachments?.length) return message;
  return { ...message, attachments: message.attachments.map((attachment, index) => {
    const context = contexts[index] || {};
    const previewId = crypto.randomUUID();
    const preview = buildAttachmentPreview(context, attachment.name);
    remember(previewId, preview);
    const saving = record(previewId, preview).then(() => fallback.delete(previewId), () => {}).finally(() => pending.delete(previewId));
    pending.set(previewId, saving);
    return { ...attachment, previewId };
  }) };
}

export async function loadAttachmentPreview(attachment) {
  if (!attachment?.previewId) return null;
  const id = attachment.previewId;
  if (fallback.has(id)) return fallback.get(id);
  await pending.get(id);
  try { return await record(id) || fallback.get(id) || null; }
  catch { return fallback.get(id) || null; }
}

export async function deleteAttachmentPreviews(attachments) {
  await Promise.all((attachments || []).map(async ({ previewId }) => {
    if (!previewId) return;
    await pending.get(previewId);
    fallback.delete(previewId);
    try { await record(previewId, undefined, true); } catch {}
  }));
}
