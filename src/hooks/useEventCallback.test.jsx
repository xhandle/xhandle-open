import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import useEventCallback from './useEventCallback';

test('memoized controls invoke the latest committed project data without rerendering', () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div'); document.body.appendChild(host);
  const root = createRoot(host);
  const observed = jest.fn(), rendered = jest.fn();
  const Control = React.memo(({ onClick }) => { rendered(); return <button onClick={onClick}>Save</button>; });
  function Parent({ project }) {
    const save = useEventCallback(() => observed(project));
    return <Control onClick={save} />;
  }
  act(() => root.render(<Parent project="first" />));
  act(() => root.render(<Parent project="current" />));
  act(() => host.querySelector('button').click());
  expect(rendered).toHaveBeenCalledTimes(1);
  expect(observed).toHaveBeenCalledWith('current');
  act(() => root.unmount()); host.remove();
});
