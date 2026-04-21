/**
 * xHandle: safety report viewer shared application component.
 * This file implements a reusable application-level component or helper that participates in xHandle's end-to-end engineering workflows.
 * Shared components connect the main workspace, diagrams, copilot features, reporting, and local persistence so individual features can cooperate as one system.
 * Related files: src/App.js, src/lib/storage/indexedDB.js, src/features/hazard-analysis/aiAnalysisLite.js.
 */

// SafetyReportViewer.js
import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';

export default function SafetyReportViewer({ reportText, report, functionalDiagramImage }) {
  // Accept both prop names; coerce to string safely
  let md = (reportText ?? report ?? '').toString();

  const splitPoint = '[[FUNCTIONAL_DIAGRAM_PLACEHOLDER]]';

  // If the placeholder is missing but we DO have an image,
  // try to inject it right after the "## 3. Functional Architecture" section,
  // otherwise just append it to the end.
  if (functionalDiagramImage && !md.includes(splitPoint)) {
    const imgMarkdown = `\n\n![Functional Architecture](${functionalDiagramImage})\n\n`;
    const anchor = /\n##\s*3\.\s*Functional Architecture[^\n]*\n/i;

    if (anchor.test(md)) {
      md = md.replace(anchor, (m) => `${m}${imgMarkdown}`);
    } else {
      md = `${md}${imgMarkdown}`;
    }
  }

  // Now split (if placeholder exists). If not, render all in "beforeDiagram".
  const [beforeDiagram, afterDiagram] = md.includes(splitPoint)
    ? md.split(splitPoint)
    : [md, ''];

  const markdownComponents = {
    h1: ({ node, children, ...props }) => (
      <h1 className="text-2xl font-bold text-gray-900 mb-4" {...props}>{children}</h1>
    ),
    h2: ({ node, children, ...props }) => (
      <h2 className="text-xl font-bold text-gray-800 mt-8 mb-3" {...props}>{children}</h2>
    ),
    h3: ({ node, children, ...props }) => (
      <h3 className="text-lg font-semibold text-gray-700 mt-6 mb-2" {...props}>{children}</h3>
    ),
    ul: ({ node, ...props }) => (
      <ul className="ml-6 list-disc space-y-1" {...props} />
    ),
    li: ({ node, children, ...props }) => {
      const text = children?.[0]?.props?.children?.[0] || '';
      const isFakeSubBullet = typeof text === 'string' && text.trim().startsWith('○');
      const isFakeTopBullet = typeof text === 'string' && text.trim().startsWith('●');
      const className = isFakeSubBullet
        ? 'ml-10 list-none'
        : isFakeTopBullet
        ? 'ml-6 list-none'
        : 'ml-4';

      return (
        <li className={className} {...props}>
          <p>{children}</p>
        </li>
      );
    },
    p: ({ node, ...props }) => <p className="mb-3" {...props} />,
  };

  // If nothing to render, show a friendly message
  if (!beforeDiagram.trim() && !afterDiagram.trim()) {
    return (
      <div className="p-3 border rounded bg-yellow-50 text-sm text-yellow-900">
        No report content to display.
      </div>
    );
  }

  return (
    <div
      className="prose max-w-4xl mx-auto bg-white p-8 rounded-lg shadow overflow-y-auto text-left leading-7"
      style={{ maxHeight: '80vh' }}
    >
      {/* Before diagram */}
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw]}
        components={markdownComponents}
      >
        {beforeDiagram}
      </ReactMarkdown>

      {/* Inject functional diagram if placeholder existed OR if we injected earlier */}
      {functionalDiagramImage && md.includes(splitPoint) && (
        <div className="flex justify-center my-6">
          <img
            src={functionalDiagramImage}
            alt="Functional Architecture"
            className="rounded border shadow max-w-3xl w-full h-auto"
          />
        </div>
      )}

      {/* After diagram */}
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw]}
        components={markdownComponents}
      >
        {afterDiagram}
      </ReactMarkdown>
    </div>
  );
}
