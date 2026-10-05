import { webcrypto } from 'crypto';
import { TextEncoder } from 'util';
import { registerLocalFolder, connectLocalFolder, scanLocalFolder, createLocalSourceProvider, normalizeLocalPath, LOCAL_FILE_LIMIT } from './localCodeSource';
import { codeSourceIndexKey, localCodeSourceDescriptor } from './codeSourceIdentity';

jest.mock('idb', () => ({ openDB: jest.fn(async () => ({ get: async () => null, put: async () => {}, close() {} })) }));
const file = (path, text = 'export function run() {}', size = text.length) => ({ name: path.split('/').pop(), webkitRelativePath: `fixture/${path}`, size, text: async () => text });
beforeAll(() => {
  global.TextEncoder = TextEncoder;
  global.crypto = webcrypto;
});
let id = 0;
const register = files => registerLocalFolder({ files, sourceId: `test-${++id}` });

it('normalizes Windows separators and rejects non-relative and traversal paths', () => {
  expect(normalizeLocalPath('src\\main.js')).toBe('src/main.js');
  for (const path of ['/tmp/main.js', 'C:\\code\\main.js', '../key', 'a/../key', 'a//b']) expect(() => normalizeLocalPath(path)).toThrow();
});
it('excludes secrets, binaries, generated dependencies, and oversized sources before reading', async () => {
  const files = [file('src/main.js'), file('.env'), file('.env.local'), file('key.pem'), file('node_modules/x/a.js'), file('build/a.js'), file('image.png'), file('huge.js', '', LOCAL_FILE_LIMIT + 1)];
  files.slice(1).forEach(entry => { entry.text = jest.fn(() => { throw new Error('Must not read excluded content'); }); });
  const source = register(files);
  const scan = await scanLocalFolder(source);
  expect(scan.entries.map(entry => entry.path)).toEqual(['src/main.js']);
  expect(scan.skipped).toHaveLength(7);
  await createLocalSourceProvider(source);
  files.slice(1).forEach(entry => expect(entry.text).not.toHaveBeenCalled());
});
it('does not count excluded dependency contents against the project file limit', async () => {
  const source = register([file('src/main.js'), ...Array.from({ length: 10001 }, (_, i) => file(`node_modules/package/file${i}.js`))]);
  const scan = await scanLocalFolder(source);
  expect(scan.entries).toHaveLength(1);
  expect(scan.skipped).toEqual([{ path: 'node_modules', reason: 'dependency/generated directory' }]);
});
it('isolates same-name folders and snapshots; portable descriptors contain no access handles or credentials', async () => {
  const a = await createLocalSourceProvider(register([file('main.js', 'one')]));
  const b = await createLocalSourceProvider(register([file('main.js', 'one')]));
  expect(a.source.folderName).toBe(b.source.folderName);
  expect(a.source.snapshotId).toBe(b.source.snapshotId);
  expect(codeSourceIndexKey(a.source, 'main.js')).not.toBe(codeSourceIndexKey(b.source, 'main.js'));
  const updated = registerLocalFolder({ files: [file('main.js', 'two')], sourceId: a.source.sourceId });
  const c = await createLocalSourceProvider(updated);
  expect(c.source.snapshotId).not.toBe(a.source.snapshotId);
  const descriptor = localCodeSourceDescriptor({ ...c.source, token: 'secret', handle: {}, files: [] });
  expect(descriptor.token).toBe(''); expect(descriptor.repoUrl).toBe('');
  expect(descriptor).not.toHaveProperty('files'); expect(descriptor).not.toHaveProperty('handle');
});
it('detects changed source between scan and read, including same-size edits', async () => {
  let text = 'one';
  const entry = { ...file('main.js'), text: async () => text };
  const provider = await createLocalSourceProvider(register([entry]));
  text = 'two';
  await expect(provider.readText({ path: 'main.js' })).rejects.toThrow('changed during analysis');
});
it('supports directory handles, skips binary text and honors cancellation', async () => {
  const handle = { name: 'native', async *entries() { yield ['main.js', { kind: 'file', getFile: async () => file('main.js') }]; } };
  const source = registerLocalFolder({ handle, sourceId: `test-${++id}` });
  expect((await createLocalSourceProvider(source)).source.folderName).toBe('native');
  const binary = await createLocalSourceProvider(register([file('main.js'), file('binary.txt', 'a\0b')]));
  expect(binary.skipped).toEqual([{ path: 'binary.txt', reason: 'binary content' }]);
  const controller = new AbortController(); controller.abort();
  await expect(createLocalSourceProvider(source, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
});
it('requires reconnect for descriptors without a browser session', async () => {
  await expect(scanLocalFolder({ sourceId: 'unavailable' })).rejects.toThrow('Reconnect');
});
it('rejects oversized projects before reading their contents', async () => {
  const entries = Array.from({ length: 160 }, (_, i) => file(`file${i}.js`, '', LOCAL_FILE_LIMIT));
  entries.forEach(entry => { entry.text = jest.fn(); });
  await expect(scanLocalFolder(register(entries))).rejects.toThrow('50 MiB');
  entries.forEach(entry => expect(entry.text).not.toHaveBeenCalled());
});

it('keeps a previously connected folder when reconnect validation fails', async () => {
  const source = register([file('main.js')]);
  await expect(connectLocalFolder({ sourceId: source.sourceId, files: [file('image.png')] })).rejects.toThrow('No supported source');
  expect((await scanLocalFolder(source)).entries.map(entry => entry.path)).toEqual(['main.js']);
});
