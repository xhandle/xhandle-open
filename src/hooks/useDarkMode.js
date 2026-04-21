/**
 * xHandle: use dark mode custom hook.
 * This file encapsulates reusable React state logic that multiple xHandle surfaces can consume without duplicating effect or persistence code.
 * Custom hooks keep cross-cutting UI behavior isolated from the larger feature components that focus on engineering workflows.
 * Related files: src/App.js, src/features/settings/SettingsModal.jsx.
 */

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'xhandle.darkMode'; // 'dark' | 'light'

export function useDarkMode() {
  const getPref = () => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
    const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    return prefersDark ? 'dark' : 'light';
  };

  const [mode, setMode] = useState(getPref);

  useEffect(() => {
    const root = document.documentElement; // <html>
    if (mode === 'dark') root.classList.add('dark');
    else root.classList.remove('dark');
    localStorage.setItem(STORAGE_KEY, mode);
  }, [mode]);

  // live-respond if OS theme changes and user hasn’t explicitly chosen
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return;
    const handler = (e) => {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved !== 'dark' && saved !== 'light') {
        setMode(e.matches ? 'dark' : 'light');
      }
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const toggle = () => setMode((m) => (m === 'dark' ? 'light' : 'dark'));

  return { mode, setMode, toggle, isDark: mode === 'dark' };
}
