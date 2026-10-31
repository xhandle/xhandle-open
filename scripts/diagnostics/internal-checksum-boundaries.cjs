// ~1.5 GiB of CPU hashing, bounded to a reusable 256 KiB buffer; no files/data stores.
// Run once: node scripts/diagnostics/internal-checksum-boundaries.cjs
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const {sha256} = require('hash.js');
const block = Buffer.alloc(256 * 1024);
for (let i = 0; i < block.length; i++) block[i] = i % 251;
for (const mib of [504, 512, 520]) {
  const start = Date.now(), legacy = sha256(), standard = createHash('sha256');
  for (let n = 0; n < mib * 4; n++) { legacy.update(block); standard.update(block); }
  const actual = legacy.digest('hex'), expected = standard.digest('hex');
  assert.equal(actual === expected, mib < 512);
  console.log(JSON.stringify({mib, bytes:mib * 1048576, legacy:actual, standard:expected, ms:Date.now()-start}));
}
