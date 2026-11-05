// Exercise the installed Markdown parser and URL policy, not the Jest mock.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const babel = require('@babel/core');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { JSDOM } = require('jsdom');
const { createRequire } = require('node:module');

const modules = new Map();
function loadSource(file) {
  if (modules.has(file)) return modules.get(file);
  const exports = {}; modules.set(file, exports);
  const code = babel.transformSync(fs.readFileSync(file, 'utf8'), {
    filename: file, babelrc: false, configFile: false,
    presets: ['@babel/preset-react'], plugins: ['@babel/plugin-transform-modules-commonjs'],
  }).code;
  const resolve = createRequire(file);
  const localRequire = (name) => {
    if (!name.startsWith('.')) return resolve(name);
    const root = path.resolve(path.dirname(file), name);
    const target = [root, root + '.js', root + '.jsx'].find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
    return target ? loadSource(target) : resolve(name);
  };
  vm.runInNewContext(code, { exports, require: localRequire, process, console, setTimeout, clearTimeout }, { filename: file });
  return exports;
}
const Viewer = loadSource(path.resolve(__dirname, '../../src/components/SafetyReportViewer.js')).default;
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRz8AAAAASUVORK5CYII=';
const placeholder = '[[FUNCTIONAL_DIAGRAM_PLACEHOLDER]]';
function render(reportText, functionalDiagramImage = image) {
  const html = renderToStaticMarkup(React.createElement(Viewer, { reportText, functionalDiagramImage }));
  return new JSDOM(html).window.document;
}

for (const heading of [
  '## 3. Internal Architecture', '## 3. Architectural Design',
  '## 3. Functional Architecture', '## Appendix: Architecture',
  '## 5. Architecture Narrative', '## Architecture Overview',
]) {
  test(`renders a captured PNG under ${heading} when the AI omits the placeholder`, () => {
    const document = render(`# Report\n\n${heading}\n\nArchitecture description.\n\n## Next section\n\nLater content.`);
    const img = document.querySelector('img');
    assert.equal(img.getAttribute('src'), image);
    assert.equal(document.querySelectorAll('img').length, 1);
    const report = document.querySelector('.prose');
    const children = [...report.children];
    const imageIndex = children.findIndex((node) => node.contains(img));
    assert.equal(children[imageIndex - 1].textContent, heading.replace(/^#+\s*/, ''));
    assert.equal(children[imageIndex + 1].textContent, 'Architecture description.');
  });
}

test('renders existing placeholder reports and preserves subsequent report text', () => {
  const document = render(`# Report\n\n${placeholder}\n\n## Findings\n\nSaved findings.`);
  assert.equal(document.querySelector('img').getAttribute('src'), image);
  assert.match(document.body.textContent, /Saved findings/);
  assert.doesNotMatch(document.body.textContent, /FUNCTIONAL_DIAGRAM_PLACEHOLDER/);
});

test('does not discard text after repeated diagram placeholders', () => {
  const document = render(`# Report\n\n${placeholder}\n\nMiddle content.\n\n${placeholder}\n\nFinal content.`);
  assert.equal(document.querySelectorAll('img').length, 2);
  assert.match(document.body.textContent, /Middle content/);
  assert.match(document.body.textContent, /Final content/);
});

test('supports a diagram-only placeholder report', () => {
  assert.equal(render(placeholder).querySelector('img').getAttribute('src'), image);
});

test('appends a diagram when there is no matching architecture heading', () => {
  const document = render('# Custom report\n\nFinal findings.');
  assert.equal(document.querySelector('img').getAttribute('src'), image);
  assert.match(document.body.textContent, /Final findings/);
});

test('does not duplicate an image already embedded in saved report Markdown', () => {
  const document = render(`# Report\n\n![Functional Architecture](${image})`);
  assert.equal(document.querySelectorAll('img').length, 1);
  assert.equal(document.querySelector('img').getAttribute('src'), image);
});

test('renders PNG images in raw HTML reports through the same limited policy', () => {
  const document = render(`<h1>Report</h1><img src="${image}" alt="Saved architecture">`, null);
  assert.equal(document.querySelector('img').getAttribute('src'), image);
});

for (const value of ['data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', 'data:text/html;base64,PHNjcmlwdD4=', 'javascript:alert(1)']) {
  test(`does not enable unsafe embedded image protocols: ${value}`, () => {
    const document = render(`<h1>Report</h1><img src="${value}" alt="Unsafe image">`, null);
    assert.equal(document.querySelector('img').getAttribute('src'), '');
  });
}

test('raster data URLs remain disallowed as links', () => {
  const document = render(`# Report\n\n[unsafe link](${image})`, null);
  assert.equal(document.querySelector('a').getAttribute('href'), '');
});

test('preserves ordinary links and source-row navigation', () => {
  const document = render('# Report\n\n[Source Row 42](#hazard-source-row-42)\n\n[Docs](https://example.com/docs)', null);
  assert.equal(document.querySelectorAll('a')[0].getAttribute('href'), '#hazard-source-row-42');
  assert.equal(document.querySelectorAll('a')[1].getAttribute('href'), 'https://example.com/docs');
});

test('text-only reports do not acquire empty images', () => {
  const document = render('# Report\n\nFindings.', null);
  assert.equal(document.querySelector('img'), null);
  assert.match(document.body.textContent, /Findings/);
});

test('renders native graphical report blocks as SVG boxes and labeled arrows', () => {
  const diagram = { title: 'QIBUS context', direction: 'TB', notes: [],
    nodes: [{ id: 'operator', label: 'Remote Operator' }, { id: 'qibus', label: 'QIBUS coordinator' }, { id: 'dbw', label: 'ATOMS DBW' }],
    edges: [{ from: 'operator', to: 'qibus', label: 'Driving Input' }, { from: 'qibus', to: 'dbw', label: 'TAR / RMR / Stop-Inhibit' }, { from: 'dbw', to: 'qibus', label: 'Authority State' }] };
  const document = render('# Report\n\n```xhandle-diagram\n' + JSON.stringify(diagram) + '\n```\n\nTrailing findings.', null);
  assert.equal(document.querySelectorAll('svg[role="img"]').length, 1);
  assert.equal(document.querySelectorAll('polyline').length, 3);
  for (const label of ['Remote Operator', 'QIBUS coordinator', 'ATOMS DBW', 'Driving Input', 'Authority State']) assert(document.body.textContent.includes(label));
  assert(document.body.textContent.includes('Trailing findings.'));
  assert.equal(document.querySelector('pre'), null);
});

test('saved ASCII reports offer conversion while preserving the original source', () => {
  const source = 'Remote Operator ──Driving Input──▶┐\n                                │\n                         ┌──────┘\n                         │ QIBUS │';
  const document = render('# Report\n\n```text\n' + source + '\n```', null);
  assert.equal(document.querySelector('button').textContent, 'Render as graphical diagram');
  assert(document.querySelector('details pre').textContent.includes('Driving Input'));
});

test('invalid or oversized graphical data cannot crash or execute in the report', () => {
  const document = render('# Report\n\n```xhandle-diagram\n{"nodes":[]}\n```', null);
  assert(document.body.textContent.includes('This diagram could not be displayed'));
  assert.equal(document.querySelector('svg'), null);
});
