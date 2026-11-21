// Accept provider presentation wrappers, without repairing malformed/truncated
// JSON or choosing between multiple answers. Callers still validate the schema,
// source citations and coverage before accepting any proposed relationships.
export default function parseCodeAnalysisJson(value) {
  if (typeof value !== 'string') return value;
  const raw = value.trim();
  try { return JSON.parse(raw); } catch {}
  const blocks = [...raw.matchAll(/^[ \t]*(`{3,}|~{3,})(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*\1[ \t]*(?=\r?\n|$)/gim)];
  let candidate;
  if (blocks.length === 1) {
    const block = blocks[0];
    const outside = raw.slice(0, block.index) + '\n' + raw.slice(block.index + block[0].length);
    if (!/^[ \t]*(?:`{3,}|~{3,})/m.test(outside)) candidate = block[2];
  } else if (!blocks.length) {
    // Preserve compact, single-line fenced replies too.
    candidate = raw.match(/^(`{3,}|~{3,})(?:json)?[ \t]*([^\r\n]*?)\1$/i)?.[2];
  }
  if (candidate !== undefined) {
    try { return JSON.parse(candidate); } catch {}
  }
  throw new SyntaxError('The model response did not contain one complete valid JSON value. Retry the unfinished analysis.');
}
