import { useCallback, useEffect, useRef, useState } from 'react';

// Storage restoration has its own lifecycle; it never starts generation.
export default function useHazardRunRestoration(options) {
  const { projectId, connectionId, repoId, enabled = true } = options;
  const scope = JSON.stringify([projectId, connectionId, repoId, options.readMode]);
  const current = useRef(options);
  current.current = options;
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt(value => value + 1), []);
  const [state, setState] = useState({ scope: null, status: 'loading', error: '', contextError: '' });
  const upgradeController = useRef(null);
  const cancelUpgrade = useCallback(() => upgradeController.current?.abort(), []);
  useEffect(() => () => { upgradeController.current?.abort(); upgradeController.current = null; }, [scope, enabled]);
  const upgrade = useCallback(async () => {
    if (!state.upgradeRunId || upgradeController.current || !current.current.upgrade) return;
    const controller = new AbortController();
    upgradeController.current = controller;
    setState(previous => ({...previous, status:'upgrading', progress:0, error:''}));
    try {
      await current.current.upgrade(state.upgradeRunId, {
        signal:controller.signal,
        onProgress: ({completed,total}) => {
          if (!controller.signal.aborted) setState(previous => ({...previous, progress:total ? Math.floor(completed*100/total) : null}));
        },
      });
      if (!controller.signal.aborted) retry();
    } catch (error) {
      if (upgradeController.current === controller) setState(previous => ({...previous, status:'upgrade-required', error:error.name === 'AbortError' ? '' : error.message}));
    } finally {
      if (upgradeController.current === controller) upgradeController.current = null;
    }
  }, [state.upgradeRunId, retry]);
  const lastScope = useRef(null);
  const readTail = useRef(Promise.resolve());

  useEffect(() => {
    let cancelled = false;
    let sequence = 0;
    let reader;
    const registryScope = `${projectId}:${connectionId || ''}`;
    const changedScope = lastScope.current !== scope;
    lastScope.current = scope;
    if (changedScope) current.current.publish(null);
    const set = patch => setState({ scope, progress: null, error: '', contextError: '', ...patch });

    if (!enabled) return undefined;

    let activeLoad = null;
    let pendingRevalidation = false;
    function load(passive = false) {
      if (cancelled || upgradeController.current) return;
      if (passive && activeLoad) {
        // Focus and visibility often arrive together. Finish the current read
        // before one follow-up check, rather than discarding its progress.
        pendingRevalidation = true;
        return;
      }
      pendingRevalidation = false;
      const work = performLoad(passive);
      activeLoad = work;
      work.finally(() => {
        if (activeLoad !== work) return;
        activeLoad = null;
        if (!cancelled && pendingRevalidation) load(true);
      });
    }

    async function performLoad(passive) {
      reader?.abort();
      const controller = new AbortController();
      reader = controller;
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
      const quiet = passive && Boolean(config.getCurrentRun());
      if (!quiet) set({ status: 'loading' });
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
      let reportedProgress = -1;
      try {
        // Retire an aborted transaction before allowing a replacement read to start.
        const work = readTail.current.catch(() => {}).then(() => {
          if (!valid() || controller.signal.aborted) return null;
          return config.read({ projectId, repoId }, {
            signal: controller.signal,
            reuseRun: expectedRun,
            onProgress: ({ completed, total }) => {
              const progress = total ? Math.floor(completed * 100 / total) : null;
              if (!quiet && valid() && !controller.signal.aborted && progress !== reportedProgress) {
                reportedProgress = progress;
                set({ status: 'loading', progress });
              }
            },
          });
        });
        readTail.current = work.then(() => undefined, () => undefined);
        loaded = await work;
      } catch (error) {
        if (superseded()) return;
        // Never erase an existing completed result because a refresh failed.
        set({ status: error?.code === 'HAZARD_TABLE_UPGRADE_REQUIRED' ? 'upgrade-required' : 'failed', upgradeRunId:error?.runId, error: error?.message || 'Unable to read saved results.' });
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
    // Another window can commit without dispatching this window's custom event.
    // Revalidate the lightweight revision when this window becomes active again.
    const onFocus = () => load(true);
    const onVisibility = () => { if (document.visibilityState === 'visible') load(true); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      reader?.abort();
      window.removeEventListener('xhandle:code-architecture-hazard-analysis:changed', onChanged);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [scope, projectId, connectionId, repoId, attempt, retry, enabled]);

  return { ...(state.scope === scope ? state : { scope, status: 'loading', error: '', contextError: '' }),
    scopeReady: state.scope === scope, retry, upgrade, cancelUpgrade };
}
