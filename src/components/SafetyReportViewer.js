// SafetyReportViewer.js
import React from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { ConvertReportDiagram, ReportGraphicalDiagram } from './ReportGraphicalDiagram';
import { REPORT_DIAGRAM_LANGUAGE, isTextDiagram, parseReportDiagram, replaceTextDiagram } from './reportDiagramModel';

const ReportDiagramContext = React.createContext(null);

function ReportCodeBlock({ children }) {
  const context = React.useContext(ReportDiagramContext);
  const code = React.Children.toArray(children).find(React.isValidElement);
  const source = String(code?.props?.children ?? '');
  const language = String(code?.props?.className || '').match(/language-([\w-]+)/)?.[1] || '';
  const diagram = React.useMemo(() => {
    if (language !== REPORT_DIAGRAM_LANGUAGE) return null;
    try { return parseReportDiagram(source); } catch { return null; }
  }, [language, source]);
  if (language === REPORT_DIAGRAM_LANGUAGE) {
    if (diagram) return <ReportGraphicalDiagram diagram={diagram} />;
    return <div className="my-3 rounded border p-3 text-sm text-amber-800">This diagram could not be displayed.<details><summary>Diagram source</summary><pre className="overflow-auto">{source}</pre></details></div>;
  }
  if (isTextDiagram(source, language)) {
    return <ConvertReportDiagram source={source} onConverted={context?.onReportChange ? async (converted) => {
      const next = replaceTextDiagram(context.markdown, source, converted);
      if (!next) throw new Error('The original diagram could not be located in this report.');
      await context.onReportChange(next);
    } : undefined} />;
  }
  return <pre className="overflow-auto">{children}</pre>;
}

function reportUrlTransform(url, key, node) {
  // Diagram captures are PNG data URLs. Allow raster image sources only;
  // links, SVG/HTML data URLs, and other protocols keep the default policy.
  if (key === 'src' && node.tagName === 'img' && /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/]+={0,2}$/i.test(url)) {
    return url;
  }
  return defaultUrlTransform(url);
}

export default function SafetyReportViewer({
  reportText,
  report,
  functionalDiagramImage,
  expanded = false,
  // Pages and drawers that already scroll own the full document height.
  embedded = false,
  onOpenSourceRow,
  onReportChange,
}) {
  // Accept both prop names; coerce to string safely
  let md = (reportText ?? report ?? '').toString();

  const splitPoint = '[[FUNCTIONAL_DIAGRAM_PLACEHOLDER]]';

  // Model-written reports do not always retain the template placeholder.
  // Use the architecture heading across the report templates, or append.
  if (functionalDiagramImage && !md.includes(splitPoint) && !md.includes(functionalDiagramImage)) {
    const imgMarkdown = `\n\n![Functional Architecture](${functionalDiagramImage})\n\n`;
    const anchor = /(^|\n)#{1,6}\s+(?:(?:\d+(?:\.\d+)*\.?|Appendix:?)\s+)?(?:Functional Architecture|Architectural Design|Internal Architecture|Architecture(?: Narrative| Overview)?|System Architecture)[^\n]*(?=\n|$)/i;

    if (anchor.test(md)) {
      md = md.replace(anchor, (m) => `${m}${imgMarkdown}`);
    } else {
      md = `${md}${imgMarkdown}`;
    }
  }

  const sections = md.split(splitPoint);

  const markdownComponents = {
    pre: ReportCodeBlock,
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
    img: ({ node, alt = '', ...props }) => (
      <img {...props} alt={alt} style={{ display: 'block', maxWidth: '100%', width: '100%', height: 'auto', objectFit: 'contain' }} />
    ),
  };

  // If nothing to render, show a friendly message
  if (!sections.some((part) => part.trim()) && !(functionalDiagramImage && sections.length > 1)) {
    return (
      <div className="p-3 border rounded bg-yellow-50 text-sm text-yellow-900">
        No report content to display.
      </div>
    );
  }

  return (
    <ReportDiagramContext.Provider value={{ markdown: (reportText ?? report ?? '').toString(), onReportChange }}>
    <div
      className={`prose w-full bg-white p-8 text-left leading-7 ${expanded || embedded ? 'max-w-none' : 'mx-auto max-w-4xl overflow-y-auto rounded-lg shadow'}`}
      style={expanded || embedded ? undefined : { maxHeight: '80vh' }}
    >
      {sections.map((part, index) => (
        <React.Fragment key={index}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeRaw]}
            components={markdownComponents}
            urlTransform={reportUrlTransform}
          >
            {part}
          </ReactMarkdown>
          {functionalDiagramImage && index < sections.length - 1 && (
            <div className="flex justify-center my-6">
              <img
                src={reportUrlTransform(functionalDiagramImage, 'src', { tagName: 'img' }) || undefined}
                alt="Functional Architecture"
                className="rounded border shadow max-w-3xl w-full h-auto"
                style={{ maxWidth: '100%', width: '100%', height: 'auto', objectFit: 'contain' }}
              />
            </div>
          )}
        </React.Fragment>
      ))}
    </div>
    </ReportDiagramContext.Provider>
  );
}
