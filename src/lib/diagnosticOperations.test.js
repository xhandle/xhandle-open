import {diagnosticCheckpoint,diagnosticError,withDiagnosticOperation,withDiagnosticSync,installDiagnosticErrorCapture} from './diagnosticOperations';
afterEach(()=>{delete window.xhandleDesktop;jest.restoreAllMocks();});
test('optional diagnostics preserve results and the original thrown error',async()=>{
 const error=new Error('original');expect(withDiagnosticSync('test.sync',{},()=>42)).toBe(42);
 await expect(withDiagnosticOperation('test.async',{},()=>Promise.reject(error))).rejects.toBe(error);
 const recordDiagnostic=jest.fn(()=>{throw Error('logger failed');});window.xhandleDesktop={recordDiagnostic};
 expect(withDiagnosticSync('test.sync',{},()=>42)).toBe(42);await expect(withDiagnosticOperation('test.async',{},()=>Promise.reject(error))).rejects.toBe(error);
});
test('operation boundaries record counts and bounded error causes, never returned data',async()=>{
 const recordDiagnostic=jest.fn();window.xhandleDesktop={recordDiagnostic};
 const source={prompt:'private prompt',sourceRows:5000};
 const rows=await withDiagnosticOperation('requirements.derive',source,async()=>[{secret:'private result'}]);
 expect(rows).toHaveLength(1);expect(recordDiagnostic.mock.calls[0][0]).toMatchObject({stage:'start',counts:{sourceRows:5000}});
 expect(recordDiagnostic.mock.calls[1][0]).toMatchObject({stage:'complete',counts:{sourceRows:5000,resultRows:1}});
 expect(JSON.stringify(recordDiagnostic.mock.calls)).not.toMatch(/private prompt|private result/);
 const cause=new Error('disk full'),error=new Error('save failed',{cause});error.code='SAVE_FAILED';
 await expect(withDiagnosticOperation('requirements.save',{},()=>Promise.reject(error))).rejects.toBe(error);
 expect(recordDiagnostic.mock.calls.at(-1)[0].error.map(e=>e.message)).toEqual(['save failed','disk full']);
 error.cause=error;expect(diagnosticError(error)).toHaveLength(1);
});
test('high-frequency checkpoints are sampled but failures are retained',()=>{
 const recordDiagnostic=jest.fn();window.xhandleDesktop={recordDiagnostic};
 for(let i=0;i<1000;i++)diagnosticCheckpoint('requirements.frequent','progress',{batchEnd:i},{sampled:true});
 expect(recordDiagnostic).toHaveBeenCalledTimes(1);
 diagnosticCheckpoint('requirements.frequent','error',{}, {sampled:true,error:new Error('failed')});expect(recordDiagnostic).toHaveBeenCalledTimes(2);
 window.xhandleDesktop.diagnosticsEnabled=false;diagnosticCheckpoint('requirements.disabled','start');expect(recordDiagnostic).toHaveBeenCalledTimes(2);
});
test('main-world error hooks preserve full stacks and rejection causes',()=>{
 const reportFailure=jest.fn(),target=new EventTarget();target.xhandleDesktop={reportFailure};
 const dispose=installDiagnosticErrorCapture(target),error=new Error('native allocation failed',{cause:new Error('underlying reason')});
 target.dispatchEvent(new ErrorEvent('error',{message:'Uncaught error',error}));
 const rejection=new Event('unhandledrejection');rejection.reason=error;target.dispatchEvent(rejection);
 expect(reportFailure.mock.calls[0][0].error[0].stack).toContain('native allocation failed');expect(reportFailure.mock.calls[1][0].error[1].message).toBe('underlying reason');
 dispose();target.dispatchEvent(new ErrorEvent('error',{error}));expect(reportFailure).toHaveBeenCalledTimes(2);
});
test('cancellation and falsy thrown values preserve control flow and correct event types',async()=>{
 const recordDiagnostic=jest.fn();window.xhandleDesktop={recordDiagnostic};
 await expect(withDiagnosticOperation('test.falsy',{},()=>Promise.reject(null))).rejects.toBeNull();
 expect(recordDiagnostic.mock.calls.at(-1)[0]).toMatchObject({stage:'error',error:[{name:'NonErrorThrownValue',message:'null'}]});
 const canceled=new Error('Canceled');canceled.name='AbortError';
 await expect(withDiagnosticOperation('test.abort',{},()=>Promise.reject(canceled))).rejects.toBe(canceled);
 expect(recordDiagnostic.mock.calls.at(-1)[0].stage).toBe('canceled');
});
test('console capture forwards original arguments, ignores object payloads, and restores the original method',()=>{
 jest.useFakeTimers();
 const reportFailure=jest.fn(),original=jest.fn(()=>42),target=new EventTarget();target.console={error:original};target.xhandleDesktop={reportFailure};
 const dispose=installDiagnosticErrorCapture(target),error=new Error('caught failure');
 expect(target.console.error('Stage failed',error,{prompt:'private content'})).toBe(42);
 expect(original).toHaveBeenCalledWith('Stage failed',error,{prompt:'private content'});expect(reportFailure.mock.calls[0][0]).toMatchObject({source:'console',message:'Stage failed'});
 expect(JSON.stringify(reportFailure.mock.calls)).not.toContain('private content');
 for(let i=0;i<100;i++)target.console.error('Flood '+i);expect(reportFailure).toHaveBeenCalledTimes(10);
  jest.advanceTimersByTime(1000);expect(reportFailure).toHaveBeenCalledTimes(11);expect(reportFailure.mock.calls.at(-1)[0].message).toBe('Flood 99');expect(reportFailure.mock.calls.at(-1)[0].error).toEqual([]);
 dispose();expect(target.console.error).toBe(original);jest.useRealTimers();
  target.console=Object.freeze({error:original});expect(()=>installDiagnosticErrorCapture(target)()).not.toThrow();
});
test('throttled console capture snapshots strings instead of retaining mutable Error objects',()=>{
 jest.useFakeTimers();const reportFailure=jest.fn(),target=new EventTarget();target.console={error:()=>{}};target.xhandleDesktop={reportFailure};
 const dispose=installDiagnosticErrorCapture(target);for(let i=0;i<10;i++)target.console.error('burst');
 const error=new Error('observed failure');target.console.error('Queued failure',error);error.message='changed later';
 jest.advanceTimersByTime(1000);expect(reportFailure.mock.calls.at(-1)[0].error[0].message).toBe('observed failure');dispose();jest.useRealTimers();
});
