import { ARTIFACT_TEMPLATES, MATRIX_TEMPLATE } from '../artifacts/artifactModel';
import { traceIconDefinition } from './TraceArtifactIcon';

jest.mock('lucide-react', () => jest.requireActual('lucide-react/dist/cjs/lucide-react.js'));

test('every supported engineering artifact has its own icon, including software, hardware, safety and matrix types', () => {
  const icons = [...ARTIFACT_TEMPLATES, MATRIX_TEMPLATE].map(template => traceIconDefinition({ type: 'artifact' }, { templateId: template.id }));
  expect(new Set(icons.map(([name]) => name)).size).toBe(icons.length);
  expect(new Set(icons.map(([, Icon]) => Icon)).size).toBe(icons.length);
  expect(icons.every(([, Icon, color]) => Icon && color)).toBe(true);
});

test('code architecture, source projects and saved evidence remain visually distinct', () => {
  const functional = traceIconDefinition({ type: 'artifact' }, { templateId: 'architecture', config: { architectureKind: 'functional' } });
  const code = traceIconDefinition({ type: 'artifact' }, { templateId: 'architecture', config: { architectureKind: 'code-based' } });
  expect(code[0]).not.toBe(functional[0]); expect(code[1]).not.toBe(functional[1]);
  expect(traceIconDefinition({ type: 'owning-project' })[0]).toBe('source-project');
  expect(traceIconDefinition({ type: 'source-snapshot' })[0]).toBe('saved-source');
  expect(traceIconDefinition({ type: 'future-type' })[0]).toBe('document');
});
