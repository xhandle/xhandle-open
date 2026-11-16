const assert = require('node:assert/strict');

// Run against an isolated profile. Creation captures real saved diagrams but
// never starts AI drafting or alters the source projects.
module.exports = async function verifyProjectDialog(page, root, openProjectDialog) {
  const before = await page.evaluate(() => {
    const owners = [
      { id: 'dialog-controller', name: 'Project dialog controller' },
      { id: 'dialog-sensor', name: 'Project dialog sensor' },
    ];
    localStorage.setItem('xhandle.projects', JSON.stringify([...JSON.parse(localStorage.getItem('xhandle.projects') || '[]'), ...owners]));
    const data = JSON.parse(localStorage.getItem('xhandle.projectData') || '{}');
    for (const owner of owners) data[owner.id] = { responseRows: [
      { id: `${owner.id}:command`, fromFunction: 'Operator', controlAction: 'Command', toFunction: owner.name },
      { id: `${owner.id}:feedback`, fromFunction: owner.name, controlAction: 'Feedback', toFunction: 'Operator' },
    ] };
    localStorage.setItem('xhandle.projectData', JSON.stringify(data));
    return JSON.stringify(owners.map(owner => data[owner.id]));
  });
  await page.reload();
  await page.getByRole('button', { name: 'Design Management', exact: true }).click();
  await openProjectDialog();
  const dialog = page.getByRole('dialog', { name: 'Generate systems engineering project', exact: true });
  await dialog.getByLabel('Project name', { exact: true }).fill('Saved diagram project fixture');
  await dialog.getByLabel('System', { exact: true }).fill('Controller');
  await dialog.getByRole('combobox', { name: /^Destination folder/ }).selectOption('trace-folder');
  for (const name of ['Project dialog controller', 'Project dialog sensor']) {
    await dialog.getByRole('checkbox', { name: `${name} (functional)`, exact: true }).check();
    await dialog.getByRole('checkbox', { name: `${name} — project diagram`, exact: true }).check();
  }
  // Removing an owner must still remove its diagram selection.
  await dialog.getByRole('checkbox', { name: 'Project dialog sensor (functional)', exact: true }).uncheck();
  assert.equal(await dialog.getByRole('checkbox', { name: 'Project dialog sensor — project diagram', exact: true }).count(), 0);
  await dialog.getByRole('checkbox', { name: 'Project dialog sensor (functional)', exact: true }).check();
  const sensor = dialog.getByRole('checkbox', { name: 'Project dialog sensor — project diagram', exact: true });
  assert.equal(await sensor.isChecked(), false);
  await sensor.check();
  for (const removed of ['Architecture scope', 'Diagram level', 'Source notes', 'Source modules and their owners', 'Shared project context']) {
    assert.equal(await dialog.getByText(removed, { exact: false }).count(), 0, `${removed} is absent`);
  }
  assert(await dialog.getByRole('button', { name: 'Create systems engineering project', exact: true }).isVisible());
  await page.screenshot({ path: root + '/simplified-project-dialog.png' });
  await dialog.getByRole('button', { name: 'Create systems engineering project', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  await page.getByRole('heading', { name: 'Saved diagram project fixture', exact: true }).waitFor();
  const after = await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('xhandle-design-artifacts', 2); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const records = await new Promise((resolve, reject) => { const r = db.transaction('metadata').objectStore('metadata').getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    db.close();
    const program = records.find(record => record.title === 'Saved diagram project fixture');
    const data = JSON.parse(localStorage.getItem('xhandle.projectData'));
    return { owners: program.ownerProjects, configs: program.members.map(member => member.config), documents: records.filter(record => record.programId === program.id), source: JSON.stringify(['dialog-controller', 'dialog-sensor'].map(id => data[id])) };
  });
  assert.equal(after.source, before, 'Source project rows are unchanged');
  assert.equal(after.documents.length, 2);
  assert.deepEqual(after.configs.map(config => config.templateId), ['conops', 'system-spec']);
  for (const config of after.configs) {
    assert.deepEqual(config.architectureSources, [
      { projectId: 'dialog-controller', workspaceType: 'functional' },
      { projectId: 'dialog-sensor', workspaceType: 'functional' },
    ]);
    assert.deepEqual(config.ownerProjects, after.owners);
    assert.equal(config.notes, '');
    assert.deepEqual(config.sources, []);
    assert(Object.values(config.projectNotes).every(value => value === ''));
  }
  await page.getByRole('button', { name: 'Traceability', exact: true }).click();
  const graph = page.getByRole('region', { name: 'Traceability directed graph', exact: true });
  await graph.locator('.react-flow__node').first().waitFor();
  assert.equal(await graph.getByRole('button', { name: 'Fit diagram', exact: true }).count(), 0);
  assert.equal(await graph.locator('.react-flow__controls-fitview').count(), 1);
};
