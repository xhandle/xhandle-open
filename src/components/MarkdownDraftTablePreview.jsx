import React, { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { markdownTablePreview } from '../lib/tableMarkdown';

const components = {
  table: ({ children }) => <table className="min-w-full border-collapse text-left text-xs">{children}</table>,
  th: ({ children }) => <th className="border border-gray-200 bg-gray-50 px-2 py-1 font-semibold">{children}</th>,
  td: ({ children }) => <td className="min-w-32 border border-gray-200 px-2 py-1 align-top">{children}</td>,
};

export default React.memo(function MarkdownDraftTablePreview({ text }) {
  const preview = useMemo(() => markdownTablePreview(text), [text]);
  if (!preview) return null;
  return (
    <details open className="mx-2 mb-2 rounded-lg border border-gray-200 p-2">
      <summary className="cursor-pointer text-xs text-gray-600">
        Table preview{preview.truncated ? ' · first 10 rows; all rows will be sent' : ''}
      </summary>
      <div className="mt-2 max-h-48 overflow-auto" aria-label="Pasted table preview">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{preview.markdown}</ReactMarkdown>
      </div>
    </details>
  );
});
