import { createHazardReviewRowIndex } from './hazardReviewRowIndex';

test('stable IDs match the first exact duplicate and reject changed narratives', () => {
  const rows = [['HA-1', 'old'], ['HA-1', 'new'], ['HA-1', 'new'], ['HA-2', 'new']];
  const index = createHazardReviewRowIndex(rows, ['Raw Analysis Row ID', 'Hazard']);
  expect(index.find(['HA-1', 'new'])).toBe(1);
  expect(index.find(['HA-2', 'old'])).toBe(-1);
  expect(index.find(['HA-3', 'new'])).toBe(-1);
});
test('legacy content matching preserves first duplicates, structured cells and nulls', () => {
  const rows = [['same', null, { a: 1 }], ['same', null, { a: 1 }], ['different']];
  const index = createHazardReviewRowIndex(rows);
  expect(index.find(['same', undefined, { a: 1 }])).toBe(0);
  expect(index.find(['same', null, { a: 2 }])).toBe(-1);
  expect(index.find(['different'])).toBe(2);
});
test('an index belongs to its supplied snapshot', () => {
  const headers = ['Raw Analysis Row ID'];
  expect(createHazardReviewRowIndex([['HA-1']], headers).find(['HA-2'])).toBe(-1);
  expect(createHazardReviewRowIndex([['HA-2']], headers).find(['HA-2'])).toBe(0);
});

test('an absent stable row ID never scans or hashes unrelated review narratives',()=>{
 const expensive={toJSON:()=>{throw Error('Unrelated narrative was scanned');}};
 const index=createHazardReviewRowIndex([['reviewed',expensive]],['Raw Analysis Row ID','Hazard']);
 expect(index.find(['different','Other hazard'])).toBe(-1);
});
