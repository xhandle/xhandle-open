import { defaultUrlTransform } from 'react-markdown';
import { isReportRaster } from './reportDiagramImages';

export function reportUrlTransform(url, key, node) {
  if (key === 'src' && node.tagName === 'img' && isReportRaster(url)) return url;
  return defaultUrlTransform(url);
}
