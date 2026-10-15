import {stableSnapshotHash} from './stableSnapshotHash';
import {computeArchitectureSnapshotHash} from './codeArchitectureHazardUtils';
const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.keys(v).sort().reduce((out,k)=>{out[k]=stable(v[k]);return out;},{}):v==null?'':v;
const legacy=value=>{const text=JSON.stringify(stable(value));let h=0;for(let i=0;i<text.length;i++)h=((h<<5)-h+text.charCodeAt(i))|0;return h;};
test.each([
 {b:null,a:undefined,c:['quote"','backslash\\','\n\t\b\r\f','é😀','\ud800','\udfff']},
 {'10':'ten','2':'two','01':'one',z:{b:false,a:Infinity}},
 [null,undefined,,{nested:[-1,0,1.5,NaN],date:new Date(0)}],
 JSON.parse('{"__proto__":{"a":1},"normal":"value"}'),
])('preserves legacy canonical JSON fingerprint %#',value=>{expect(stableSnapshotHash(value)).toBe(legacy(value));});
test('large shared evidence is hashed without whole-tree or long-string stringify',()=>{
 const evidence={content:'x'.repeat(8192)},rows=Array.from({length:100},()=>({from:'A',to:'B',action:'Call',codeEvidence:evidence,sourceEvidence:evidence}));
 const stringify=JSON.stringify,spy=jest.spyOn(JSON,'stringify').mockImplementation((value,...args)=>{
  if(Array.isArray(value)&&value.length===100)throw new Error('Whole-array stringify');
  if(typeof value==='string'&&value.length>1000)throw new Error('Whole-string stringify');
  return stringify(value,...args);
 });
 let before;try{before=computeArchitectureSnapshotHash(rows);}finally{spy.mockRestore();}
 evidence.content+='changed';expect(computeArchitectureSnapshotHash(rows)).not.toBe(before);
});
test('nested key insertion order does not change hash',()=>{
 expect(stableSnapshotHash({z:{b:2,a:1},a:3})).toBe(stableSnapshotHash({a:3,z:{a:1,b:2}}));
});
