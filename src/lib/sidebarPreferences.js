export const SIDEBAR_AREAS = [
  ['code-architecture', 'Code-Based Architecture'],
  ['projects', 'Projects'],
  ['safety-case', 'Safety Case'],
  ['review-center', 'Review Center'],
  ['reports', 'Reports'],
  ['requirements', 'Design Management'],
  ['vnv', 'System Test'],
  ['collaborator', 'Collaborator'],
];
export const SIDEBAR_PREFERENCES_KEY = 'xhandle.sidebarVisibility';
export function loadSidebarPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem(SIDEBAR_PREFERENCES_KEY) || '{}');
    return Object.fromEntries(SIDEBAR_AREAS.map(([id]) => [id, saved?.[id] !== false]));
  } catch { return Object.fromEntries(SIDEBAR_AREAS.map(([id]) => [id, true])); }
}
