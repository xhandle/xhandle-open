export const THEME_STORAGE_KEY = 'xhandle.darkMode';
const normalize = value => ['light','dark','system'].includes(value) ? value : 'system';

// A single controller keeps the header, settings, OS and other windows in sync.
// Merely resolving the OS preference never saves an explicit user choice.
export function createThemePreference(host) {
  const listeners = new Set();
  let media;
  try { media = host?.matchMedia?.('(prefers-color-scheme: dark)'); } catch {}
  const read = () => { try { return normalize(host?.localStorage?.getItem(THEME_STORAGE_KEY)); } catch { return 'system'; } };
  let snapshot;
  const update = (preference, error = '') => {
    const mode = preference === 'system' ? media?.matches ? 'dark' : 'light' : preference;
    if (snapshot?.preference === preference && snapshot.mode === mode && snapshot.error === error) return;
    snapshot = {preference, mode, error};
    const root = host?.document?.documentElement;
    root?.classList.toggle('dark', mode === 'dark');
    root?.setAttribute('data-theme', mode);
    if (root) root.style.colorScheme = mode;
    host?.document?.querySelector('meta[name="theme-color"]')?.setAttribute('content', mode === 'dark' ? '#0d1420' : '#ffffff');
    try { Promise.resolve(host?.xhandleDesktop?.setThemePreference?.(preference)).catch(() => {}); } catch {}
    listeners.forEach(listener => listener());
  };
  update(read());
  const onSystem = () => { if (snapshot.preference === 'system') update('system', snapshot.error); };
  const onStorage = event => { if (event.key === THEME_STORAGE_KEY || event.key === null) update(read()); };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) {
        if (media?.addEventListener) media.addEventListener('change', onSystem); else media?.addListener?.(onSystem);
        host?.addEventListener?.('storage', onStorage);
        onSystem();
      }
      return () => {
        listeners.delete(listener);
        if (!listeners.size) {
          if (media?.removeEventListener) media.removeEventListener('change', onSystem); else media?.removeListener?.(onSystem);
          host?.removeEventListener?.('storage', onStorage);
        }
      };
    },
    setPreference(value) {
      const preference = normalize(typeof value === 'function' ? value(snapshot.mode) : value);
      let error = '';
      try { host?.localStorage?.setItem(THEME_STORAGE_KEY, preference); }
      catch { error = 'This theme is applied, but this window could not save your preference.'; }
      update(preference, error);
    },
  };
}

export const themePreference = createThemePreference(typeof window === 'undefined' ? null : window);
