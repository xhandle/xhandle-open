// A failed row must not cancel independent work. Explicit cancellation and
// account/configuration failures are exceptions: repeatedly spending requests
// cannot repair those. Programming errors must also remain visible.
export function canDeferHazardFailure(error,signal) {
 if(signal?.aborted || error?.name==='AbortError')return false;
 const status=Number(error?.status || error?.response?.status || error?.message?.match(/LLM proxy error \((\d+)\)/)?.[1]);
 if([401,402,403,404,429].includes(status))return false;
 if(['ReferenceError','RangeError'].includes(error?.name))return false;
 if(error?.name==='TypeError' && !/fetch|load failed|network/i.test(error.message))return false;
 return true;
}
