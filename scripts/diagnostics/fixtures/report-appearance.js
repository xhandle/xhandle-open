// Only injected by the disposable Electron test. Never a production entry.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { captureReportDiagramImages } from '../../../src/components/utils/captureReportDiagramImages';
import { fullDiagramBounds } from '../../../src/components/utils/captureFullDiagram';
import { saveGeneratedReport, readGeneratedReport, listGeneratedReports } from '../../../src/features/project-hazard-analysis/generatedReportStorage';
import ArchitectureReportViewer from '../../../src/components/ArchitectureReportViewer';
import { themePreference } from '../../../src/theme/themePreference';

let mounted;
window.reportAppearance = {
  captureReportDiagramImages, fullDiagramBounds, saveGeneratedReport, readGeneratedReport, listGeneratedReports,
  setMode(mode) {
    themePreference.setPreference(mode);
    // Notify the separately bundled app controller, as another window would.
    dispatchEvent(new StorageEvent('storage', { key: 'xhandle.darkMode', newValue: mode }));
  },
  mountArchitecture(report) {
    const host = document.createElement('section'); host.id = 'report-appearance-viewer';
    Object.assign(host.style, {position:'fixed', inset:'0', zIndex:'100000', background:'var(--bg)', overflow:'auto'});
    document.body.append(host); const root = createRoot(host); mounted = { host, root };
    root.render(<ArchitectureReportViewer report={report} repoName="Synthetic snapshot" onRegenerate={() => { throw Error('Theme changes must not regenerate reports'); }} />);
  },
  unmount() { mounted?.root.unmount(); mounted?.host.remove(); mounted = null; },
};
