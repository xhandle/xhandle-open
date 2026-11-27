import { registerDesktopUpdateSave, saveBeforeDesktopUpdate, installDesktopUpdateSave } from './desktopUpdateSave';

const owners = [];
const own = owner => owners.push(registerDesktopUpdateSave(owner));
afterEach(() => { owners.splice(0).forEach(remove => remove()); document.body.innerHTML = ''; });

test('stops producers and awaits final checkpoints before draining workspace storage', async () => {
  const events = [];
  let checkpoint;
  own({ stop: () => events.push('stop'), save: () => new Promise(resolve => { checkpoint = resolve; }) });
  own({ workspace: true, save: async () => events.push('durable') });
  const first = saveBeforeDesktopUpdate();
  expect(saveBeforeDesktopUpdate()).toBe(first);
  for (let i = 0; i < 8; i++) await Promise.resolve();
  expect(events).toEqual(['stop']);
  expect(() => registerDesktopUpdateSave({})).toThrow('being saved');
  checkpoint();
  await expect(first).resolves.toEqual({ saved: true });
  expect(events).toEqual(['stop', 'durable']);
});

test('fails closed without a mounted workspace and after a failed save', async () => {
  await expect(saveBeforeDesktopUpdate()).rejects.toThrow('not ready');
  let fail = true;
  own({ workspace: true, save: async () => { if (fail) throw new Error('Synthetic storage failure'); } });
  await expect(saveBeforeDesktopUpdate()).rejects.toThrow('storage failure');
  fail = false;
  await expect(saveBeforeDesktopUpdate()).resolves.toEqual({ saved: true });
});

test('observes every producer even if another producer cannot save', async () => {
  let finish;
  own({ save: async () => { throw new Error('Synthetic checkpoint failure'); } });
  own({ save: () => new Promise(resolve => { finish = resolve; }) });
  const durable = jest.fn();
  own({ workspace: true, save: durable });
  const operation = saveBeforeDesktopUpdate();
  const rejected = expect(operation).rejects.toThrow('checkpoint failure');
  for (let i = 0; i < 8; i++) await Promise.resolve();
  expect(durable).not.toHaveBeenCalled();
  finish(); await rejected;
});

test('commits blur edits and keeps editing disabled until the native attempt ends', async () => {
  document.body.innerHTML = '<div id="root"><input/></div>';
  const input = document.querySelector('input'), root = document.getElementById('root');
  input.focus(); const blur = jest.fn(); input.addEventListener('blur', blur);
  own({ workspace: true, save: async () => {} });
  let prepare, finish;
  const unsubscribe = jest.fn();
  const dispose = installDesktopUpdateSave({ onSaveBeforeUpdate: (save, release) => { prepare = save; finish = release; return unsubscribe; } });
  await expect(prepare()).resolves.toEqual({ saved: true });
  expect(blur).toHaveBeenCalledTimes(1);
  expect(root.inert).toBe(true);
  expect(document.querySelector('[role="status"]')).not.toBeNull();
  finish(); expect(root.inert).not.toBe(true);
  expect(document.querySelector('[role="status"]')).toBeNull();
  dispose(); expect(unsubscribe).toHaveBeenCalled();
});

test('a failed automatic save restores editing for manual saving', async () => {
  document.body.innerHTML = '<div id="root"></div>';
  own({ workspace: true, save: async () => { throw new Error('Synthetic quota failure'); } });
  let prepare;
  const dispose = installDesktopUpdateSave({ onSaveBeforeUpdate: save => { prepare = save; } });
  await expect(prepare()).rejects.toThrow('quota failure');
  expect(document.getElementById('root').inert).not.toBe(true);
  expect(document.querySelector('[role="status"]')).toBeNull();
  dispose();
});
