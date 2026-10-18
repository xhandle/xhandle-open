import { groupArchitectureDashboard } from './architectureDashboardGroups';
const folders=[{id:'a',name:'Alpha'},{id:'b',name:'Beta',parentId:'a'},{id:'c',name:'Beta'}];
const rows=[{id:'1',name:'Project 10',folderId:'a',rowCount:10},{id:'2',name:'Project 2',folderId:'a',rowCount:2},{id:'3',name:'Nested',folderId:'b'},{id:'4',name:'Separate',folderId:'c'},{id:'5',name:'Root'},{id:'6',name:'Unknown',folderId:'missing'}];
test('groups by identity, includes nested paths and retains top-level/orphan projects',()=>{
 const result=groupArchitectureDashboard(rows,folders,{key:'name',direction:'asc'});
 expect(result.map(g=>g.name)).toEqual(['Alpha','Alpha / Beta','Beta','Top level']);
 expect(result[0].rows.map(r=>r.id)).toEqual(['2','1']);
 expect(result[3].rows).toHaveLength(2);expect(rows[0].id).toBe('1');
});
test('sorts numeric values numerically, missing values last in both directions',()=>{
 const data=[{id:'a',name:'A',rowCount:null},{id:'b',name:'B',rowCount:0},{id:'c',name:'C',rowCount:10},{id:'d',name:'D',rowCount:2}];
 expect(groupArchitectureDashboard(data,[],{key:'rowCount',direction:'asc'})[0].rows.map(r=>r.id)).toEqual(['b','d','c','a']);
 expect(groupArchitectureDashboard(data,[],{key:'rowCount',direction:'desc'})[0].rows.map(r=>r.id)).toEqual(['c','d','b','a']);
});
test('folder sort reverses group order without interleaving projects',()=>{
 expect(groupArchitectureDashboard(rows,folders,{key:'folder',direction:'desc'}).map(g=>g.name)).toEqual(['Beta','Alpha / Beta','Alpha','Top level']);
});
test('sorts dates and duration using raw values',()=>{
 const data=[{id:'a',name:'A',updatedAt:'2026-01-01',metrics:{durationMs:100,aiCallCount:4}},{id:'b',name:'B',updatedAt:'2025-12-31',metrics:{durationMs:100,aiCallCount:2}},{id:'c',name:'C',updatedAt:'bad'}];
 expect(groupArchitectureDashboard(data,[],{key:'updatedAt',direction:'desc'})[0].rows.map(r=>r.id)).toEqual(['a','b','c']);
 expect(groupArchitectureDashboard(data,[],{key:'metrics',direction:'asc'})[0].rows.map(r=>r.id)).toEqual(['b','a','c']);
});
