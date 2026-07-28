/* Frame-cost benchmark.
   Usage: node game/qa/bench.js [preset] [frames] [width] [height]

   IMPORTANT — what this can and cannot tell you.

   There is no GPU here; Chromium runs on SwiftShader, a software rasteriser.
   So the absolute numbers are NOT frames per second on real hardware and must
   never be reported as such.

   What it *is* good for is A/B comparison of fragment shader cost. SwiftShader
   executes the same GLSL, so halving the per-pixel maths shows up here as a
   real drop in milliseconds. Run it, change something, run it again, and the
   ratio is meaningful even though neither absolute number is.

   gl.finish() after every frame, or the timings measure how fast the driver
   accepts commands rather than how long the work takes.                      */
const pw = require('./pw');
const path = require('path');

const GAME = 'file://' + path.resolve(__dirname, '..', 'index.html');
const PRESET = process.argv[2] || 'high';
const FRAMES = parseInt(process.argv[3] || '40', 10);
const W = parseInt(process.argv[4] || '960', 10);
const H = parseInt(process.argv[5] || '540', 10);

(async () => {
  const browser = await pw.launch();
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(GAME);
  await page.waitForFunction(() => window.DEEPCAST && window.DEEPCAST.started, { timeout: 180000 });

  const out = await page.evaluate(async ({ preset, frames }) => {
    const g = window.DEEPCAST;
    document.getElementById('start').classList.add('hidden');
    document.getElementById('hud').classList.remove('hidden');
    g.audio.enabled = false;
    g.paused = true;

    // A representative view: on the boat, looking across open water at the
    // treeline, which is the worst case for fog and prop overdraw.
    g.state.hour = 10.0;
    g.player.pitch = -0.05;
    const sp = g.spots.find(s => s.id === 'dropoff') || g.spots[0];
    if (!g.boat.aboard) g.toggleBoat();
    g.boat.x = sp.x; g.boat.z = sp.z;
    g.player.x = sp.x; g.player.z = sp.z;
    g.player.yaw = 0.7;
    for (let i = 0; i < 30; i++) { g.time += 1 / 60; g.update(1 / 60); g.state.hour = 10.0; }

    g.renderer.setQuality(preset, 190);
    const gl = g.renderer.gl;

    /* gl.finish() is not enough: it returns once the command buffer is
       accepted, so frames measure at ~0.2 ms and the benchmark lies. A
       one-pixel readPixels forces the whole pipeline to drain first. */
    const px = new Uint8Array(4);
    const sample = n => {
      const ts = [];
      for (let i = 0; i < n; i++) {
        g.time += 1 / 60;
        const t0 = performance.now();
        g.draw();
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        ts.push(performance.now() - t0);
      }
      return ts;
    };

    sample(8);                             // warm up: shader compile, caches
    const ts = sample(frames).sort((a, b) => a - b);
    const med = ts[ts.length >> 1];
    const mean = ts.reduce((a, b) => a + b, 0) / ts.length;
    const r = g.renderer;
    return {
      median: +med.toFixed(2), mean: +mean.toFixed(2),
      min: +ts[0].toFixed(2), max: +ts[ts.length - 1].toFixed(2),
      buffer: r.width + 'x' + r.height,
      quality: r.qualityName,
      fish: g.scene.fishCount || 0
    };
  }, { preset: PRESET, frames: FRAMES });

  console.log('preset ' + out.quality + '  buffer ' + out.buffer + '  fish ' + out.fish);
  console.log('  median ' + out.median + ' ms   mean ' + out.mean +
    ' ms   min ' + out.min + '   max ' + out.max);
  console.log('  (software rasteriser — compare runs, never quote as FPS)');
  if (errs.length) console.log('page errors:\n' + errs.join('\n'));
  await browser.close();
})();
