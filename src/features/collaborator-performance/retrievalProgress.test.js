import {formatRetrievalProgress} from './retrievalProgress';
test('reports local preparation counts without suggesting the model is reasoning',()=>{
 expect(formatRetrievalProgress({step:'codeArchitecture',recordsPrepared:1024})).toBe('Preparing saved code architecture… 1,024 records prepared so far.');
 expect(formatRetrievalProgress({step:'searching'})).toBe('Finding relevant saved information…');
 expect(formatRetrievalProgress({step:'waiting'})).toBe('Waiting for access to saved project information…');
 expect(formatRetrievalProgress({step:'unknown',recordsPrepared:NaN})).toBe('Preparing saved project information…');
});
