import { portableLocalMetadata } from './portableLocalMetadata';
test('removes only per-call diagnostics, retaining totals, context and unknown fields',()=>{
 const value={metrics:{calls:[{prompt:'diagnostic'.repeat(100000)}],aiCallCount:42,durationMs:100,models:{a:42}},operationalContext:'saved',sourceAnalysis:{pending:['file.cpp']},custom:'retained'};
 const text=JSON.stringify(value),result=JSON.parse(portableLocalMetadata('cbaMeta:p:r',text));
 expect(result).toEqual({...value,metrics:{aiCallCount:42,durationMs:100,models:{a:42}}});
 expect(JSON.stringify(result).length).toBeLessThan(1000);
 expect(value.metrics.calls.length).toBe(1);
 expect(portableLocalMetadata('other',text)).toBe(text);
 expect(portableLocalMetadata('cbaMeta:p:r','invalid')).toBe('invalid');
});
