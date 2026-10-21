import {claimHazardSaveAttempt,isCurrentHazardSaveAttempt,revokeHazardSaveAttempts} from './hazardSaveAttempt';
test('method-scoped clearing revokes only matching claims',()=>{
 const stpa={id:'method-stpa',projectId:'claim-project',repoId:'repo',hazardMethod:'STPA-Textbook'};
 const fha={...stpa,id:'method-fha',hazardMethod:'FHA'};
 claimHazardSaveAttempt(stpa);claimHazardSaveAttempt(fha);
 revokeHazardSaveAttempts({projectId:'claim-project',hazardMethod:'STPA-Textbook'});
 expect(isCurrentHazardSaveAttempt(stpa)).toBe(false);expect(isCurrentHazardSaveAttempt(fha)).toBe(true);
});
test('new pending attempt can reuse the record while deleted attempt remains revoked',()=>{
 const old={id:'shared-cleared',projectId:'claim-reuse',repoId:'repo',pendingAttempt:{id:'old'}};
 claimHazardSaveAttempt(old);revokeHazardSaveAttempts({projectId:'claim-reuse'});
 const fresh={...old,pendingAttempt:{id:'fresh'}};claimHazardSaveAttempt(fresh);
 expect(isCurrentHazardSaveAttempt(fresh)).toBe(true);expect(isCurrentHazardSaveAttempt(old)).toBe(false);
 // Even a repeated claim cannot resurrect the same revoked authorization.
 claimHazardSaveAttempt(old);expect(isCurrentHazardSaveAttempt(old)).toBe(false);expect(isCurrentHazardSaveAttempt(fresh)).toBe(true);
});
