const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parse } = require('@babel/parser');
const traverse = require('@babel/traverse').default;

// Execute the actual App handlers with controlled network/state boundaries.
// No credentials, real repositories or provider calls are used.
const source = fs.readFileSync(path.resolve(__dirname, '../../src/App.js'), 'utf8');
const functions = new Map();
traverse(parse(source, { sourceType: 'module', plugins: ['jsx'] }), {
  FunctionDeclaration({ node }) {
    if (['verifyCodeArchitectureRepo', 'generateCodeArchitectureRepoContext'].includes(node.id?.name)) functions.set(node.id.name, source.slice(node.start, node.end));
  },
});
function fixture() {
  const draft = { owner: 'fixture', repo: 'private', token: 'synthetic-token', repoUrl: '', analysisContextText: '', analysisContextFiles: [] };
  const updates = { messages: [], files: [], verifying: [], generating: [] };
  const context = {
    AbortController, localConnectionChoicePending: false, codeArchitectureRepoDraft: draft,
    codeArchitectureRepoConfigProjectId: 'p', codeArchitectureRepoConfigRepoId: null,
    codeArchitectureProjects: [], repoSourceRequestRef: { current: null }, repoContextRequestRef: { current: 0 },
    repoContextDraftRef: { current: { open: true, draft, project: 'p', repo: null } },
    isLocalCodeSource: () => false, parseGitHubRepoUrl: () => null, backendURL: '/fixture',
    setCodeArchitectureRepoConfigMessage: message => updates.messages.push(message),
    setCodeArchitectureRepoFilesForModal: files => updates.files.push(files),
    setIsCodeArchitectureRepoVerifying: value => updates.verifying.push(value),
    setIsCodeArchitectureContextGenerating: value => updates.generating.push(value),
    filterSelectableRepoFiles: files => files, makeRepoConfig: config => config,
    fetch: async () => ({ ok: true, json: async () => [] }),
    listRepoFilesViaGitHub: async () => [{ path: 'control.py' }],
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../../src/features/code-architecture-context/repositoryContextRequest.js'), 'utf8').replaceAll('export function', 'function'), context);
  for (const code of functions.values()) vm.runInContext(code, context);
  return { context, updates };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
test('verification displays the rate-limit wait and Cancel aborts it without publishing stale configuration', async () => {
  const { context, updates } = fixture(); let signal;
  context.getDefaultBranch = (_owner, _repo, _token, suppliedSignal, progress) => {
    signal = suppliedSignal; progress({ message: 'Paused for GitHub API rate limit.' });
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }));
  };
  const pending = context.verifyCodeArchitectureRepo(); await tick();
  assert.equal(updates.messages.at(-1), 'Paused for GitHub API rate limit.');
  context.repoSourceRequestRef.current.abort();
  assert.equal(await pending, null); assert.equal(signal.aborted, true);
  assert.equal(updates.files.length, 0); assert.equal(updates.verifying.at(-1), false);
  assert.equal(updates.messages.at(-1), 'Paused for GitHub API rate limit.');
});
test('editing the source while verification is pending cannot save the old result', async () => {
  const { context, updates } = fixture(); let resolve;
  context.getDefaultBranch = () => new Promise(done => { resolve = done; });
  const pending = context.verifyCodeArchitectureRepo(); await tick();
  context.repoContextDraftRef.current = { ...context.repoContextDraftRef.current, draft: { ...context.codeArchitectureRepoDraft, repo: 'other' } };
  resolve('main');
  assert.equal(await pending, null); assert.equal(updates.files.length, 0);
  assert.equal(updates.verifying.at(-1), false);
});
test('context generation propagates progress and cancellation through repository lookup', async () => {
  const { context, updates } = fixture(); let signal;
  context.getDefaultBranch = (_owner, _repo, _token, suppliedSignal, progress) => {
    signal = suppliedSignal; progress({ message: 'Waiting for GitHub quota reset.' });
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }));
  };
  const pending = context.generateCodeArchitectureRepoContext(); await tick();
  assert.equal(updates.messages.at(-1), 'Waiting for GitHub quota reset.');
  context.repoSourceRequestRef.current.abort(); await pending;
  assert.equal(signal.aborted, true); assert.equal(updates.generating.at(-1), false);
  assert.equal(updates.files.length, 0);
});
