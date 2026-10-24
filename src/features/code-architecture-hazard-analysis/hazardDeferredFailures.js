const providerStatus=error=>Number(error?.status || error?.response?.status || error?.message?.match(/LLM proxy error \((\d+)\)/)?.[1]);
const programmingFailure=error=>['ReferenceError','RangeError'].includes(error?.name) ||
 (error?.name==='TypeError' && !/fetch|load failed|network/i.test(error.message));

// Provider fallback is allowed only when the failure itself can be completed
// with explicit assumptions. Status metadata must not disguise a fatal error.
export function canCompleteHazardWithAssumptions(error,signal) {
 return !signal?.aborted && error?.name!=='AbortError' &&
  error?.code!=='HAZARD_EVIDENCE_STORAGE_UNAVAILABLE' && !programmingFailure(error) &&
  [401,402,403,404,429].includes(providerStatus(error));
}

// A failed row must not cancel independent work. Explicit cancellation and
// account/configuration failures are exceptions: repeatedly spending requests
// cannot repair those. Programming errors must also remain visible.
export function canDeferHazardFailure(error,signal) {
 if(signal?.aborted || error?.name==='AbortError')return false;
 // A storage outage is not evidence uncertainty. Preserve partial work and
 // require recovery instead of substituting assumption-based assessments.
 if(error?.code==='HAZARD_EVIDENCE_STORAGE_UNAVAILABLE')return false;
 if([401,402,403,404,429].includes(providerStatus(error)))return false;
 if(programmingFailure(error))return false;
 return true;
}

// Concurrent workers can fail for different reasons. A budget/account failure
// must never hide missing required evidence and trigger assumption completion.
// Preserve the original object (including its cause); do not mutate DOMExceptions.
export function preferredHazardFailure(current,incoming) {
 const priority=error=>error?.name==='AbortError'?5:
  error?.code==='HAZARD_EVIDENCE_STORAGE_UNAVAILABLE'?4:
  canCompleteHazardWithAssumptions(error)?2:
  !canDeferHazardFailure(error)?3:1;
 if(!current)return incoming;
 return incoming && priority(incoming)>priority(current)?incoming:current;
}
