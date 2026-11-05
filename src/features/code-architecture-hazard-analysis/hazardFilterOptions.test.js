import {createHazardFilterOptions,findPreparedHazardOptions,FILTER_OPTION_BYTES,FILTER_ROW_INDEX_BYTES,filterPreparedHazardLayout} from './hazardFilterOptions';

test('deduplicates normalized values, blanks and numeric sorting with immediate case-insensitive search',()=>{
 const collector=createHazardFilterOptions(2);
 [[' mode 10 ',''],['mode 2',null],['mode 2','value']].forEach(row=>collector.addRow(row));
 const index=collector.finish();
 expect(findPreparedHazardOptions(index,0).options).toEqual(['mode 2','mode 10']);
 expect(findPreparedHazardOptions(index,1).options).toEqual(['(blank)','value']);
 expect(findPreparedHazardOptions(index,0,'MODE 1')).toEqual({options:['mode 10'],truncated:false});
 expect(findPreparedHazardOptions(index,0,'absent').options).toEqual([]);
});
test('73 high-cardinality columns stay within the aggregate budget; duplicates do not falsely truncate',()=>{
 const collector=createHazardFilterOptions(73);
 for(let i=0;i<27000;i++)collector.addRow(Array.from({length:73},(_,c)=>c===72?'same':`${i}:`+'x'.repeat(100)));
 const index=collector.finish();
 expect(index.metadataBytes).toBeLessThanOrEqual(FILTER_OPTION_BYTES);
 expect(JSON.stringify(index).length*2).toBeLessThan(FILTER_OPTION_BYTES);
 expect(index.columns.every(column=>column.options.length<=500)).toBe(true);
 expect(index.columns[0].truncated).toBe(true);
 expect(index.columns[72]).toEqual({options:['same'],truncated:false});
 expect(findPreparedHazardOptions(index,0,'26999:')).toBeNull();
 expect(findPreparedHazardOptions(index,0).options.length).toBeGreaterThan(0);
});
test('very long cells are not retained and incomplete searches fall back to the saved source',()=>{
 const collector=createHazardFilterOptions(1);
 collector.addRow(['a'.repeat(1000000)]);collector.addRow(['short']);
 const index=collector.finish();
 expect(index.columns[0]).toEqual({options:['short'],truncated:true});
 expect(index.metadataBytes).toBeLessThan(1000);
 expect(findPreparedHazardOptions(index,0,'short')).toBeNull();
 expect(findPreparedHazardOptions(index,1)).toBeNull();
});

function prepare(rows) {
 const collector=createHazardFilterOptions(rows[0].length,rows.length);
 rows.forEach(row=>collector.addRow(row));
 const indices=rows.map((_,i)=>i);
 return {indices,total:rows.length,metadataBytes:0,optionIndex:collector.finish(),groups:[
  {key:'even',rowIndices:indices.filter(i=>i%2===0)},
  {key:'odd',rowIndices:indices.filter(i=>i%2===1)}]};
}
test('packed membership handles all 400 codes across byte boundaries and repeated offscreen values',()=>{
 const rows=Array.from({length:800},(_,i)=>['value '+(i%400),i%2?'odd':'even']);
 const layout=prepare(rows);
 for(let i=0;i<400;i++)expect(filterPreparedHazardLayout(layout,{0:['value '+i]}).indices).toEqual([i,i+400]);
 expect(filterPreparedHazardLayout(layout,{0:['value 399','value 398'],1:['odd']}).indices).toEqual([399,799]);
 expect(filterPreparedHazardLayout(layout,{0:['value 399']}).groups).toEqual([{key:'odd',rowIndices:[399,799],rowCount:2}]);
 expect(filterPreparedHazardLayout(layout,{})).toBe(layout);
 expect(filterPreparedHazardLayout(layout,{0:['unknown']}).total).toBe(0);
 expect(layout.indices).toHaveLength(800);
});
test('blank normalization and truncated columns preserve exact filtering or request fallback',()=>{
 const layout=prepare([['  '],['value'],['x'.repeat(3000)],['value']]);
 expect(filterPreparedHazardLayout(layout,{0:['(blank)']}).indices).toEqual([0]);
 expect(filterPreparedHazardLayout(layout,{0:['value']}).indices).toEqual([1,3]);
 expect(filterPreparedHazardLayout(layout,{0:['x'.repeat(3000)]})).toBeNull();
});
test('27,000 rows and 73 columns have bounded membership storage; larger inputs fall back without allocation',()=>{
 const collector=createHazardFilterOptions(73,27000);
 for(let i=0;i<27000;i++)collector.addRow(Array(73).fill('value '+i));
 const index=collector.finish();
 expect(index.columns.reduce((n,c)=>n+c.codes.byteLength,0)).toBeLessThanOrEqual(FILTER_ROW_INDEX_BYTES);
 expect(index.metadataBytes).toBeLessThanOrEqual(FILTER_OPTION_BYTES+FILTER_ROW_INDEX_BYTES);
 const oversized=createHazardFilterOptions(73,1000000).finish();
 expect(oversized.rowCount).toBe(0);
 expect(oversized.columns.every(c=>!c.codes)).toBe(true);
 expect(filterPreparedHazardLayout({total:1000000,optionIndex:oversized},{0:['value']})).toBeNull();
});
