import {hazardByteCache,hazardTextKey} from './hazardMemory';

test('identities use SHA-256',()=>{
 expect(hazardTextKey('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
test('cache stays bounded over a large stream and honors recent reads',()=>{
 const cache=hazardByteCache(1024,3);
 for(let i=0;i<10000;i++){cache.set(String(i),'x'.repeat(100));expect(cache.stats.bytes).toBeLessThanOrEqual(1024);}
 expect(cache.stats.entries).toBe(3);
 expect(cache.get('9997')).toBe('x'.repeat(100));
 cache.set('new','y');
 expect(cache.get('9998')).toBeUndefined();
 expect(cache.get('9997')).toBeDefined();
 cache.set('oversize','x'.repeat(2000));
 expect(cache.get('oversize')).toBeUndefined();
 expect(cache.stats.bytes).toBeLessThanOrEqual(1024);
});
test('incremental hash preserves UTF-8 across a surrogate-pair chunk boundary',()=>{
 const text='x'.repeat(8191)+'😀'+'界'.repeat(10000);
 expect(hazardTextKey(text)).toBe(require('crypto').createHash('sha256').update(text).digest('hex'));
});
