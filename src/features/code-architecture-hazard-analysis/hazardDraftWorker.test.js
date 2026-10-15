import {buildCodeArchitectureHazardCsvDraft} from './codeArchitectureHazardCsv';

test('draft worker executes the real builder and returns its result',()=>{
 const previous=globalThis.postMessage;
 globalThis.postMessage=jest.fn();
 try{
  require('./hazardDraftWorker');
  const options={cbaRows:[],method:'STPA',projectId:'worker-test',repoMeta:{}};
  globalThis.onmessage({data:{options,headers:['Function','Guide Phrase']}});
  expect(globalThis.postMessage.mock.calls[0][0]).toEqual({type:'progress',progress:0});
  const response=globalThis.postMessage.mock.calls.at(-1)[0];
  expect(response.error).toBeUndefined();
  expect(response.run.generatedSheets.Summary).toEqual(buildCodeArchitectureHazardCsvDraft(options,['Function','Guide Phrase']).generatedSheets.Summary);
 }finally{globalThis.postMessage=previous;delete globalThis.onmessage;}
});
