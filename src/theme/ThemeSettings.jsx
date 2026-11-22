import React from 'react';
import {useDarkMode} from '../hooks/useDarkMode';

export default function ThemeSettings() {
  const {preference, setMode, error} = useDarkMode();
  return <section className="space-y-4" aria-label="Appearance settings">
    <div><h3 className="font-semibold text-gray-900">Appearance</h3>
      <p className="mt-1 text-sm text-gray-600">Choose a theme, or follow your device’s appearance. Your choice applies across the workspace.</p></div>
    <fieldset className="space-y-2"><legend className="mb-2 text-sm font-medium">Color theme</legend>
      {[['light','Light','A bright workspace.'],['dark','Dark','A softer workspace in low light.'],['system','Use device setting','Automatically follow light and dark appearance.']].map(([value,label,description]) =>
        <label key={value} className={`flex cursor-pointer items-center gap-3 rounded-lg border p-4 ${preference===value?'border-indigo-500 bg-indigo-50':'border-slate-200 bg-white'}`}>
          <input type="radio" name="xhandle-theme" value={value} checked={preference===value} onChange={() => setMode(value)} />
          <span><span className="block font-medium">{label}</span><span className="text-sm text-slate-600">{description}</span></span>
        </label>)}
    </fieldset>
    {error && <p role="status" className="text-sm text-amber-800">{error}</p>}
  </section>;
}
