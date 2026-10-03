export function promptDisplayText(message) {
  return String(message?.promptText ?? message?.content ?? '');
}

export function revisePromptMessage(message, text) {
  if (typeof message?.promptText !== 'string') return { ...message, content: text };
  const attachmentContent = String(message.content || '').slice(0, message.attachmentContentLength || 0);
  return {
    ...message,
    promptText: text,
    content: [attachmentContent, text.trim()].filter(Boolean).join('\n\n'),
  };
}
