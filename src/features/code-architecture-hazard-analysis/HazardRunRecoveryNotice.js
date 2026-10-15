import React, {useState} from 'react';
import CodeArchitectureHazardSummaryTable from './CodeArchitectureHazardSummaryTable';

export default function HazardRunRecoveryNotice({run,onExport,onRetrySave,isRunning=false}) {
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');
  const pendingSave=['saving','slow','retrying'].includes(run?.finalSaveStatus);
  const attempt=run?.pendingAttempt || (run?.runState==='incomplete'?run:null);
  if(!attempt && !run?.finalSavePending)return null;
  return <div role="alert" className="m-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm">
    {attempt && <>
      <p>Analysis incomplete: {attempt.validatedAssessments || 0} of {attempt.totalAssessments || 0} assessments validated. Use Continue hazard analysis to retry unresolved work.</p>
      {run.pendingAttempt && <p>The previous completed analysis remains in the main table. The incomplete attempt is separate.</p>}
      <details><summary>Failure details</summary>
        <p>{attempt.failureMessage}</p>
        <ul>{(attempt.failedAssessments || []).map(item=><li key={item.id}>{item.id} — {item.action} — {item.phrase}: {(item.reasons || []).join('; ')}</li>)}</ul>
      </details>
      <button type="button" onClick={()=>onExport(attempt.generatedSheets?.Summary,`${run.repoName || 'analysis'}-incomplete`)}>Export validated partial results</button>
      {run.pendingAttempt && <details><summary>Inspect validated partial results</summary>
        <div className="h-96 overflow-auto"><CodeArchitectureHazardSummaryTable summarySheet={attempt.generatedSheets?.Summary} hazardMethod={attempt.hazardMethod} storageKey={`hazard-recovery:${attempt.id}`} readOnly /></div>
      </details>}
    </>}
    {run.finalSavePending && <>
      <p>{pendingSave ? (run.finalSaveStatus==='retrying' ? 'Retrying save automatically. Results remain available; export them before reloading.' : run.finalSaveStatus==='slow' ? 'Saving is taking longer than usual. Results remain available; export them before reloading.' : 'Saving results. Keep this page open until saving finishes.') : 'Saving failed. Recovered results are in memory; export them before reloading.'}</p>
      {!pendingSave && run.saveFailureMessage && <p>Save error: {run.saveFailureMessage}</p>}
      {!attempt && <button type="button" onClick={()=>onExport(run.generatedSheets?.Summary,run.repoName)}>Export recovered results</button>}
      <button type="button" disabled={saving || pendingSave || isRunning || !onRetrySave} onClick={async()=>{
        setSaving(true);setError('');
        try{await onRetrySave(run);}catch(err){setError(err.message || 'Saving failed.');}finally{setSaving(false);}
      }}>{saving?'Saving…':'Retry save'}</button>
      {error && <p>{error}</p>}
    </>}
  </div>;
}
