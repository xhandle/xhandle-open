import { useSyncExternalStore } from 'react';
import { themePreference } from '../theme/themePreference';

export function useDarkMode() {
  const state = useSyncExternalStore(themePreference.subscribe, themePreference.getSnapshot, themePreference.getSnapshot);
  return {...state, setMode:themePreference.setPreference,
    toggle:() => themePreference.setPreference(state.mode === 'dark' ? 'light' : 'dark'), isDark:state.mode === 'dark'};
}
