import React from 'react';
import XHandleWorkingMark from '../../components/XHandleWorkingMark';

export default function TablePreparationProgress({ label = 'Preparing table', progress = 0 }) {
  const percent = Math.max(0, Math.min(100, Math.floor(progress)));
  return <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}
    className="flex items-center gap-2 p-3 text-sm text-slate-600">
    <XHandleWorkingMark className="h-6 w-6" /><span>{label}… {percent}%</span>
  </div>;
}
