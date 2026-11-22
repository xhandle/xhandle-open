// Deliberately small arithmetic grammar. Never eval/compile supplied source.
const number = '(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?';
const numeric = new RegExp(`^${number}$`);
const cache = new WeakMap();
const strings = value => typeof value === 'string' ? [value] : value && typeof value === 'object' ? Object.values(value).flatMap(strings) : [];

export function evaluateSourceArithmetic(expression, variables = {}) {
  const input = String(expression).replace(/×/g, '*').replace(/÷/g, '/').replace(/²/g, '**2');
  if (input.length > 512) return null;
  const tokens = input.match(new RegExp(`${number}|[A-Za-z_]\\w*|\\*\\*|[()+*/-]|\\S`, 'g')) || [];
  let index = 0, depth = 0;
  const atom = () => {
    if (++depth > 32) throw Error('Expression too deep');
    const token = tokens[index++];
    let result;
    if (token === '(') { result = sum(); if (tokens[index++] !== ')') throw Error('Missing parenthesis'); }
    else if (numeric.test(token || '')) result = Number(token);
    else if (Object.prototype.hasOwnProperty.call(variables, token) && typeof variables[token] === 'number') result = variables[token];
    else throw Error('Unsupported expression');
    depth--; return result;
  };
  const power = () => { const left = atom(); if (tokens[index] !== '**') return left; index++; return left ** unary(); };
  const unary = () => {
    if (++depth > 32) throw Error('Expression too deep');
    const sign = tokens[index];
    let result;
    if (sign === '+' || sign === '-') { index++; result = (sign === '-' ? -1 : 1) * unary(); }
    else result = power();
    depth--; return result;
  };
  const product = () => {
    let value = unary();
    while (tokens[index] === '*' || tokens[index] === '/') { const op = tokens[index++], right = unary(); value = op === '*' ? value * right : value / right; }
    return value;
  };
  const sum = () => {
    let value = product();
    while (tokens[index] === '+' || tokens[index] === '-') { const op = tokens[index++], right = product(); value = op === '+' ? value + right : value - right; }
    return value;
  };
  try { const result = sum(); return index === tokens.length && Number.isFinite(result) ? result : null; }
  catch { return null; }
}

export function sourceArithmeticFacts(source) {
  const evidence = source?.evidence;
  if (!evidence || typeof evidence !== 'object') return {functions: [], constants: []};
  if (cache.has(evidence)) return cache.get(evidence);
  const functions = new Map(), constants = new Map();
  for (const content of new Set(strings(evidence))) {
    for (const match of content.matchAll(new RegExp(`^([A-Z][A-Z_0-9]*)\\s*(?::[^=\\n]+)?=\\s*([+-]?${number})\\s*(?:#.*)?$`, 'gm'))) {
      const key = `${match[1]}:${match[2]}`;
      constants.set(key, {name: match[1], value: Number(match[2]), quote: match[0]});
    }
    const definition = /^def ([A-Za-z_]\w*)\(\s*([A-Za-z_]\w*)\s*\)\s*:\s*\n((?:(?:[ \t]+[^\n]*|)\n?)*)/gm;
    for (const match of content.matchAll(definition)) {
      const body = match[3].replace(/^\s*(?:"""[\s\S]*?"""|'''[\s\S]*?''')\s*/, '').trim();
      const returned = /^return ([^\n#]+)(?:\s*#.*)?$/.exec(body);
      if (!returned || evaluateSourceArithmetic(returned[1], {[match[2]]: 1}) === null) continue;
      const fact = {name: match[1], parameter: match[2], expression: returned[1].trim(), quote: match[0].trim()};
      functions.set(JSON.stringify([fact.name, fact.parameter, fact.expression]), fact);
    }
  }
  const result = {functions: [...functions.values()], constants: [...constants.values()]};
  cache.set(evidence, result); return result;
}

export function sourceArithmeticAnchors(sources) {
  const facts = new Map();
  for (const source of sources) {
    const found = sourceArithmeticFacts(source);
    for (const fact of found.functions) {
      const values = [0, 1, 2].map(input => ({input, result: evaluateSourceArithmetic(fact.expression, {[fact.parameter]: input})}));
      facts.set(JSON.stringify(fact), {...fact, examples: values});
    }
    for (const fact of found.constants) facts.set(JSON.stringify(fact), fact);
  }
  return [...facts.values()];
}

export function validateSourceArithmetic(row, source) {
  const errors = [], facts = sourceArithmeticFacts(source);
  const equal = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  for (const field of ['causalScenario', 'softwareRequirement', 'verification']) {
    const prose = String(row[field] || '');
    // Literal equations are mathematics even inside a hypothetical scenario.
    // Require a real binary operation so numbered steps/assignments are ignored.
    const equations = new RegExp(`(?<![\\w.])([0-9.eE()+*/×÷² \\t-]{3,256})\\s*=\\s*([+-]?${number})`, 'g');
    for (const match of prose.matchAll(equations)) {
      if (!new RegExp(`${number}\\s*(?:[+*/×÷-]|\\*\\*|²)`).test(match[1])) continue;
      const calculated = evaluateSourceArithmetic(match[1]);
      if (calculated !== null && !equal(calculated, Number(match[2]))) errors.push(`${field}: arithmetic ${match[1].trim()} equals ${calculated}, not ${match[2]}; correct the numerical scenario and its expected result.`);
    }
    for (const fact of facts.functions) {
      const pattern = new RegExp(`\\b${fact.name}\\(\\s*([+-]?${number})\\s*\\)\\s*(?:=|equals)\\s*([+-]?${number})`, 'g');
      for (const match of prose.matchAll(pattern)) {
        // Explicit fault injection/proposed replacements are not claims about
        // the existing pure function. Leave their semantics to engineering review.
        if (/(?:mock|stub|override|replace|mutate|proposed|assum\w*|hypothes\w*|inject\w*)[^.;\n]{0,100}$/i.test(prose.slice(Math.max(0, match.index - 100), match.index))) continue;
        const expected = evaluateSourceArithmetic(fact.expression, {[fact.parameter]: Number(match[1])});
        const variants = facts.functions.filter(value => value.name === fact.name);
        if (new Set(variants.map(value => value.expression)).size > 1) continue; // ambiguous snapshots
        if (expected !== null && !equal(expected, Number(match[2]))) errors.push(`${field}: ${fact.name}(${match[1]}) evaluates to ${expected} in supplied source, not ${match[2]}; preserve the source calculation or identify an explicit injected/proposed replacement.`);
      }
    }
    for (const fact of facts.constants) {
      const variants = facts.constants.filter(value => value.name === fact.name);
      if (new Set(variants.map(value => value.value)).size > 1) continue;
      const pattern = new RegExp(`\\b${fact.name}\\s*=\\s*([+-]?${number})`, 'g');
      for (const match of prose.matchAll(pattern)) {
        if (/\b(?:proposed|override|mock|stub|replace)\b/i.test(prose.slice(Math.max(0, match.index - 100), match.index))) continue;
        if (!equal(fact.value, Number(match[1]))) errors.push(`${field}: supplied ${fact.name} is ${fact.value}, not ${match[1]}; keep source thresholds distinct from proposed values and test stimuli.`);
      }
    }
  }
  return [...new Set(errors)];
}
