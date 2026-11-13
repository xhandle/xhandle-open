import { IDBFactory } from 'fake-indexeddb';
import { serialize, deserialize } from 'v8';
import { captureCodePresentation } from './codeArchitectureSnapshot';
import { openCbaIndexedDB } from '../../code-architecture-assurance/codeArchitectureStorage';
import { functionalDiagramStorageKey } from '../../../components/functionalDiagramIdentity';

beforeEach(() => { global.indexedDB = new IDBFactory(); global.structuredClone = value => deserialize(serialize(value)); localStorage.clear(); });

test.each(['csu', 'functional'])('captures %s layout and routing from the source canvas without changing source storage', async abstraction => {
  const source = { projectId: 'project', repoId: 'repo', abstraction }, repo = { branch: 'main' };
  const rows = [{ fromArchitecture: { subsystem: 'A' }, toArchitecture: { subsystem: 'B' } }];
  const key = abstraction === 'functional' ? functionalDiagramStorageKey(JSON.stringify(['project', '', 'repo', 'main']), rows) : 'diagram:github:repo:main';
  const positionKey = key + (abstraction === 'functional' ? ':function-spacing-v3' : '');
  const positions = [['node', { x: 345, y: 678 }]];
  const db = await openCbaIndexedDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction('diagram_positions', 'readwrite');
    tx.objectStore('diagram_positions').put({ key: positionKey, value: positions });
    tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
  });
  db.close();
  localStorage.setItem(key + ':csu-edge-routing', JSON.stringify({ defaultStyle: 'rectangular' }));
  const saved = await captureCodePresentation(source, repo, rows, localStorage);
  expect(saved.positions).toEqual(positions);
  expect(saved.routing).toEqual({ defaultStyle: 'rectangular' });
  saved.positions[0][1].x = 0;
  saved.routing.defaultStyle = 'changed';
  const next = await captureCodePresentation(source, repo, rows, localStorage);
  expect(next.positions).toEqual(positions);
  expect(next.routing.defaultStyle).toBe('rectangular');
});
