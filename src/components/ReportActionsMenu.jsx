import RenameReportDialog from './RenameReportDialog';
import React, { useEffect, useId, useState } from 'react';
import ArtifactActionsPopover from '../features/design-management/artifacts/ArtifactActionsPopover';
import { Gate } from '../license/LicenseContext';
import './reportActionsMenu.css';

export default function ReportActionsMenu({ reportType, reportTypes, onReportTypeChange,
  onGenerate, generating, canGenerate, canExport, onExport, selectedReport, onDelete, onRename, projectId, selectedReportId }) {
  const typeId = useId();
  const [renameTarget, setRenameTarget] = useState(null);
  useEffect(() => { setRenameTarget(null); }, [projectId, selectedReportId]);
  return <><ArtifactActionsPopover label="Report actions" panelLabel="Report actions" compact>
    {close => <div className="report-actions-menu">
      <label htmlFor={typeId}>Report type</label>
      <select id={typeId} value={reportType} onChange={event => onReportTypeChange(event.target.value)} disabled={generating}>
        {reportTypes.map(type => <option key={type} value={type}>{type}</option>)}
      </select>
      <Gate feature="agentic_reports">
        <button type="button" className="report-actions-generate" disabled={!canGenerate || generating} onClick={() => { close(); onGenerate(); }}>
          {generating ? 'Generating Report...' : 'Generate AI Report'}
        </button>
      </Gate>
      <div className="report-actions-exports" role="group" aria-label="Report exports">
        <div className="report-actions-label">Exports</div>
        {[['pdf', 'Export Report as PDF'], ['word', 'Export Report as Word (.docx)'], ['gdocs', 'Export Report to Google Docs']].map(([format, label]) =>
          <button key={format} type="button" disabled={!canExport} onClick={() => { close(); onExport(format); }}>{label}</button>)}
      </div>
      {selectedReport && <button type="button" onClick={() => { close(); setRenameTarget(selectedReport); }}>Rename selected report</button>}
      {selectedReport && <button type="button" className="report-actions-delete" onClick={() => {
        if (window.confirm(`Delete this saved report: ${selectedReport.title}?`)) { close(); onDelete(selectedReport.id); }
      }}>Delete selected report</button>}
    </div>}
  </ArtifactActionsPopover>
    {renameTarget && <RenameReportDialog report={renameTarget} onRename={onRename} onClose={() => setRenameTarget(null)} />}
  </>;
}
