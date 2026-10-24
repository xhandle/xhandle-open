#!/usr/bin/env python3
"""Read-only regex reproduction; isolated processes/profiles, no app data or AI calls.
Example: python3 docs/investigations/cpp-indexer-engine-probe.py --engine node --words 30
Use --source /path/to/file.cpp for real source. Requires locally installed engines.
"""
import argparse
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--engine', choices=['node', 'jsc', 'chrome', 'electron'], required=True)
p.add_argument('--source', type=Path)
p.add_argument('--words', type=int, default=30)
p.add_argument('--constructor-args', type=int, help='Generate a valid C++ constructor fixture')
p.add_argument('--legacy', action='store_true', help='Probe the old regex from commit 68c856b')
p.add_argument('--timeout', type=float, default=12)
p.add_argument('--executable', help='Override engine executable')
a = p.parse_args()
if a.legacy:
 implementation = subprocess.check_output(['git', 'show', '68c856b:src/components/generateFunctionalDecompositionFromGitHub.js'], cwd=ROOT, text=True)
 section = implementation.split('function extractFunctionRangesCpp(', 1)[1].split('\nfunction ', 1)[0]
 pattern = re.search(r'const pattern = (/.+/g);', section).group(1)
 setup = 'const pattern = '+pattern+';'
 operation = 'let matches=0; while(pattern.exec(source)) matches++;'
else:
 setup = (ROOT / 'src/features/code-architecture-context/cppSourceFunctions.js').read_text().replace('export function', 'function')
 operation = 'const ranges=extractCppSourceFunctions(source); const matches=ranges.length;'
source = a.source.read_text() if a.source else 'a ' * a.words + ';'
if a.constructor_args is not None:
 source = 'Widget::Widget(\n' + ',\n'.join('  const Type & value'+str(i) for i in range(a.constructor_args)) + '\n) : member_(value0) {}'
payload = """(() => {
 SETUP
 const source = SOURCE;
 const start = Date.now();
 try { OPERATION
 return {matches, elapsedMs: Date.now()-start}; }
 catch(error) { return {error: String(error), elapsedMs: Date.now()-start}; }
})()""".replace('SETUP', setup).replace('OPERATION', operation).replace('SOURCE', json.dumps(source))
defaults = {
 'node': 'node',
 'jsc': '/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc',
 'chrome': '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
 'electron': str(ROOT.parent / 'xhandle-desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),
}
with tempfile.TemporaryDirectory(prefix='xhandle-regex-probe-') as tmp:
 d = Path(tmp)
 exe = a.executable or defaults[a.engine]
 env = dict(os.environ)
 env.pop('ELECTRON_RUN_AS_NODE', None)
 if a.engine in ('node','jsc'):
  script = d/'probe.js'
  script.write_text(('console.log' if a.engine=='node' else 'print')+'(JSON.stringify('+payload+'));')
  cmd = [exe, str(script)]
 elif a.engine == 'chrome':
  html = d/'probe.html'
  html.write_text('<!doctype html><body>pending<script>document.body.textContent=JSON.stringify('+payload.replace('</', '<\\/')+');</script>')
  cmd = [exe, '--headless=new', '--no-first-run', '--no-default-browser-check',
         '--disable-extensions', '--disable-background-networking', '--user-data-dir='+str(d/'profile'),
         '--dump-dom', html.as_uri()]
 else:
  script = d/'main.cjs'
  script.write_text("""
const {app,BrowserWindow}=require('electron');
app.setPath('userData', PROFILE);
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
 await win.loadURL('data:text/html,<body>probe</body>');
 console.log('ENGINE '+JSON.stringify(process.versions));
 const timer=setTimeout(()=>{console.log('RENDERER_TIMEOUT');win.webContents.forcefullyCrashRenderer();app.exit(2)}, DEADLINE);
 try {
  const result=await win.webContents.executeJavaScript(PAYLOAD);
  clearTimeout(timer);console.log('RESULT '+JSON.stringify(result));app.exit(0);
 } catch(error) { clearTimeout(timer);console.log('RENDERER_ERROR '+String(error));app.exit(2); }
});
""".replace('PROFILE',json.dumps(str(d/'profile'))).replace('DEADLINE',str(max(100,int((a.timeout-2)*1000)))).replace('PAYLOAD',json.dumps(payload)))
  cmd = [exe,str(script)]
 proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env, start_new_session=True)
 try:
  out,err = proc.communicate(timeout=a.timeout)
  print(json.dumps({'engine':a.engine,'characters':len(source),'exitCode':proc.returncode,'stdout':out.strip(),'stderrTail':err[-1200:] if proc.returncode else ''}))
 except subprocess.TimeoutExpired:
  os.killpg(proc.pid,signal.SIGKILL)
  out,err = proc.communicate()
  print(json.dumps({'engine':a.engine,'characters':len(source),'timeoutSeconds':a.timeout,'stdout':out.strip()}))
