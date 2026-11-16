import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Modal, RowActionsBar } from './RequirementsViews';

jest.mock('lucide-react', () => new Proxy({}, { get: (_target, key) => key === '__esModule' ? true : () => null }));

test('read-only objects retain navigation and History while mutation controls are disabled', async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div'); document.body.appendChild(host);
  const root = createRoot(host), history = jest.fn(), setViewMode = jest.fn();
  try {
    await act(async () => root.render(<RowActionsBar disabled selection={{ id: 'r', title: 'Recorded requirement' }} onHistory={history} setViewMode={setViewMode} viewMode="outline" documentView diagramView />));
    const button = title => host.querySelector(`button[title="${title}"]`);
    for (const title of ['New child', 'Edit', 'Delete', 'Move up', 'Move down', 'Promote (outdent)', 'Demote (indent)', 'Insert image (renders in place of title)', 'Insert table (renders in place of title)']) expect(button(title).disabled).toBe(true);
    expect(button('History').disabled).toBe(false);
    await act(async () => { button('History').click(); button('Table view').click(); button('Traceability view').click(); button('Document view').click(); button('Diagram view').click(); });
    expect(history).toHaveBeenCalledTimes(1);
    expect(setViewMode.mock.calls.map(call => call[0])).toEqual(['table', 'TRACE', 'document', 'diagram']);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

test('shared dialogs contain keyboard focus, close with Escape, and return focus to the trigger', async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div'); document.body.appendChild(host);
  const root = createRoot(host);
  function Example() {
    const [open, setOpen] = React.useState(false);
    return <><button onClick={() => setOpen(true)}>Open history</button>{open && <Modal title="Object history" onClose={() => setOpen(false)}><button>First action</button><button>Last action</button></Modal>}</>;
  }
  try {
    await act(async () => root.render(<Example />));
    const trigger = host.querySelector('button'); trigger.focus(); await act(async () => trigger.click());
    const close = host.querySelector('[aria-label="Close Object history"]'); expect(document.activeElement).toBe(close);
    await act(async () => close.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })));
    expect(document.activeElement.textContent).toBe('Last action');
    await act(async () => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })));
    expect(document.activeElement).toBe(close);
    await act(async () => close.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(host.querySelector('[role="dialog"]')).toBeNull(); expect(document.activeElement).toBe(trigger);
  } finally { await act(async () => root.unmount()); host.remove(); }
});
