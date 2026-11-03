import {createHazardCsvWorkerEndpoint} from './hazardCsvWorkerProtocol';
import {prepareHazardCsvImport,applyHazardCsvImport,discardHazardCsvImport} from './hazardCsvImport';
jest.mock('./hazardCsvImport',()=>({prepareHazardCsvImport:jest.fn(),applyHazardCsvImport:jest.fn(),discardHazardCsvImport:jest.fn()}));
const turn=()=>new Promise(resolve=>setTimeout(resolve,0));
test('durable notification precedes cleanup, while final completion waits for cleanup',async()=>{
 const messages=[],result={run:{id:'saved'},changedRowCount:27125};let finish;
 prepareHazardCsvImport.mockResolvedValue({sessionId:'test'});
 applyHazardCsvImport.mockImplementation(async(_id,options)=>{options.onCommitted(result);await new Promise(resolve=>{finish=resolve;});return result;});
 const receive=createHazardCsvWorkerEndpoint(message=>messages.push(message));
 receive({data:{id:1,operation:'prepare',args:{}}});await turn();
 receive({data:{id:2,operation:'apply',args:{}}});await turn();
 expect(messages.some(message=>message.id===2&&message.type==='committed')).toBe(true);
 expect(messages.some(message=>message.id===2&&message.type==='result')).toBe(false);
 // Cancellation after publication cannot turn durable success into failure.
 receive({data:{operation:'cancel'}});finish();await turn();
 expect(messages.filter(message=>message.id===2&&message.type==='result')).toEqual([{id:2,type:'result',result}]);
 receive({data:{id:3,operation:'discard'}});await turn();
 expect(discardHazardCsvImport).not.toHaveBeenCalled();
});
test('a cleanup failure after publication still reports the durable result',async()=>{
 const messages=[],result={run:{id:'saved'},changedRowCount:1};
 applyHazardCsvImport.mockImplementation(async(_id,options)=>{options.onCommitted(result);throw Error('Cleanup interrupted');});
 const receive=createHazardCsvWorkerEndpoint(message=>messages.push(message));
 receive({data:{id:1,operation:'apply',args:{}}});await turn();
 expect(messages.at(-1)).toEqual({id:1,type:'result',result});
});
