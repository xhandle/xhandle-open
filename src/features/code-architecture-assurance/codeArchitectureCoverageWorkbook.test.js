import { architectureCoverageSheets, architectureEvidenceColumns } from './codeArchitectureCoverageWorkbook';
it('exports hashes, selection, parser limitations, settings and proposal coverage without hiding absent files', () => {
 const result=architectureCoverageSheets([{fingerprint:'run',comparisonFingerprint:'comparison',analysisVersion:'v2',generationSettings:{model:'requested'},effectiveSettings:{model:'actual'},
 inputManifest:[{path:'a.py',contentDigest:'bytes',textDigest:'text',decoding:'utf8'}],
 selectionManifest:[{path:'a.py',disposition:'analyzed'},{path:'b.py',disposition:'not-selected'}],
 relationshipLedger:{'a.py':{version:2,supported:true,definitionCount:1,callExpressionCount:2,relationships:[{},{}],unresolvedTargets:1,modelOnly:3,parseErrors:[{line:12}],limitation:'No dynamic dispatch resolution'}},
 }]);
 expect(result.runs[0]).toMatchObject({'Comparison Fingerprint':'comparison','Parse Errors':1,'Model-only Proposals':3,'Effective Settings':'{"model":"actual"}'});
 expect(result.files[0]).toMatchObject({'Text SHA-256':'text','Byte SHA-256':'bytes','Parse Error Lines':'12'});
 expect(result.files[1]).toMatchObject({Disposition:'not-selected','Syntax Inventory Available':'No'});
});
it('keeps canonical identity and provenance separate from user labels, and identifies legacy exports', () => {
 expect(architectureEvidenceColumns({from:'Edited display',canonicalRelationshipId:'rel',traceId:'trace',lineage:{status:'historical',runFingerprint:'run'},relationshipEvidence:{supported:true,from:'source',lines:[2,3],textDigest:'hash'}})).toMatchObject({'Canonical From':'source','Lineage Status':'historical','Source Lines':'2, 3','Source Text SHA-256':'hash'});
 expect(architectureCoverageSheets().runs[0].Notice).toMatch(/cannot be established/);
});
it('distinguishes published counts from pre-dedup proposals and legacy count semantics', () => {
 const {runs,files}=architectureCoverageSheets([{selectionManifest:[{path:'a.py'}],relationshipLedger:{'a.py':{modelOnly:0,modelOnlyBeforeDedup:2,proposalCountBasis:'published-after-deduplication'}}}]);
 expect(runs[0]).toMatchObject({'Model-only Proposals':0,'Model-only Proposals Before Deduplication':2,'Proposal Count Basis':'Published after deduplication'});
 expect(files[0]).toMatchObject({'Model-only Proposals':0,'Model-only Proposals Before Deduplication':2});
 expect(architectureCoverageSheets([{relationshipLedger:{'a.py':{modelOnly:3}}}]).runs[0]['Proposal Count Basis']).toMatch(/Legacy/);
});
