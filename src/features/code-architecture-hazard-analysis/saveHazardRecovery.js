import {HAZARD_EDIT_REVISION,saveCodeArchitectureHazardRun} from './codeArchitectureHazardStore';
// A timed-out manifest write is still running. Wait for that exact write before
// taking its committed revision; never rebase against unrelated storage changes.
export async function saveHazardRecovery(initialSave, manifest, recovery, save=saveCodeArchitectureHazardRun) {
 try {await initialSave;} catch {} // A failed manifest may still permit recovery.
 if(manifest[HAZARD_EDIT_REVISION])recovery[HAZARD_EDIT_REVISION]=manifest[HAZARD_EDIT_REVISION];
 return save(recovery);
}
