import 'fake-indexeddb/auto';
import {IDBFactory,IDBKeyRange} from 'fake-indexeddb';
import {serialize,deserialize} from 'v8';
import {saveHazardAnalysis,loadProjectHazardReuseState,switchProjectHazardMethod,resetLocalRevisionTracking} from './projectHazardAnalysisStorageCore';
import {refreshProjectHaraSheets,PROJECT_HARA_HEADERS} from './projectHara';
import {haraReviewRecords,applyHaraReviewPatches,undoHaraFinalReview,haraReviewHistorySheet} from './haraFinalReview';
beforeEach(()=>{global.indexedDB=new IDBFactory();global.IDBKeyRange=IDBKeyRange;global.structuredClone=value=>deserialize(serialize(value));resetLocalRevisionTracking();});
test('real IndexedDB reload preserves final review history and undo without modifying the saved STPA foundation',async()=>{
  const stpa={Summary:[['Raw Analysis Row ID','Hazard','System Requirement'],['synthetic-row','Uncontrolled motion','The item shall provide braking.']]};
  await saveHazardAnalysis('synthetic',{method:'STPA-Textbook',analysisResult:stpa});
  await switchProjectHazardMethod('synthetic','STPA-Textbook','HARA');
  const headers=['Raw Analysis Row ID',...PROJECT_HARA_HEADERS];
  const values={'Raw Analysis Row ID':'synthetic-row','Guide Phrase Applicable':'Yes',Severity:'S3',Exposure:'E4',Controllability:'C0',
    'Controllability Rationale':'Generally controllable.','Safety Goal':'The vehicle shall prevent loss of braking.','Hazardous Event':'Vehicle fails to stop at an occupied crossing.'};
  const before=refreshProjectHaraSheets({Summary:[headers,headers.map(header=>values[header]||'')]},{practical:true});
  await saveHazardAnalysis('synthetic',{method:'HARA',analysisResult:before});
  const record=haraReviewRecords(before)[0],after=applyHaraReviewPatches(before,[record],[{id:record.id,hash:record.hash,
    reason:'The pedestrian cannot avoid the impact.',changes:{Controllability:'C3','Controllability Rationale':'The exposed pedestrian cannot avoid impact in the available time.'}}],{runId:'synthetic-review'}).sheets;
  await saveHazardAnalysis('synthetic',{method:'HARA',analysisResult:after});
  resetLocalRevisionTracking();const cold=await loadProjectHazardReuseState('synthetic');
  expect(cold.stpa.analysisResult).toEqual(stpa);expect(cold.hara.analysisResult.haraPostReviewHistory).toEqual(after.haraPostReviewHistory);
  expect(haraReviewHistorySheet(cold.hara.analysisResult)).toHaveLength(3);
  const undone=undoHaraFinalReview(cold.hara.analysisResult);expect(undone.reversed).toBe(2);
  await saveHazardAnalysis('synthetic',{method:'HARA',analysisResult:undone.sheets});
  const restored=await loadProjectHazardReuseState('synthetic');expect(restored.stpa.analysisResult).toEqual(stpa);
  expect(restored.hara.analysisResult.Summary[1][headers.indexOf('ASIL')]).toBe('Not assigned');
  expect(restored.hara.analysisResult.haraPostReviewHistory[0].undone).toBe(true);
});
