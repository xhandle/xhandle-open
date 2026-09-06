// SafetyReportViewer.js
import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';

export default function SafetyReportViewer({
  reportText,
  report,
  functionalDiagramImage,
  expanded = false,
  onOpenSourceRow,
}) {
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
      children ? <h1 className="text-2xl font-bold text-gray-900 mb-4" {...props}>{children}</h1> : null
    ),
    h2: ({ node, children, ...props }) => (
      children ? <h2 className="text-xl font-bold text-gray-800 mt-8 mb-3" {...props}>{children}</h2> : null
    ),
    h3: ({ node, children, ...props }) => (
      children ? <h3 className="text-lg font-semibold text-gray-700 mt-6 mb-2" {...props}>{children}</h3> : null
    ),
    ul: ({ node, ...props }) => (
      <ul className="ml-6 list-disc space-y-1" {...props} />
    ),
    table: ({ node, ...props }) => (
      <div className="my-5 max-w-full overflow-x-auto rounded-md border border-gray-300 bg-white shadow-sm">
        <table
          className={`${expanded ? 'min-w-[1200px]' : 'min-w-[960px]'} w-full table-fixed border-collapse text-sm`}
          {...props}
        />
      </div>
    ),
    thead: ({ node, ...props }) => (
      <thead className="bg-gray-50" {...props} />
    ),
    th: ({ node, ...props }) => (
      <th className="min-w-40 border border-gray-300 px-4 py-3 text-left align-top font-semibold leading-5 text-gray-900" {...props} />
    ),
    td: ({ node, ...props }) => (
      <td className="min-w-40 break-words border border-gray-300 px-4 py-3 align-top leading-6 text-gray-800" {...props} />
    ),
    a: ({ node, href, children, ...props }) => {
      const sourceMatch = String(href || '').match(/^#hazard-source-row-(\d+)$/i);
      const canOpenSource = Boolean(sourceMatch && typeof onOpenSourceRow === 'function');
      return (
        <a
          href={href}
          className="font-medium text-[#1c5fde] underline decoration-blue-300 underline-offset-2 hover:text-[#0B3EA8]"
          onClick={canOpenSource ? (event) => {
            event.preventDefault();
            onOpenSourceRow(Number(sourceMatch[1]));
          } : undefined}
          title={canOpenSource ? `Open hazard analysis source row ${sourceMatch[1]}` : undefined}
          {...props}
        >
          {children}
        </a>
      );
    },
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
      className={`prose w-full bg-white p-8 text-left leading-7 ${expanded ? 'max-w-none' : 'mx-auto max-w-4xl overflow-y-auto rounded-lg shadow'}`}
      style={expanded ? undefined : { maxHeight: '80vh' }}
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
