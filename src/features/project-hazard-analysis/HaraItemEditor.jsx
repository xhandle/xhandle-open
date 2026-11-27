import React, {useState} from 'react';
import {createProjectHaraItem} from './projectHaraItem';

export default function HaraItemEditor({item,legacyDefinition='',disabled=false,onSave,onReset}) {
  const [editing,setEditing]=useState(false),[name,setName]=useState(''),[definition,setDefinition]=useState(''),[error,setError]=useState('');
  const edit=()=>{setName(item?.name||'');setDefinition(item?.definition||legacyDefinition);setError('');setEditing(true);};
  const save=async()=>{
    const next=createProjectHaraItem({...item,name,definition,rationale:'User-defined analysis boundary.'},item?.basis||'','user');
    if(!next){setError('Enter an Item name and definition.');return;}
    try{await onSave(next);setEditing(false);}catch(cause){setError(cause.message);}
  };
  return <div className="space-y-2 text-xs">
    <div className="font-semibold">{item?.name||'Item identified automatically'}</div>
    {!item?.name&&<p className="text-gray-500">AI identifies the Item from the full functional decomposition when HARA runs.</p>}
    {item?.definition&&!editing&&<details><summary className="cursor-pointer text-indigo-600">View Item definition</summary><p className="mt-2 whitespace-pre-wrap">{item.definition}</p>{item.rationale&&<p className="mt-2 text-gray-500">{item.rationale}</p>}</details>}
    {editing?<>
      <label className="block">Item name<input aria-label="HARA Item name" value={name} onChange={e=>setName(e.target.value)} maxLength={180} disabled={disabled} className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1"/></label>
      <label className="block">Item definition<textarea aria-label="Edit HARA Item definition" value={definition} onChange={e=>setDefinition(e.target.value)} maxLength={12000} rows={7} disabled={disabled} className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1"/></label>
      <p className="text-gray-500">Changes apply when HARA is regenerated.</p>
      <div className="flex gap-3"><button type="button" onClick={save} disabled={disabled} className="font-semibold text-indigo-600">Save Item</button><button type="button" onClick={()=>setEditing(false)} disabled={disabled}>Cancel</button></div>
    </>:<div className="flex flex-wrap gap-3"><button type="button" onClick={edit} disabled={disabled} className="text-indigo-600">{item?'Edit Item':'Define Item'}</button>{item&&<button type="button" onClick={async()=>{try{await onReset();}catch(cause){setError(cause.message);}}} disabled={disabled} className="text-indigo-600">Use AI on next run</button>}</div>}
    {error&&<p role="alert" className="text-red-600">{error}</p>}
  </div>;
}
