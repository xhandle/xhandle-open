import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import DesignDialogForm from './DesignDialogForm';

test('the fixed footer stays in its form and preserves required-field validation and submission', async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div'); document.body.appendChild(host);
  const root = createRoot(host), submitted = jest.fn();
  try {
    await act(async () => root.render(<DesignDialogForm onSubmit={event => { event.preventDefault(); submitted(new FormData(event.currentTarget).get('title')); }} footer={<button type="submit">Save</button>}>
      <label>Title<input name="title" required /></label>
    </DesignDialogForm>));
    const form = host.querySelector('form'), body = host.querySelector('.design-dialog-body'), footer = host.querySelector('.design-dialog-footer');
    expect(body.contains(footer)).toBe(false); expect(footer.parentElement).toBe(form);
    expect(host.querySelector('input').required).toBe(true); expect(form.checkValidity()).toBe(false);
    host.querySelector('input').value = 'Reviewed safety requirements';
    expect(form.checkValidity()).toBe(true);
    await act(async () => footer.querySelector('button').click());
    expect(submitted).toHaveBeenCalledWith('Reviewed safety requirements');
  } finally { await act(async () => root.unmount()); host.remove(); }
});

test('confirmation dialogs can keep their non-form behavior', async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div'); document.body.appendChild(host);
  const root = createRoot(host), cancel = jest.fn();
  try {
    await act(async () => root.render(<DesignDialogForm as="div" footer={<button onClick={cancel}>Cancel</button>}><p>Remove this document?</p></DesignDialogForm>));
    expect(host.querySelector('form')).toBeNull();
    await act(async () => host.querySelector('.design-dialog-footer button').click()); expect(cancel).toHaveBeenCalledTimes(1);
  } finally { await act(async () => root.unmount()); host.remove(); }
});
