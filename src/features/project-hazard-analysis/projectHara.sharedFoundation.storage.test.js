import 'fake-indexeddb/auto';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { serialize,deserialize } from 'v8';
import { saveHazardAnalysis,switchProjectHazardMethod,loadProjectHazardReuseState,clearProjectHazardMethodResults,saveProjectStpaFoundation,restoreProjectHazardMethodState,resetLocalRevisionTracking } from './projectHazardAnalysisStorageCore';
beforeEach(()=>{global.indexedDB=new IDBFactory();global.IDBKeyRange=IDBKeyRange;global.structuredClone=value=>deserialize(serialize(value));resetLocalRevisionTracking();});
const stpa={Summary:[['Function (From)','Control Action','Function (To)','Guide Phrase','Hazard'],['Controller','Demand','Actuator','Not provided','Uncontrolled motion']]};
const hara={Summary:[['Hazard'],['HARA result']]};
async function setup(){
 await saveHazardAnalysis('synthetic',{method:'STPA-Textbook',analysisResult:stpa});
 await switchProjectHazardMethod('synthetic','STPA-Textbook','HARA');
 await saveHazardAnalysis('synthetic',{method:'HARA',analysisResult:hara});
 return loadProjectHazardReuseState('synthetic');
}
test('real IndexedDB cold reads retain STPA after HARA-only clear and can restore both cleared methods',async()=>{
 const before=await setup();
 await clearProjectHazardMethodResults('synthetic',{expectedRevision:before.headRevision});
 let state=await loadProjectHazardReuseState('synthetic');expect(state.stpa.analysisResult).toEqual(stpa);expect(state.hara.analysisResult).toBeNull();
 await saveProjectStpaFoundation('synthetic',stpa);
 await clearProjectHazardMethodResults('synthetic',{clearStpa:true});
 expect((await loadProjectHazardReuseState('synthetic')).stpa).toBeNull();
 await restoreProjectHazardMethodState('synthetic',before);
 state=await loadProjectHazardReuseState('synthetic');expect(state.stpa.analysisResult).toEqual(stpa);expect(state.generationEpochs).toEqual({HARA:2,'STPA-Textbook':1});
});
test('a synchronous write failure rolls back snapshot deletions and the active head',async()=>{
 const before=await setup(),original=IDBObjectStore.prototype.put;
 const spy=jest.spyOn(IDBObjectStore.prototype,'put').mockImplementation(function(...args){if(this.name==='analyses')throw Object.assign(new Error('Synthetic quota failure'),{name:'QuotaExceededError'});return original.apply(this,args);});
 try{await expect(clearProjectHazardMethodResults('synthetic',{clearStpa:true})).rejects.toThrow('Synthetic quota failure');}finally{spy.mockRestore();}
 const after=await loadProjectHazardReuseState('synthetic');expect(after.stpa).toEqual(before.stpa);expect(after.hara).toEqual(before.hara);
});
test('switching with a table-only UI snapshot preserves the saved STPA source workbook and reuse provenance',async()=>{
 const source={...stpa,'Functional Decomposition':[['Control Action'],['Demand']],stpaFoundationBasis:{version:1,entries:{synthetic:'basis'}}};
 await saveHazardAnalysis('synthetic',{method:'STPA-Textbook',analysisResult:source});
 await switchProjectHazardMethod('synthetic','STPA-Textbook','HARA',{analysisResult:stpa});
 const saved=(await loadProjectHazardReuseState('synthetic')).stpa.analysisResult;
 expect(saved.Summary).toEqual(stpa.Summary);
 expect(saved['Functional Decomposition']).toEqual(source['Functional Decomposition']);
 expect(saved.stpaFoundationBasis).toEqual(source.stpaFoundationBasis);
});
