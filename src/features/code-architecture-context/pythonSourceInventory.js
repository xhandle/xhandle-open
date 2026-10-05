import { parser } from '@lezer/python';
import { stableJson } from './codeAnalysisRun';

export const PYTHON_INVENTORY_VERSION = 2;
const children = node => { const out = []; for (let child = node.firstChild; child; child = child.nextSibling) out.push(child); return out; };
const isDefinition = node => node.name === 'FunctionDefinition' || node.name === 'ClassDefinition';
const ROUTINE_BUILTINS = new Set(['len', 'range', 'enumerate', 'zip', 'iter', 'next', 'isinstance', 'issubclass', 'type', 'hasattr', 'getattr', 'super']);
const RAISED_BUILTINS = new Set(['Exception', 'ValueError', 'TypeError', 'RuntimeError', 'AssertionError', 'KeyError', 'IndexError', 'NotImplementedError', 'AttributeError', 'StopIteration']);

// This is a syntax inventory, not a Python interpreter or a whole-program call graph.
// Receiver calls are recorded even when their runtime target cannot be resolved.
export function buildPythonSourceInventory(path, source) {
  if (!path.endsWith('.py')) return { version: 2, supported: false, relationships: [], limitation: 'Syntax inventory is currently available for Python only.' };
  const tree = parser.parse(source);
  const text = node => source.slice(node.from, node.to);
  const lineStarts = [0]; for (let i = 0; i < source.length; i++) if (source[i] === '\n') lineStarts.push(i + 1);
  const lineAt = offset => { let lo = 0, hi = lineStarts.length; while (lo + 1 < hi) { const mid = (lo + hi) >>> 1; if (lineStarts[mid] <= offset) lo = mid; else hi = mid; } return lo + 1; };
  const moduleScope = { name: '<module>', qualified: `${path} (module)`, kind: 'module', bindings: new Map(), line: 1 };
  const definitions = [], calls = [], errors = [], relationships = new Map(), presentationExclusions = {}, requiredCalls = new Set();
  const bind = (scope, name, value) => { if (!name) return; const entries = scope.bindings.get(name) || []; entries.push(value); scope.bindings.set(name, entries); };
  const names = node => { const out = []; function visit(n) { if (n.name === 'VariableName') out.push(text(n)); else if (n.name !== 'MemberExpression' && n.name !== 'TypeDef') children(n).forEach(visit); } visit(node); return out; };
  const dotted = node => {
    if (node.name === 'VariableName' || node.name === 'PropertyName') return text(node);
    const parts = children(node);
    if (node.name === 'MemberExpression' && parts.length === 3 && parts[1].name === '.') { const base = dotted(parts[0]); return base ? `${base}.${text(parts[2])}` : ''; }
    return '';
  };
  function registerImports(node, scope, conditional) {
    // The parser determines statement boundaries; token extraction here handles aliases
    // and parenthesized/multiline imports without interpreting strings or comments.
    const tokens = children(node).filter(n => n.name !== 'Comment' && !['(', ')'].includes(n.name));
    const importIndex = tokens.findIndex(n => n.name === 'import');
    const module = tokens[0]?.name === 'from' ? tokens.slice(1, importIndex).map(text).join('') : '';
    const groups = []; let group = [];
    for (const token of tokens.slice(importIndex + 1)) { if (token.name === ',') { groups.push(group); group = []; } else group.push(token); } groups.push(group);
    for (const parts of groups) {
      const asIndex = parts.findIndex(n => n.name === 'as');
      const imported = parts.slice(0, asIndex < 0 ? undefined : asIndex).map(text).join('');
      if (!imported || imported === '*') { if (imported === '*') scope.wildcard = true; continue; }
      const alias = asIndex < 0 ? (module ? imported : imported.split('.')[0]) : text(parts[asIndex + 1]);
      const symbol = module ? `${module}${module.endsWith('.') ? '' : '.'}${imported}` : asIndex < 0 ? imported.split('.')[0] : imported;
      bind(scope, alias, { kind: 'import', symbol, conditional });
    }
  }
  function walk(node, scope, conditional = false) {
    if (node.type.isError) {
      // Lezer 1.1.x emits zero-width recovery nodes for these valid Python forms.
      // Do not suppress any other recovered syntax, or a yield outside a function.
      const commentOnlyModule = node.parent?.name === 'Script' && source.split('\n').every(line => /^\s*(?:#.*)?$/.test(line));
      const bareYield = scope.kind === 'def' && node.parent?.name === 'YieldStatement' && text(node.parent).trim() === 'yield';
      if (node.from !== node.to || (!commentOnlyModule && !bareYield)) errors.push({ line: lineAt(node.from), offset: node.from });
      return;
    }
    if (isDefinition(node)) {
      const parts = children(node), nameNode = parts.find(n => n.name === 'VariableName');
      if (!nameNode) return;
      const name = text(nameNode), kind = node.name === 'ClassDefinition' ? 'class' : 'def';
      const record = { kind, name, qualified: scope === moduleScope ? name : `${scope.qualified}.${name}`, parent: scope, line: lineAt(node.from), bindings: new Map(), conditional, decorated: node.parent?.name === 'DecoratedStatement' };
      record.bases = [];
      if (kind === 'class') {
        const args = parts.find(part => part.name === 'ArgList');
        let group = [];
        for (const part of args ? children(args) : []) {
          if (part.name === '(') continue;
          if (part.name === ',' || part.name === ')') {
            if (group.length === 1) record.bases.push(group[0]);
            group = [];
          } else group.push(part);
        }
      }
      definitions.push(record); bind(scope, name, { kind: 'definition', record, conditional });
      const params = parts.find(n => n.name === 'ParamList');
      if (params) for (const parameter of children(params).filter(n => n.name === 'VariableName')) bind(record, text(parameter), { kind: 'parameter' });
      // Defaults and decorators execute at definition time, not in the function body.
      for (const part of parts) {
        if (part.name === 'Body') walk(part, record);
        else if (part.name === 'ParamList' || (kind === 'class' && part.name === 'ArgList')) walk(part, scope, conditional);
      }
      return;
    }
    if (node.name === 'TypeDef' || node.name === 'Comment' || node.name === 'String') return;
    if (node.name === 'ImportStatement') { registerImports(node, scope, conditional); return; }
    const parts = children(node);
    if (node.name === 'LambdaExpression' || /Comprehension/.test(node.name)) {
      const nested = { kind:'expression', name:scope.name, qualified:scope.qualified, line:scope.line, parent:scope, bindings:new Map(), virtual:true };
      if (node.name === 'LambdaExpression') {
        nested.name = `<lambda@${lineAt(node.from)}:${node.from - lineStarts[lineAt(node.from) - 1]}>`;
        nested.qualified = `${scope.qualified}::${nested.name}`;
        const params = parts.find(part => part.name === 'ParamList');
        if (params) children(params).filter(part => part.name === 'VariableName').forEach(part => bind(nested, text(part), {kind:'parameter'}));
      } else {
        for (let i = 0; i < parts.length; i++) if (parts[i].name === 'for') {
          for (let j = i + 1; j < parts.length && parts[j].name !== 'in'; j++) names(parts[j]).forEach(name => bind(nested,name,{kind:'iteration'}));
        }
      }
      parts.forEach(part => walk(part,nested,conditional));
      return;
    }
    if (['ScopeStatement','DeleteStatement'].includes(node.name)) names(node).forEach(name => bind(scope,name,{kind:'dynamic-binding'}));
    if (['AssignStatement', 'UpdateStatement', 'NamedExpression'].includes(node.name)) {
      for (const part of parts) { if (['AssignOp', 'UpdateOp', ':='].includes(part.name)) break; names(part).forEach(name => bind(scope, name, { kind: 'assignment' })); }
    }
    if (node.name === 'ForStatement') {
      for (const part of parts.slice(1)) { if (part.name === 'in') break; names(part).forEach(name => bind(scope, name, { kind: 'iteration' })); }
    }
    if (['WithStatement', 'TryStatement'].includes(node.name)) for (let i = 0; i < parts.length - 1; i++) if (parts[i].name === 'as') names(parts[i + 1]).forEach(name => bind(scope, name, { kind: 'alias' }));
    if (node.name === 'CallExpression') calls.push({ node, scope, callee: parts[0] });
    const nestedConditional = conditional || ['IfStatement', 'TryStatement', 'ForStatement', 'WhileStatement', 'MatchStatement'].includes(node.name);
    parts.forEach(part => walk(part, scope, nestedConditional));
  }
  walk(tree.topNode, moduleScope);
  const counts = new Map(); definitions.forEach(d => counts.set(d.qualified, (counts.get(d.qualified) || 0) + 1));
  const unique = d => d.virtual || counts.get(d.qualified) === 1;
  function resolveBinding(scope, name) {
    for (let current = scope; current; current = current.parent) {
      if (current.kind === 'class' && scope.kind !== 'class') continue;
      if (current.wildcard) return null;
      const bindings = current.bindings.get(name);
      if (bindings) return bindings.length === 1 && !bindings[0].conditional ? bindings[0] : null;
    }
    return null;
  }
  function isUnshadowedBuiltin(scope, name) {
    for (let current = scope; current; current = current.parent) {
      if (current.kind === 'class' && scope.kind !== 'class') continue;
      if (current.wildcard || current.bindings.has(name)) return false;
    }
    return true;
  }
  function add(from, to, kind, offset, resolution, extra = {}) {
    const tuple = [path, from.qualified, kind, path, to];
    // Keep v1 IDs for the unchanged direct-call/member subset to preserve links.
    const canonicalId = `rel:v1:${stableJson(tuple)}`;
    const line = lineAt(offset), old = relationships.get(canonicalId);
    if (old) { if (!old.lines.includes(line)) old.lines.push(line); return canonicalId; }
    relationships.set(canonicalId, { version: 2, supported: true, fromFile: path, from: from.qualified, kind, toFile: path, to, canonicalId, fromName: from.name, toName: to.split('.').pop(), fromLine: from.line, lines: [line], targetResolution: resolution, ...extra });
    return canonicalId;
  }
  for (const def of definitions) if (def.kind === 'def' && def.parent.kind === 'class' && unique(def) && unique(def.parent)) {
    add(def.parent, def.qualified, 'structural_member', lineStarts[def.line - 1], 'lexical-definition', { toLine: def.line });
  }
  for (const def of definitions) if (def.kind === 'class' && unique(def)) for (const base of def.bases) {
    const expression = dotted(base) || text(base).replace(/\s+/g, ' ').trim();
    const parts = expression.split('.'), binding = resolveBinding(def.parent, parts[0]);
    const target = binding?.kind === 'import' ? [binding.symbol, ...parts.slice(1)].join('.') : binding?.kind === 'definition' && parts.length === 1 && unique(binding.record) ? binding.record.qualified : `${def.qualified}::${expression}`;
    add(def, target, 'structural_inheritance', base.from, binding?.kind === 'import' ? 'import-reference' : binding?.kind === 'definition' ? 'lexical-definition' : 'unresolved-runtime-target', { expression });
  }
  for (const { node, scope, callee } of calls) {
    if (scope !== moduleScope && !unique(scope)) continue;
    const expression = dotted(callee), parts = expression.split('.'), root = parts[0];
    const binding = resolveBinding(scope, root);
    let target;
    if (expression && parts.length === 1 && binding?.kind === 'definition') target = binding.record;
    if (expression && parts.length === 2 && root === 'self' && scope.parent?.kind === 'class' && scope.bindings.get('self')?.length === 1 && scope.bindings.get('self')[0].kind === 'parameter') {
      const member = scope.parent.bindings.get(parts[1]);
      if (member?.length === 1 && member[0].kind === 'definition') target = member[0].record;
    }
    if (target && unique(target) && !target.decorated && !target.conditional && target.kind === 'def') {
      add(scope, target.qualified, 'direct_call', node.from, 'lexical-definition', { toLine: target.line });
    } else if (binding?.kind === 'import') {
      add(scope, [binding.symbol, ...parts.slice(1)].join('.'), 'imported_call', node.from, 'import-reference', { expression });
    } else {
      // Scope the receiver expression; x.forward in unrelated callers is not one node.
      const targetText = expression || text(callee).replace(/\s+/g, ' ').trim();
      const id = add(scope, `${scope.qualified}::${targetText}`, 'call_expression', node.from, 'unresolved-runtime-target', { expression: targetText });
      // Keep publication metadata out of immutable relationship evidence so a
      // scope change does not invalidate existing trace/review identities.
      let exclusion;
      if (expression && parts.length === 1 && isUnshadowedBuiltin(scope, root)) {
        if (ROUTINE_BUILTINS.has(root)) exclusion = 'excluded-language-helper';
        else if (RAISED_BUILTINS.has(root) && node.parent?.name === 'RaiseStatement') exclusion = 'excluded-exception-construction';
      }
      if (!exclusion) { requiredCalls.add(id); delete presentationExclusions[id]; }
      else if (!requiredCalls.has(id)) presentationExclusions[id] = exclusion;
    }
  }
  return {
    version: 2, supported: true, relationships: [...relationships.values()].sort((a, b) => a.canonicalId < b.canonicalId ? -1 : 1), presentationExclusions,
    definitionCount: definitions.length, callExpressionCount: calls.length, parseErrors: errors,
    limitation: 'Python syntax inventory: class membership, explicit base expressions and call expressions. Imported references do not prove runtime dispatch; receiver/dynamic targets remain unresolved. Operators, implicit calls, data flows and cross-file dispatch are not a complete semantic graph.',
  };
}
