import { webcrypto } from 'crypto';
import { TextEncoder } from 'util';
import { registerLocalFolder, connectLocalFolder, scanLocalFolder, createLocalSourceProvider, normalizeLocalPath } from './localCodeSource';
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
it('excludes secrets, binaries and generated dependencies before reading', async () => {
  const files = [file('src/main.js'), file('.env'), file('.env.local'), file('key.pem'), file('node_modules/x/a.js'), file('build/a.js'), file('image.png')];
  files.slice(1).forEach(entry => { entry.text = jest.fn(() => { throw new Error('Must not read excluded content'); }); });
  const source = register(files);
  const scan = await scanLocalFolder(source);
  expect(scan.entries.map(entry => entry.path)).toEqual(['src/main.js']);
  expect(scan.skipped).toHaveLength(6);
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
it('scans beyond the former source byte and entry ceilings for both adapters', async () => {
  const entries = Array.from({ length: 10020 }, (_, i) => file(`file${i}.js`, '', 6000));
  entries.push(file('large.py', 'def last(): return call()\n', 700000));
  const uploaded = await scanLocalFolder(register(entries));
  const handle = {name:'native-large',async *entries(){for(const entry of entries)yield [entry.name,{kind:'file',getFile:async()=>entry}];}};
  const native = await scanLocalFolder(registerLocalFolder({handle,sourceId:'native-large',rememberHandle:false}));
  expect(native.entries.map(e=>e.path)).toEqual(uploaded.entries.map(e=>e.path));
  expect(uploaded.entries).toHaveLength(10021);
  expect(uploaded.bytes).toBeGreaterThan(50*1024*1024);
});
it('reads large Unicode local files without clipping end-of-file evidence', async () => {
  const text='# café 车辆\n'.repeat(50000)+'def final_call(): return endpoint()\n';
  const provider=await createLocalSourceProvider(register([file('large.py',text)]));
  expect((await provider.readText({path:'large.py'})).content).toBe(text);
});

it('keeps a previously connected folder when reconnect validation fails', async () => {
  const source = register([file('main.js')]);
  await expect(connectLocalFolder({ sourceId: source.sourceId, files: [file('image.png')] })).rejects.toThrow('No supported source');
  expect((await scanLocalFolder(source)).entries.map(entry => entry.path)).toEqual(['main.js']);
});
