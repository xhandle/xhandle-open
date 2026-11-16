const assert = require('node:assert/strict');

// Exercise the real UI, workers, IndexedDB, generation checkpoints and joint
// publication. Only the provider response is controlled; no paid requests run.
module.exports = async function verifyRequirementDirections(page, root, action) {
  const safety = process.argv.includes('--safety-inheritance');
  const projectSafety = 'The controller shall inhibit motion while the operator emergency stop is active.';
  const codeSafety = 'The command validator shall reject commands older than 100 ms.';
  const requests = [];
  await page.route('**/api/chat', async route => {
    const input = JSON.parse(route.request().postDataJSON().messages.find(message => message.role === 'user').content);
    requests.push(input);
    const source = input.sources.find(source => source.sourceType === 'artifact-object' && source.kind === 'requirement' && source.attributes?.['Safety Significant'] === 'Yes')
      || input.sources.find(source => source.sourceType === 'artifact-object' && source.kind === 'requirement')
      || input.sources.find(source => source.sourceType === 'architecture-element');
    assert(source, 'A real selected source reaches every drafting request');
    const objects = [{ key: 'command-age', kind: input.section.id === 's2' ? 'requirement' : 'narrative', title: 'Command age', text: 'The controller shall reject motion commands older than 100 ms.', sourceIds: [source.id] }];
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ objects }) } }] }) });
  });
  const sourceBefore = await page.evaluate(async ({ safety, projectSafety, codeSafety }) => {
    const projects = JSON.parse(localStorage.getItem('xhandle.projects') || '[]');
    localStorage.setItem('xhandle.projects', JSON.stringify([...projects, { id: 'derivation-functional', name: 'Derivation project' }]));
    const code = { id: 'derivation-code', name: 'Derivation code', folderId: null, activeRepoId: 'repo', repos: [{ id: 'repo', repoId: 'repo', repoName: 'controller' }], createdAt: '2026-11-15T12:00:00Z', updatedAt: '2026-11-15T12:00:00Z' };
    localStorage.setItem('xhandle.codeArchitectureProjects', JSON.stringify([...JSON.parse(localStorage.getItem('xhandle.codeArchitectureProjects') || '[]'), code]));
    const data = JSON.parse(localStorage.getItem('xhandle.projectData') || '{}');
    data['derivation-functional'] = { responseRows: [{ id: 'functional-command', fromFunction: 'Operator', controlAction: 'Motion command', toFunction: 'Controller', controlDetails: 'Reject stale commands.' }] };
    if (safety) {
      data['derivation-functional'].analysisResult = { Summary: [['Raw Analysis Row ID', 'System Requirement', 'Safety Significant'], ['PROJECT-SAFE', projectSafety, 'Yes']] };
      localStorage.setItem('xhandle:code-architecture-hazard-analysis:v1', JSON.stringify({ hazardAnalysisRuns: [{ id: 'derivation-code-safety', projectId: 'derivation-code', repoId: 'repo', runState: 'complete', hazardMethod: 'STPA', generatedSheets: { Summary: [['Raw Analysis Row ID', 'Software Safety Requirement', 'Safety Significant', 'ASIL'], ['CODE-SAFE', codeSafety, 'Yes', 'D']] } }] }));
    }
    localStorage.setItem('xhandle.projectData', JSON.stringify(data));
    const rows = [{ traceId: 'code-command', fromNodeId: 'validate', toNodeId: 'publish', fromFunction: 'Validate command', toFunction: 'Publish command', controlAction: 'Validated command', fromArchitecture: { subsystem: 'Control', csci: 'Command input', csc: 'Validation', csu: 'Validator' }, toArchitecture: { subsystem: 'Control', csci: 'Command output', csc: 'Publication', csu: 'Publisher' } }];
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open('xhandle', 4); request.onupgradeneeded = () => { for (const store of ['code_index', 'copilot_baseline', 'diagram_positions']) if (!request.result.objectStoreNames.contains(store)) request.result.createObjectStore(store, { keyPath: 'key' }); }; request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const tx = db.transaction('copilot_baseline', 'readwrite');
    const done = new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); });
    tx.objectStore('copilot_baseline').put({ key: 'cba:derivation-code:repo', value: rows }); await done; db.close();
    return { functional: JSON.stringify(data['derivation-functional']), code: JSON.stringify(rows) };
  }, { safety, projectSafety, codeSafety });
  const readProject = title => page.evaluate(async title => {
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open('xhandle-design-artifacts', 2); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const all = await new Promise((resolve, reject) => { const request = db.transaction('metadata').objectStore('metadata').getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const program = all.find(meta => meta.title === title && meta.members);
    if (!program) { db.close(); return null; }
    const records = [];
    for (const member of program.members) {
      const get = (store, id) => new Promise((resolve, reject) => { const request = db.transaction(store).objectStore(store).get(id); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      const meta = all.find(meta => meta.id === member.id);
      records.push({ meta, job: await get('jobs', member.id), revision: meta.revision ? await get('revisions', `${member.id}:${meta.revision}`) : null });
    }
    db.close(); return { program, records };
  }, title);
  const waitProject = async (title, state) => {
    for (let attempt = 0; attempt < 200; attempt++) {
      const data = await readProject(title);
      if (data?.program.state === state) return data;
      if (data?.program.state === 'paused' && data.program.error) throw Error(data.program.error);
      await page.waitForTimeout(100);
    }
    throw Error(`Timed out waiting for ${title} to become ${state}`);
  };
  for (const mode of ['functional', 'code', 'mixed']) {
    const title = `Derivation ${mode} fixture`;
    await page.reload(); await page.getByRole('button', { name: 'Design Management', exact: true }).click();
    await action('Generate systems engineering project', 'Design Management actions');
    const dialog = page.getByRole('dialog', { name: 'Generate systems engineering project', exact: true });
    await dialog.getByLabel('Project name', { exact: true }).fill(title);
    await dialog.getByLabel('System', { exact: true }).fill('Controller');
    await dialog.getByRole('combobox', { name: /^Destination folder/ }).selectOption('trace-folder');
    if (mode !== 'code') {
      await dialog.getByRole('checkbox', { name: 'Derivation project (functional)', exact: true }).check();
      await dialog.getByRole('checkbox', { name: 'Derivation project — project diagram', exact: true }).check();
    }
    if (mode !== 'functional') {
      await dialog.getByRole('checkbox', { name: 'Derivation code (code-architecture)', exact: true }).check();
      await dialog.getByRole('checkbox', { name: 'Derivation code — controller', exact: true }).check();
    }
    await dialog.getByRole('button', { name: 'Clear selection', exact: true }).click();
    const types = dialog.getByRole('group', { name: 'Artifacts to generate', exact: true });
    await types.getByRole('checkbox', { name: 'Software Requirements Specification', exact: true }).check();
    await types.getByRole('checkbox', { name: 'Hardware Requirements Specification', exact: true }).check();
    assert(await types.getByRole('checkbox', { name: 'System Requirements Specification', exact: true }).isChecked());
    await dialog.getByRole('button', { name: 'Create systems engineering project', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
    await page.getByRole('heading', { name: title, exact: true }).waitFor();
    await action('Generate / resume project', 'Project actions');
    const ready = await waitProject(title, 'ready'), [first, second, hardware] = ready.records;
    assert.deepEqual(ready.records.map(record => record.meta.templateId), mode === 'functional' ? ['system-spec', 'software-spec', 'hardware-spec'] : ['software-spec', 'system-spec', 'hardware-spec']);
    const diagrams = record => record.job.sources.entries.filter(entry => entry.sourceType === 'architecture-diagram').map(entry => entry.workspaceType);
    assert.deepEqual(diagrams(first), [mode === 'functional' ? 'functional' : 'code-architecture']);
    assert.deepEqual(diagrams(second), mode === 'mixed' ? ['functional'] : []); assert.deepEqual(diagrams(hardware), []);
    assert(second.job.sources.entries.some(source => source.sourceType === 'artifact-object' && source.artifactId === first.meta.id));
    if (safety) {
      const rootSafety = mode === 'functional' ? projectSafety : codeSafety;
      assert(Object.values(first.job.sections).flat().some(object => object.kind === 'requirement' && object.text === rootSafety && object.attributes?.['Safety Significant'] === 'Yes'), 'Recorded root safety obligation survives the model omitting it');
      if (mode === 'mixed') assert(Object.values(second.job.sections).flat().some(object => object.text === projectSafety && object.attributes?.['Safety Significant'] === 'Yes'), 'Mixed System Requirements also retain Projects safety obligations');
      assert(ready.records.every(record => Object.values(record.job.sections).flat().some(object => object.kind === 'requirement' && object.attributes?.['Safety Significant'] === 'Yes')), 'Safety significance flows through each requirements stage');
    } else {
      assert(ready.records.every(record => !record.job.sources.entries.some(source => source.sourceType === 'hazard-derived-requirement') && !Object.values(record.job.sections).flat().some(object => object.recordedSafetyRequirement || object.evidenceIssue === 'unresolved-safety-allocation' || object.attributes?.['Safety Significant'] === 'Yes')), 'No safety requirements or safety gaps are introduced without analysis');
    }
    await action('Review project proposal', 'Project actions');
    const accept = page.getByRole('button', { name: 'Accept complete project', exact: true }); await accept.waitFor();
    await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(button => button.textContent === 'Accept complete project')?.disabled);
    await accept.click(); const accepted = await waitProject(title, 'accepted');
    assert(accepted.records.every(record => record.meta.revision === 1 && !record.job));
    assert(accepted.records[1].revision.objects.some(object => object.kind === 'requirement' && object.sourceEvidence?.some(source => source.artifactId === first.meta.id && source.revision === 1)));
    if (safety) {
      await page.getByRole('button', { name: 'Documents', exact: true }).click();
      await page.locator('table').getByRole('button', { name: first.meta.title, exact: true }).click();
      await page.getByTitle('Table view', { exact: true }).click();
      await page.getByRole('columnheader', { name: /Safety Significant/ }).waitFor();
      assert(await page.locator('table').getByText('Yes', { exact: true }).count() > 0, 'Safety significance is visible in the table');
      await page.getByTitle('Outline view', { exact: true }).click();
      await page.getByText(/Safety significant/, { exact: false }).first().waitFor();
    }
    await page.screenshot({ path: `${root}/derivation-${mode}.png` });
  }
  const after = await page.evaluate(async () => {
    const db = await new Promise(resolve => { const request = indexedDB.open('xhandle', 4); request.onsuccess = () => resolve(request.result); });
    const rows = await new Promise(resolve => { const request = db.transaction('copilot_baseline').objectStore('copilot_baseline').get('cba:derivation-code:repo'); request.onsuccess = () => resolve(request.result.value); }); db.close();
    return { functional: JSON.stringify(JSON.parse(localStorage.getItem('xhandle.projectData'))['derivation-functional']), code: JSON.stringify(rows) };
  });
  assert.deepEqual(after, sourceBefore, 'Requirements never mutate their source diagrams or code rows');
  assert.equal(requests.length, 54, 'Six sections per document, three documents per project, three source configurations');
  return { controlledProviderResponses: requests.length, savedHazardSafety: safety, workflows: ['Projects → System → Software / Hardware', 'Code → Software → System → Hardware', 'Mixed → Software + Projects → System → Hardware'] };
};
