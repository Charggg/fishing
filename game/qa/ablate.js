/* Ablation study: turn one thing off at a time and measure what it was
   costing. Same caveat as bench.js — software rasteriser, so treat these as
   proportions of a frame, never as milliseconds on real hardware.

   This exists because guessing was wrong. The first optimisation I was sure
   about (per-pixel sky in the fog) turned out to be 6% of the frame.

   Usage: node game/qa/ablate.js [preset] [frames]                            */
const pw = require('./pw');
const path = require('path');

const GAME = 'file://' + path.resolve(__dirname, '..', 'index.html');
const PRESET = process.argv[2] || 'high';
const FRAMES = parseInt(process.argv[3] || '16', 10);

(async () => {
  const browser = await pw.launch();
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(GAME);
  await page.waitForFunction(() => window.DEEPCAST && window.DEEPCAST.started, { timeout: 180000 });

  const rows = await page.evaluate(async ({ preset, frames }) => {
    const g = window.DEEPCAST;
    document.getElementById('start').classList.add('hidden');
    document.getElementById('hud').classList.remove('hidden');
    g.audio.enabled = false;
    g.paused = true;
    g.state.hour = 10.0; g.player.pitch = -0.05;
    const sp = g.spots.find(s => s.id === 'dropoff') || g.spots[0];
    if (!g.boat.aboard) g.toggleBoat();
    g.boat.x = sp.x; g.boat.z = sp.z;
    g.player.x = sp.x; g.player.z = sp.z; g.player.yaw = 0.7;
    for (let i = 0; i < 30; i++) { g.time += 1 / 60; g.update(1 / 60); g.state.hour = 10.0; }
    g.renderer.setQuality(preset, 190);

    const r = g.renderer, gl = r.gl, px = new Uint8Array(4);
    const time = n => {
      const ts = [];
      for (let i = 0; i < n; i++) {
        g.time += 1 / 60;
        const t0 = performance.now();
        g.draw();
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        ts.push(performance.now() - t0);
      }
      ts.sort((a, b) => a - b);
      return ts[ts.length >> 1];
    };

    const orig = {};
    for (const k of ['_drawTerrain', '_drawProps', '_drawFish', '_drawSolids', '_post']) orig[k] = r[k];
    const noop = function () {};
    const restore = () => { for (const k in orig) r[k] = orig[k]; r._benchNoRefl = r._benchNoRefr = false; };

    time(6);                                     // warm up
    const base = time(frames);
    const out = [{ name: 'baseline', ms: base, saved: 0 }];

    const cases = [
      ['no terrain (x3 passes)', () => { r._drawTerrain = noop; }],
      ['no props/trees (x3)', () => { r._drawProps = noop; }],
      ['no fish (x3)', () => { r._drawFish = noop; }],
      ['no solids (boat/dock/rod)', () => { r._drawSolids = noop; }],
      ['no post (bloom+tonemap)', () => { r._post = noop; }],
      ['no reflection pass', () => { r._benchNoRefl = true; }],
      ['no refraction pass', () => { r._benchNoRefr = true; }],
      ['no water surface', () => { r._benchNoWater = true; }],
      ['no sky dome', () => { r._benchNoSky = true; }]
    ];
    for (const [name, apply] of cases) {
      restore(); r._benchNoWater = false; r._benchNoSky = false;
      apply();
      const ms = time(frames);
      out.push({ name, ms, saved: +(base - ms).toFixed(1), pct: +((base - ms) / base * 100).toFixed(1) });
    }
    restore(); r._benchNoWater = false; r._benchNoSky = false;
    return { base, out, buffer: r.width + 'x' + r.height };
  }, { preset: PRESET, frames: FRAMES });

  console.log('preset ' + PRESET + '  buffer ' + rows.buffer +
    '  baseline ' + rows.base.toFixed(1) + ' ms/frame (software)');
  console.log('');
  for (const r of rows.out) {
    if (r.name === 'baseline') continue;
    const bar = '#'.repeat(Math.max(0, Math.round(r.pct / 2)));
    console.log('  ' + String(r.pct).padStart(5) + '%  ' +
      String(r.saved).padStart(7) + ' ms  ' + r.name.padEnd(28) + bar);
  }
  if (errs.length) console.log('page errors:\n' + errs.join('\n'));
  await browser.close();
})();
