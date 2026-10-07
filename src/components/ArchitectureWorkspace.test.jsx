import React, { act, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArchitectureDivider, useArchitectureColumnWidths } from './ArchitectureWorkspace';
global.IS_REACT_ACT_ENVIRONMENT = true;
let host, root;
beforeEach(() => { localStorage.clear(); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
const columns = [{ id: 'from', minWidth: 150, defaultWidth: 220 }];
function Fixture({ scope = 'a', fit = () => {} }) {
  const ref = useRef(null), [percent, setPercent] = useState(50);
  const [widths, resize] = useArchitectureColumnWidths(columns, `widths:${scope}`, scope);
  return <div ref={ref}><ArchitectureDivider view="split" scope={scope} workspaceRef={ref} percent={percent} onChange={setPercent} onFit={fit} /><button onMouseDown={e => resize(e, 0)}>width:{widths.from}</button></div>;
}
const frame = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 35)); });
test('widths persist by stable column and scope, and scope switch cancels active drag', async () => {
  const render = scope => act(() => root.render(<Fixture scope={scope} />));
  render('a');
  act(() => host.querySelector('button').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 100 })));
  act(() => window.dispatchEvent(new MouseEvent('mousemove', { clientX: 200 })));
  await frame();
  expect(host.textContent).toContain('width:320');
  render('b');
  expect(document.body.style.cursor).toBe('');
  act(() => window.dispatchEvent(new MouseEvent('mousemove', { clientX: 900 })));
  await frame();
  expect(host.textContent).toContain('width:220');
  render('a'); expect(host.textContent).toContain('width:320');
});
test('keyboard clamps split width and defers fit; blur restores drag styles', async () => {
  const fit = jest.fn(); act(() => root.render(<Fixture fit={fit} />));
  const divider = host.querySelector('[role="separator"]');
  for (let i = 0; i < 8; i++) act(() => divider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
  expect(divider.getAttribute('aria-valuenow')).toBe('75');
  expect(fit).not.toHaveBeenCalled(); await frame(); expect(fit).toHaveBeenCalledTimes(1);
  act(() => host.querySelector('button').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })));
  expect(document.body.style.cursor).toBe('col-resize');
  act(() => window.dispatchEvent(new Event('blur')));
  expect(document.body.style.cursor).toBe(''); expect(document.body.style.userSelect).toBe('');
});
