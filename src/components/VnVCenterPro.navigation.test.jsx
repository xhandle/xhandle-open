import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import VnVCenterPro from './VnVCenterPro';
jest.mock('lucide-react',()=>new Proxy({},{get:()=>()=>null}));
let root,container;
beforeEach(()=>{
  global.IS_REACT_ACT_ENVIRONMENT=true;
  localStorage.clear();
  localStorage.setItem('xhandle:vnv-test-case-documents',JSON.stringify([
    {id:'other',projectId:'other-p',name:'Other document',updatedAt:'2026-11-05',testCases:[{id:'OTHER',title:'Other test'}]},
    {id:'doc',projectId:'p',name:'Target document',updatedAt:'2026-11-04',testCases:[{id:'FIRST',title:'First test'},{id:'TARGET',title:'Target test'}]},
  ]));
  container=document.createElement('div');document.body.appendChild(container);root=createRoot(container);
});
afterEach(()=>{act(()=>root.unmount());container.remove();delete global.IS_REACT_ACT_ENVIRONMENT;});
const render=sourceFocus=>act(()=>root.render(<VnVCenterPro sourceFocus={sourceFocus} activeProjectId="p" vnvArtifacts={{}} requirements={[]} projects={[]} />));
test('a source link opens the specific test document and test without editing saved records',()=>{
  const before=localStorage.getItem('xhandle:vnv-test-case-documents');
  render({projectId:'p',documentId:'doc',testId:'TARGET'});
  expect(localStorage.getItem('xhandle:vnv-active-document-id')).toBe('doc');
  expect([...container.querySelectorAll('input')].some(input=>input.value==='Target test')).toBe(true);
  expect(localStorage.getItem('xhandle:vnv-test-case-documents')).toBe(before);
});
test('a stale link does not select a different test in the document',()=>{
  render({projectId:'p',documentId:'doc',testId:'DELETED'});
  expect(container.textContent).toContain('This test case is no longer available.');
  expect(container.querySelector('[title="Delete test case"]')).toBeNull();
});
test('a source link cannot choose a document belonging to another project',()=>{
  render({projectId:'p',documentId:'other',testId:'OTHER'});
  expect(localStorage.getItem('xhandle:vnv-active-document-id')).toBeNull();
  expect(container.textContent).toContain('This test case document is no longer available.');
});
