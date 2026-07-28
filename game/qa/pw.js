/* The game itself has zero dependencies, so there is no node_modules here and
   `require('playwright-core')` only resolves when NODE_PATH happens to be set.
   Every QA script goes through this shim instead: it finds playwright-core in
   the global npm root and picks a Chromium out of the Playwright cache, so the
   scripts run with a plain `node game/qa/<script>.js` from any directory.     */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function loadCore() {
  const tried = [];
  let root = '';
  try { root = execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch (e) { /* npm may be absent */ }
  const cands = ['playwright-core', 'playwright'];
  if (root) cands.push(path.join(root, 'playwright-core'),
    path.join(root, 'playwright', 'node_modules', 'playwright-core'),
    path.join(root, 'playwright'));
  for (const c of cands) {
    try { return require(c); } catch (e) { tried.push(c); }
  }
  throw new Error('playwright-core not found. Tried:\n  ' + tried.join('\n  ') +
    '\nInstall it with `npm i -g playwright`.');
}

function findChrome() {
  if (process.env.QA_CHROME) return process.env.QA_CHROME;
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, '/opt/pw-browsers',
    path.join(process.env.HOME || '/root', '.cache', 'ms-playwright')].filter(Boolean);
  for (const r of roots) {
    let names = [];
    try { names = fs.readdirSync(r); } catch (e) { continue; }
    // Prefer full chromium over the headless shell: the shell has no GPU stack.
    names.sort((a, b) => (a.indexOf('headless') >= 0) - (b.indexOf('headless') >= 0));
    for (const n of names) {
      const exe = path.join(r, n, 'chrome-linux', 'chrome');
      if (fs.existsSync(exe)) return exe;
    }
  }
  return undefined;   // let Playwright fall back to its own lookup
}

const core = loadCore();

/* Launch Chromium with the flags the QA rigs need. Software rendering via
   SwiftShader, because there is no GPU in here — which is also why any FPS
   number measured by these scripts is meaningless. */
async function launch(extraArgs) {
  return core.chromium.launch({
    executablePath: findChrome(),
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--no-sandbox', '--disable-dev-shm-usage'].concat(extraArgs || [])
  });
}

module.exports = { chromium: core.chromium, launch: launch, findChrome: findChrome };
