import { Blob } from 'buffer';
import { streamValue, createValueAssembler, fitsArchiveLine } from './archiveValueStream';

beforeAll(() => { global.Blob = Blob; });
async function roundTrip(value) {
  const assembler = createValueAssembler();
  for await (const token of streamValue(value)) {
    expect(JSON.stringify(token).length).toBeLessThan(65536);
    assembler.add(JSON.parse(JSON.stringify(token)));
  }
  return assembler.finish();
}
test('bounded tokens preserve escaped text, split Unicode, structured values and binary', async () => {
  const value = {text:'x'.repeat(8191)+'😀'+ '\u0000\\"'.repeat(50000),
    map:new Map([['key',new Set([undefined,NaN,Infinity])]]), date:new Date('2026-01-01'),
    bytes:new Uint16Array([10,65535]), blob:new Blob(['abc'.repeat(50000)]),
    special:JSON.parse('{"__proto__":{"polluted":true}}')};
  expect(fitsArchiveLine(value)).toBe(false);
  const copy = await roundTrip(value);
  expect(copy.text).toBe(value.text); expect(copy.map).toEqual(value.map);
  expect(copy.date).toEqual(value.date); expect(copy.bytes).toEqual(value.bytes);
  expect(await copy.blob.text()).toBe(await value.blob.text());
  expect(copy.special.__proto__).toEqual({polluted:true}); expect({}.polluted).toBeUndefined();
});
test('rejects cycles and incomplete or malformed streams', async () => {
  const cycle={};cycle.self=cycle;
  await expect(roundTrip(cycle)).rejects.toThrow(/Circular/);
  const assembler=createValueAssembler();assembler.add(['object']);expect(()=>assembler.add(['value',1])).toThrow();
  expect(()=>assembler.finish()).toThrow();
});
