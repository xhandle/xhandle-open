import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {FilterableHeaderCell} from './FilterableTableHeader';
global.IS_REACT_ACT_ENVIRONMENT=true;
let root,host,state;
beforeEach(()=>{host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);state={filters:{},searches:{},openIndex:0,filterRefs:{current:{}},setOpenIndex:jest.fn(),setSearches:jest.fn(),getOptions:()=>[],setFilterValues:jest.fn(),toggleFilterValue:jest.fn(),retryOptions:jest.fn()};});
afterEach(()=>{act(()=>root.unmount());host.remove();});
const render=patch=>act(()=>root.render(<table><thead><tr><FilterableHeaderCell label="Hazard" index={0} filterState={{...state,...patch}}/></tr></thead></table>));
test('loading is distinct from an empty result, and discovered choices remain selectable',()=>{
 render({optionsLoading:true});expect(host.textContent).toContain('Loading filter values');expect(host.textContent).not.toContain('No matching values');
 render({optionsLoading:true,getOptions:()=>['Discovered value']});expect(host.textContent).toContain('Loading more filter values');
 act(()=>host.querySelector('input[type=checkbox]').click());expect(state.toggleFilterValue).toHaveBeenCalledWith(0,'Discovered value');
 render({optionsLoading:false});expect(host.textContent).toContain('No matching values');
});
test('failed filter requests offer retry rather than claiming there are no values',()=>{
 render({optionsError:'Unable to read filter values'});expect(host.querySelector('[role=alert]').textContent).toContain('Unable to read');expect(host.textContent).not.toContain('No matching values');
 act(()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Retry').click());expect(state.retryOptions).toHaveBeenCalledTimes(1);
});
