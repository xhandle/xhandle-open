import { useCallback, useEffect, useRef, useState } from 'react';

// Storage restoration has its own lifecycle; it never starts generation.
export default function useHazardRunRestoration(options) {
  const { projectId, connectionId, repoId } = options;
  const scope = JSON.stringify([projectId, connectionId, repoId]);
  const current = useRef(options);
  current.current = options;
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt(value => value + 1), []);
  const [state, setState] = useState({ scope: null, status: 'loading', error: '', contextError: '' });
  const lastScope = useRef(null);

  useEffect(() => {
    let cancelled = false;
    let sequence = 0;
    const registryScope = `${projectId}:${connectionId || ''}`;
    const changedScope = lastScope.current !== scope;
    lastScope.current = scope;
    if (changedScope) current.current.publish(null);
    const set = patch => setState({ scope, error: '', contextError: '', ...patch });

    async function load() {
      const request = ++sequence;
      const valid = () => !cancelled && request === sequence;
      const config = current.current;
      const registry = config.registry.current;
      const revision = registry.revision(registryScope);
      const retained = registry.get(registryScope);
      if (retained?.run) {
        config.publish(retained.run);
        set({ status: 'loaded' });
        return;
      }
      set({ status: 'loading' });
      if (!repoId || !projectId) {
        set({ status: 'empty' });
        return;
      }
      const pending = config.pendingContextSave.current;
      if (pending?.scope === `${projectId}:${connectionId || repoId}`) {
        try { await pending.promise; } catch { /* Read the previously saved result. */ }
      }
      if (!valid()) return;
      const version = config.contextVersion.current;
      let expectedRun = config.getCurrentRun();
      const superseded = () => {
        if (!valid()) return true;
        const live = registry.get(registryScope);
        if (live?.run) {
          config.publish(live.run);
          set({ status: 'loaded' });
          return true;
        }
        if (registry.revision(registryScope) !== revision) {
          // A live generation owns publication. Otherwise reread the newer saved state.
          if (live?.running) set({ status: 'loaded' });
          else retry();
          return true;
        }
        if (config.contextVersion.current !== version) {
          retry();
          return true;
        }
        if (config.getCurrentRun() !== expectedRun) {
          set({ status: config.getCurrentRun() ? 'loaded' : 'empty' });
          return true;
        }
        return false;
      };
      let loaded;
      try {
        loaded = await config.read({ projectId, repoId });
      } catch (error) {
        if (superseded()) return;
        // Never erase an existing completed result because a refresh failed.
        set({ status: 'failed', error: error?.message || 'Unable to read saved results.' });
        return;
      }
      if (superseded()) return;
      config.publish(loaded || null);
      expectedRun = loaded || null;
      set({ status: loaded ? 'loaded' : 'empty' });
      if (!loaded || registry.get(registryScope)?.running) return;
      // Publish the valid saved result before optional context reconciliation.
      // Its save failure must not be reported as a failed result read.
      try {
        const aligned = config.align(loaded);
        if (aligned === loaded) return;
        await config.save(aligned, { notify: false });
        if (superseded()) return;
        // Edits or another publisher may have replaced the run while saving.
        if (config.getCurrentRun() !== loaded) return;
        config.publish(aligned);
      } catch (error) {
        if (superseded()) return;
        set({ status: 'loaded', contextError: error?.message || 'Unable to save context updates.' });
      }
    }
    load();
    const onChanged = event => {
      if (event.detail?.projectId && event.detail.projectId !== projectId) return;
      if (event.detail?.repoId && event.detail.repoId !== repoId) return;
      load();
    };
    window.addEventListener('xhandle:code-architecture-hazard-analysis:changed', onChanged);
    return () => {
      cancelled = true;
      window.removeEventListener('xhandle:code-architecture-hazard-analysis:changed', onChanged);
    };
  }, [scope, projectId, connectionId, repoId, attempt, retry]);

  return { ...(state.scope === scope ? state : { scope, status: 'loading', error: '', contextError: '' }),
    scopeReady: state.scope === scope, retry };
}
