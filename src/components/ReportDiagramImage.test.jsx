import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import ReportDiagramImage from './ReportDiagramImage';
import { themePreference } from '../theme/themePreference';
import { normalizeReportImages } from './utils/reportDiagramImages';

const images = { light: 'data:image/png;base64,bGlnaHQ=', dark: 'data:image/png;base64,ZGFyaw==' };
let root, container;
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.append(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); delete global.IS_REACT_ACT_ENVIRONMENT; });

test.each(['light', 'dark'])('a report captured in %s switches in both directions without replacing its snapshot', initial => {
  const frozen = Object.freeze({ ...images });
  act(() => { themePreference.setPreference(initial); root.render(<ReportDiagramImage src={frozen[initial]} images={frozen} alt="Saved architecture" />); });
  expect(container.querySelector('img').getAttribute('src')).toBe(images[initial]);
  const next = initial === 'dark' ? 'light' : 'dark';
  act(() => themePreference.setPreference(next));
  expect(container.querySelector('img').getAttribute('src')).toBe(images[next]);
  act(() => themePreference.setPreference(initial));
  expect(container.querySelector('img').getAttribute('src')).toBe(images[initial]);
  expect(container.querySelector('source[media="print"]').getAttribute('srcset')).toBe(images.light);
  expect(frozen).toEqual(images);
});

test('legacy images and unrelated illustrations keep their exact original pixels', () => {
  for (const [src, pair] of [[images.dark, null], ['illustration.png', images]]) {
    act(() => { themePreference.setPreference('light'); root.render(<ReportDiagramImage src={src} images={pair} />); });
    act(() => themePreference.setPreference('dark'));
    expect(container.querySelector('img').getAttribute('src')).toBe(src);
    expect(container.querySelector('picture')).toBeNull();
  }
});

test.each([null, { light: images.light }, { light: 'javascript:alert(1)', dark: images.dark }, { light: 'data:image/svg+xml;base64,PHN2Zz4=', dark: images.dark }])('rejects incomplete or active-content variants: %j', value => {
  expect(normalizeReportImages(value)).toBeNull();
});
