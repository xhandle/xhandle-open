import { architecturePages, architecturePageForElement, ARCHITECTURE_PAGE_NODES, ARCHITECTURE_PAGE_EDGES } from './architecturePages';
import { artifactMarkdown } from './artifactExport';

const fixture = size => ({ id: 'diagram', title: 'Functional decomposition', workspaceType: 'code-architecture', snapshot: {
  nodes: Array.from({ length: size + 1 }, (_, i) => ({ id: `n${i}`, label: `Responsibility ${i}`, details: 'Original evidence' })),
  edges: Array.from({ length: size }, (_, i) => ({ id: `e${i}`, from: 'n0', to: `n${i + 1}`, label: 'Uses', row: { traceId: `original-${i}` } })),
} });

test('large functional decompositions have bounded views with complete node/edge coverage and unchanged evidence', () => {
  const diagram = fixture(10000);
  diagram.snapshot.nodes.push({ id: 'isolated', label: 'Isolated component' });
  const pages = architecturePages(diagram);
  const nodeIds = new Set(), edges = [];
  for (const page of pages) {
    expect(page.snapshot.nodes.length).toBeLessThanOrEqual(ARCHITECTURE_PAGE_NODES);
    expect(page.snapshot.edges.length).toBeLessThanOrEqual(ARCHITECTURE_PAGE_EDGES);
    const ids = new Set(page.snapshot.nodes.map(node => node.id));
    page.snapshot.edges.forEach(edge => { expect(ids.has(edge.from) && ids.has(edge.to)).toBe(true); edges.push(edge); });
    page.snapshot.nodes.forEach(node => nodeIds.add(node.id));
  }
  expect(nodeIds).toEqual(new Set(diagram.snapshot.nodes.map(node => node.id)));
  expect(edges).toEqual(diagram.snapshot.edges);
  expect(edges[9999]).toBe(diagram.snapshot.edges[9999]);
  expect(pages[architecturePageForElement(pages, 'e9999')].snapshot.edges.some(edge => edge.id === 'e9999')).toBe(true);
  expect(pages[architecturePageForElement(pages, 'isolated')].snapshot.nodes.some(node => node.id === 'isolated')).toBe(true);
  expect(diagram.id).toBe('diagram');
});

test('small code graphs and native project diagrams retain their original presentation', () => {
  const small = fixture(5), native = { ...fixture(2000), workspaceType: 'functional' };
  expect(architecturePages(small)).toEqual([small]);
  expect(architecturePages(native)).toEqual([native]);
});

test.each(['subsystem', 'csci', 'csc'])('%s diagrams stay complete at source-canvas scale while oversized graphs remain bounded', level => {
  const diagram = { ...fixture(196), abstraction: level };
  expect(architecturePages(diagram)).toEqual([diagram]);
  const large = { ...fixture(2000), abstraction: level };
  const pages = architecturePages(large);
  expect(pages.length).toBeGreaterThan(1);
  expect(pages.flatMap(page => page.snapshot.edges)).toEqual(large.snapshot.edges);
});

test('document export includes every view rather than silently exporting the visible page', () => {
  const diagram = { ...fixture(125), sourceType: 'architecture-diagram' };
  const pages = architecturePages(diagram);
  const images = Object.fromEntries(pages.map(page => [page.id, `image-for-${page.id}`]));
  const text = artifactMarkdown({ title: 'Architecture', templateId: 'architecture' }, { number: 1, objects: [], sources: { entries: [diagram] } }, images);
  for (const page of pages) expect(text).toContain(`image-for-${page.id}`);
});
