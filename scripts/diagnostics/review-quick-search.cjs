// Run against an isolated browser context; never connects to a user's browser.
// XHANDLE_PLAYWRIGHT_PATH=/path/to/playwright-core node scripts/diagnostics/review-quick-search.cjs
const fs = require('fs');
const assert = require('assert/strict');
const path = require('path');
const { webkit, chromium } = require(process.env.XHANDLE_PLAYWRIGHT_PATH || 'playwright-core');
const utils = fs.readFileSync(path.resolve(__dirname, '../../src/components/quickSearchUtils.js'), 'utf8').replace(/export /g, '');
(async () => {
  for (const [name, engine, opts] of [
    ['WebKit', webkit, {}],
    ['Chromium', chromium, process.env.XHANDLE_CHROME_PATH ? { executablePath: process.env.XHANDLE_CHROME_PATH } : {}],
  ]) {
    const browser = await engine.launch({ headless: true, ...opts });
    const page = await browser.newPage();
    await page.setContent('<main></main>');
    await page.addScriptTag({ content: utils });
    const data = await page.evaluate(() => {
      document.querySelector('main').innerHTML = '<table aria-label="Review"><tbody>'
        + '<tr><td>Visible row</td><td><select><option selected>Approved</option><option>Rejected</option></select></td><td style="display:none">hidden-secret</td></tr>'
        + '<tr style="visibility:hidden"><td>invisible-row</td></tr></tbody></table>';
      const entries = tableSearchEntries();
      const findings = {
        selectedValue: document.querySelector('select').value,
        rejectedMatches: filterSearchEntries(entries, 'Rejected').length,
        hiddenCellMatches: filterSearchEntries(entries, 'hidden-secret').length,
        hiddenRowMatches: filterSearchEntries(entries, 'invisible-row').length,
      };
      document.querySelector('main').innerHTML = '';
      const table = document.createElement('table');
      const body = document.createElement('tbody');
      table.append(body); document.querySelector('main').append(table);
      for (let i = 0; i < 343; i++) {
        const row = document.createElement('tr');
        for (let j = 0; j < 60; j++) {
          const cell = document.createElement('td');
          cell.textContent = 'Causal mechanism and verification requirement ' + i + '/' + j + ' '.repeat(2) + 'bounded response '.repeat(12);
          row.append(cell);
        }
        body.append(row);
      }
      table.getBoundingClientRect();
      const start = performance.now();
      const large = tableSearchEntries();
      findings.scan343x60Ms = Math.round(performance.now() - start);
      const queryStart = performance.now();
      for (let i = 0; i < 20; i++) filterSearchEntries(large, 'verification response');
      findings.averageQueryMs = Math.round((performance.now() - queryStart) / 20);
      return findings;
    });
    await page.goto(process.env.XHANDLE_URL || 'http://localhost:3000', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Quick search', exact: true }).waitFor();
    await page.evaluate(() => {
      const table = document.createElement('table');
      table.innerHTML = '<tbody>' + Array.from({length: 150}, (_, i) => '<tr><td>Braking ' + i + '</td></tr>').join('') + '</tbody>';
      document.body.append(table);
    });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.keyboard.press('Control+f');
    const input = page.getByRole('combobox', {name:'Search current view'});
    await input.fill('Braking');
    data.resultCount = await page.locator('[role="listbox"] [role="option"]').count();
    await page.locator('#quick-search-results').evaluate(el => { el.scrollTop = el.scrollHeight; });
    await input.fill('Brakin');
    data.firstResultOffscreenAfterRefine = await page.evaluate(() => {
      const list = document.querySelector('#quick-search-results').getBoundingClientRect();
      return document.querySelector('[role="option"]').getBoundingClientRect().bottom <= list.top;
    });
    await input.press('Backspace');
    data.textAfterBackspace = await input.inputValue();
    await input.evaluate(el => el.setSelectionRange(0, 0));
    await input.press('Delete');
    data.textAfterDelete = await input.inputValue();
    await input.press('Escape');
    data.pageErrors = errors;
    assert.equal(data.rejectedMatches, 0, name + ': unselected option matched');
    assert.equal(data.hiddenCellMatches, 0, name + ': hidden cell matched');
    assert.equal(data.hiddenRowMatches, 0, name + ': hidden row matched');
    assert.equal(data.firstResultOffscreenAfterRefine, false, name + ': active result offscreen');
    assert.equal(data.textAfterBackspace, 'Braki');
    assert.equal(data.textAfterDelete, 'raki');
    assert.deepEqual(data.pageErrors, []);
    console.log(JSON.stringify({browser:name,...data}, null, 2));
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
