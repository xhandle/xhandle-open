export const readableLabel = value => String(value || '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/^./, c => c.toUpperCase());
export function structuredValue(value) {
  if (typeof value === 'string' && /^[[{]/.test(value.trim())) {
    try { const parsed = JSON.parse(value); if (parsed && typeof parsed === 'object') return parsed; } catch { /* Ordinary prose may start with brackets. */ }
  }
  return value;
}
export function readableValue(value) {
  value = structuredValue(value);
  if (value == null) return 'Not specified';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.length ? value.map(readableValue).join('; ') : 'None recorded';
  if (typeof value === 'object') return Object.entries(value).map(([key, item]) => `${readableLabel(key)}: ${readableValue(item)}`).join('\n') || 'No details recorded';
  return String(value);
}
