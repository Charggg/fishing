/* Viewmodel probe. Reports where each first-person piece lands in view space
   and on screen, and renders the rod with pieces suppressed one at a time so
   it is obvious which lump on screen is which.

   The point of this is that the viewmodel cannot be checked by reading the
   code: a sign error in one matrix mounts the whole rod upside down and it
   still "renders fine". Measure it instead.

   Usage: node game/qa/viewmodel.js [outDir]     (probe + identification shots)
          node game/qa/viewmodel.js --probe      (numbers only, no rendering)  */
const pw = require('./pw');
const path = require('path');
const fs = require('fs');

const GAME = 'file://' + path.resolve(__dirname, '..', 'index.html');
const PROBE_ONLY = process.argv.indexOf('--probe') >= 0;
const OUT = (PROBE_ONLY ? null : process.argv[2]) || path.resolve(__dirname, 'out');
const W = 1280, H = 720;

(async () => {
  if (!PROBE_ONLY) fs.mkdirSync(OUT, { recursive: true });
  const browser = await pw.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(GAME);
  await page.waitForFunction(() => window.DEEPCAST && window.DEEPCAST.started, { timeout: 180000 });
  await page.evaluate(() => {
    document.getElementById('start').classList.add('hidden');
    document.getElementById('hud').classList.remove('hidden');
    window.DEEPCAST.audio.enabled = false;
    const g = window.DEEPCAST;
    g.paused = true;
    g.state.hour = 9.4; g.player.pitch = -0.08;
    for (let i = 0; i < 60; i++) { g.time += 1 / 60; g.update(1 / 60); g.state.hour = 9.4; }
  });

  /* Sample the rig across a full crank revolution. Anything that only looks
     right at spin = 0 is a bug waiting to happen, which is exactly how the
     old left arm got shipped. */
  const frames = await page.evaluate(({ W, H }) => {
    const g = window.DEEPCAST, s = g.scene, r = g.renderer;
    const xf = (m, p) => {
      const w = [
        m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
        m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
        m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
      const v = r.view, e = [
        v[0] * w[0] + v[4] * w[1] + v[8] * w[2] + v[12],
        v[1] * w[0] + v[5] * w[1] + v[9] * w[2] + v[13],
        v[2] * w[0] + v[6] * w[1] + v[10] * w[2] + v[14]];
      const vp = r.viewProj, c = [
        vp[0] * w[0] + vp[4] * w[1] + vp[8] * w[2] + vp[12],
        vp[1] * w[0] + vp[5] * w[1] + vp[9] * w[2] + vp[13],
        vp[3] * w[0] + vp[7] * w[1] + vp[11] * w[2] + vp[15]];
      return { view: e.map(n => +n.toFixed(3)),
        px: [Math.round((c[0] / c[2] * 0.5 + 0.5) * W),
          Math.round((1 - (c[1] / c[2] * 0.5 + 0.5)) * H)] };
    };
    const out = [];
    for (let k = 0; k < 8; k++) {
      g.reelSpin = k / 8 * Math.PI * 2;
      g.updateRod(1 / 60);
      out.push({
        spin: +(k / 8).toFixed(3),
        rodGrip: xf(s.rod.matrix, [0, 0, 0]),
        rodTip: xf(s.rod.matrix, [0, 2.45, 0]),
        knob: xf(s.rod.handleMatrix, [0.05, 0.085, 0]),
        handR: xf(s.rod.handR, [0, 0, 0]),
        armEndR: xf(s.rod.handR, s.rod.armTipR),
        handL: xf(s.rod.handL, [0, 0, 0]),
        armEndL: xf(s.rod.handL, s.rod.armTipL)
      });
    }
    return out;
  }, { W, H });

  let bad = 0;
  const fail = m => { bad++; console.log('  FAIL ' + m); };
  const f0 = frames[0];
  console.log('rod    grip ' + f0.rodGrip.px + '  tip ' + f0.rodTip.px +
    '   (view grip y ' + f0.rodGrip.view[1] + ', tip y ' + f0.rodTip.view[1] + ')');
  if (f0.rodTip.view[1] <= f0.rodGrip.view[1]) fail('rod is upside down');
  if (f0.rodGrip.view[1] > 0) fail('rod grip is above eye level');
  for (const nm of ['rodGrip', 'rodTip']) {
    const p = f0[nm].px;
    if (p[0] < 0 || p[0] > W || p[1] < 0 || p[1] > H) fail(nm + ' is off screen at ' + p);
  }

  for (const side of ['R', 'L']) {
    const hs = frames.map(f => f['hand' + side]), as = frames.map(f => f['armEnd' + side]);
    const onScreen = hs.filter(h => h.px[0] > 0 && h.px[0] < W && h.px[1] > 0 && h.px[1] < H).length;
    const armY = as.map(a => a.px[1]);
    console.log('hand' + side + ' px ' + hs[0].px + ' -> arm end ' + as[0].px +
      '  (over a revolution: on screen ' + onScreen + '/8, arm end y ' +
      Math.min.apply(null, armY) + '..' + Math.max.apply(null, armY) + ')');
    if (onScreen < 8) fail('hand' + side + ' leaves the frame during the crank revolution');
    // The elbow is not modelled, so every arm must run off the bottom edge.
    for (let i = 0; i < 8; i++) {
      if (as[i].px[1] < H) { fail('arm' + side + ' ends inside the frame at ' + as[i].px +
        ' (spin ' + frames[i].spin + ') - severed stump'); break; }
      if (as[i].view[1] >= hs[i].view[1]) { fail('arm' + side + ' points up, not down'); break; }
    }
  }

  /* The forearms must not run through the opposite hand. Aimed straight down
     the left arm passes within a few pixels of the right fist and the two fuse
     into one indistinct column of flesh — which no per-piece check catches,
     because every piece is individually in the right place. */
  for (const [from, to] of [['L', 'R'], ['R', 'L']]) {
    const a = frames[0]['hand' + from].px, b = frames[0]['armEnd' + from].px;
    const h = frames[0]['hand' + to].px;
    const vx = b[0] - a[0], vy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((h[0] - a[0]) * vx + (h[1] - a[1]) * vy) / (vx * vx + vy * vy)));
    const d = Math.hypot(a[0] + vx * t - h[0], a[1] + vy * t - h[1]);
    console.log('arm' + from + ' passes ' + d.toFixed(0) + ' px from hand' + to);
    if (d < 34) fail('arm' + from + ' runs through hand' + to + ' (' + d.toFixed(0) + ' px) - limbs will fuse');
  }

  if (!PROBE_ONLY) {
    // Suppress one piece at a time so each lump can be identified by elimination.
    const KEYS = ['meshHandR', 'meshHandL', 'meshReelHandle'];
    const VARIANTS = [
      { tag: 'vm-all', hide: [] },
      { tag: 'vm-no-hands', hide: ['meshHandR', 'meshHandL'] },
      { tag: 'vm-no-reelhandle', hide: ['meshReelHandle'] },
      { tag: 'vm-rod-only', hide: KEYS }
    ];
    for (const v of VARIANTS) {
      await page.evaluate(({ hide, keys }) => {
        const r = window.DEEPCAST.renderer;
        r._stash = r._stash || {};
        for (const k of keys) {
          if (r._stash[k] === undefined) r._stash[k] = r[k];
          r[k] = hide.indexOf(k) >= 0 ? null : r._stash[k];
        }
        const g = window.DEEPCAST;
        g.reelSpin = 1.9;
        for (let i = 0; i < 3; i++) { g.time += 1 / 60; g.update(1 / 60); g.state.hour = 9.4; }
      }, { hide: v.hide, keys: KEYS });
      await page.waitForTimeout(3500);
      await page.screenshot({ path: path.join(OUT, v.tag + '.png'), timeout: 120000 });
      process.stdout.write(v.tag + ' ');
    }
    process.stdout.write('\n');
  }

  if (errs.length) { console.log('page errors:\n' + errs.join('\n')); bad += errs.length; }
  console.log(bad ? '\nVIEWMODEL: ' + bad + ' problem(s)' : '\nVIEWMODEL: ok');
  await browser.close();
  process.exit(bad ? 1 : 0);
})();
