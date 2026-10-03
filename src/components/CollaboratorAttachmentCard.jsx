import React from 'react';
import { FileText, Image, Table2, X } from 'lucide-react';

export default function CollaboratorAttachmentCard({ name, description, imageDataUrl, kind, onOpen, onRemove }) {
  const Icon = imageDataUrl || kind === 'image' ? Image : kind === 'table' ? Table2 : FileText;
  return (
    <div className="group relative w-40 max-w-full shrink-0 overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900">
      <button
        type="button"
        onClick={onOpen}
        title={`${name}${description ? ` · ${description}` : ''} — Click to preview`}
        aria-label={`Preview attachment ${name}`}
        className="flex h-32 w-full flex-col text-left transition hover:bg-neutral-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400 dark:hover:bg-neutral-800"
      >
        <span className="flex min-h-0 w-full flex-1 items-center justify-center overflow-hidden px-3 pt-3">
          {imageDataUrl
            ? <img src={imageDataUrl} alt="" className="h-full w-full rounded-lg object-cover" />
            : <Icon size={26} strokeWidth={1.5} className="text-neutral-500 dark:text-neutral-400" aria-hidden="true" />}
        </span>
        <span className="flex w-full items-center gap-1.5 px-2.5 py-2.5">
          <Icon size={14} className="shrink-0 text-blue-500" aria-hidden="true" />
          <span className="min-w-0 truncate text-xs font-medium text-neutral-800 dark:text-neutral-100">{name}</span>
        </span>
      </button>
      {onRemove && <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove attachment ${name}`}
        title={`Remove ${name}`}
        className="absolute right-1.5 top-1.5 rounded-full border border-neutral-200 bg-white p-1 text-neutral-500 shadow-sm hover:bg-neutral-100 hover:text-neutral-900 focus-visible:ring-2 focus-visible:ring-indigo-400 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
      >
        <X size={12} aria-hidden="true" />
      </button>}
    </div>
  );
}
