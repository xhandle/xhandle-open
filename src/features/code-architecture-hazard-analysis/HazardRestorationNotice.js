import React from "react";
import XHandleWorkingMark from "../../components/XHandleWorkingMark";
export default function HazardRestorationNotice({restoration,latestRun,isRunning=false}){
  return restoration && !isRunning && (
    ['loading', 'failed', 'upgrade-required', 'upgrading'].includes(restoration.status) || restoration.contextError
  ) ? <div role={restoration.status === 'failed' || restoration.contextError ? 'alert' : 'status'} className="shrink-0 border border-slate-200 bg-slate-50 p-3 text-sm">
    {!latestRun && restoration.status === 'loading' && <XHandleWorkingMark className="mr-2 inline-block h-6 w-6" />}
    {restoration.status === 'upgrade-required' ? 'Older saved results need a one-time storage upgrade for fast opening. Your original results are retained.'
      : restoration.status === 'upgrading' ? `Upgrading saved table storage… ${restoration.progress ?? 0}%`
      : restoration.contextError
      ? 'Saved results are available, but context updates could not be saved.'
      : restoration.status === 'failed'
        ? (latestRun ? 'Could not refresh saved results. Previously loaded results are still shown.' : 'Unable to load saved results. This does not mean the analysis is missing.')
        : (latestRun ? 'Refreshing saved results…' : 'Loading saved results…')}
    {restoration.status === 'loading' && restoration.progress != null && <span> {restoration.progress}%</span>}
    {(restoration.error || restoration.contextError) && <details><summary>Details</summary>{restoration.error || restoration.contextError}</details>}
    {restoration.status === 'upgrade-required'
      ? <button type="button" className="ml-3 rounded border px-3 py-1" onClick={restoration.upgrade}>Upgrade saved table storage</button>
      : restoration.status === 'upgrading'
        ? <button type="button" className="ml-3 rounded border px-3 py-1" onClick={restoration.cancelUpgrade}>Cancel upgrade</button>
        : <button type="button" className="ml-3 rounded border px-3 py-1" onClick={restoration.retry}>Retry loading</button>}
  </div> : null;

}
