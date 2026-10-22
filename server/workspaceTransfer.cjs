const net = require('node:net');
function validateBackend(data) {
  const invalid = () => { throw new Error('Invalid local-server workspace data.'); };
  if (!data || data.version !== 1 || typeof data.includeCredentials !== 'boolean' || !Array.isArray(data.baselines)) invalid();
  const ids = new Set();
  for (const row of data.baselines) {
    if (!row || !Number.isSafeInteger(row.id) || row.id < 1 || ids.has(row.id) || typeof row.name !== 'string' || typeof row.created_at !== 'string' || typeof row.decomposition_data !== 'string') invalid();
    ids.add(row.id); try { JSON.parse(row.decomposition_data); } catch { invalid(); }
  }
  if (data.repo !== null && (!data.repo || typeof data.repo.owner !== 'string' || typeof data.repo.repo !== 'string')) invalid();
  if (data.includeCredentials) {
    if (!Array.isArray(data.providerKeys) || data.repo?.token != null && typeof data.repo.token !== 'string') invalid();
    const providers = new Set();
    for (const row of data.providerKeys) {
      if (!row || !['openai','claude','gemini'].includes(row.provider) || providers.has(row.provider) || typeof row.api_key !== 'string' || ![0,1].includes(row.is_active) || typeof row.created_at !== 'string' || typeof row.updated_at !== 'string') invalid();
      providers.add(row.provider);
    }
    if (data.openai !== null && (!data.openai || typeof data.openai.api_key !== 'string' || typeof data.openai.created_at !== 'string' || typeof data.openai.updated_at !== 'string')) invalid();
  }
  return data;
}
async function connection(filename, action) {
  const sqlite3 = require('sqlite3');
  const db = await new Promise((resolve, reject) => { const db = new sqlite3.Database(filename, error => error ? reject(error) : resolve(db)); });
  db.configure('busyTimeout', 10000);
  const run = (sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, error => error ? reject(error) : resolve()));
  const all = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows)));
  try { return await action({ run, all }); }
  finally { await new Promise((resolve, reject) => db.close(error => error ? reject(error) : resolve())); }
}
async function exportBackend(filename, account, includeCredentials) {
  return connection(filename, async ({ run, all }) => {
    await run('BEGIN');
    try {
      const baselines = await all('SELECT id,name,created_at,COALESCE(decomposition_data,\'[]\') AS decomposition_data FROM baselines ORDER BY id');
      const repos = await all(`SELECT owner,repo${includeCredentials ? ',token' : ''} FROM github_configs WHERE account_id=?`, [account]);
      const result = { version: 1, includeCredentials, baselines, repo: repos[0] || null };
      if (includeCredentials) {
        result.providerKeys = await all('SELECT provider,api_key,is_active,created_at,updated_at FROM ai_provider_keys WHERE account_id=?', [account]);
        result.openai = (await all('SELECT api_key,created_at,updated_at FROM openai_keys WHERE account_id=?', [account]))[0] || null;
      }
      await run('COMMIT'); return result;
    } catch (error) { await run('ROLLBACK'); throw error; }
  });
}
async function importBackend(filename, account, input) {
  const data = validateBackend(input);
  return connection(filename, async ({ run }) => {
    await run('BEGIN IMMEDIATE');
    try {
      await run('DELETE FROM baselines');
      for (const row of data.baselines) await run('INSERT INTO baselines (id,name,created_at,decomposition_data) VALUES (?,?,?,?)', [row.id,row.name,row.created_at,row.decomposition_data]);
      if (data.repo) {
        if (data.includeCredentials) await run('INSERT INTO github_configs(account_id,owner,repo,token) VALUES (?,?,?,?) ON CONFLICT(account_id) DO UPDATE SET owner=excluded.owner,repo=excluded.repo,token=excluded.token', [account,data.repo.owner,data.repo.repo,data.repo.token || null]);
        else await run('INSERT INTO github_configs(account_id,owner,repo) VALUES (?,?,?) ON CONFLICT(account_id) DO UPDATE SET owner=excluded.owner,repo=excluded.repo', [account,data.repo.owner,data.repo.repo]);
      } else if (data.includeCredentials) await run('DELETE FROM github_configs WHERE account_id=?', [account]);
      else {
        await run("DELETE FROM github_configs WHERE account_id=? AND (token IS NULL OR token='')", [account]);
        await run("UPDATE github_configs SET owner='',repo='' WHERE account_id=?", [account]);
      }
      if (data.includeCredentials) {
        await run('DELETE FROM ai_provider_keys WHERE account_id=?', [account]);
        for (const row of data.providerKeys) await run('INSERT INTO ai_provider_keys(account_id,provider,api_key,is_active,created_at,updated_at) VALUES (?,?,?,?,?,?)', [account,row.provider,row.api_key,row.is_active,row.created_at,row.updated_at]);
        await run('DELETE FROM openai_keys WHERE account_id=?', [account]);
        if (data.openai) await run('INSERT INTO openai_keys(account_id,api_key,created_at,updated_at) VALUES (?,?,?,?)', [account,data.openai.api_key,data.openai.created_at,data.openai.updated_at]);
      }
      await run('COMMIT'); return { ok: true };
    } catch (error) { await run('ROLLBACK'); throw error; }
  });
}
function mountWorkspaceTransfer(app, getFilename) {
  app.use('/api/workspace-transfer', (req, res, next) => {
    const address = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
    if (!(address === '::1' || net.isIPv4(address) && address.startsWith('127.'))) return res.status(403).json({ error: 'Workspace transfer requires the local xHandle API server.' });
    res.set('Cache-Control', 'no-store');
    if (!getFilename()) return res.status(503).json({ error: 'Local workspace database is unavailable.' });
    next();
  });
  app.post('/api/workspace-transfer/export', async (req, res) => {
    try { res.json(await exportBackend(getFilename(), req.user.account_id, req.body?.includeCredentials === true)); }
    catch { res.status(503).json({ error: 'Could not export local-server data. No complete workspace file was created.' }); }
  });
  app.post('/api/workspace-transfer/validate', (req, res) => {
    try { validateBackend(req.body); res.json({ ok: true }); }
    catch (error) { res.status(400).json({ error: error.message }); }
  });
  app.post('/api/workspace-transfer/import', async (req, res) => {
    try { validateBackend(req.body); }
    catch (error) { return res.status(400).json({ error: error.message }); }
    try { res.json(await importBackend(getFilename(), req.user.account_id, req.body)); }
    catch { res.status(500).json({ error: 'Could not restore local-server data. Retry workspace recovery.' }); }
  });
}
module.exports = { mountWorkspaceTransfer, validateBackend, exportBackend, importBackend };
