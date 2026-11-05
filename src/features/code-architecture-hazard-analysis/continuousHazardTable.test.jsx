import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import Table from './CodeArchitectureHazardSummaryTable';

jest.mock('lucide-react',()=>new Proxy({__esModule:true},{get:(_target,name)=>name==='__esModule'?true:()=>null}));
global.IS_REACT_ACT_ENVIRONMENT=true;
const headers=['Raw Analysis Row ID','Function (From)','Control Action','Function (To)','Hazard'];
const sheet=[headers];
const row=index=>[`HA-${index}`,'Source '+index,'Command '+index,'Target '+index,'Hazard '+index];
const layout={headers,total:2000,groups:[
 {key:'even',label:'Even interfaces',rowCount:1000,rowIndices:Array.from({length:1000},(_,i)=>i*2)},
 {key:'odd',label:'Odd interfaces',rowCount:1000,rowIndices:Array.from({length:1000},(_,i)=>i*2+1)},
]};
let host,root,remote;
beforeEach(()=>{
 jest.useFakeTimers();
 host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);
 remote={rowIndices:[0],continuous:true,queryKey:'source:revision:all',layout,total:2000,rowsByIndex:new Map([[0,row(0)]]),
  filters:{},options:[],setFilter:jest.fn(),requestOptions:jest.fn(),clearFilters:jest.fn(),copy:jest.fn(),requestRows:jest.fn(),cacheStats:{rows:1,bytes:100}};
});
afterEach(()=>{act(()=>root.unmount());host.remove();jest.useRealTimers();localStorage.clear();});
const render=(props={})=>act(()=>root.render(<Table summarySheet={sheet} remotePage={remote} storageKey="continuous-test" showReview={false} {...props}/>));

test('distant focus requests load absolute rows and acknowledge only real cells, with correct selection and deletion',()=>{
 const resolved=jest.fn(),remove=jest.fn(),select=jest.fn(),open=jest.fn();
 const props={highlightedRowIndex:1999,focusRequestKey:'far',onRowFocusResolved:resolved,onDeleteRow:remove,onCollaboratorSelectionChange:select,onOpenArchitectureTarget:open};
 render(props);
 expect(host.querySelector('table').getAttribute('aria-rowcount')).toBe('2003');
 expect(remote.requestRows.mock.calls.at(-1)[0]).toContain(1999);
 expect(resolved).not.toHaveBeenCalled();
 expect(host.querySelectorAll('tbody tr').length).toBeLessThan(40);
 remote={...remote,rowsByIndex:new Map([[1999,row(1999)]])};
 render(props);
 // Focus acknowledges measured, committed geometry on a later frame.
 for(let frame=0;frame<8 && !resolved.mock.calls.length;frame++)act(()=>jest.advanceTimersByTime(16));
 expect(resolved).toHaveBeenCalledTimes(1);
 expect(resolved).toHaveBeenCalledWith('far');
 const target=host.querySelector('#cba-hazard-row-1999');
 expect(target.textContent).toContain('Hazard 1999');
 act(()=>target.querySelector('[data-column-index="4"]').click());
 expect(select.mock.calls.at(-1)[0].primary.rowIndex).toBe(1999);
 act(()=>target.querySelector('button[aria-label="Open Control Action in the CSU diagram view"]').click());
 expect(open.mock.calls.at(-1)[0].controlAction).toBe('Command 1999');
 act(()=>[...target.querySelectorAll('button')].find(button=>button.textContent==='Delete').click());
 expect(remove).toHaveBeenCalledWith(1999);
});

test('ordinary scrolling requests distant rows and reverse scrolling without paging controls',()=>{
 render();
 const scroller=host.querySelector('[data-hazard-scroll]');
 act(()=>{scroller.scrollTop=319500;scroller.dispatchEvent(new Event('scroll'));jest.advanceTimersByTime(30);});
 expect(remote.requestRows.mock.calls.at(-1)[0].some(index=>index>1900)).toBe(true);
 expect(host.querySelectorAll('[data-hazard-loading-row]').length).toBeGreaterThan(0);
 act(()=>{scroller.scrollTop=0;scroller.dispatchEvent(new Event('scroll'));jest.advanceTimersByTime(30);});
 expect(remote.requestRows.mock.calls.at(-1)[0]).toContain(0);
 expect(host.querySelector('#cba-hazard-row-0')).not.toBeNull();
 expect(host.textContent).not.toMatch(/Next rows|Previous rows|groups show this page/);
});

test('global group counts and collapsed state survive row-cache fills',()=>{
 render();
 const group=host.querySelector('tbody button[aria-expanded]');
 expect(group.textContent).toContain('1000 analysis variants');
 act(()=>group.click());
 remote={...remote,rowIndices:[0,1],rowsByIndex:new Map([[0,row(0)],[1,row(1)]])};
 render();
 expect([...host.querySelectorAll('tbody button[aria-expanded]')].find(button=>button.textContent.includes('Even interfaces')).getAttribute('aria-expanded')).toBe('false');
 expect(host.querySelector('#cba-hazard-row-0')).toBeNull();
 expect(host.querySelector('#cba-hazard-row-1')).not.toBeNull();
});

test('a query with no matches retains filters and column controls',()=>{
 remote={...remote,queryKey:'filtered',total:0,layout:{headers,total:0,groups:[]},rowsByIndex:new Map(),filters:{4:['missing']}};
 render();
 expect(host.querySelector('thead')).not.toBeNull();
 expect(host.textContent).toContain('No hazard rows match');
 const clear=[...host.querySelectorAll('button')].find(button=>button.textContent==='Clear filters');
 act(()=>clear.click());
 expect(remote.clearFilters).toHaveBeenCalled();
});

test('remote filters show loading immediately and never display choices from a different column',()=>{
 remote={...remote,optionsSourceKey:'saved-source',optionsRequest:null,cancelOptions:jest.fn()};
 render();const button=host.querySelector('button[title="Filter Hazard"]');expect(button).toBeTruthy();
 act(()=>button.click());expect(host.textContent).toContain('Loading filter values');expect(host.textContent).not.toContain('No matching values');
 remote={...remote,options:['Wrong column value'],optionsRequest:{column:0,search:'',sourceKey:'saved-source'}};render();
 expect(host.textContent).not.toContain('Wrong column value');
 remote={...remote,options:['Available hazard'],optionsRequest:{column:4,search:'',sourceKey:'saved-source'},optionsLoading:true};render();
 expect(host.textContent).toContain('Available hazard');expect(host.textContent).toContain('Loading more filter values');
 act(()=>button.click());expect(remote.cancelOptions).toHaveBeenCalled();
});

test('prepared column values display on the opening render without a worker request or loading flash',()=>{
 const options=['Available hazard','Other hazard'];
 remote={...remote,optionsSourceKey:'current',optionsRequest:null,getPreparedOptions:(column)=>column===4?{options,truncated:false}:null};
 render();
 act(()=>host.querySelector('button[title="Filter Hazard"]').click());
 expect(host.textContent).toContain('Available hazard');
 expect(host.textContent).not.toContain('Loading filter values');
 expect(remote.requestOptions).not.toHaveBeenCalled();
 const choice=[...host.querySelectorAll('label')].find(label=>label.textContent.includes('Available hazard'));
 act(()=>choice.querySelector('input').click());
 expect(remote.setFilter).toHaveBeenCalledWith(4,['Available hazard']);
});

test('filtered counts use the full source total and remain visible while viewport rows load',()=>{
 remote={...remote,unfilteredTotal:10346,total:1,queryKey:'one-match',layout:{headers,total:1,groups:[{key:'one',label:'One',rowCount:1,rowIndices:[999]}]},rowsByIndex:new Map()};
 render();expect(host.textContent).toContain('1 of 10,346 rows match filters');
 remote={...remote,total:0,layout:{headers,total:0,groups:[]},queryKey:'no-match'};
 render();expect(host.textContent).toContain('0 of 10,346 rows match filters');
 remote={...remote,total:10346,queryKey:'cleared'};
 render();expect(host.textContent).toContain('10,346 of 10,346 rows match filters');
});
