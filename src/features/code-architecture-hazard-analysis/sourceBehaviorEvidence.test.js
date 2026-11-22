import {prepareSourceBehaviorEvidence,sourceBehaviorEvidenceIsValid} from './sourceBehaviorEvidence';
const files=[{filePath:'gate.py',content:'LIMIT = 7\ndef gate(x):\n    return x <= LIMIT\n'},
  {filePath:'control.py',content:'def tick(x):\n    return gate(x)\n'}];
const context={sharedSourceCorpus:files,operationalContext:'Teleoperated test'};
const evidence=[{filePath:'gate.py',fact:'gate accepts boundary equality.',quote:'return x <= LIMIT'}];
test('derives cited source behavior without changing the source model or generating expected hazards',async()=>{
  const original=JSON.stringify(context),checkpoint={readMany:async()=>[null],write:jest.fn()};
  const request=jest.fn(async()=>JSON.stringify(evidence));
  expect(await prepareSourceBehaviorEvidence({context,checkpoint,request})).toEqual(evidence);
  expect(request.mock.calls[0][0]).toContain('Do not generate hazards, requirements');
  expect(request.mock.calls[0][1]).toMatchObject({workflow:'hazard-evidence-extraction'});
  expect(checkpoint.write).toHaveBeenCalledTimes(1);expect(JSON.stringify(context)).toBe(original);
});
test('fabricated/stiched quotes cannot become shared source evidence',async()=>{
  const fake=[{...evidence[0],quote:'return x < ... LIMIT'}];
  expect(sourceBehaviorEvidenceIsValid(fake,files)).toBe(false);
  await expect(prepareSourceBehaviorEvidence({context,checkpoint:{readMany:async()=>[null],write:jest.fn()},request:async()=>fake})).rejects.toMatchObject({code:'HAZARD_EVIDENCE_INVALID'});
});
test('cached evidence is revalidated against the exact source revision',async()=>{
  const request=jest.fn();
  expect(await prepareSourceBehaviorEvidence({context,checkpoint:{readMany:async()=>[evidence]},request})).toEqual(evidence);
  expect(request).not.toHaveBeenCalled();
  expect(sourceBehaviorEvidenceIsValid(evidence,files.map(file=>({...file,content:file.content.replace('<=','<')})))).toBe(false);
});
test('single-file/no-source analyses retain their existing direct evidence path',async()=>{
  const request=jest.fn();
  expect(await prepareSourceBehaviorEvidence({context:{sharedSourceCorpus:files.slice(0,1)},request})).toEqual([]);
  expect(request).not.toHaveBeenCalled();
});
