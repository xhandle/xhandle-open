import { resolveProjectHaraItem, projectHaraItemPrompt } from './aiAnalysisHaraItem';
import { projectHaraItemBasis, projectHaraItemDecomposition, createProjectHaraItem, projectHaraItemDefinitionSheet } from '../features/project-hazard-analysis/projectHaraItem';
import {refreshProjectHaraSheets} from '../features/project-hazard-analysis/projectHara';

const rows=[{fromFunction:'Remote operator',fromDetails:'External actor issuing vehicle requests.',controlAction:'Motion request',toFunction:'Authority manager',subsystem:'Authority'},
 {fromFunction:'Authority manager',controlAction:'Authorized motion request',toFunction:'Motion controller',subsystem:'Motion'},
 {fromFunction:'Motion controller',controlAction:'Deceleration request',toFunction:'Brake actuator',subsystem:'Braking'}];
const result={name:'Remote vehicle control system',definition:'Vehicle functions accepting external operator requests, managing control authority and controlling vehicle motion. The remote operator is external; the brake actuator is an interface dependency.',rationale:'Authority and motion functions jointly deliver remote vehicle control across subsystem boundaries.'};
const cache=()=>{const data=new Map();return {read:async basis=>data.get(JSON.stringify(basis)),write:async(basis,value)=>data.set(JSON.stringify(basis),value)};};

test('infers one shared Item from every function/interface rather than copying subsystem allocation',async()=>{
 const request=jest.fn(async()=>result),onResolved=jest.fn();
 const item=await resolveProjectHaraItem({functionalRows:rows,request,onResolved});
 expect(request).toHaveBeenCalledTimes(1);
 const prompt=request.mock.calls[0][0];
 for(const row of rows)expect(prompt).toContain(row.controlAction);
 expect(prompt).toContain('Do not automatically equate');expect(prompt).toContain('External actor');
 expect(item).toMatchObject(result);expect(item.id).toMatch(/^ITEM-[A-F0-9]{12}$/);expect(onResolved).toHaveBeenCalledWith(item);
});
test('reuse is independent of row order, guide/context expansion and the selected hazard subset',async()=>{
 const request=jest.fn(async()=>result),generationCheckpoint=cache();
 const first=await resolveProjectHaraItem({functionalRows:rows,request,generationCheckpoint});
 request.mockClear();
 const source=[...rows].reverse().flatMap(row=>[{...row,guidePhrase:'Not provided'},{...row,guidePhrase:'Too late',operationalScenario:'Parking'}]);
 const item=await resolveProjectHaraItem({functionalRows:source,sheets:{'Functional Decomposition':[['Control Action'],['One selected event']]},request,generationCheckpoint,savedItem:first});
 expect(request).not.toHaveBeenCalled();expect(item).toEqual(first);
});
test('decomposition/profile changes infer a new boundary; an explicit edited Item remains authoritative',async()=>{
 const request=jest.fn(async()=>result),first=await resolveProjectHaraItem({functionalRows:rows,request});
 for(const change of [{functionalRows:[...rows,{fromFunction:'Power controller',controlAction:'Power state',toFunction:'Motion controller'}]},{organizationContext:'Updated domain scope'}]){
  request.mockClear();await resolveProjectHaraItem({functionalRows:rows,savedItem:first,request,...change});expect(request).toHaveBeenCalledTimes(1);
 }
 request.mockClear();const edited=createProjectHaraItem({...first,name:'User-defined remote control item'},first.basis,'user');
 expect(await resolveProjectHaraItem({functionalRows:[],savedItem:edited,request})).toEqual(edited);expect(request).not.toHaveBeenCalled();
});
test('item checkpoints survive a restart and legacy explicit definitions require no new inference',async()=>{
 const request=jest.fn(async()=>result),generationCheckpoint=cache();
 const first=await resolveProjectHaraItem({functionalRows:rows,request,generationCheckpoint});request.mockClear();
 expect(await resolveProjectHaraItem({functionalRows:rows,request,generationCheckpoint})).toEqual(first);expect(request).not.toHaveBeenCalled();
 const legacy=await resolveProjectHaraItem({functionalRows:rows,itemDefinition:'An explicitly defined braking item.',request});
 expect(legacy.definition).toBe('An explicitly defined braking item.');expect(legacy.origin).toBe('user');expect(request).not.toHaveBeenCalled();
});
test('malformed inference completes once while cancellation, account and persistence failures remain visible',async()=>{
 const request=jest.fn(async()=>'not JSON');
 expect(await resolveProjectHaraItem({functionalRows:rows,request})).toMatchObject({name:'Modeled vehicle system',origin:'fallback'});expect(request).toHaveBeenCalledTimes(1);
 expect(createProjectHaraItem({name:{value:'Bad shape'},definition:'Boundary.'})).toBeNull();
 for(const error of [Object.assign(Error('Stopped'),{name:'AbortError'}),Object.assign(Error('Account'),{status:401})])await expect(resolveProjectHaraItem({functionalRows:rows,request:async()=>{throw error;}})).rejects.toBe(error);
 await expect(resolveProjectHaraItem({functionalRows:rows,request:async()=>result,generationCheckpoint:{read:async()=>null,write:async()=>{throw Error('Storage unavailable');}}})).rejects.toThrow('Storage unavailable');
 await expect(resolveProjectHaraItem({functionalRows:rows,request:async()=>result,onResolved:async()=>{throw Error('Project save unavailable');}})).rejects.toThrow('Project save unavailable');
});
test('large graphs cover all relationships in bounded partitions and derive a common final Item',async()=>{
 const many=Array.from({length:200},(_,i)=>({...rows[i%rows.length],controlAction:`Action-${i}`,fromDetails:'Function context. '.repeat(90)}));
 const seen=new Set(),request=jest.fn(async prompt=>{
  expect(prompt.length).toBeLessThan(52000);
  for(const match of prompt.matchAll(/Action-(\d+)/g))seen.add(Number(match[1]));
  return result;
 });
 const item=await resolveProjectHaraItem({functionalRows:many,request});
 expect(seen.size).toBe(200);expect(request.mock.calls.length).toBeGreaterThan(1);expect(item.name).toBe(result.name);
});

test('long function descriptions retain boundary statements beyond the first transport fragment',async()=>{
 const seen=[];
 const request=jest.fn(async prompt=>{seen.push(prompt);expect(prompt.length).toBeLessThan(52000);return result;});
 await resolveProjectHaraItem({functionalRows:[{...rows[0],fromDetails:'Vehicle functional context. '.repeat(3000)+' EXTERNAL-BOUNDARY-AT-END'}],request});
 expect(seen.some(prompt=>prompt.includes('EXTERNAL-BOUNDARY-AT-END'))).toBe(true);
});
test('the Item worksheet uses shared metadata and preserves legacy definitions without inventing an Item',()=>{
 const item=createProjectHaraItem(result,'scope');
 expect(projectHaraItemDefinitionSheet({haraItem:item})).toEqual([['Item ID','Item','Item Definition','Selection Rationale'],[item.id,item.name,item.definition,item.rationale]]);
 expect(projectHaraItemDefinitionSheet({Summary:[['Item Definition'],['Legacy generated boundary.']]})).toEqual([['Item Definition'],['Legacy generated boundary.']]);
 expect(projectHaraItemDefinitionSheet(null)).toEqual([['Item Definition']]);
 expect(projectHaraItemDecomposition({},rows)).toHaveLength(3);
 expect(projectHaraItemBasis(projectHaraItemDecomposition({},rows))).toBe(projectHaraItemBasis(projectHaraItemDecomposition({},[...rows].reverse())));
 expect(projectHaraItemPrompt(rows)).not.toContain('Return ratings');
});

test('legacy Item / Function cells migrate to Function without shifting ratings or row identities',()=>{
 const source={Summary:[['Hazardous Event ID','Item / Function','Function','Severity','Exposure','Controllability','Raw Analysis Row ID'],['event-1','Legacy source function','','S3','E4','C3','raw-1']]};
 const refreshed=refreshProjectHaraSheets(source,{practical:true}),[headers,row]=refreshed.Summary;
 expect(headers.filter(h=>h==='Function')).toHaveLength(1);expect(headers).not.toContain('Item / Function');
 expect(row[headers.indexOf('Function')]).toBe('Legacy source function');expect(row[headers.indexOf('ASIL')]).toBe('ASIL D');
 expect(row[headers.indexOf('Raw Analysis Row ID')]).toBe('raw-1');expect(source.Summary[0][1]).toBe('Item / Function');
});
