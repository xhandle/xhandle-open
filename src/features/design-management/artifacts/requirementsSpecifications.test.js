import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { serialize, deserialize } from 'v8';
import { randomUUID } from 'crypto';
import { getTemplate } from './artifactModel';
import { contentGuidance } from './artifactContentGuidance';
import { createArtifact, loadArtifact, acceptProposal, saveDraftObjects, openArtifactDatabase } from './artifactRepository';
import { generateArtifact, requestSection } from './artifactGeneration';
import { artifactMarkdown } from './artifactExport';

jest.mock('../../../components/backendConfig', () => ({ backendURL: '/fixture', buildAIAuthOpts: () => ({ headers: { 'x-ai-model': 'fixture' } }) }));

const ids = ['software-spec', 'hardware-spec'];
const wording = {
  'software-spec': 'The command software shall reject commands older than 100 ms.',
  'hardware-spec': 'The controller board shall remove actuator power when the emergency stop input is active.',
};
const config = templateId => ({ templateId, title: getTemplate(templateId).name, system: 'Controller', projectId: 'p', workspaceType: 'functional', folderId: 'f', sources: [], notes: wording[templateId] });
const response = (args, text = wording[args.meta.templateId]) => ({ objects: [{ key: 'command-control', kind: args.section.id === 's2' ? 'requirement' : 'narrative', title: 'Command control', text: args.section.id === 's2' ? text : 'Recorded controller scope and supporting evidence.', sourceIds: args.sources.entries.filter(source => source.sourceType !== 'project').map(source => source.id) }] });

beforeEach(async () => {
  global.structuredClone = value => deserialize(serialize(value));
  Object.defineProperty(window, 'indexedDB', { configurable: true, value: new IDBFactory() });
  Object.defineProperty(window, 'crypto', { configurable: true, value: { randomUUID } });
  localStorage.clear(); localStorage.setItem('xhandle.projects', JSON.stringify([{ id: 'p', name: 'Controller' }]));
  localStorage.setItem('xhandle:req-projects', JSON.stringify([{ id: 'f', name: 'Specifications', modules: [] }]));
  const db = await openArtifactDatabase();
  await db.put('metadata', { id: 'parent-system', templateId: 'system-spec', title: 'Controller System Requirements', revision: 1, config: { ...config('software-spec'), templateId: 'system-spec' } });
  await db.put('revisions', { id: 'parent-system:1', artifactId: 'parent-system', number: 1, objects: ids.map(templateId => ({ id: 'parent-' + templateId, kind: 'requirement', title: 'Command safety', text: wording[templateId], sourceIds: ['functional-decomposition'] })) });
  db.close();
});

test.each(ids)('%s reaches generation with domain guidance and complete standalone requirement instructions', async templateId => {
  const input = config(templateId), id = await createArtifact(input), saved = await loadArtifact(id);
  let prompt;
  global.fetch = jest.fn(async (_url, options) => {
    const payload = JSON.parse(options.body); prompt = JSON.parse(payload.messages[1].content);
    return { ok: true, text: async () => JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ objects: [{ key: 'command', kind: 'requirement', title: 'Command validity', text: wording[templateId], sourceIds: [prompt.sources.find(source => source.sourceType !== 'project').id] }] }) } }] }) };
  });
  await requestSection({ meta: saved.meta, section: getTemplate(templateId).sections[1], sources: saved.job.sources });
  expect(prompt.document.type).toBe(getTemplate(templateId).name);
  expect(prompt.synthesisGuidance).toContain('one complete standalone sentence');
  expect(prompt.contentGuidance).toContain('INCOSE');
  expect(contentGuidance(templateId)).toContain(templateId === 'software-spec' ? 'software responsibilities' : 'hardware responsibilities');
  expect(prompt.contentGuidance).toContain('explicit gaps');
});

test.each(ids)('%s repairs incomplete requirement wording and accepts/exports the cited requirement', async templateId => {
  const id = await createArtifact(config(templateId));
  const request = jest.fn(async args => response(args, args.section.id === 's2' && !args.writingCorrection ? 'otherwise no command shall be accepted.' : wording[templateId]));
  await generateArtifact(id, { request });
  const draft = await loadArtifact(id);
  expect(draft.job.state).toBe('ready');
  const requirement = draft.job.sections.s2.find(object => object.kind === 'requirement');
  expect(requirement.text).toBe(wording[templateId]); expect(requirement.sourceIds).toContain('artifact-object:parent-system:parent-' + templateId);
  expect(request.mock.calls.some(([args]) => args.writingCorrection?.items[0].text === 'otherwise no command shall be accepted.')).toBe(true);
  await acceptProposal(id, 0, draft.job.token);
  const accepted = await loadArtifact(id);
  expect(accepted.meta).toMatchObject({ templateId, revision: 1 }); expect(accepted.job).toBeUndefined();
  expect(accepted.revision.objects.find(object => object.id === requirement.id).text).toBe(wording[templateId]);
  expect(artifactMarkdown(accepted.meta, accepted.revision)).toContain(wording[templateId]);
  expect(artifactMarkdown(accepted.meta, accepted.revision)).toContain(getTemplate(templateId).name);
});

test.each(ids)('%s preserves persistent writing defects as review gaps', async templateId => {
  const id = await createArtifact(config(templateId));
  await generateArtifact(id, { request: async args => response(args, 'otherwise no command shall be accepted.') });
  const saved = await loadArtifact(id), gap = saved.job.sections.s2.find(object => object.proposedKind === 'requirement');
  expect(gap).toMatchObject({ kind: 'gap', evidenceIssue: 'requirement-writing' });
  expect(gap.requirementWritingIssues.length).toBeGreaterThan(0);
});

test.each(ids)('%s keeps topic titles as parents when multiple manual shall statements are separated', async templateId => {
  const id = await createArtifact(config(templateId));
  await generateArtifact(id, { request: async args => response(args) });
  const { job } = await loadArtifact(id), rows = Object.values(job.sections).flat();
  const original = rows.find(object => object.kind === 'requirement');
  const actor = templateId === 'software-spec' ? 'The command software' : 'The controller board';
  const nextText = `${wording[templateId]} ${actor} shall report rejected commands.`;
  await saveDraftObjects(id, job, rows.map(object => object.id === original.id ? { ...object, text: nextText, manual: true } : object));
  const saved = await loadArtifact(id), topic = saved.job.sections.s2.find(object => object.id === original.id);
  const children = saved.job.sections.s2.filter(object => object.parentId === topic.id);
  expect(topic).toMatchObject({ kind: 'section', title: 'Command control' }); expect(children).toHaveLength(2);
  expect(children.map(object => object.text)).toEqual([wording[templateId], `${actor} shall report rejected commands.`]);
  expect(children.every(object => object.kind === 'requirement' && object.sourceIds.includes('artifact-object:parent-system:parent-' + templateId))).toBe(true);
});
