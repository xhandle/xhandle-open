import {TextEncoder,TextDecoder} from 'util';
import {createRequirementCheckpoint} from './requirementCheckpoint';
import {clearOrganizationPromptCache,setOrganizationPromptScopeResolver} from '../organization-profile/organizationPromptContext';
import {readRecord,writeRecord} from '../code-architecture-storage/chunkedRecord';
import {openCbaIndexedDB} from '../code-architecture-assurance/codeArchitectureStorage';
jest.mock('../code-architecture-assurance/codeArchitectureStorage',()=>({openCbaIndexedDB:jest.fn(async()=>({close:jest.fn()}))}));
jest.mock('../code-architecture-storage/chunkedRecord',()=>({readRecord:jest.fn(),writeRecord:jest.fn()}));
test('profile changes invalidate requirement work and capture project context for background requests',async()=>{
 global.TextEncoder=TextEncoder;global.TextDecoder=TextDecoder;localStorage.clear();clearOrganizationPromptCache();
 const saved=new Map();readRecord.mockImplementation(async(_db,_store,key)=>saved.get(key));writeRecord.mockImplementation(async(_db,_store,key,value)=>saved.set(key,value));
 openCbaIndexedDB.mockResolvedValue({close:jest.fn()});
 const release=setOrganizationPromptScopeResolver(({projectId})=>({projectId,projectProfile:{mode:'inherit',overrideMarkdown:'BACKGROUND-OVERRIDE'}}));
 const basis={payload:{rowStart:0,rowEnd:1}},generate=jest.fn(async()=> 'complete'),accept=value=>value==='complete';
 const save=text=>localStorage.setItem('xhandle.organizationProfile',JSON.stringify({enabled:true,markdown:'---\norganization: Checkpoint fixture\nprofile_version: 1.0\nstatus: approved\n---\n# Engineering Rules\n'+text}));
 try{
  const disabled=createRequirementCheckpoint('background','r','software');await disabled(basis,generate,accept);
  expect(disabled.organizationPromptContext.header).toBe('');
  save('Use policy A.');const first=createRequirementCheckpoint('background','r','software');await first(basis,generate,accept);
  expect(first.organizationPromptContext.context).toContain('BACKGROUND-OVERRIDE');
  await createRequirementCheckpoint('background','r','software')(basis,generate,accept);expect(generate).toHaveBeenCalledTimes(2);
  save('Use policy B.');await createRequirementCheckpoint('background','r','software')(basis,generate,accept);expect(generate).toHaveBeenCalledTimes(3);
  expect(first.organizationPromptContext.context).toContain('policy A');expect(first.organizationPromptContext.context).not.toContain('policy B');
  localStorage.removeItem('xhandle.organizationProfile');await createRequirementCheckpoint('background','r','software')(basis,generate,accept);expect(generate).toHaveBeenCalledTimes(3);
 }finally{release();localStorage.clear();clearOrganizationPromptCache();}
});
