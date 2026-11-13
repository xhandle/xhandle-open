import React, { useState } from 'react';
import { readableLabel, structuredValue } from './readableValues';

// Edit named values while preserving existing arrays, objects and scalar types.
export default function StructuredAttributeInput({ value, onChange, label = 'Value' }) {
  const [fieldName, setFieldName] = useState('');
  const parsed = structuredValue(value);
  if (parsed !== value) return <StructuredAttributeInput label={label} value={parsed} onChange={next => onChange(JSON.stringify(next))} />;
  const type = Array.isArray(value) ? 'list' : value === null ? 'empty' : typeof value;
  const field = content => <div><label className="block text-xs text-gray-500">Value type<select aria-label={`Value type for ${label}`} value={type} onChange={event => onChange(({ string: '', number: 0, boolean: false, list: [], object: {}, empty: null })[event.target.value])}>{[['string','Text'],['number','Number'],['boolean','Yes / No'],['list','List'],['object','Named fields'],['empty','Not specified']].map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>{content}</div>;
  if (value && typeof value === 'object') {
    const array = Array.isArray(value);
    return field(<fieldset className="border rounded p-2 space-y-2"><legend>{label}</legend>{Object.entries(value).map(([key, item]) => <div key={key} className="flex items-start gap-2"><div className="flex-1 min-w-0"><StructuredAttributeInput label={array ? `Item ${Number(key) + 1}` : readableLabel(key)} value={item} onChange={next => { const copy = array ? [...value] : { ...value }; copy[key] = next; onChange(copy); }} /></div><button type="button" aria-label={`Remove ${array ? 'item ' + (Number(key) + 1) : readableLabel(key)}`} onClick={() => { const copy = array ? value.filter((_, index) => index !== Number(key)) : { ...value }; if (!array) delete copy[key]; onChange(copy); }}>Remove</button></div>)}{!Object.keys(value).length && <p className="text-sm">No values recorded.</p>}
      {array ? <button type="button" onClick={() => onChange([...value, ''])}>Add value</button> : <div className="flex gap-2"><input aria-label={`New field in ${label}`} value={fieldName} onChange={event => setFieldName(event.target.value)} placeholder="Field name" /><button type="button" disabled={!fieldName.trim() || Object.hasOwn(value, fieldName.trim())} onClick={() => { onChange({ ...value, [fieldName.trim()]: '' }); setFieldName(''); }}>Add field</button></div>}
    </fieldset>);
  }
  if (typeof value === 'boolean') return field(<label className="block text-sm"><input type="checkbox" checked={value} onChange={event => onChange(event.target.checked)} /> {label}</label>);
  return field(<label className="block text-sm">{label}<input className="w-full rounded border px-2 py-1 text-sm" type={typeof value === 'number' ? 'number' : 'text'} value={value ?? ''} onChange={event => onChange(typeof value === 'number' && event.target.value !== '' ? Number(event.target.value) : event.target.value)} /></label>);
}
