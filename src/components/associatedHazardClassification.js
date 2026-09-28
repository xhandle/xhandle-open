// Use governed decisions first; older exports may only carry significance or
// the retired proposed-assessment column. Never infer Safety from missing data.
export function classifyAssociatedHazard(headers, cells = []) {
  const value = name => String(cells[headers.findIndex(h => String(h).trim().toLowerCase() === name)] ?? '').trim().toLowerCase();
  const applicable = value('guide phrase applicable');
  const classification = value('safety classification');
  if (applicable === 'no' || applicable === 'not applicable' || classification === 'not applicable') return 'Not Applicable';
  if (applicable === 'needs review') return 'Needs Review';
  const decision = classification || value('safety significant') || value('proposed safety assessment');
  if (/^needs review$|^unknown$|^uncertain$/.test(decision)) return 'Needs Review';
  if (/^mission\s*\/\s*reliability$/.test(decision) || decision === 'no') return 'Mission/Reliability';
  if (decision === 'yes' || /^safety(?:$|\s*[—–-]\s*(?:direct|related)$|[ -]critical$| significant$)/.test(decision)) return 'Safety';
  return 'Needs Review';
}
