import { extractCppSourceFunctions } from './cppSourceFunctions';

const constructor = count => 'Widget::Widget(\n' + Array.from({length: count}, (_, i) => `  const Type & value${i}`).join(',\n') + '\n) : member_(value0), other_{value0} {\n  consume();\n}';
it('indexes the formerly pathological multiline constructor and its body range', () => {
  expect(extractCppSourceFunctions(constructor(8))).toEqual([
    {functionName: 'Widget', startLine: 1, endLine: 12},
  ]);
});
it('handles templates, qualifiers, destructors, trailing types and nested scopes', () => {
  const source = `namespace demo {
class Widget {
Widget() : member{1} {}
~Widget() noexcept {}
void run() const & noexcept(noexcept(work())) { work(); }
};
template <typename T>
std::optional<T> free_function(const T & x) { return x; }
auto qualified() && -> std::vector<int> { return {}; }
}`;
  expect(extractCppSourceFunctions(source)).toEqual([
    {functionName:'Widget',startLine:3,endLine:3},
    {functionName:'~Widget',startLine:4,endLine:4},
    {functionName:'run',startLine:5,endLine:5},
    {functionName:'free_function',startLine:7,endLine:8},
    {functionName:'qualified',startLine:9,endLine:9},
  ]);
});
it('ignores comments, raw strings, directives, calls and declarations', () => {
  const source = `// void fake() {}
/* int other() {} */
#define FAKE(x) void fake_macro() {}
const char * text = R"tag(void fake_string() { " )tag";
void declared();
void real() {
  if (ready()) { call(); }
  const char * braces = "} {";
}
`;
  expect(extractCppSourceFunctions(source)).toEqual([{functionName:'real',startLine:6,endLine:9}]);
});
it('does not announce incomplete bodies as complete ranges', () => {
  expect(extractCppSourceFunctions('void missing() { if (true) {')).toEqual([]);
  expect(extractCppSourceFunctions('void missing(')).toEqual([]);
});
it('handles large constructor lists and nonmatching token sequences', () => {
  expect(extractCppSourceFunctions(constructor(2000))[0].functionName).toBe('Widget');
  expect(extractCppSourceFunctions('word '.repeat(20000) + ';')).toEqual([]);
});
it('tracks access labels and prefixed raw strings without inventing functions', () => {
  expect(extractCppSourceFunctions(`template<class T> class Box {
public:
Box() {}
};
const char * s = u8R"x( " void fake() {} )x";
int last() { return 1; }`)).toEqual([
    {functionName:'Box',startLine:3,endLine:3},
    {functionName:'last',startLine:6,endLine:6},
  ]);
});
it('finishes the pathological shape under an external process deadline', () => {
  const fs = require('fs');
  const {spawnSync} = require('child_process');
  const implementation = fs.readFileSync(require('path').join(__dirname, 'cppSourceFunctions.js'), 'utf8').replace('export function', 'function');
  const script = implementation + '\nconst result = extractCppSourceFunctions(' + JSON.stringify(constructor(4000)) + '); console.log(JSON.stringify(result));';
  const result = spawnSync(process.execPath, ['-e', script], {encoding:'utf8',timeout:5000});
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual([{functionName:'Widget',startLine:1,endLine:4004}]);
});
it('does not treat C++ numeric separators as character-literal openings', () => {
  expect(extractCppSourceFunctions("constexpr auto limit = 1'000'000;\nvoid run() { const auto x = 0xFF'FF; }\nvoid next() {}"))
    .toEqual([{functionName:'run',startLine:2,endLine:2},{functionName:'next',startLine:3,endLine:3}]);
});
it('retains template defaults and parameter packs without confusing them with expressions', () => {
  const source = `template<typename T = std::vector<int>>
void work(T value) {}
template<typename... Args>
void print(Args &&... args) {}
template<class T, class... Bound>
static auto makeAdapter(T callback, Bound... bound) {}
template<int N = (1 > 0 ? 2 : 3)>
int count() { return N; }`;
  expect(extractCppSourceFunctions(source)).toEqual([
    {functionName:'work',startLine:1,endLine:2},
    {functionName:'print',startLine:3,endLine:4},
    {functionName:'makeAdapter',startLine:5,endLine:6},
    {functionName:'count',startLine:7,endLine:8},
  ]);
});
it('keeps Windows-line-ending continuations out of the function index', () => {
  const source = '// continued comment \\\r\nvoid fakeComment() {}\r\n#define DECLARE \\\r\nvoid fakeMacro() {}\r\nvoid real() {}';
  expect(extractCppSourceFunctions(source)).toEqual([{functionName:'real',startLine:5,endLine:5}]);
});
it('indexes real names following parenthesized return-type specifiers', () => {
  expect(extractCppSourceFunctions('API_TYPE(Value)\nmake() {}\ndecltype(factory())\ncreate() {}')).toEqual([
    {functionName:'make',startLine:1,endLine:2},
    {functionName:'create',startLine:3,endLine:4},
  ]);
});
it('does not promote lambda calls or constexpr control statements into definitions', () => {
  expect(extractCppSourceFunctions(`bool outer() {
  if constexpr (ready) { consume(); }
  return std::any_of(first, last, [](auto x) { return x.valid(); });
}`)).toEqual([{functionName:'outer',startLine:1,endLine:4}]);
});
it('preserves call-operator definitions and does not label conversions as ordinary functions', () => {
  expect(extractCppSourceFunctions(`struct Callback {
void operator()(const Input & x) const { consume(x); }
explicit operator bool() const { return true; }
void next() {}
};`)).toEqual([
    {functionName:'operator()',startLine:2,endLine:2},
    {functionName:'next',startLine:4,endLine:4},
  ]);
});
it('does not consume following functions after a numeric template default comparison', () => {
  expect(extractCppSourceFunctions('template<bool B = 1 < 3> void work() {}\nvoid after() {}')).toEqual([
    {functionName:'work',startLine:1,endLine:1},
    {functionName:'after',startLine:2,endLine:2},
  ]);
});
it('recovers identifier comparisons in template defaults without losing following definitions', () => {
  for (const condition of ['limit < 5', 'left < right', 'limit < 5 && left < right']) {
    const source = `template<bool B = ${condition}>\nvoid work() {}\nvoid after() {}`;
    expect(extractCppSourceFunctions(source)).toEqual([
      {functionName:'work',startLine:1,endLine:2},
      {functionName:'after',startLine:3,endLine:3},
    ]);
  }
  expect(extractCppSourceFunctions('template<bool B = limit < 5> void declared();\nvoid after() {}'))
    .toEqual([{functionName:'after',startLine:2,endLine:2}]);
});
it('indexes local-class methods through nested executable blocks without indexing calls', () => {
  const source = `void outer() {
  if (ready()) {
    struct Local {
      Local() { consume(); }
      void run() {
        struct Nested { void execute() {} };
        run_callback([]() { call(); });
      }
    };
  }
}
void after() {}`;
  expect(extractCppSourceFunctions(source)).toEqual([
    {functionName:'outer',startLine:1,endLine:11},
    {functionName:'Local',startLine:4,endLine:4},
    {functionName:'run',startLine:5,endLine:8},
    {functionName:'execute',startLine:6,endLine:6},
    {functionName:'after',startLine:12,endLine:12},
  ]);
});
it('retains template default lambda and value initializers', () => {
  expect(extractCppSourceFunctions('template<class T = Box<int>, auto F = []() { return 1; }>\nvoid work() {}\nvoid after() {}').map(r=>r.functionName)).toEqual(['work','after']);
});
it('keeps templated return types when recovering a comparison default', () => {
  expect(extractCppSourceFunctions('template<bool B = limit < 5>\nstd::vector<int> work() {}\nvoid after() {}')).toEqual([
    {functionName:'work',startLine:1,endLine:2},
    {functionName:'after',startLine:3,endLine:3},
  ]);
});
it('recovers comparison defaults on class templates and nested member templates', () => {
  expect(extractCppSourceFunctions(`template<bool B = left < right>
struct Outer {
  template<bool C = left < right>
  void work() {}
};
void after() {}`).map(row=>row.functionName)).toEqual(['work','after']);
});
