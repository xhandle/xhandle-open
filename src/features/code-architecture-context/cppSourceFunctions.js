// A lightweight lexical index, not a C++ compiler. Each token/delimiter is
// visited a bounded number of times; never match a whole file with a signature regex.
function tokenize(source) {
  const tokens = [];
  let i = 0, line = 1;
  const advance = end => { while (i < end) { if (source[i++] === '\n') line++; } };
  while (i < source.length) {
    const ch = source[i];
    if (/\s/.test(ch)) { advance(i + 1); continue; }
    if (source.startsWith('//', i) || ch === '#') {
      let end = i;
      do {
        end = source.indexOf('\n', end + 1);
      } while (end >= 0 && (source[end - 1] === '\\' || (source[end - 1] === '\r' && source[end - 2] === '\\')));
      advance(end < 0 ? source.length : end + 1); continue;
    }
    if (source.startsWith('/*', i)) {
      const end = source.indexOf('*/', i + 2);
      advance(end < 0 ? source.length : end + 2); continue;
    }
    const start = i, startLine = line;
    // Raw strings can contain quotes, braces and fake declarations.
    const rawPrefix = ['R"', 'u8R"', 'uR"', 'UR"', 'LR"'].find(prefix => source.startsWith(prefix, start));
    if (rawPrefix) {
      const delimiterStart = i + rawPrefix.length;
      let open = delimiterStart;
      while (open < source.length && open - delimiterStart <= 16 && source[open] !== '(' && !/\s/.test(source[open])) open++;
      if (source[open] === '(') {
        const terminator = ')' + source.slice(delimiterStart, open) + '"';
        const end = source.indexOf(terminator, open + 1);
        advance(end < 0 ? source.length : end + terminator.length);
        tokens.push({ value: 'literal', line: startLine }); continue;
      }
    }
    if (ch === '"' || ch === "'") {
      advance(i + 1);
      while (i < source.length) {
        if (source[i] === '\\') { advance(Math.min(source.length, i + 2)); continue; }
        const done = source[i] === ch; advance(i + 1); if (done) break;
      }
      tokens.push({ value: 'literal', line: startLine }); continue;
    }
    if (/[A-Za-z_0-9]/.test(ch)) {
      let end = i + 1;
      while (end < source.length && (/[A-Za-z_0-9]/.test(source[end]) ||
        (/[0-9]/.test(ch) && source[end] === "'" && /[A-Za-z_0-9]/.test(source[end + 1] || '')))) end++;
      advance(end);
    } else if (['::', '->', '&&'].includes(source.slice(i, i + 2))) advance(i + 2);
    else advance(i + 1);
    tokens.push({ value: source.slice(start, i), line: startLine });
  }
  return tokens;
}

const qualifiers = new Set(['const', 'volatile', 'noexcept', 'override', 'final', '&', '&&']);
const forbidden = new Set(['return', 'throw', 'if', 'for', 'while', 'switch', 'catch', 'sizeof', 'alignof', 'decltype', 'static_assert', 'new', 'delete', '=', '.', '->']);
const identifier = value => /^[A-Za-z_][A-Za-z_0-9]*$/.test(value || '');

export function extractCppSourceFunctions(source) {
  const tokens = tokenize(String(source || ''));
  const pairs = new Int32Array(tokens.length).fill(-1), stack = [];
  const closing = { ')': '(', ']': '[', '}': '{' };
  for (let i = 0; i < tokens.length; i++) {
    const value = tokens[i].value;
    if (['(', '[', '{'].includes(value)) stack.push(i);
    else if (closing[value]) {
      const open = stack[stack.length - 1];
      if (open !== undefined && tokens[open].value === closing[value]) {
        stack.pop(); pairs[open] = i;
      }
    }
  }
  const value = i => tokens[i]?.value;
  const ranges = [], scopes = [];
  let start = 0, signatureStart = 0, returnTypeEnd = -1;
  for (let i = 0; i < tokens.length; i++) {
    if (value(i) === 'template' && value(i + 1) === '<') {
      // Defaults and packs are declaration metadata, not assignments/member
      // access in the function prefix. Skip each template head once while
      // retaining its line in the source range.
      let depth = 1, next = i + 2, lastClose = -1, recoveryClose = -1, lambdaParameters = false;
      while (next < tokens.length && depth > 0) {
        // A relational '<' can be indistinguishable from a template opener
        // lexically. Recover at a declaration boundary, using the last '>',
        // rather than consuming unrelated bodies and the rest of the file.
        if ([';', '}'].includes(value(next)) || (value(next) === 'template' && lastClose >= 0) ||
          (value(next) === '{' && (value(next - 1) === ')' || recoveryClose >= 0) && !lambdaParameters)) {
          if (lastClose >= 0) next = (recoveryClose >= 0 ? recoveryClose : lastClose) + 1;
          break;
        }
        if (['(', '[', '{'].includes(value(next)) && pairs[next] >= 0) {
          lambdaParameters = value(next) === '(' && value(next - 1) === ']';
          next = pairs[next] + 1;
        }
        else {
          // A numeric comparison in a non-type default is not a nested
          // template argument list (e.g. template<bool B = 1 < 3>).
          if (value(next) === '<' && !/^[0-9]/.test(value(next - 1) || '')) depth++;
          if (value(next) === '>') {
            depth--; lastClose = next;
            if (recoveryClose < 0 && identifier(value(next + 1))) recoveryClose = next;
          }
          lambdaParameters = false;
          next++;
        }
      }
      i = next - 1; signatureStart = next; continue;
    }
    if (value(i) === '{') {
      const prefix = tokens.slice(Math.max(start, signatureStart), i).map(token => token.value);
      const at = Math.max(prefix.lastIndexOf('class'), prefix.lastIndexOf('struct'));
      scopes.push({ name: at >= 0 ? prefix[at + 1] : '',
        executable: at < 0 && Boolean(scopes[scopes.length - 1]?.executable) });
      start = i + 1; continue;
    }
    if (value(i) === '}') { scopes.pop(); start = i + 1; continue; }
    if (value(i) === ';') { start = i + 1; continue; }
    if (value(i) === ':' && ['public', 'private', 'protected'].includes(value(i - 1))) { start = i + 1; continue; }
    if (value(i) !== '(' || pairs[i] < 0) continue;
    if (scopes[scopes.length - 1]?.executable) {
      // Expressions are not declarations. Still visit ordinary block/class
      // braces so methods in local classes remain visible in one traversal.
      i = pairs[i]; start = i + 1; continue;
    }
    let end = pairs[i], name = value(i - 1);
    if (name === 'operator' && end === i + 1 && value(end + 1) === '(' && pairs[end + 1] >= 0) {
      name = 'operator()'; end = pairs[end + 1];
    }
    if (identifier(value(end + 1)) && value(end + 2) === '(' &&
      (name === 'decltype' || /^[A-Z_][A-Z_0-9]*$/.test(name || ''))) {
      // A parenthesized type specifier/macro followed by the actual function
      // name. Retain the original range without rescanning its tokens.
      returnTypeEnd = end; signatureStart = end + 1; i = end; continue;
    }
    const prefix = tokens.slice(Math.max(start, signatureStart), i - 1).map(token => token.value);
    const isConstructor = value(i - 2) === '::' || value(i - 2) === '~' || name === scopes[scopes.length - 1]?.name;
    const declaration = (identifier(name) || name === 'operator()') && !forbidden.has(name) && !prefix.includes('operator') &&
      !prefix.some(token => forbidden.has(token)) && (prefix.length > 0 || isConstructor || returnTypeEnd === i - 2);
    let next = end + 1;
    while (qualifiers.has(value(next))) {
      const qualifier = value(next++);
      if (qualifier === 'noexcept' && value(next) === '(' && pairs[next] >= 0) next = pairs[next] + 1;
    }
    while (value(next) === '[' && pairs[next] >= 0) next = pairs[next] + 1;
    if (value(next) === '->') {
      next++;
      while (next < tokens.length && !['{', ';', '=', '}'].includes(value(next))) {
        if (value(next) === '(' || value(next) === '[') {
          if (pairs[next] < 0) break;
          next = pairs[next] + 1;
        } else next++;
      }
    }
    if (value(next) === ':' && declaration) {
      next++;
      // Constructor initializer: qualified member/base name then (...) or {...}.
      while (next < tokens.length) {
        while (next < tokens.length && !['(', '{', ';', '}'].includes(value(next))) next++;
        if (!['(', '{'].includes(value(next)) || pairs[next] < 0) break;
        next = pairs[next] + 1;
        if (value(next) !== ',') break;
        next++;
      }
    }
    if (declaration && value(next) === '{' && pairs[next] >= 0) {
      const close = pairs[next];
      ranges.push({ functionName: (value(i - 2) === '~' ? '~' : '') + name,
        startLine: tokens[start]?.line || tokens[i - 1].line, endLine: tokens[close].line });
      scopes.push({ name: '', executable: true });
      i = next; start = next + 1;
    } else {
      // Do not repeatedly rescan a malformed declaration prefix or suffix.
      i = Math.max(end, next - 1); start = i + 1;
    }
  }
  return ranges;
}
