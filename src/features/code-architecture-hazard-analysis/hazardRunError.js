// Browser/IndexedDB DOMExceptions have read-only properties (including code).
// Recovery metadata belongs to an application-owned error, not the native one.
export function hazardRunError(cause, fallbackCode='COMPACT_HAZARD_INTERRUPTED') {
  const error=new Error(cause?.message || String(cause || 'Hazard analysis interrupted.'));
  error.name=cause?.name || 'Error';
  error.cause=cause;
  error.code=typeof cause?.code==='string' && cause.code ? cause.code : fallbackCode;
  return error;
}
