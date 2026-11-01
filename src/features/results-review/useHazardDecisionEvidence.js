import { useEffect, useState } from 'react';
import { hazardDecisionEvidence, readHazardDecisionEvidence } from './collaboratorReviewStore';

const EMPTY = [];
// Only current-project decision bases are held here. Session histories and
// legacy automatic review queues never enter the application context.
export function useHazardDecisionEvidence(projectId) {
  const [state, setState] = useState({ projectId: null, items: EMPTY, error: null });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const changed = event => {
      const projects = event.detail?.projectIds;
      if (projectId && (!projects?.length || projects.includes('') || projects.includes(projectId))) setRevision(value => value + 1);
    };
    window.addEventListener('xhandle:collaborator-review:evidence-changed', changed);
    return () => window.removeEventListener('xhandle:collaborator-review:evidence-changed', changed);
  }, [projectId]);
  useEffect(() => {
    setState({ projectId, items: EMPTY, error: null });
    if (!projectId) return undefined;
    let cancelled = false;
    const live = new Map();
    const key = item => `${item.vibeReview.reviewTarget}:${item.vibeReview.rowId}`;
    const saved = event => {
      const item = hazardDecisionEvidence(event.detail?.reviewItem);
      if (!item || item.projectId !== projectId) return;
      live.set(key(item), item);
      setState(old => {
        const items = new Map((old.projectId === projectId ? old.items : []).map(entry => [key(entry), entry]));
        items.set(key(item), item);
        return { ...old, projectId, items: [...items.values()] };
      });
    };
    window.addEventListener('xhandle:collaborator-review:evidence-saved', saved);
    readHazardDecisionEvidence(projectId).then(items => {
      if (cancelled) return;
      const merged = new Map(items.map(item => [key(item), item]));
      live.forEach((item, id) => merged.set(id, item));
      setState({ projectId, items: [...merged.values()], error: null });
    }).catch(error => {
      if (!cancelled) setState({ projectId, items: [...live.values()], error });
    });
    return () => { cancelled = true; window.removeEventListener('xhandle:collaborator-review:evidence-saved', saved); };
  }, [projectId, revision]);
  return state.projectId === projectId ? state : { items: EMPTY, error: null };
}
