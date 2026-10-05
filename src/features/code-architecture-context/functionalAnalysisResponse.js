import { FUNCTIONAL_REQUEST_TIMEOUT_MS, FUNCTIONAL_OUTPUT_TOKENS, FUNCTIONAL_MAX_OUTPUT_TOKENS } from './functionalAnalysisPolicy';
// Model responses are data. Parse the table without mistaking pipes in code or
// escaped Markdown for column separators, and never silently discard bad rows.
export function incompleteResponse(message, code = 'FUNCTIONAL_RESPONSE_FORMAT') {
  return Object.assign(new Error(message), { code });
}
function cells(line) {
  const output = [];
  let cell = '', ticks = 0;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '\\' && line[i + 1] === '|') { cell += '|'; i++; continue; }
    if (char === '`') {
      let end = i;
      while (line[end] === '`') end++;
      const count = end - i;
      if (!ticks) ticks = count;
      else if (ticks === count) ticks = 0;
      cell += line.slice(i, end); i = end - 1; continue;
    }
    if (char === '|' && !ticks) { output.push(cell.trim()); cell = ''; }
    else cell += char;
  }
  output.push(cell.trim());
  if (line.trimStart().startsWith('|')) output.shift();
  if (line.trimEnd().endsWith('|') && !ticks && output[output.length - 1] === '') output.pop();
  return output;
}
const headers = ['Function (From)', 'Function (From) Related File(s)', 'Function (From) Details', 'Control Action', 'Control Action Details', 'Function (To)', 'Function (To) Related File(s)', 'Function (To) Details'];
const normalize = value => value.replace(/[*`]/g, '').trim().toLowerCase();
export function parseFunctionalAnalysisTable(text) {
  const lines = String(text || '').split(/\r?\n/);
  const headerIndex = lines.findIndex(line => {
    const values = cells(line).map(normalize);
    return values.length === 8 && headers.every(header => values.includes(normalize(header)));
  });
  if (headerIndex < 0) throw incompleteResponse('The model response did not contain the expected eight-column functional table.');
  const columns = cells(lines[headerIndex]).map(normalize);
  const separator = cells(lines[headerIndex + 1] || '');
  if (separator.length !== 8 || !separator.every(value => /^:?-{3,}:?$/.test(value))) throw incompleteResponse('The functional table header was incomplete.');
  const result = [];
  for (const line of lines.slice(headerIndex + 2)) {
    if (!line.trim() || /^\s*```/.test(line)) continue;
    const values = cells(line);
    if (values.length === 8 && values.every(value => /^:?-{3,}:?$/.test(value))) continue;
    if (values.map(normalize).join('|') === columns.join('|')) continue;
    if (!line.includes('|')) throw incompleteResponse('The functional table contains an incomplete row or unexpected prose.');
    if (values.length !== 8) throw incompleteResponse(`The functional table contains a row with ${values.length} columns; expected eight.`);
    const ordered = headers.map(header => values[columns.indexOf(normalize(header))]);
    const [from, fromFile, fromDetails, action, controlActionDetails, to, toFile, toDetails] = ordered;
    if (!from || !fromFile || !action || !to || !toFile) throw incompleteResponse('The functional table contains an unfinished relationship.');
    result.push({from, fromFile, fromDetails, action, controlActionDetails, to, toFile, toDetails});
  }
  return result;
}

export function throwIfAnalysisAborted(signal) {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('Analysis cancelled.');
}
export function waitForAnalysisRetry(ms, signal) {
  throwIfAnalysisAborted(signal);
  return new Promise((resolve, reject) => {
    const finish = () => { signal?.removeEventListener('abort', abort); resolve(); };
    const timer = setTimeout(finish, ms);
    const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(signal.reason instanceof Error ? signal.reason : new Error('Analysis cancelled.')); };
    signal?.addEventListener('abort', abort, {once:true});
  });
}
export function retryAfterMilliseconds(value, now = Date.now()) {
  if (!value) return 0;
  const numeric = Number(value);
  const ms = Number.isFinite(numeric) ? numeric * 1000 : Date.parse(value) - now;
  return Number.isFinite(ms) ? Math.max(0, Math.min(60000, ms)) : 0;
}
export async function withAnalysisRequestDeadline(request, parentSignal, timeoutMs = FUNCTIONAL_REQUEST_TIMEOUT_MS) {
  throwIfAnalysisAborted(parentSignal);
  const controller = new AbortController();
  let timer, abort;
  const cancelled = new Promise((_, reject) => {
    abort = () => {
      const error = parentSignal.reason instanceof Error ? parentSignal.reason : new Error('Analysis cancelled.');
      controller.abort(error); reject(error);
    };
    parentSignal?.addEventListener('abort', abort, {once:true});
    timer = setTimeout(() => {
      const error = Object.assign(new Error('The analysis request timed out.'), {code:'FUNCTIONAL_REQUEST_TIMEOUT',retryable:true});
      controller.abort(error); reject(error);
    }, timeoutMs);
  });
  try { return await Promise.race([Promise.resolve().then(() => request(controller.signal)), cancelled]); }
  finally { clearTimeout(timer); parentSignal?.removeEventListener('abort', abort); }
}
function splitPosition(content, start, end) {
  const mid = start + Math.floor((end - start) / 2);
  // Prefer a nearby line boundary without allowing a very long line to prevent subdivision.
  const next = content.indexOf('\n', mid);
  return next >= mid && next < end - (end - start) / 4 ? next + 1 : mid;
}

// A shared three-request budget cannot complete nested splits. Each section now
// has its own retries, with a finite tree/request bound across automatic passes.
// State stores only completed leaf outputs and counters, never partial responses.
export async function analyzeFunctionalSourceChunk({ content, request, signal, onRetry, state = {}, onCheckpoint,
  policy = {}, wait = waitForAnalysisRetry }) {
  const limits = {maxDepth:5, minChars:256, maxRequests:128, attempts:3, timeoutMs:FUNCTIONAL_REQUEST_TIMEOUT_MS, initialTokens:FUNCTIONAL_OUTPUT_TOKENS, maxTokens:FUNCTIONAL_MAX_OUTPUT_TOKENS, ...policy};
  state.completed ||= {};
  state.splits ||= {};
  state.requests ||= 0;
  async function analyze(start, end, depth, tokenBudget = limits.initialTokens) {
    throwIfAnalysisAborted(signal);
    const key = `${start}:${end}`;
    if (state.completed[key]) return state.completed[key];
    if (state.splits[key] !== undefined) {
      const mid = state.splits[key];
      return [...await analyze(start,mid,depth+1,limits.maxTokens), ...await analyze(mid,end,depth+1,limits.maxTokens)];
    }
    let lastError;
    for (let attempt = 0; attempt < limits.attempts; attempt++) {
      throwIfAnalysisAborted(signal);
      if (state.requests >= limits.maxRequests) throw Object.assign(new Error('Automatic recovery reached its request limit without completing this source section.'), {code:'FUNCTIONAL_RECOVERY_EXHAUSTED',retryable:false});
      state.requests++;
      let rows;
      const requestTokens = tokenBudget;
      try {
        rows = parseFunctionalAnalysisTable(await withAnalysisRequestDeadline(requestSignal => request(content.slice(start,end), depth > 0 || attempt > 0, {
          signal:requestSignal, start, end, maxTokens:requestTokens,
          contextBefore:content.slice(Math.max(0,start-400),start),
          contextAfter:content.slice(end,Math.min(content.length,end+400)),
        }), signal, limits.timeoutMs));
      } catch (error) {
        throwIfAnalysisAborted(signal);
        const format = error.code === 'FUNCTIONAL_RESPONSE_FORMAT';
        const truncated = error.code === 'FUNCTIONAL_RESPONSE_TRUNCATED';
        const timedOut = error.code === 'FUNCTIONAL_REQUEST_TIMEOUT';
        if (!(format || truncated || timedOut || error.retryable || error instanceof TypeError)) throw error;
        lastError = error;
        if (truncated && tokenBudget < limits.maxTokens && attempt + 1 < limits.attempts) {
          tokenBudget = Math.min(limits.maxTokens, tokenBudget * 2);
          onRetry?.('Automatically increasing response capacity to finish this source section.');
          continue;
        }
        const canSplit = depth < limits.maxDepth && end - start > limits.minChars;
        if (canSplit && (truncated || ((format || timedOut) && attempt >= 1))) {
          onRetry?.('Automatically analyzing smaller source sections; all sections remain required.');
          const mid = splitPosition(content,start,end);
          state.splits[key] = mid;
          const first = await analyze(start,mid,depth+1,tokenBudget);
          const second = await analyze(mid,end,depth+1,tokenBudget);
          return [...first,...second];
        }
        if (attempt + 1 < limits.attempts) {
          const delay = Math.max(Math.min(1000 * (2 ** attempt), 8000), Math.min(60000, error.retryAfterMs || 0));
          onRetry?.(`Automatically retrying this section in ${Math.ceil(delay/1000)} seconds (${attempt+2}/${limits.attempts}).`);
          await wait(delay,signal);
        }
        continue;
      }
      throwIfAnalysisAborted(signal);
      state.completed[key] = rows;
      // Persistence failure must never be mistaken for a retryable model failure.
      await onCheckpoint?.();
      return rows;
    }
    throw Object.assign(lastError || new Error('Source section could not be analyzed.'), {retryable:true});
  }
  return analyze(0,content.length,0);
}

// Used for source preflight/reads as well as model responses. Permanent access,
// integrity and configuration errors are not made retryable by this wrapper.
export async function retryAnalysisOperation(request, {signal, onRetry, wait = waitForAnalysisRetry, timeoutMs = FUNCTIONAL_REQUEST_TIMEOUT_MS} = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await withAnalysisRequestDeadline(request,signal,timeoutMs); }
    catch (error) {
      throwIfAnalysisAborted(signal);
      if (attempt === 2 || !(error.retryable || error instanceof TypeError)) throw error;
      const delay = Math.max(1000 * (2 ** attempt), Math.min(60000,error.retryAfterMs || 0));
      onRetry?.(`Automatically retrying source access in ${Math.ceil(delay/1000)} seconds.`);
      await wait(delay,signal);
    }
  }
}
