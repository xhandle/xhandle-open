import { CODE_ARCHITECTURE_HAZARD_ARTIFACT_TYPE } from '../code-architecture-hazard-analysis/codeArchitectureHazardTypes';

// Serialize the full source + review publication, not just the event dispatch.
export function createReviewActionQueue() {
  const tails = new Map();
  return (key, task) => {
    const pending = (tails.get(key) || Promise.resolve()).catch(() => {}).then(task);
    tails.set(key, pending);
    const cleanup = () => { if (tails.get(key) === pending) tails.delete(key); };
    pending.then(cleanup, cleanup);
    return pending;
  };
}

export async function commitReviewSource(item, currentContent, action, operationId) {
  if (item?.artifactType !== CODE_ARCHITECTURE_HAZARD_ARTIFACT_TYPE ||
      !['update_current_content', 'approve_with_modifications'].includes(action)) return false;
  if (!Array.isArray(currentContent?.row)) throw Error('The reviewed hazard row is invalid.');
  let completion;
  const detail = {
    action,
    operationId,
    reviewItem: { ...item, currentContent },
    previousContent: item.currentContent || item.originalContent,
    // Handler claims synchronously, but completes only after durable publication.
    accept: promise => { completion = Promise.resolve(promise); },
  };
  window.dispatchEvent(new CustomEvent('xhandle:results-review:apply-source', { detail }));
  if (!completion) throw Error('The hazard analysis is not available. Open it and retry the review.');
  await completion;
  return true;
}

export function needsDurableReviewAction(item, action) {
  return item?.artifactType === CODE_ARCHITECTURE_HAZARD_ARTIFACT_TYPE &&
    (item.pendingSourceCommit || ['update_current_content', 'approve_with_modifications'].includes(action));
}

// Persist the intent before touching the source. A receipt in the source record
// makes recovery idempotent when the source committed but review finalization did not.
export async function saveDurableReviewAction({item, updates, action, withHistory, persist, getItem, dispatchReviewEvent, createHistoryEntry}) {
  const requested = JSON.stringify({updates, action, withHistory});
  const finish = async pendingItem => {
    if (!pendingItem?.pendingSourceCommit) throw Error('The pending review was deleted or changed.');
    const pending = pendingItem.pendingSourceCommit;
    await commitReviewSource(pendingItem, pending.patch.currentContent || pendingItem.currentContent, pending.action, pending.id);
    let completed;
    await persist(items => items.map(current => {
      if (current.id !== item.id) return current;
      if (current.pendingSourceCommit?.id !== pending.id) throw Error('The pending review changed. Reopen the review.');
      completed = {...current, ...pending.patch, originalContent:current.originalContent,
        history:pending.historyEntry ? [...(current.history || []),pending.historyEntry] : current.history,
        pendingSourceCommit:null,id:current.id};
      return completed;
    }), {requireDurable:true});
    if (!completed) throw Error('The review was deleted.');
    dispatchReviewEvent('xhandle:results-review:item-updated', {reviewItem:completed,previousContent:pendingItem.currentContent,action:pending.action,sourceApplied:true});
    return completed;
  };
  if (item.pendingSourceCommit) {
    const previousRequest = item.pendingSourceCommit.request;
    const pendingId = item.pendingSourceCommit.id;
    // A previous failed writer may have left only an in-memory intent. Confirm
    // durability again before resuming; never infer it from optimistic UI state.
    await persist(items => {
      if (!items.some(current => current.id === item.id && current.pendingSourceCommit?.id === pendingId))
        throw Error('The pending review changed. Reopen the review.');
      return items;
    }, {requireDurable:true});
    item = await finish(getItem());
    if (previousRequest === requested || action === 'resume_pending') return item;
  }
  const {historyDetails = {}, ...itemUpdates} = updates;
  const at = new Date().toISOString();
  const patch = {...itemUpdates,updatedAt:at};
  if (withHistory) Object.assign(patch, {reviewerFeedback:itemUpdates.reviewerFeedback ?? item.reviewerFeedback,
    reviewedAt:at,version:(Number(item.version)||1)+1});
  const pending = {id:crypto.randomUUID(),action,request:requested,patch,
    historyEntry:withHistory ? createHistoryEntry(action, {status:itemUpdates.status,reviewState:itemUpdates.reviewState,feedback:itemUpdates.reviewerFeedback,...historyDetails}) : null};
  await persist(items => items.map(current => {
    if(current.id !== item.id) return current;
    if(current !== item) throw Error('The review changed. Reopen it before saving.');
    return {...current,pendingSourceCommit:pending};
  }), {requireDurable:true});
  const prepared = getItem();
  if (prepared?.pendingSourceCommit?.id !== pending.id) throw Error('The review was deleted or changed.');
  return finish(prepared);
}
