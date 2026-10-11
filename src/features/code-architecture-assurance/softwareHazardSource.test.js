jest.mock('../code-architecture-hazard-analysis/codeArchitectureHazardStore',()=>({getLatestCodeArchitectureHazardRun:jest.fn()}));
import {getLatestCodeArchitectureHazardRun} from '../code-architecture-hazard-analysis/codeArchitectureHazardStore';
import {resolveSoftwareHazardSource} from './softwareHazardSource';
test('loads saved hazards when the panel has not loaded them yet, using repo aliases',async()=>{
 const run={id:'saved',projectId:'p',repoId:'owner/repo',updatedAt:'2026-10-09'};
 getLatestCodeArchitectureHazardRun.mockImplementation(async({repoId})=>repoId==='owner/repo'?run:null);
 expect(await resolveSoftwareHazardSource({projectId:'p',repo:{id:'uuid',repoId:'owner/repo'}})).toBe(run);
 expect(getLatestCodeArchitectureHazardRun).toHaveBeenCalledWith({projectId:'p',repoId:'uuid'});
});
test('does not import a different project and reports load failures',async()=>{
 getLatestCodeArchitectureHazardRun.mockResolvedValue(null);
 expect(await resolveSoftwareHazardSource({projectId:'p',repo:{id:'r'},current:{projectId:'other',repoId:'r'}})).toBeNull();
 getLatestCodeArchitectureHazardRun.mockRejectedValue(new Error('Storage unavailable'));
 await expect(resolveSoftwareHazardSource({projectId:'p',repo:{id:'r'}})).rejects.toThrow('Storage unavailable');
});

test.each(['HARA','FHA'])('rejects stale %s safety inputs before derivation',async hazardMethod=>{
 getLatestCodeArchitectureHazardRun.mockResolvedValue({id:'saved',projectId:'p',repoId:'r',hazardMethod,architectureSnapshotHash:'old'});
 await expect(resolveSoftwareHazardSource({projectId:'p',repo:{id:'r'},cbaRows:[]})).rejects.toThrow('older architecture');
});

test('software derivation rejects a saved run from a different organization policy',async()=>{
 const {organizationProfileContextIdentity}=require('../organization-profile/organizationProfile');
 getLatestCodeArchitectureHazardRun.mockResolvedValue({id:'saved',projectId:'p',repoId:'r',hazardMethod:'STPA-Textbook',organizationProfileProvenance:{effectiveContextIdentity:organizationProfileContextIdentity('A')}});
 await expect(resolveSoftwareHazardSource({projectId:'p',repo:{id:'r'},cbaRows:[],organizationContext:'B'})).rejects.toThrow('organization guidance');
 expect((await resolveSoftwareHazardSource({projectId:'p',repo:{id:'r'},cbaRows:[],organizationContext:'A'})).id).toBe('saved');
});
