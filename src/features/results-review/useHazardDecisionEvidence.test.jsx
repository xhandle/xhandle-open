import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useHazardDecisionEvidence } from './useHazardDecisionEvidence';
import { readHazardDecisionEvidence } from './collaboratorReviewStore';

jest.mock('./collaboratorReviewStore', () => ({...jest.requireActual('./collaboratorReviewStore'),readHazardDecisionEvidence:jest.fn()}));
global.IS_REACT_ACT_ENVIRONMENT = true;
let root,host,current;
function Probe({projectId}) { current = useHazardDecisionEvidence(projectId); return null; }
const item = (projectId,decision) => ({id:`${projectId}-row`,projectId,currentContent:{row:[decision]},history:['large history'],vibeReview:{domain:'hazard-analysis',reviewTarget:'guidePhraseApplicable',rowId:'HA-1',decision}});
beforeEach(() => {host=document.createElement('div'); root=createRoot(host);readHazardDecisionEvidence.mockReset();});
afterEach(() => act(() => root.unmount()));
test('project switches discard stale loads, and live decisions win over an in-flight historical read', async () => {
  const pending = {};
  readHazardDecisionEvidence.mockImplementation(id => new Promise(resolve => {pending[id]=resolve;}));
  act(() => root.render(<Probe projectId="a" />));
  act(() => root.render(<Probe projectId="b" />));
  await act(async () => pending.a([item('a','old')])); expect(current.items).toEqual([]);
  act(() => window.dispatchEvent(new CustomEvent('xhandle:collaborator-review:evidence-saved',{detail:{reviewItem:item('b','Yes')}})));
  await act(async () => pending.b([item('b','No')]));
  expect(current.items).toHaveLength(1); expect(current.items[0].vibeReview.decision).toBe('Yes');
  expect(current.items[0].history).toBeUndefined();
  act(() => window.dispatchEvent(new CustomEvent('xhandle:collaborator-review:evidence-saved',{detail:{reviewItem:{projectId:'b',currentContent:{decisions:['large ledger']},vibeReview:{domain:'hazard-analysis',reviewTarget:'guidePhraseApplicable'}}}})));
  expect(current.items).toHaveLength(1);
  act(() => root.render(<Probe projectId={null} />)); expect(current.items).toEqual([]);
  act(() => window.dispatchEvent(new CustomEvent('xhandle:collaborator-review:evidence-saved',{detail:{reviewItem:item('b','No')}})));
  expect(current.items).toEqual([]);
});
test('a failed scoped load reports the error without replacing a newly saved decision', async () => {
  let fail; readHazardDecisionEvidence.mockImplementation(() => new Promise((_resolve,reject) => {fail=reject;}));
  act(() => root.render(<Probe projectId="a" />));
  act(() => window.dispatchEvent(new CustomEvent('xhandle:collaborator-review:evidence-saved',{detail:{reviewItem:item('a','Yes')}})));
  await act(async () => fail(Error('unavailable')));
  expect(current.error.message).toBe('unavailable'); expect(current.items[0].vibeReview.decision).toBe('Yes');
});
test('reset/import/undo invalidation reloads only the current project and clears removed decisions', async () => {
  readHazardDecisionEvidence.mockResolvedValue([item('a','Yes')]);
  await act(async () => root.render(<Probe projectId="a" />));
  expect(current.items).toHaveLength(1);
  act(() => window.dispatchEvent(new CustomEvent('xhandle:collaborator-review:evidence-changed',{detail:{projectIds:['other']}})));
  expect(readHazardDecisionEvidence).toHaveBeenCalledTimes(1);
  readHazardDecisionEvidence.mockResolvedValue([]);
  await act(async () => window.dispatchEvent(new CustomEvent('xhandle:collaborator-review:evidence-changed',{detail:{projectIds:['a']}})));
  expect(current.items).toEqual([]); expect(readHazardDecisionEvidence).toHaveBeenCalledTimes(2);
});
