import React from 'react';

// The browser owns the draft while focused. Plain text wraps naturally and does
// not require thousands of textarea instances or layout reads on each keypress.
export default React.memo(function InlineHazardText({ value, label, readOnly, onFocus, onCommit }) {
  return <div
    className="min-h-[30px] min-w-0 flex-1 whitespace-pre-wrap break-words bg-transparent text-xs leading-4 text-gray-900 [overflow-wrap:anywhere] outline-none"
    contentEditable={readOnly ? undefined : 'plaintext-only'}
    suppressContentEditableWarning
    role="textbox"
    aria-readonly={readOnly || undefined}
    aria-multiline="true"
    aria-label={label}
    onFocus={onFocus}
    onBlur={async event => {
      if (readOnly) return;
      const element = event.currentTarget;
      const next = element.innerText ?? element.textContent ?? '';
      if (next === String(value ?? '')) return;
      try { await onCommit(next); }
      catch (error) {
        window.alert(`Your edit could not be saved: ${error.message}. The edited text is still in the cell; click it and leave it to retry.`);
      }
    }}
    onKeyDown={event => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.currentTarget.textContent = String(value ?? '');
      event.currentTarget.blur();
    }}
  >{value}</div>;
});
