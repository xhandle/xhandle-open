import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import ThemeSettings from './ThemeSettings';
import {useDarkMode} from '../hooks/useDarkMode';
import {themePreference,THEME_STORAGE_KEY} from './themePreference';
global.IS_REACT_ACT_ENVIRONMENT=true;
function Header(){const {isDark,toggle}=useDarkMode();return <button onClick={toggle}>{isDark?'Switch to light':'Switch to dark'}</button>;}
let host,root;
beforeEach(()=>{host=document.createElement('div');document.body.append(host);root=createRoot(host);act(()=>themePreference.setPreference('light'));act(()=>root.render(<><Header/><ThemeSettings/></>));});
afterEach(()=>{act(()=>root.unmount());host.remove();themePreference.setPreference('system');localStorage.removeItem(THEME_STORAGE_KEY);});
test('header and settings share one preference and apply appearance without remounting',()=>{
 act(()=>host.querySelector('input[value=dark]').click());expect(document.documentElement.classList.contains('dark')).toBe(true);expect(host.querySelector('button').textContent).toBe('Switch to light');expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
 act(()=>host.querySelector('button').click());expect(host.querySelector('input[value=light]').checked).toBe(true);expect(document.documentElement.style.colorScheme).toBe('light');
 act(()=>host.querySelector('input[value=system]').click());expect(themePreference.getSnapshot().preference).toBe('system');
});
test('another window’s storage event updates both mounted controls',()=>{
 localStorage.setItem(THEME_STORAGE_KEY,'dark');act(()=>window.dispatchEvent(new StorageEvent('storage',{key:THEME_STORAGE_KEY,newValue:'dark'})));expect(host.querySelector('input[value=dark]').checked).toBe(true);expect(host.querySelector('button').textContent).toBe('Switch to light');
});
