import React, { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { tableToMarkdown } from '../lib/tableMarkdown';

export default function CopyTableButton({ columns, rows, label = 'Copy functional decomposition table' }) {
  const [status, setStatus] = useState('');
  const resetTimer = useRef(null);
  useEffect(() => () => clearTimeout(resetTimer.current), []);

  const copy = async () => {
    const text = tableToMarkdown(columns, rows);
    try {
      await navigator.clipboard.writeText(text);
      setStatus('Copied');
    } catch {
      setStatus('Copy failed. Please try again.');
    }
    clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setStatus(''), 4000);
  };

  return (
    <div className="flex shrink-0 items-center gap-2">
      <span role="status" className="text-xs text-gray-600">{status}</span>
      <button
        type="button"
        onClick={copy}
        disabled={!rows.length}
        title="Copy filtered rows as a Markdown table"
        aria-label={label}
        className="rounded-md border border-gray-200 bg-white p-2 text-gray-600 hover:bg-gray-100 disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-blue-500"
      >
        {status === 'Copied' ? <Check size={18} aria-hidden="true" /> : <Copy size={18} aria-hidden="true" />}
      </button>
    </div>
  );
}
