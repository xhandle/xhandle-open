// components/utils/exportUtils.js
import { saveAs } from "file-saver";
import { jsPDF } from "jspdf";
import { Document, Packer, Paragraph, TextRun } from "docx";

export async function exportReport(text, type) {
  if (!text) return;

  if (type === "pdf") {
    const doc = new jsPDF();
    doc.setFont("Times", "Normal");
    doc.setFontSize(12);
    doc.text(text, 10, 10, { maxWidth: 180 });
    doc.save("Safety_Report.pdf");
  }

  else if (type === "word") {
    const doc = new Document({
      sections: [{
        children: text.split("\n").map(line =>
          new Paragraph({ children: [new TextRun(line)] })
        ),
      }],
    });
    const blob = await Packer.toBlob(doc);
    saveAs(blob, "Safety_Report.docx");
  }

  else if (type === "gdocs") {
    const markdownFormatted = text
      .replace(/^## (.*?)$/gm, '### $1')
      .replace(/^# (.*?)$/gm, '## $1')
      .replace(/\*\*(.*?)\*\*/g, '**$1**') // already fine
      .replace(/- /g, '- ') // for bullets
      .replace(/\n{2,}/g, '\n\n'); // preserve spacing
  
    await navigator.clipboard.writeText(markdownFormatted);
    const win = window.open("https://docs.google.com/document/u/0/create", "_blank");
    if (!win) alert("Please enable pop-ups to paste into Google Docs.");
    else alert("Markdown copied to clipboard. Paste it and enable 'auto-detect markdown' in Docs.");
  }  
}
