const NOTES_SUFFIX = ':notes:v1';

function clean(value) {
  return String(value ?? '').trim();
}

function finiteCoordinate(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function diagramNotesStorageKey(storageKey) {
  return `${clean(storageKey) || 'diagram'}${NOTES_SUFFIX}`;
}

export function normalizeDiagramNote(note = {}) {
  const id = clean(note.id);
  if (!id) return null;
  return {
    id,
    label: clean(note.label) || 'Note',
    description: String(note.description ?? ''),
    position: {
      x: finiteCoordinate(note.position?.x),
      y: finiteCoordinate(note.position?.y),
    },
    createdAt: clean(note.createdAt) || new Date().toISOString(),
    updatedAt: clean(note.updatedAt) || clean(note.createdAt) || new Date().toISOString(),
  };
}

export function loadDiagramNotes(storageKey, storage = typeof window === 'undefined' ? null : window.localStorage) {
  try {
    const raw = storage?.getItem?.(diagramNotesStorageKey(storageKey));
    const parsed = raw ? JSON.parse(raw) : [];
    return (Array.isArray(parsed) ? parsed : []).map(normalizeDiagramNote).filter(Boolean);
  } catch {
    return [];
  }
}

export function saveDiagramNotes(storageKey, notes = [], storage = typeof window === 'undefined' ? null : window.localStorage) {
  try {
    const normalized = (Array.isArray(notes) ? notes : []).map(normalizeDiagramNote).filter(Boolean);
    storage?.setItem?.(diagramNotesStorageKey(storageKey), JSON.stringify(normalized));
    return normalized;
  } catch {
    return [];
  }
}
