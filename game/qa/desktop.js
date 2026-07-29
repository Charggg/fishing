/* Smoke test for the Electron desktop shell.

   Runs the actual app, not a browser tab: boots it, waits for the game, and
   checks the things only the desktop build can get wrong — the preload bridge,
   the save file round-trip, and whether the window loaded the game at all
   (a packaged build that resolves GAME_DIR wrongly shows a blank window and
   nothing else notices).

   Usage: node game/qa/desktop.js [pathToPackagedBinary]
          With no argument it runs the dev app out of desktop/.             */
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

function electronAPI() {
  const roots = [
    path.join(__dirname, '..', '..', 'desktop', 'node_modules', 'playwright-core'),
    'playwright-core'
  ];
  let core = null;
  for (const r of roots) { try { core = require(r); break; } catch (e) { /* next */ } }
  if (!core) {
    const g = execSync('npm root -g', { encoding: 'utf8' }).trim();
    core = require(path.join(g, 'playwright', 'node_modules', 'playwright-core'));
  }
  return core._electron;
}

const APP_DIR = path.resolve(__dirname, '..', '..', 'desktop');
const BINARY = process.argv[2] || null;

(async () => {
  const _electron = electronAPI();
  let bad = 0;
  const fail = m => { bad++; console.log('  FAIL ' + m); };

  /* Playwright resolves Electron relative to itself, not to the app being
     launched, so point it at the binary directly. */
  const GL = ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
  let exe = BINARY;
  if (!exe) {
    const cand = path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron');
    if (fs.existsSync(cand)) exe = cand;
    else {
      try { exe = require(path.join(APP_DIR, 'node_modules', 'electron')); } catch (e) { /* leave undefined */ }
    }
  }
  const launchOpts = BINARY
    ? { executablePath: BINARY, args: GL }
    : { executablePath: exe, args: [APP_DIR].concat(GL), cwd: APP_DIR };

  const app = await _electron.launch(launchOpts);
  const win = await app.firstWindow({ timeout: 120000 });
  const errs = [];
  win.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  win.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });

  // Did it actually load the game, or an empty window?
  const title = await win.title();
  console.log('window title: ' + title);
  const hasCanvas = await win.evaluate(() => !!document.getElementById('gl'));
  if (!hasCanvas) fail('the window did not load the game (GAME_DIR resolved wrong?)');

  await win.waitForFunction(() => window.DEEPCAST && window.DEEPCAST.started, null, { timeout: 240000 });
  console.log('game booted');

  // The preload bridge must be present, and must NOT leak node into the page.
  const bridge = await win.evaluate(() => ({
    present: !!window.DEEPCAST_DESKTOP,
    keys: window.DEEPCAST_DESKTOP ? Object.keys(window.DEEPCAST_DESKTOP).sort() : [],
    leakedRequire: typeof window.require,
    leakedProcess: typeof window.process
  }));
  console.log('bridge: ' + JSON.stringify(bridge));
  if (!bridge.present) fail('preload bridge missing — saves would not reach disk');
  if (bridge.leakedRequire !== 'undefined') fail('node require() is exposed to the page');
  if (bridge.leakedProcess !== 'undefined') fail('node process is exposed to the page');

  // Save round-trip: write through the game, read back through the bridge.
  const saved = await win.evaluate(async () => {
    const g = window.DEEPCAST;
    g.state.money = 4242;
    g.save();
    await new Promise(r => setTimeout(r, 400));
    const onDisk = await window.DEEPCAST_DESKTOP.readSave();
    return { money: onDisk && onDisk.money, path: await window.DEEPCAST_DESKTOP.savePath() };
  });
  console.log('save file: ' + saved.path);
  if (saved.money !== 4242) fail('save did not reach disk (got ' + saved.money + ')');

  // WebGL2 must be real, and the renderer should report what it got.
  const gl = await win.evaluate(() => {
    const g = window.DEEPCAST;
    const c = g.renderer.gl;
    const dbg = c.getExtension('WEBGL_debug_renderer_info');
    return {
      version: c.getParameter(c.VERSION),
      renderer: dbg ? c.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : c.getParameter(c.RENDERER),
      quality: g.renderer.qualityName
    };
  });
  console.log('gl: ' + gl.version);
  console.log('device: ' + gl.renderer + '   preset ' + gl.quality);
  if (!/WebGL 2/.test(gl.version)) fail('not a WebGL2 context');

  if (errs.length) { console.log('page errors:\n' + errs.join('\n')); bad += errs.length; }
  await app.close();
  console.log(bad ? '\nDESKTOP: ' + bad + ' problem(s)' : '\nDESKTOP: ok');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.log('DESKTOP: launch failed\n' + e.message); process.exit(1); });
