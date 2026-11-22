import {normalizeQualityVerdicts,compactQualitySources} from './functionalQualityTransport';
const source={id:'A',evidence:{code:{files:[{filePath:'guard.py',content:'def guard(x): return x <= LIMIT'}]}}};
const first={id:'A',scores:{grounding:9,verification:4},support:[{quote:'return x <= LIMIT',source:'guard.py'}],findings:[{severity:'critical',claim:'expect release'}]};
test('split reviewer entries with identical scores retain every unique finding and source quote',()=>{
  const second={...first,support:[{quote:'def guard(x): return x <= LIMIT',source:'guard.py'}],findings:[{severity:'minor',claim:'missing state'}]};
  const before=JSON.stringify([first,second]);
  const [row]=normalizeQualityVerdicts([first,second],[source]);
  expect(row.scores).toEqual(first.scores);expect(row.findings).toHaveLength(2);expect(row.support).toHaveLength(2);
  expect(JSON.stringify([first,second])).toBe(before);
});
test('conflicting scores and unknown/missing verdicts fail rather than choose an advantageous result',()=>{
  expect(()=>normalizeQualityVerdicts([first,{...first,scores:{grounding:10,verification:10}}],[source])).toThrow('conflicting');
  expect(()=>normalizeQualityVerdicts([{...first,id:'UNKNOWN'}],[source])).toThrow('invented');
  expect(()=>normalizeQualityVerdicts([],[source])).toThrow('omitted');
});
test('source transport refers only to byte-identical full source already present in the shared corpus',()=>{
  const corpus=source.evidence.code.files,before=JSON.stringify(source);
  expect(compactQualitySources([source],corpus)[0].evidence.code.files[0]).toEqual({filePath:'guard.py',contentRef:'Shared unmodified source corpus: guard.py'});
  expect(compactQualitySources([source],[{filePath:'guard.py',content:'DIFFERENT REVISION'}])[0]).toEqual(source);
  expect(JSON.stringify(source)).toBe(before);
  expect(compactQualitySources([{id:'B',evidence:{code:'Raw scalar source evidence.'}}],corpus)).toEqual([{id:'B',evidence:{code:'Raw scalar source evidence.'}}]);
});
test('declared severity ceilings are enforced downward with original scores retained for audit',()=>{
  const row={...first,scores:{grounding:9,verification:8},findings:[{severity:'major',dimension:'verification'},{severity:'critical',dimension:'grounding'}]};
  const [normalized]=normalizeQualityVerdicts([row],[source]);
  expect(normalized.scores).toEqual({grounding:4,verification:7});expect(row.scores).toEqual({grounding:9,verification:8});
  expect(normalized.appliedScoreCeilings).toContainEqual({dimension:'grounding',original:9,ceiling:4});
  expect(normalizeQualityVerdicts([{...row,scores:{grounding:99,verification:8}}],[source])[0].scores.grounding).toBe(99);
});
