import { HAZARD_TRACKING_TABLE_COLUMNS } from './hazardTrackingFields';
import { consolidateHazardRows, hazardGroupValues } from './consolidateHazardRows';

export function hazardTrackingExportRows(objects) {
  return consolidateHazardRows(objects).map(group => HAZARD_TRACKING_TABLE_COLUMNS.map(column => hazardGroupValues(group, column).map(value => value || '—').join('\n\n')));
}
export function hazardTrackingMarkdown(meta, revision) {
  const cell = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\|/g, '&#124;').replace(/\r?\n/g, '<br>');
  return [`# ${meta.title}`, `Revision ${revision.number} · Hazard Tracking List`, '', ...[HAZARD_TRACKING_TABLE_COLUMNS, HAZARD_TRACKING_TABLE_COLUMNS.map(() => '---'), ...hazardTrackingExportRows(revision.objects)].map(row => `| ${row.map(cell).join(' | ')} |`)].join('\n');
}
export function hazardTrackingCSV(objects) {
  return '\uFEFF' + [HAZARD_TRACKING_TABLE_COLUMNS, ...hazardTrackingExportRows(objects)].map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\r\n');
}
export async function hazardTrackingWord(meta, revision) {
  const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, PageOrientation } = await import('docx');
  const rows = [HAZARD_TRACKING_TABLE_COLUMNS, ...hazardTrackingExportRows(revision.objects)];
  const table = new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: rows.map((row, index) => new TableRow({ tableHeader: index === 0, children: row.map(value => new TableCell({ children: String(value).split('\n').map(text => new Paragraph({ children: [new TextRun({ text, bold: index === 0, size: 14 })] })) })) })) });
  return Packer.toBlob(new Document({ sections: [{ properties: { page: { size: { orientation: PageOrientation.LANDSCAPE, width: 16838, height: 11906 }, margin: { top: 567, bottom: 567, left: 567, right: 567 } } }, children: [new Paragraph(meta.title), new Paragraph(`Revision ${revision.number}`), table] }] }));
}
export async function hazardTrackingPDF(meta, revision) {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ orientation: 'landscape', format: 'a3' });
  const margin = 10, bottom = pdf.internal.pageSize.getHeight() - margin, width = (pdf.internal.pageSize.getWidth() - margin * 2) / HAZARD_TRACKING_TABLE_COLUMNS.length, lineHeight = 3;
  let y;
  const draw = (cells, height) => {
    cells.forEach((lines, index) => { const x = margin + index * width; pdf.rect(x, y, width, height); if (lines.length) pdf.text(lines, x + 1, y + 3); });
    y += height;
  };
  const header = () => {
    y = 10; pdf.setFontSize(12); pdf.text(`${meta.title} — Revision ${revision.number}`, margin, y + 4); y += 10;
    pdf.setFontSize(7);
    const cells = HAZARD_TRACKING_TABLE_COLUMNS.map(value => pdf.splitTextToSize(value, width - 2));
    draw(cells, Math.max(...cells.map(lines => lines.length)) * lineHeight + 3);
  };
  header();
  for (const row of hazardTrackingExportRows(revision.objects)) {
    const cells = row.map(value => pdf.splitTextToSize(value, width - 2)), total = Math.max(...cells.map(lines => lines.length));
    let offset = 0;
    while (offset < total) {
      if (bottom - y < lineHeight + 3) { pdf.addPage(); header(); }
      const count = Math.min(total - offset, Math.floor((bottom - y - 3) / lineHeight));
      const from = offset;
      draw(cells.map(lines => lines.slice(from, from + count)), count * lineHeight + 3);
      offset += count;
    }
  }
  return pdf.output('blob');
}
