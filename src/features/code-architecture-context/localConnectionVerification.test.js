// Execute the actual App verification function so analysis cannot use a new
// repository storage scope while upsert silently reuses the old connection.
const fs = require('fs');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const text = fs.readFileSync('src/App.js', 'utf8');
let body;
traverse(parser.parse(text, { sourceType: 'module', plugins: ['jsx'] }), {
  FunctionDeclaration({ node }) { if (node.id.name === 'verifyCodeArchitectureRepo') body = text.slice(node.start, node.end); },
});
const verify = env => new Function(...Object.keys(env), `${body}; return verifyCodeArchitectureRepo();`)(...Object.values(env));

test('saving an existing local source from new-connection setup preserves the repository storage ID', async () => {
  const existing = { id: 'saved-repo', sourceType: 'local', sourceId: 'saved-folder' };
  const scan = jest.fn().mockResolvedValue({ entries: [{ path: 'main.js', name: 'main.js', size: 1 }], skipped: [] });
  const result = await verify({
    localConnectionChoicePending: false,
    codeArchitectureRepoDraft: existing,
    codeArchitectureRepoConfigProjectId: 'project', codeArchitectureRepoConfigRepoId: null,
    codeArchitectureProjects: [{ id: 'project', repos: [existing] }],
    isLocalCodeSource: source => source?.sourceType === 'local',
    scanLocalFolder: scan,
    makeRepoConfig: () => ({ ...existing, id: 'new-random-id' }),
    setIsCodeArchitectureRepoVerifying: jest.fn(), setCodeArchitectureRepoFilesForModal: jest.fn(), setCodeArchitectureRepoConfigMessage: jest.fn(),
  });
  expect(result.repoConfig.id).toBe('saved-repo');
  expect(result.repoConfig.sourceId).toBe('saved-folder');
});

test('unresolved duplicate selection cannot be verified or analyzed', async () => {
  const message = jest.fn();
  expect(await verify({ localConnectionChoicePending: true, setCodeArchitectureRepoConfigMessage: message })).toBeNull();
  expect(message).toHaveBeenCalledWith(expect.stringContaining('reuse'));
});
