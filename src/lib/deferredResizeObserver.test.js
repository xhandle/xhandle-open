import { installDeferredResizeObserver } from './deferredResizeObserver';

function fixture() {
  const frames = new Map();
  let nextId = 0;
  class NativeResizeObserver {
    constructor(callback) { this.deliver = entries => callback(entries, this); }
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  const target = {
    ResizeObserver: NativeResizeObserver,
    requestAnimationFrame: callback => { frames.set(++nextId, callback); return nextId; },
    cancelAnimationFrame: id => frames.delete(id),
  };
  installDeferredResizeObserver(target);
  const callback = jest.fn();
  const observer = new target.ResizeObserver(callback);
  const flush = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn()); };
  return { observer, callback, frames, flush };
}

test('does not deliver queued diagram measurements after disconnect on project switch', () => {
  const { observer, callback, frames, flush } = fixture();
  const node = {};
  observer.observe(node);
  observer.deliver([{ target: node }]);
  expect(frames.size).toBe(1);
  observer.disconnect();
  expect(frames.size).toBe(0);
  flush();
  expect(callback).not.toHaveBeenCalled();
});

test('unobserving a removed node leaves only still-observed nodes in the delivery', () => {
  const { observer, callback, flush } = fixture();
  const removed = {}, retained = {};
  observer.observe(removed); observer.observe(retained);
  observer.deliver([{ target: removed }, { target: retained }]);
  observer.unobserve(removed);
  flush();
  expect(callback).toHaveBeenCalledWith([{ target: retained }], observer);
});

test('can observe again after disconnect without reviving old queued entries', () => {
  const { observer, callback, flush } = fixture();
  const oldNode = {}, newNode = {};
  observer.observe(oldNode); observer.deliver([{ target: oldNode }]);
  observer.disconnect();
  observer.observe(newNode); observer.deliver([{ target: newNode }]);
  flush();
  expect(callback).toHaveBeenCalledTimes(1);
  expect(callback).toHaveBeenCalledWith([{ target: newNode }], observer);
});

test('coalesces repeated measurements and retains the native callback receiver', () => {
  const { observer, callback, frames, flush } = fixture();
  let receiver;
  callback.mockImplementation(function () { receiver = this; });
  const node = {};
  observer.observe(node);
  observer.deliver([{ target: node, size: 10 }]);
  observer.deliver([{ target: node, size: 20 }]);
  expect(frames.size).toBe(1);
  flush();
  expect(callback).toHaveBeenCalledWith([{ target: node, size: 20 }], observer);
  expect(receiver).toBe(observer);
});

test('does not hide errors thrown by application callbacks', () => {
  const { observer, callback, flush } = fixture();
  const node = {};
  observer.observe(node);
  callback.mockImplementation(() => { throw new Error('real application error'); });
  observer.deliver([{ target: node }]);
  expect(flush).toThrow('real application error');
});
