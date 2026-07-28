import React from "react";
import { contentToText } from "./reviewUtils";

export default function ReviewDiffViewer({ originalContent, currentContent }) {
  const originalText = contentToText(originalContent);
  const currentText = contentToText(currentContent);
  const changed = originalText !== currentText;

  return (
    <div className="space-y-3">
      <div>
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Original AI Output</div>
        <pre className="max-h-52 overflow-auto whitespace-pre-wrap rounded-md border border-gray-200 bg-gray-50 p-3 text-xs leading-5 text-gray-700">
          {originalText || "No original content captured."}
        </pre>
      </div>
      {changed && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Current content differs from the original AI output. The original is preserved for audit history.
        </div>
      )}
    </div>
  );
}
