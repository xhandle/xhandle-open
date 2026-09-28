import { chooseDecompositionRecovery, nextDecompositionVersion } from './decompositionRecovery';
test('newer checkpoint replaces nonempty stale primary irrespective of metadata time',()=>{
 const backup={responseRows:['new'],decompositionVersion:20};
 expect(chooseDecompositionRecovery({responseRows:['old'],decompositionVersion:10,_updatedAt:'2099-01-01'},backup)).toBe(backup);
});
test('explicit clear with newer content version is preserved',()=>{
 expect(chooseDecompositionRecovery({responseRows:[],decompositionVersion:30},{responseRows:['old'],decompositionVersion:20})).toBeNull();
});
test('checkpoint clear supersedes old populated primary',()=>{
 const clear={responseRows:[],decompositionVersion:30};
 expect(chooseDecompositionRecovery({responseRows:['old'],decompositionVersion:20},clear)).toBe(clear);
});
test('ambiguous legacy checkpoint preserves explicit primary clear',()=>{
 const backup={responseRows:['saved'],updatedAt:'2026-01-01'};
 expect(chooseDecompositionRecovery({responseRows:[],_updatedAt:'2026-02-01'},backup)).toBeNull();
});
test('versions are monotonic across repeated writes',()=>{
 const a=nextDecompositionVersion();expect(nextDecompositionVersion(a)).toBeGreaterThan(a);
});

test('unaccepted newer candidate never replaces primary', () => {
 expect(chooseDecompositionRecovery({decompositionVersion:1}, {responseRows:['rejected'],decompositionVersion:2,accepted:false})).toBeNull();
});
test('older legacy backup cannot roll back populated primary', () => {
 expect(chooseDecompositionRecovery({responseRows:['new']}, {responseRows:['old'],updatedAt:'2020-01-01'})).toBeNull();
});
