import {stpaColumnOptions, STPA_DEFAULT_COLUMNS} from './stpaTableColumns';
const columns = headers => headers.map((header, index) => ({header, index, key:String(index)}));
test('STPA removes review/processing/other-method fields and empty unused fields, preserving populated user columns and original indices', () => {
  const headers = ['Unsafe Control Action', 'Confidence', 'Raw Analysis Row ID', 'ASIL', 'Reviewer note', 'Unused legacy', 'Safety Constraint', 'Classification Resolution Status'];
  const rows = [['Stop late', 'High', 'HA-1', 'D', 'Customer comment', '', 'Controller shall stop', 'Needs Review']];
  expect(stpaColumnOptions(columns(headers), rows).map(({header,index})=>[header,index])).toEqual([
    ['Unsafe Control Action',0], ['Reviewer note',4], ['Safety Constraint',6],
  ]);
  expect(rows[0][1]).toBe('High');
});
test('default methodology fields survive empty datasets and late populated rows keep custom columns', () => {
  const headers = [...STPA_DEFAULT_COLUMNS, 'Customer note'];
  const data = Array.from({length:150},()=>[]); data[149][headers.length-1]='Retained';
  expect(stpaColumnOptions(columns(headers), data)).toHaveLength(headers.length);
  expect(stpaColumnOptions(columns(headers), [])).toHaveLength(STPA_DEFAULT_COLUMNS.length);
});
test('remote windows keep a stable picker and source indices even when a field is empty in the current window', () => {
  const headers = ['Unsafe Control Action','Customer note','Confidence','Severity'];
  expect(stpaColumnOptions(columns(headers), [], {remote:true}).map(c=>c.index)).toEqual([0,1]);
});
