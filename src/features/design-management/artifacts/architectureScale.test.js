import { architectureDiagram } from './architectureSources';

test('CSU capture preserves a repository-sized graph and its original relationships', () => {
  const rows = Array.from({length:5040}, (_,i) => ({ id:`row-${i}`, fromFunction:`function-${i}`, toFunction:`function-${(i+1)%5040}`, controlAction:'Calls', fromArchitecture:{system:'AV',subsystem:'Localization',csci:'Map',csc:'Estimation',csu:`unit-${i%80}`}, toArchitecture:{system:'AV',subsystem:'Localization',csci:'Map',csc:'Estimation',csu:`unit-${(i+1)%80}`}, controlDetails:'Saved implementation details. '.repeat(30) }));
  const entries=architectureDiagram({workspaceType:'code-architecture', projectId:'p',repoId:'r',abstraction:'csu',label:'CSU'},rows);
  const snapshot = entries[0].snapshot;
  expect(snapshot.nodes).toHaveLength(80);
  expect(snapshot.nodes.flatMap(node => node.members)).toHaveLength(5040);
  expect(snapshot.edges.flatMap(edge => edge.relationships)).toHaveLength(5040);
}, 60000);
