import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { compileArchitectureMarkers, ArchitectureMarkers } from './ArchitectureMarkers';

test('deduplicates equivalent markers without changing model/export objects', () => {
  const marker = { type: 'arrowclosed', color: 'rgba(45,125,254,0.92)', width: 20, height: 20 };
  const edges = [{ id: 'a', markerEnd: marker, markerStart: { color: marker.color, height: 20, width: 20, type: 'arrowclosed' } }, { id: 'b', markerEnd: marker }];
  const before = JSON.stringify(edges), result = compileArchitectureMarkers(edges, 'diagram-1');
  expect(result.definitions).toHaveLength(1);
  expect(result.edges[0].markerStart).toBe(result.edges[1].markerEnd);
  expect(result.edges[0].markerEnd).toBe('diagram-1-0');
  expect(JSON.stringify(edges)).toBe(before);
  expect(compileArchitectureMarkers(edges, 'diagram-2').edges[0].markerEnd).not.toBe(result.edges[0].markerEnd);
});

test('preserves custom markers and separate start/end paint', () => {
  const custom = { type: 'custom', color: 'red' };
  const result = compileArchitectureMarkers([{ markerStart: 'custom-url', markerEnd: custom }, { markerStart: { type: 'arrow', color: 'red' }, markerEnd: { type: 'arrowclosed', color: 'blue', orient: 'auto', markerUnits: 'userSpaceOnUse' } }], 'scope');
  expect(result.edges[0]).toEqual({ markerStart: 'custom-url', markerEnd: custom });
  const html = renderToStaticMarkup(<ArchitectureMarkers definitions={result.definitions} />);
  const host = document.createElement('div'); host.innerHTML = html;
  const markers = host.querySelectorAll('marker'); expect(markers).toHaveLength(2);
  expect(markers[0].querySelector('polyline').style.fill).toBe('none');
  expect(markers[1].querySelector('polyline').style.fill).toBe('blue');
  expect(markers[1].getAttribute('markerUnits')).toBe('userSpaceOnUse');
  expect(markers[1].getAttribute('orient')).toBe('auto');
});
