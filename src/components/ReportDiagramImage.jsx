import React, { useMemo } from 'react';
import { useDarkMode } from '../hooks/useDarkMode';
import { normalizeReportImages } from './utils/reportDiagramImages';

// Both variants belong to the saved report revision, never the live project.
export default function ReportDiagramImage({ src, images, original, alt = '', ...props }) {
  const { mode } = useDarkMode();
  // Base64 snapshots can be large. Validate once per saved pair, rather than
  // rescanning both images while the user edits report review comments.
  const pair = useMemo(() => normalizeReportImages(images), [images]);
  const matches = pair && [original || pair.light, pair.light, pair.dark].includes(src);
  const selected = matches ? pair[mode === 'dark' ? 'dark' : 'light'] : src;
  const image = <img {...props} src={selected} alt={alt} />;
  return matches
    ? <picture style={{ display: 'contents' }}><source media="print" srcSet={pair.light} />{image}</picture> : image;
}
