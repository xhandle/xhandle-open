const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');

function files(directory, accept = () => true) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
    if (['node_modules', '.git', '__pycache__', 'build', 'dist'].includes(entry.name)) return [];
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? files(file, accept) : entry.isFile() && accept(file) ? [file] : [];
  });
}
function fingerprint(root, directories = ['src', 'public', 'server', 'scripts/diagnostics']) {
  const hash = crypto.createHash('sha256');
  const inputs = [...directories.flatMap(directory => files(path.join(root, directory))), ...['package.json', 'package-lock.json', 'config-overrides.js', 'tailwind.config.js', 'server.js'].map(file => path.join(root, file)).filter(file => fs.existsSync(file))].sort();
  for (const file of inputs) hash.update(path.relative(root, file)).update('\0').update(fs.readFileSync(file)).update('\0');
  return { sha256: hash.digest('hex'), files: inputs.length };
}
function cleanEnvironment(extra = {}) {
  const names = ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'USER', 'LOGNAME', 'SystemRoot', 'WINDIR', 'COMSPEC', 'DISPLAY', 'XAUTHORITY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR'];
  return { ...Object.fromEntries(names.filter(name => process.env[name]).map(name => [name, process.env[name]])), CI: 'true', PYTHONDONTWRITEBYTECODE: '1', ...extra };
}
function killTree(child, signal = 'SIGTERM', descendants = new Set()) {
  if (!child.pid) return;
  // Playwright launches Electron in its own process group. Killing only the
  // runner group leaves the GUI and its helper processes behind on timeout.
  if (process.platform !== 'win32') {
    const pairs=execFileSync('ps',['-A','-o','pid=,ppid='],{encoding:'utf8'}).trim().split('\n').map(line=>line.trim().split(/\s+/).map(Number));
    const queue=[child.pid];
    for(let index=0;index<queue.length;index++)for(const [pid,parent]of pairs)if(parent===queue[index]&&!descendants.has(pid)){descendants.add(pid);queue.push(pid);}
    for(const pid of [...descendants].reverse())try{process.kill(pid,signal);}catch(error){if(error.code!=='ESRCH')throw error;}
  }
  try {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else {
      try { process.kill(-child.pid, signal); }
      catch (error) {
        if (error.code !== 'ESRCH') throw error;
        // Playwright Electron is not always a process-group leader on macOS.
        // Its children were handled above; still terminate the actual main PID.
        process.kill(child.pid, signal);
      }
    }
  } catch (error) { if (error.code !== 'ESRCH') throw error; }
}
async function command(executable, args, { cwd, env = cleanEnvironment(), log, timeoutMs = 600000 } = {}) {
  const stream = fs.createWriteStream(log);
  const started = Date.now();
  let tail = '', timedOut = false, interrupted = false, blockedEgress = false;
  const child = spawn(executable, args, { cwd, env, shell: false, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
  const descendants = new Set();
  const output = chunk => { stream.write(chunk); tail = (tail + chunk).slice(-500000); blockedEgress ||= tail.includes('REGRESSION_BLOCKED_EGRESS'); };
  child.stdout.on('data', output); child.stderr.on('data', output);
  const timer = setTimeout(() => { timedOut = true; killTree(child,'SIGTERM',descendants); }, timeoutMs);
  let hardTimer;
  const stop = () => { interrupted = true; killTree(child,'SIGTERM',descendants); clearTimeout(hardTimer); hardTimer=setTimeout(hardKill,8000); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  const hardKill = () => {
    if (!timedOut && !interrupted) return;
    killTree(child,'SIGKILL',descendants);
  };
  hardTimer = setTimeout(hardKill, timeoutMs + 8000);
  const result = await new Promise(resolve => {
    child.once('error', error => resolve({ exitCode: null, error: error.message }));
    child.once('close', (exitCode, signal) => resolve({ exitCode, signal }));
  });
  if ((timedOut || interrupted) && descendants.size) killTree(child,'SIGKILL',descendants);
  clearTimeout(timer); clearTimeout(hardTimer); process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
  await new Promise(resolve => stream.end(resolve));
  return { ...result, timedOut, interrupted, blockedEgress, durationMs: Date.now() - started, tail, log };
}
function resultFromOutput(output) {
  const match = [...output.matchAll(/RESULT\s+([^\r\n]*?\/result\.json)(?:\s|$)/g)].at(-1);
  if (!match) return null;
  const file = match[1];
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (data.failure || data.ok === false || data.errors?.length || data.failures?.length || !data.checks?.length) throw Error(`Diagnostic failed: ${file}: ${data.failure || JSON.stringify(data.errors || data.failures || [])}`);
  return { file, checks: data.checks, performance: data.performance, requests: data.requests?.length };
}
function markdown(report) {
  return [`# Electron regression report`, '', `Status: **${report.status}**`, '', `Runtime: ${report.platform} ${report.arch} · Node ${report.node} · Electron ${report.electronVersion || 'unavailable'}`, '',
    `Shared source: ${report.source.sha256} (${report.source.files} files).`, '',
    '| Suite | Result | Duration | Evidence |', '| --- | --- | ---: | --- |',
    ...report.suites.map(suite => `| ${suite.name} | ${suite.status} | ${(suite.durationMs / 1000).toFixed(1)} s | [log](${suite.log})${suite.evidence?.file ? ` · [result](${suite.evidence.file})` : ''} |`), '',
    '## Counts', '', ...report.suites.filter(suite=>suite.counts).map(suite=>`- ${suite.name}: ${JSON.stringify(suite.counts)}`), '',
    '## Coverage and limits', '', 'The list below describes the full gate. A partial selection only establishes coverage for the suites in the results table.', '', ...report.coverage.map(line => `- ${line}`), '',
    ...report.suites.filter(suite => suite.error).flatMap(suite => [`## ${suite.name}`, '', suite.error, '']),
    ...(report.fatal ? ['## Runner failure', '', report.fatal, ''] : []),
    'Only synthetic workspaces are used. Remote AI responses are controlled; provider correctness against live services is not established. Platform-specific runtime coverage applies only to the OS/architecture shown above. Tests do not establish signing, notarization, packaging or update-feed publication.', '',
  ].join('\n');
}
function electronFixtureMain(stage, root) {
  return `const {app,session}=require('electron');
app.setPath('userData',${JSON.stringify(path.join(root,'profile'))});
app.setPath('sessionData',${JSON.stringify(path.join(root,'session'))});
app.whenReady().then(()=>session.defaultSession.webRequest.onBeforeRequest((details,callback)=>{
  const url=new URL(details.url),allowed=['xhandle:','data:','blob:','devtools:','chrome:','chrome-extension:','file:'].includes(url.protocol)||['127.0.0.1','localhost','[::1]'].includes(url.hostname);
  if(!allowed)console.error('REGRESSION_BLOCKED_EGRESS '+url.hostname);
  callback({cancel:!allowed});
}));
require(${JSON.stringify(path.join(stage,'electron/main.cjs'))});`;
}
// Injected fixture bundles use the native origin for their real worker chunks.
// Only diagnostic chunks are copied; production bundles remain unchanged.
function stageFixtureWorkers(fixtures, stage) {
  for (const entry of fs.readdirSync(fixtures, { withFileTypes: true })) {
    const file = path.join(fixtures, entry.name);
    if (entry.isDirectory()) stageFixtureWorkers(file, stage);
    else if (entry.name.endsWith('.worker.js')) fs.copyFileSync(file, path.join(stage, 'stage/renderer', entry.name));
  }
}
module.exports = { stageFixtureWorkers, files, fingerprint, cleanEnvironment, command, resultFromOutput, markdown, killTree, electronFixtureMain };
