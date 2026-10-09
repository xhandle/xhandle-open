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
