import {indexArtifactCollections,downstreamSubsystemRequirementIds,downstreamDesignElementIds,resolveArtifactArchitectureRefs,createFunctionalRowLookup,functionalRowIndexForTraceValue} from './artifactUtils';
import {ARTIFACT_KINDS as K} from './artifactDefinitions';
it('indexed links and inherited refs preserve ordering, multi-parent deduplication, and duplicates',()=>{
 const raw={softwareRows:[{id:'W',sourceArchitectureRefs:[{traceId:'F'}]}],systemRows:[{id:'S',parentSwRequirement:'W'}],subsystemRows:[{id:'U1',parentSystemRequirement:'S'},{id:'U2',traceLinks:[{targetType:'system-requirement',targetId:'S'}]}],designRows:[{id:'D2',parentRequirement:'U2'},{id:'D1',parentRequirement:'U1; U2'}]};
 const indexed=indexArtifactCollections(raw);
 expect(downstreamSubsystemRequirementIds(raw.systemRows[0],indexed)).toEqual(downstreamSubsystemRequirementIds(raw.systemRows[0],raw));
 for(const [kind,rows] of [[K.SYSTEM,raw.systemRows],[K.SUBSYSTEM,raw.subsystemRows],[K.DESIGN,raw.designRows]]) for(const row of rows) {
   expect(resolveArtifactArchitectureRefs(row,kind,indexed)).toEqual(resolveArtifactArchitectureRefs(row,kind,raw));
   expect(downstreamDesignElementIds(row,kind,indexed)).toEqual(downstreamDesignElementIds(row,kind,raw));
 }
 const next=indexArtifactCollections({...raw,designRows:[]});
 expect(downstreamDesignElementIds(raw.systemRows[0],K.SYSTEM,next)).toBe('');
});
it('indexed architecture lookup preserves exact/legacy precedence and ambiguity',()=>{
 const rows=[{traceId:'a',rowRef:'01'},{traceId:'b',rowRef:'01'},{traceId:'a'},{sourceTraceId:'x',lineage:{status:'historical'}},{functionalTraceId:'z',rowRef:'explicit'}];
 const lookup=createFunctionalRowLookup(rows);
 for(const value of ['a','b','01','FD-1',1,2,3,4,'x','z','explicit','missing','functional-relationship:missing','']) expect(lookup(value)).toBe(functionalRowIndexForTraceValue(rows,value));
});
