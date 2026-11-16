import { useEffect, useRef } from 'react';
import { registerActionProvider } from '../app/actionRegistry';

// Mounted surfaces expose read-only, bounded live evidence. Nothing is copied
// or hydrated until a conversational turn asks for its current-view snapshot.
export function useCurrentViewSource(section, reader) {
  const ref = useRef(reader); ref.current = reader;
  useEffect(() => registerActionProvider(`collaborator-current-view:${section}`, { read: () => ref.current?.() }), [section]);
}
