// Diagnostic assertions for unresolved review findings; deliberately exits 1
// while either expected definition is missing. No app/database/provider access.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
const implementation = fs.readFileSync(path.join(root, 'src/features/code-architecture-context/cppSourceFunctions.js'), 'utf8').replace('export function', 'function');
const cases = [
  { name: 'identifier comparison in template default',
    source: 'constexpr int limit = 3;\ntemplate<bool B = limit < 5>\nvoid work() {}\nvoid after() {}',
    expected: ['work', 'after'] },
  { name: 'local class method',
    source: 'void outer() {\nstruct Local {\nvoid run() {}\n};\n}\nvoid after() {}',
    expected: ['outer', 'run', 'after'] },
];
for (const item of cases) {
  const actual = new vm.Script(implementation + '\nextractCppSourceFunctions(source).map(row => row.functionName);').runInNewContext({ source: item.source }, { timeout: 2000 });
  const passed = JSON.stringify(actual) === JSON.stringify(item.expected);
  console.log(JSON.stringify({ name: item.name, expected: item.expected, actual, passed }));
  if (!passed) process.exitCode = 1;
}
