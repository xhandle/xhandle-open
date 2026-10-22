import React, { act, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import useDiagramResizeFit from './useDiagramResizeFit';

let notify, disconnect, observe, root, container;
const suppressed = () => false;
function Harness({ fit, suppress = suppressed }) {
  const host = useRef(null);
  useDiagramResizeFit(host, fit, suppress);
  return <div ref={host}><span data-testid="diagram-content" /></div>;
}
function resize(width, height) {
  act(() => notify([{ target: container.firstChild, contentRect: { width, height } }]));
}
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  jest.useFakeTimers();
  disconnect = jest.fn();
  observe = jest.fn();
  global.ResizeObserver = jest.fn(callback => {
    notify = callback;
    return { observe, disconnect };
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  jest.useRealTimers();
  delete global.ResizeObserver;
  delete global.IS_REACT_ACT_ENVIRONMENT;
});
test('fits once after a resize burst and ignores duplicate size notifications', () => {
  const fit = jest.fn();
  act(() => root.render(<Harness fit={fit} />));
  resize(800, 600);
  resize(900, 600);
  resize(1000, 600);
  act(() => jest.advanceTimersByTime(150));
  expect(fit).toHaveBeenCalledTimes(1);
  resize(1000, 600);
  act(() => jest.advanceTimersByTime(150));
  expect(fit).toHaveBeenCalledTimes(1);
});
test('uses the latest graph callback without reconnecting or triggering another fit', () => {
  const oldFit = jest.fn(), fit = jest.fn();
  act(() => root.render(<Harness fit={oldFit} />));
  resize(800, 600);
  act(() => root.render(<Harness fit={fit} />));
  act(() => jest.advanceTimersByTime(150));
  expect(oldFit).not.toHaveBeenCalled();
  expect(fit).toHaveBeenCalledWith({ duration: 0 });
  expect(observe).toHaveBeenCalledTimes(1);
});
test('respects navigation suppression and cancels pending fits when hidden or unmounted', () => {
  const fit = jest.fn();
  act(() => root.render(<Harness fit={fit} suppress={() => true} />));
  resize(800, 600);
  act(() => jest.advanceTimersByTime(150));
  expect(fit).not.toHaveBeenCalled();
  act(() => root.render(<Harness fit={fit} />));
  resize(900, 600);
  resize(0, 0);
  act(() => jest.advanceTimersByTime(150));
  expect(fit).not.toHaveBeenCalled();
  resize(900, 600);
  act(() => root.render(null));
  act(() => jest.advanceTimersByTime(150));
  expect(fit).not.toHaveBeenCalled();
  expect(disconnect).toHaveBeenCalledTimes(1);
});

test('StrictMode reconnects safely and leaves no fit scheduled after unmount', () => {
  const fit = jest.fn();
  act(() => root.render(<React.StrictMode><Harness fit={fit} /></React.StrictMode>));
  expect(observe).toHaveBeenCalledTimes(2);
  expect(disconnect).toHaveBeenCalledTimes(1);
  resize(800, 600);
  act(() => jest.advanceTimersByTime(150));
  expect(fit).toHaveBeenCalledTimes(1);
  resize(900, 600);
  act(() => root.render(null));
  act(() => jest.advanceTimersByTime(150));
  expect(fit).toHaveBeenCalledTimes(1);
  expect(disconnect).toHaveBeenCalledTimes(2);
});

test('a hidden host cancels a pending fit even when its previous size rounds to zero', () => {
  const fit = jest.fn();
  act(() => root.render(<Harness fit={fit} />));
  resize(0.2, 0.2);
  resize(0, 0);
  act(() => jest.advanceTimersByTime(150));
  expect(fit).not.toHaveBeenCalled();
});

test('fits again when a hidden host returns to its previous visible size', () => {
  const fit = jest.fn();
  act(() => root.render(<Harness fit={fit} />));
  resize(800, 600);
  act(() => jest.advanceTimersByTime(150));
  resize(0, 0);
  resize(800, 600);
  act(() => jest.advanceTimersByTime(150));
  expect(fit).toHaveBeenCalledTimes(2);
});

test.each(['pointerdown', 'wheel'])('%s navigation cancels a delayed resize fit without disabling later resizes', eventType => {
  const fit = jest.fn();
  act(() => root.render(<Harness fit={fit} />));
  resize(800, 600);
  act(() => jest.advanceTimersByTime(100));
  const event = new Event(eventType, { bubbles: true, cancelable: true });
  act(() => container.querySelector('[data-testid="diagram-content"]').dispatchEvent(event));
  expect(event.defaultPrevented).toBe(false);
  act(() => jest.advanceTimersByTime(150));
  expect(fit).not.toHaveBeenCalled();
  resize(900, 600);
  act(() => jest.advanceTimersByTime(150));
  expect(fit).toHaveBeenCalledTimes(1);
});
