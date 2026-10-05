import { parseFunctionalAnalysisTable, analyzeFunctionalSourceChunk, incompleteResponse, withAnalysisRequestDeadline, waitForAnalysisRetry, retryAfterMilliseconds } from './functionalAnalysisResponse';
const headers = ['Function (From)', 'Function (From) Related File(s)', 'Function (From) Details', 'Control Action', 'Control Action Details', 'Function (To)', 'Function (To) Related File(s)', 'Function (To) Details'];
const row = ['caller', 'control.py', 'Caller', 'Check', 'Check request', 'validator', 'control.py', 'Validate'];
const table = (values = row, columns = headers) => [columns.join(' | '), columns.map(() => '---').join(' | '), values.join(' | ')].join('\n');
test('accepts optional outside pipes, CRLF, reordered columns, escaped pipes and code pipes', () => {
 const values = [...row]; values[2] = 'Either a\\|b or `a | b`';
 const text = 'Response:\r\n```markdown\r\n' + table(values.reverse(), [...headers].reverse()).split('\n').map(line => `| ${line} |`).join('\r\n') + '\r\n```';
 expect(parseFunctionalAnalysisTable(text)[0]).toMatchObject({from:'caller',fromDetails:'Either a|b or `a | b`',to:'validator'});
});
test('accepts explicit empty table but rejects missing and partial rows', () => {
 expect(parseFunctionalAnalysisTable(table().split('\n').slice(0,2).join('\n'))).toEqual([]);
 expect(() => parseFunctionalAnalysisTable('No relationships.')).toThrow();
 expect(() => parseFunctionalAnalysisTable(table() + '\n| incomplete |')).toThrow(/columns/);
 expect(() => parseFunctionalAnalysisTable(table() + '\nunfinished')).toThrow(/incomplete/);
});
const wait = jest.fn(async()=>{});
const truncated = () => incompleteResponse('limit','FUNCTIONAL_RESPONSE_TRUNCATED');
test('increases output capacity automatically before splitting', async () => {
 const request=jest.fn().mockRejectedValueOnce(truncated()).mockResolvedValue(table());
 await expect(analyzeFunctionalSourceChunk({content:'source',request,wait})).resolves.toHaveLength(1);
 expect(request.mock.calls.map(call=>call[2].maxTokens)).toEqual([4096,8192]);
});
test.each(['single line','multiple lines'])('nested subdivision covers every character of %s and supplies boundary context', async kind => {
 const content=kind==='single line'?'x'.repeat(2048):'some source\n'.repeat(180);
 const completed=[];
 const request=jest.fn(async(part,repair,section)=>{
  expect(part).toBe(content.slice(section.start,section.end));
  expect(section.contextBefore).toBe(content.slice(Math.max(0,section.start-400),section.start));
  expect(section.contextAfter).toBe(content.slice(section.end,Math.min(content.length,section.end+400)));
  if(part.length>300)throw truncated();
  completed.push(section);return table();
 });
 const rows=await analyzeFunctionalSourceChunk({content,request,wait,policy:{minChars:64}});
 expect(rows).toHaveLength(completed.length);
 expect(request.mock.calls.length).toBeGreaterThan(3);
 expect(completed[0].start).toBe(0);
 completed.slice(1).forEach((part,i)=>expect(part.start).toBe(completed[i].end));
 expect(completed.at(-1).end).toBe(content.length);
});
test('each child can recover without exhausting the other child allowance', async () => {
 let calls=0;
 const request=jest.fn(async part=>{calls++;if(part.length>512)throw truncated();if(calls===3)return 'broken';return table();});
 await expect(analyzeFunctionalSourceChunk({content:'x'.repeat(1024),request,wait})).resolves.toHaveLength(2);
 expect(request).toHaveBeenCalledTimes(5);
});
test('retains completed sections across automatic passes', async () => {
 const state={},content='x'.repeat(1024),checkpoint=jest.fn(async()=>{});
 let failing=true;
 const request=jest.fn(async(part,repair,section)=>{
  if(part.length>512)throw truncated();
  if(section.start>0&&failing)throw Object.assign(new Error('Unavailable'),{retryable:true});
  return table();
 });
 await expect(analyzeFunctionalSourceChunk({content,request,wait,state,onCheckpoint:checkpoint})).rejects.toThrow('Unavailable');
 expect(Object.keys(state.completed)).toHaveLength(1);
 const count=request.mock.calls.length;failing=false;
 await expect(analyzeFunctionalSourceChunk({content,request,wait,state,onCheckpoint:checkpoint})).resolves.toHaveLength(2);
 expect(request.mock.calls.slice(count).map(call=>call[2].start)).toEqual([512]);
});
test('bounds persistent truncation and format failure without returning partial results', async () => {
 const request=jest.fn().mockRejectedValue(truncated());
 await expect(analyzeFunctionalSourceChunk({content:'x'.repeat(12000),request,wait,policy:{maxRequests:5}})).rejects.toMatchObject({code:'FUNCTIONAL_RECOVERY_EXHAUSTED',retryable:false});
 expect(request).toHaveBeenCalledTimes(5);
 const broken=jest.fn().mockResolvedValue('broken');
 await expect(analyzeFunctionalSourceChunk({content:'source',request:broken,wait})).rejects.toMatchObject({retryable:true});
 expect(broken).toHaveBeenCalledTimes(3);
});
test('honors bounded Retry-After and exponential delays for transient errors', async () => {
 const pause=jest.fn(async()=>{});
 const request=jest.fn().mockRejectedValueOnce(Object.assign(new Error('Rate limit'),{retryable:true,retryAfterMs:5000})).mockRejectedValueOnce(new TypeError('network')).mockResolvedValue(table());
 await expect(analyzeFunctionalSourceChunk({content:'source',request,wait:pause})).resolves.toHaveLength(1);
 expect(pause.mock.calls.map(call=>call[0])).toEqual([5000,2000]);
 expect(retryAfterMilliseconds('120')).toBe(60000);
 expect(retryAfterMilliseconds('invalid')).toBe(0);
 expect(retryAfterMilliseconds('Wed, 01 Jan 2025 00:00:10 GMT',Date.parse('2025-01-01T00:00:00Z'))).toBe(10000);
});
test('does not retry permanent errors, cancellation or storage errors', async () => {
 const request=jest.fn().mockRejectedValue(new Error('Settings changed'));
 await expect(analyzeFunctionalSourceChunk({content:'source',request,wait})).rejects.toThrow('Settings changed');
 expect(request).toHaveBeenCalledTimes(1);
 const controller=new AbortController();controller.abort(new Error('cancelled'));
 request.mockClear();
 await expect(analyzeFunctionalSourceChunk({content:'source',request,signal:controller.signal,wait})).rejects.toThrow('cancelled');
 expect(request).not.toHaveBeenCalled();
 request.mockResolvedValue(table());
 await expect(analyzeFunctionalSourceChunk({content:'source',request,wait,onCheckpoint:async()=>{throw new TypeError('Storage failed');}})).rejects.toThrow('Storage failed');
 expect(request).toHaveBeenCalledTimes(1);
});
test('a hung request times out, aborts its signal, and recovers within the same chunk', async () => {
 let signal;
 const request=jest.fn().mockImplementationOnce((part,repair,section)=>{signal=section.signal;return new Promise(()=>{});}).mockResolvedValue(table());
 await expect(analyzeFunctionalSourceChunk({content:'source',request,wait,policy:{timeoutMs:10}})).resolves.toHaveLength(1);
 expect(signal.aborted).toBe(true);
});
test('cancels a hung request immediately without waiting for its deadline', async () => {
 const controller=new AbortController();let child;
 const pending=withAnalysisRequestDeadline(signal=>{child=signal;return new Promise(()=>{});},controller.signal,10000);
 await Promise.resolve();controller.abort(new Error('User cancelled'));
 await expect(pending).rejects.toThrow(/cancelled/);expect(child.aborted).toBe(true);
});
test('cancels a pending retry delay', async () => {
 const controller=new AbortController();const pending=waitForAnalysisRetry(60000,controller.signal);
 controller.abort(new Error('User cancelled'));
 await expect(pending).rejects.toThrow(/cancelled/);
});

test('automatically retries transient source access but not permanent access errors', async () => {
 const {retryAnalysisOperation}=require('./functionalAnalysisResponse');
 const read=jest.fn().mockRejectedValueOnce(Object.assign(new Error('Unavailable'),{retryable:true})).mockResolvedValue('source');
 await expect(retryAnalysisOperation(read,{wait})).resolves.toBe('source');
 expect(read).toHaveBeenCalledTimes(2);
 const denied=jest.fn().mockRejectedValue(new Error('Permission denied'));
 await expect(retryAnalysisOperation(denied,{wait})).rejects.toThrow('Permission denied');
 expect(denied).toHaveBeenCalledTimes(1);
});
