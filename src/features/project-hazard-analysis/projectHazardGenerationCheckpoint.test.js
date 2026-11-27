import {createProjectHazardCheckpoint} from './projectHazardGenerationCheckpoint';
import {createCodeHazardCheckpoint} from '../code-architecture-hazard-analysis/codeHazardGenerationCheckpoint';
jest.mock('../code-architecture-hazard-analysis/codeHazardGenerationCheckpoint',()=>({createCodeHazardCheckpoint:jest.fn()}));
test('clear epochs change checkpoint scope independently for each Projects method',()=>{
 createProjectHazardCheckpoint('synthetic','HARA',{generationEpoch:3});
 expect(createCodeHazardCheckpoint).toHaveBeenLastCalledWith(expect.objectContaining({projectId:'synthetic',method:'HARA',generationEpoch:3}),expect.anything());
 createProjectHazardCheckpoint('synthetic','STPA-Textbook',{generationEpoch:1});
 expect(createCodeHazardCheckpoint).toHaveBeenLastCalledWith(expect.objectContaining({method:'STPA-Textbook',generationEpoch:1}),expect.anything());
});
