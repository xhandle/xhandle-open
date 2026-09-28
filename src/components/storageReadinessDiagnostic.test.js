// Regression: a completed STPA stage survives failure of a later stage.
import { runLiteAIAnalysis } from './aiAnalysisLite';
import { generateStandardCodeHazardAnalysisSheets } from './aiAnalysisCodeHazardStandard';
jest.mock('./aiAnalysisCodeHazardStandard',()=>({generateStandardCodeHazardAnalysisSheets:jest.fn(async ({onStageComplete=()=>{}})=>{
 await onStageComplete({stage:'generation',rows:[['generated result']]});
 throw new Error('Later stage failed');
})}));
test('forwards completed stages before a later failure',async()=>{
 generateStandardCodeHazardAnalysisSheets.mockImplementation(async ({onStageComplete=()=>{}})=>{
   await onStageComplete({stage:'generation',rows:[['generated result']]});
   throw new Error('Later stage failed');
 });
 const snapshots=[]; const stages=[];
 await expect(runLiteAIAnalysis({
 onStageComplete:async stage=>{stages.push(JSON.parse(JSON.stringify(stage)));},
 tableRows:[{fromFunction:'Operator',controlAction:'Drive',toFunction:'Vehicle'}],sheets:{},currentFolder:'LiteProject',hazardMethod:'STPA-Textbook',
 setFolders:async updater=>{const next=updater({});snapshots.push(next);return next;},
 setProgress:()=>{},setChatPrompt:()=>{},setChatResponse:()=>{},
 })).rejects.toThrow('Later stage failed');
 expect(generateStandardCodeHazardAnalysisSheets.mock.calls[0][0].onStageComplete).toEqual(expect.any(Function));
 expect(stages).toEqual([{stage:"generation",rows:[["generated result"]]}]);
 expect(snapshots).toHaveLength(1); // Only initial decomposition reached storage callback.
 expect(JSON.stringify(snapshots)).not.toContain('generated result');
});
