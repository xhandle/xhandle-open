global.IS_REACT_ACT_ENVIRONMENT = true;
jest.mock('lucide-react', () => ({ AlertTriangle: () => <span /> }));
const React = require('react');
const { act } = React;
const { createRoot } = require('react-dom/client');
const Modal = require('./HazardAnalysisResetModal').default;

test('requires acknowledgement and submits the selected clear scope without clearing on cancel', () => {
  const host = document.createElement('div'); document.body.appendChild(host);
  const root = createRoot(host), onConfirm = jest.fn(), onCancel = jest.fn();
  const counts = { rawRows: 24, draftRows: 2, safetyIssues: 3, reports: 0, reviewItems: 1, contexts: 2 };
  try {
    act(() => root.render(<Modal counts={counts} onConfirm={onConfirm} onCancel={onCancel} />));
    const confirm = [...host.querySelectorAll('button')].find(button => button.textContent === 'Clear analysis');
    expect(confirm.disabled).toBe(true);
    act(() => host.querySelector('input[value="results-and-contexts"]').click());
    expect(confirm.disabled).toBe(true);
    act(() => host.querySelector('input[type="checkbox"]').click());
    expect(confirm.disabled).toBe(false);
    act(() => confirm.click());
    expect(onConfirm).toHaveBeenCalledWith('results-and-contexts');
    act(() => [...host.querySelectorAll('button')].find(button => button.textContent === 'Cancel').click());
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  } finally { act(() => root.unmount()); host.remove(); }
});

test('HARA offers HARA-only or STPA-and-HARA clear with independent context removal',()=>{
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host),onConfirm=jest.fn();
 try{
  act(()=>root.render(<Modal method="HARA" counts={{}} onConfirm={onConfirm}/>));
  expect(host.textContent).toContain('Clear HARA results only');expect(host.textContent).toContain('Clear STPA and HARA results');
  expect(host.querySelector('input[value="hara-only"]').checked).toBe(true);
  const confirm=[...host.querySelectorAll('button')].find(button=>button.textContent==='Clear analysis');
  const boxes=host.querySelectorAll('input[type="checkbox"]');act(()=>boxes[1].click());act(()=>confirm.click());
  expect(onConfirm).toHaveBeenLastCalledWith('hara-only',{clearContexts:false});
  act(()=>host.querySelector('input[value="stpa-and-hara"]').click());act(()=>boxes[0].click());act(()=>confirm.click());
  expect(onConfirm).toHaveBeenLastCalledWith('stpa-and-hara',{clearContexts:true});
 }finally{act(()=>root.unmount());host.remove();}
});
