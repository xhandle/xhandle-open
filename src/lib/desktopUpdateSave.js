// The desktop owns restart/install. Shared code can only acknowledge a native
// save request after every registered owner has drained its durable writes.
const owners = new Map();
let saving = null;
let updateHeld = false;

export function registerDesktopUpdateSave(owner) {
  if (saving || updateHeld) throw new Error('Work is being saved for an update. Try again when saving finishes.');
  const key = Symbol('update-save-owner');
  owners.set(key, owner);
  return () => owners.delete(key);
}

export function saveBeforeDesktopUpdate({ fresh = false } = {}) {
  if (saving) return fresh ? Promise.reject(new Error('A previous automatic save is still finishing. Retry after it finishes.')) : saving;
  const snapshot = [...owners.values()];
  saving = (async () => {
    if (!snapshot.some(owner => owner.workspace)) throw new Error('The workspace is not ready to save.');
    // Stop producers first, then await their final checkpoints before storage
    // owners drain. A failed owner cannot hide another owner's pending write.
    const stopped = await Promise.allSettled(snapshot.map(owner => Promise.resolve().then(() => owner.stop?.())));
    const tasks = await Promise.allSettled(snapshot.filter(owner => !owner.workspace).map(owner => owner.save?.()));
    const failed = [...stopped, ...tasks].find(result => result.status === 'rejected');
    if (failed) throw failed.reason;
    const workspaces = await Promise.allSettled(snapshot.filter(owner => owner.workspace).map(owner => owner.save()));
    const failure = workspaces.find(result => result.status === 'rejected');
    if (failure) throw failure.reason;
    return { saved: true };
  })().finally(() => { saving = null; });
  return saving;
}

export function installDesktopUpdateSave(bridge = window.xhandleDesktop) {
  if (!bridge?.onSaveBeforeUpdate) return () => {};
  let release = () => {};
  const unsubscribe = bridge.onSaveBeforeUpdate(async () => {
    release();
    updateHeld = true;
    document.activeElement?.blur?.();
    const root = document.getElementById('root');
    const wasInert = root?.inert;
    if (root) root.inert = true;
    const notice = document.createElement('div');
    notice.setAttribute('role', 'status');
    notice.tabIndex = -1;
    notice.textContent = 'Saving work before updating…';
    notice.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;background:#0f172ae6;color:white;font:18px system-ui';
    document.body.append(notice);
    notice.focus();
    const preventEditing = event => { event.preventDefault(); event.stopImmediatePropagation(); };
    window.addEventListener('keydown', preventEditing, true);
    window.addEventListener('beforeinput', preventEditing, true);
    const cleanup = () => {
      updateHeld = false;
      notice.remove();
      if (root) root.inert = wasInert;
      window.removeEventListener('keydown', preventEditing, true);
      window.removeEventListener('beforeinput', preventEditing, true);
    };
    release = cleanup;
    try {
      // Let blur-triggered React edits reach their normal persistence owners.
      await new Promise(resolve => setTimeout(resolve, 0));
      return await saveBeforeDesktopUpdate({ fresh: true });
    } catch (error) { cleanup(); throw error; }
    // Keep editing disabled after acknowledgement until installation starts,
    // or the native owner releases this attempt after cancellation/failure.
  }, () => release());
  return () => { unsubscribe?.(); release(); };
}
