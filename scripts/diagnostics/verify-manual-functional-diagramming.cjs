// Behavioral assertions in a fresh browser context using synthetic project data.
// XHANDLE_PLAYWRIGHT_PATH=/path/to/playwright-core XHANDLE_CHROME_PATH=/path/to/chrome node scripts/diagnostics/verify-manual-functional-diagramming.cjs
const { chromium, webkit } = require(process.env.XHANDLE_PLAYWRIGHT_PATH || 'playwright-core');
const assert = require('node:assert/strict');
const id = 'manual-diagram-review-fixture';
const key = `diagram:positions:${id}`;
(async () => {
  const browser = process.env.REVIEW_BROWSER === 'webkit'
    ? await webkit.launch({ headless: true })
    : await chromium.launch({ headless: true, executablePath: process.env.XHANDLE_CHROME_PATH });
  const output = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const mode = process.env.REVIEW_MODE || 'mixed';
    await page.addInitScript(({ id, mode }) => {
      if (sessionStorage.getItem('manual-review-seeded')) return;
      localStorage.setItem('xhandle.projects', JSON.stringify([{ id, name: 'Manual diagram review' }]));
      localStorage.setItem('xhandle.sidebarProjectsOpen', 'true');
      localStorage.setItem('xhandle.projectData', JSON.stringify({ [id]: { responseRows: [
        { subsystem: ['manual', 'disconnected', 'rename', 'connected-drag'].includes(mode) ? '' : 'Source', fromFunction: 'A', controlAction: 'Command', toFunction: 'B', ...(mode === 'nested' ? {system: 'Vehicle'} : {}) },
        { subsystem: ['manual', 'disconnected', 'rename', 'connected-drag'].includes(mode) ? '' : 'Destination', fromFunction: 'B', controlAction: 'Feedback', toFunction: 'A', ...(mode === 'nested' ? {system: 'Vehicle'} : {}) },
      ] } }));
      sessionStorage.setItem('manual-review-seeded', 'true');
    }, { id, mode });
    const settle = async () => { await page.waitForTimeout(750); };
    const snapshot = async stage => {
      await settle();
      const state = await page.evaluate(({ key, id }) => ({
        groups: JSON.parse(localStorage.getItem(key + ':groups:v1') || '[]'),
        positions: JSON.parse(localStorage.getItem(key) || '[]'),
        manual: JSON.parse(localStorage.getItem(key + ':manual:v1') || '[]'),
        rows: JSON.parse(localStorage.getItem('xhandle.projectData') || '{}')[id]?.responseRows,
        rendered: [...document.querySelectorAll('.react-flow__node')].map(el => ({ id: el.dataset.id, transform: el.style.transform, width: el.style.width, height: el.style.height })),
      }), { key, id });
      output.push({ stage, ...state });
      return state;
    };
    const geometry = state => state.rendered.slice().sort((a,b)=>a.id.localeCompare(b.id));
    const position = (state,id) => new Map(state.positions).get(id);
    const verify = () => {
      assert.deepEqual(errors, []);
      const byStage = Object.fromEntries(output.map(stage=>[stage.stage,stage]));
      const created = byStage['create-empty-subsystem'];
      if (mode === 'disconnected') {
        const added = byStage['add-node-with-subsystem-selected'];
        assert.equal(added.manual.length,1,'New manual node must be persisted while idle');
        assert.deepEqual(geometry(byStage['disconnected-reload']),geometry(byStage['idle-before-reload']));
      } else if (mode === 'manual') {
        const assigned = byStage['explicitly-assign-disconnected-function'];
        const connected = byStage['connect-manual-function-to-A'];
        assert.equal(connected.groups.length,created.groups.length,'Connection duplicated a subsystem');
        assert.deepEqual(geometry(connected),geometry(assigned),'Connection moved an endpoint');
        assert.equal(position(connected,'n:new: 1').groupingIntent,'explicit');
        assert.deepEqual(geometry(byStage['manual-reload']),geometry(connected));
      } else if (!['drag','rename','group-rename','connected-drag'].includes(mode)) {
        const before = byStage['nest-manual-subsystem-in-system'] || created;
        const assigned = byStage['assign-A-to-manual-subsystem'];
        assert.equal(assigned.groups.length,before.groups.length,'Assignment duplicated or removed a subsystem');
        assert.equal(assigned.rows.find(row=>row.fromFunction==='B').subsystem,'Destination');
        assert.deepEqual(position(assigned,'n:B'),position(before,'n:B'),'Unselected function moved');
        assert.deepEqual(geometry(byStage['undo-assignment']),geometry(before),'Undo changed original geometry');
        assert.deepEqual(geometry(byStage['redo-assignment']),geometry(assigned),'Redo changed geometry');
        assert.deepEqual(geometry(byStage.reload),geometry(assigned),'Reload changed geometry');
      }
    };
    await page.goto(process.env.XHANDLE_URL || 'http://localhost:3000');
    await page.getByRole('button', { name: 'Manual diagram review', exact: true }).click({ timeout: 60000 });
    await page.waitForFunction(() => document.querySelector('.react-flow')?.style.visibility === 'visible');
    await snapshot('baseline');
    await page.getByTitle('Group selected nodes', { exact: true }).click();
    const created = await snapshot('create-empty-subsystem');
    const group = created.groups.find(box => !box.autoGenerated && box.elementType !== 'system');
    if (mode === 'connected-drag') {
      await page.getByTitle('Fit entire diagram to view',{exact:true}).click(); await settle();
      const source = await page.locator('.react-flow__node[data-id="n:A"]').boundingBox();
      const target = await page.locator(`.react-flow__node[data-id="${group.id}"]`).boundingBox();
      await page.mouse.move(source.x+source.width/2,source.y+source.height/2); await page.mouse.down();
      await page.mouse.move(target.x+target.width/2,target.y+target.height/2,{steps:15}); await page.mouse.up();
      const moved = await snapshot('connected-function-dropped');
      const peer = state => { const saved=position(state,'n:B'); return {parentId:saved.parentId,position:saved.position}; };
      assert.equal(position(moved,'n:A').parentId,group.id);
      assert.deepEqual(peer(moved),peer(created),'Edge peer followed dragged function');
      await page.getByTitle('Undo last diagram change',{exact:true}).click();
      const undone=await snapshot('undo-connected-drop');
      assert.deepEqual(geometry(undone),geometry(created));
      await page.getByTitle('Redo diagram change',{exact:true}).click();
      const redone=await snapshot('redo-connected-drop');
      assert.deepEqual(geometry(redone),geometry(moved));
      await page.reload();
      await page.getByRole('button', { name: 'Manual diagram review', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('.react-flow')?.style.visibility === 'visible');
      const restored=await snapshot('connected-drop-reload');
      assert.deepEqual(geometry(restored),geometry(moved));
      verify(); console.log(JSON.stringify({mode,stages:output,errors},null,2)); return;
    }
    if (mode === 'group-rename') {
      await page.getByTitle('Fit entire diagram to view',{exact:true}).click(); await settle();
      const source = created.groups.find(box=>box.label==='Source');
      await page.locator(`.react-flow__node[data-id="${source.id}"] .project-group-drag-handle`).dblclick();
      await page.locator('input:visible').first().fill('Renamed Source');
      await page.getByRole('button',{name:'Save',exact:true}).click();
      const renamed = await snapshot('subsystem-renamed');
      assert.equal(renamed.groups.length,created.groups.length);
      assert.equal(renamed.groups.find(box=>box.id===source.id).label,'Renamed Source');
      assert.equal(renamed.rows.find(row=>row.fromFunction==='A').subsystem,'Renamed Source');
      assert.equal(renamed.rows.find(row=>row.fromFunction==='B').subsystem,'Destination');
      assert.deepEqual(geometry(renamed),geometry(created));
      await page.reload();
      await page.getByRole('button', { name: 'Manual diagram review', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('.react-flow')?.style.visibility === 'visible');
      const restored = await snapshot('subsystem-renamed-reload');
      assert.deepEqual(geometry(restored),geometry(renamed));
      verify(); console.log(JSON.stringify({mode,stages:output,errors},null,2)); return;
    }
    if (mode === 'drag') {
      const clear = page.getByTitle('Clear node selection and edge highlight',{exact:true});
      if (await clear.isEnabled()) await clear.click();
      await page.getByTitle('Add node',{exact:true}).click();
      const initial = await snapshot('root-function-created');
      const newId = initial.manual[0].id;
      const locator = page.locator(`.react-flow__node[data-id="${newId}"]`);
      const dragTo = async (label, transfer) => {
        await page.getByTitle('Fit entire diagram to view',{exact:true}).click(); await settle();
        const targetGroup = label && initial.groups.find(box=>box.label===label);
        const rect = await page.locator(targetGroup ? `.react-flow__node[data-id="${targetGroup.id}"]` : '.react-flow').boundingBox();
        const from = await locator.boundingBox();
        if (transfer) await page.keyboard.down('Alt');
        await page.mouse.move(from.x+from.width/2,from.y+from.height/2); await page.mouse.down();
        await page.mouse.move(label ? rect.x+rect.width/2 : rect.x+rect.width-60,label ? rect.y+rect.height/2 : rect.y+rect.height-90,{steps:15});
        await page.mouse.up();
        if (transfer) await page.keyboard.up('Alt');
        return snapshot(label ? 'drop-'+label : 'detach');
      };
      const source = await dragTo('Source',false);
      assert.equal(position(source,newId).parentId,initial.groups.find(box=>box.label==='Source').id);
      const destination = await dragTo('Destination',true);
      assert.equal(position(destination,newId).parentId,initial.groups.find(box=>box.label==='Destination').id);
      const detached = await dragTo(null,true);
      assert.equal(position(detached,newId).parentId,null);
      assert.deepEqual(position(detached,'n:A'),position(initial,'n:A'));
      assert.deepEqual(position(detached,'n:B'),position(initial,'n:B'));
      verify();
      console.log(JSON.stringify({mode,stages:output,errors},null,2)); return;
    }
    if (['manual', 'disconnected', 'rename', 'connected-drag'].includes(mode)) {
      await page.getByTitle('Fit entire diagram to view', { exact: true }).click();
      await settle();
      await page.locator(`.react-flow__node[data-id="${group.id}"] .project-group-drag-handle`).click();
      await page.getByTitle('Add node', { exact: true }).click();
      const added = await snapshot('add-node-with-subsystem-selected');
      const newId = added.rendered.find(node => node.id.startsWith('n:new:')).id;
      const newNode = page.locator(`.react-flow__node[data-id="${newId}"]`);
      if (mode === 'rename') {
        await newNode.dblclick();
        const label = page.locator('input:visible').first();
        await label.fill('Added Function');
        await page.getByRole('button',{name:'Save',exact:true}).click();
        const renamed = await snapshot('renamed');
        assert(renamed.rendered.some(node=>node.id==='n:Added Function'));
        assert(!renamed.rendered.some(node=>node.id===newId));
        assert.deepEqual(position(renamed,'n:Added Function'),position(added,newId));
        await page.reload();
        await page.getByRole('button', { name: 'Manual diagram review', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('.react-flow')?.style.visibility === 'visible');
        const restored = await snapshot('renamed-reload');
        assert.deepEqual(geometry(restored),geometry(renamed));
        verify(); console.log(JSON.stringify({mode,stages:output,errors},null,2)); return;
      }
      if (mode === 'disconnected') {
        await page.waitForTimeout(2000);
        await snapshot('idle-before-reload');
        await page.reload();
        await page.getByRole('button', { name: 'Manual diagram review', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('.react-flow')?.style.visibility === 'visible');
        await snapshot('disconnected-reload');
        verify();
        console.log(JSON.stringify({ browser: process.env.REVIEW_BROWSER || 'chromium', mode, stages: output, errors }, null, 2));
        return;
      }
      await page.getByTitle('Fit entire diagram to view', { exact: true }).click();
      await settle();
      const box = await page.locator(`.react-flow__node[data-id="${group.id}"]`).boundingBox();
      const fn = await newNode.boundingBox();
      await page.mouse.move(fn.x + fn.width / 2, fn.y + fn.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 12 });
      await page.mouse.up();
      await snapshot('drop-new-function-inside-subsystem');
      await newNode.click({ button: 'right' });
      await page.getByRole('button', { name: group.label, exact: true }).click();
      await snapshot('explicitly-assign-disconnected-function');
      await page.getByTitle('Fit entire diagram to view', { exact: true }).click();
      await settle();
      const source = await newNode.locator('[data-handleid="right-source-1"]').boundingBox();
      const target = await page.locator('.react-flow__node[data-id="n:A"] [data-handleid="left-target-1"]').boundingBox();
      await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
      await page.mouse.down();
      await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 15 });
      await page.mouse.up();
      await snapshot('connect-manual-function-to-A');
      await page.reload();
      await page.getByRole('button', { name: 'Manual diagram review', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('.react-flow')?.style.visibility === 'visible');
      await snapshot('manual-reload');
      verify();
      console.log(JSON.stringify({ browser: process.env.REVIEW_BROWSER || 'chromium', mode, stages: output, errors }, null, 2));
      return;
    }
    if (mode === 'nested') {
      await page.getByTitle('Fit entire diagram to view', { exact: true }).click();
      await settle();
      await page.locator(`.react-flow__node[data-id="${group.id}"] .project-group-drag-handle`).click({ button: 'right' });
      await page.getByRole('button', { name: 'Vehicle (System)', exact: true }).click();
      await snapshot('nest-manual-subsystem-in-system');
    }
    await page.getByTitle('Fit entire diagram to view', { exact: true }).click();
    await settle();
    await page.locator('.react-flow__node[data-id="n:A"]').click({ button: 'right' });
    await page.getByRole('button', { name: group.label, exact: true }).click();
    await snapshot('assign-A-to-manual-subsystem');
    await page.getByTitle('Undo last diagram change', { exact: true }).click();
    await snapshot('undo-assignment');
    await page.getByTitle('Redo diagram change', { exact: true }).click();
    await snapshot('redo-assignment');
    await page.reload();
    await page.getByRole('button', { name: 'Manual diagram review', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.react-flow')?.style.visibility === 'visible');
    await snapshot('reload');
    verify();
    console.log(JSON.stringify({ browser: process.env.REVIEW_BROWSER || 'chromium', mode, stages: output, errors }, null, 2));
  } catch (error) {
    console.log(JSON.stringify({ stages: output, failure: error.message }, null, 2));
    process.exitCode = 1;
  } finally { await browser.close(); }
})();
