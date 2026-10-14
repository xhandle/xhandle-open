jest.mock('../../components/aiAnalysisSTPA',()=>({fetchLLMResponse:jest.fn()}));
jest.mock('./codeHazardGenerationCheckpoint',()=>({createCodeHazardCheckpoint:jest.fn()}));
jest.mock('./codeArchitectureHazardStore',()=>({saveCodeArchitectureHazardRun:jest.fn()}));
import {fetchLLMResponse} from '../../components/aiAnalysisSTPA';
import {saveCodeArchitectureHazardRun} from './codeArchitectureHazardStore';
import {runCodeArchitectureHazardAnalysis} from './codeArchitectureHazardRunner';
import {normalizeCodeArchitectureHazardRun} from './codeArchitectureHazardUtils';
import {importHazardSoftwareRequirements} from '../code-architecture-assurance/artifactAI';
import {toCsvText,parseCsv} from '../../lib/csv';
const base={projectId:'audit-project',repoMeta:{repoId:'audit-repo'},cbaRows:[{from:'Planner',action:'Apply torque',to:'Actuator',traceId:'functional-1',rowRef:1,hazardAnalysisEligibility:'Include',hazardAnalysisEligibilitySource:'manual'}]};
beforeEach(()=>{jest.clearAllMocks();localStorage.clear();});
test.each(['STPA','HARA','FHA'])('%s publishes every expected row despite unavailable provider, checkpoint and final storage',async method=>{
 fetchLLMResponse.mockRejectedValue(Object.assign(new Error('Provider account unavailable'),{status:403}));
 saveCodeArchitectureHazardRun.mockRejectedValue(new DOMException('Storage aborted','AbortError'));
 const updates=[];
 const run=await runCodeArchitectureHazardAnalysis({...base,method,onPartialRunUpdate:value=>{updates.push(value);throw new Error('Observer failed');}});
 expect(run.runState).toBe('complete');expect(run.finalSavePending).toBe(true);
 const [headers,...rows]=run.generatedSheets.Summary;
 expect(rows).toHaveLength(7);
 expect(new Set(rows.map(row=>row[headers.indexOf('Raw Analysis Row ID')])).size).toBe(7);
 expect(rows.every(row=>row[headers.indexOf('Assessment Basis')].includes('Assumption-based'))).toBe(true);
 expect(updates.at(-1).generatedSheets.Summary).toEqual(run.generatedSheets.Summary);
 expect(saveCodeArchitectureHazardRun).toHaveBeenCalledTimes(1);
 const reloaded=normalizeCodeArchitectureHazardRun(JSON.parse(JSON.stringify(run)));
 expect(parseCsv(toCsvText(reloaded.generatedSheets.Summary))).toEqual(run.generatedSheets.Summary.map(row=>row.map(String)));
 // Completion in memory is distinct from durable readiness for downstream use.
 expect(()=>importHazardSoftwareRequirements({hazardAnalysis:reloaded})).toThrow('Complete and save');
});
