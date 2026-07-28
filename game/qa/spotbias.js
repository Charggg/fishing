/* =========================================================================
   DEEP CAST — qa/spotbias.js
   Balance probe: does fishing a named spot actually change what you catch?
   Fishes each spot with a matching rig and tallies the species landed.

   Run:  node game/qa/spotbias.js
   Read the output, do not assert on it — this is a tuning instrument, not a
   pass/fail gate. Randomness means small counts swing.
   ========================================================================= */
const { chromium } = require('playwright-core');
const path = require('path');

const GAME = 'file://' + path.resolve(__dirname, '..', 'index.html');
const N = parseInt(process.argv[2] || '14', 10);

(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--no-sandbox', '--disable-dev-shm-usage']
  });
  const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
  page.on('pageerror', e => console.log('ERR ' + e.message));
  await page.goto(GAME);
  await page.waitForFunction(() => window.DEEPCAST && window.DEEPCAST.started, { timeout: 180000 });

  const out = await page.evaluate((N) => {
    const g = window.DEEPCAST, dt = 1 / 60;
    g.paused = true;
    g.audio.enabled = false;
    g.state.lures = ['worm', 'spinner', 'popper', 'jig', 'fly', 'glow', 'minnow'];
    g.state.rods = ['starter', 'graphite', 'baitcast', 'surf', 'abyss'];
    g.state.rod = 'abyss';

    // Park the boat on a spot, keep a lure in the water, and count what bites.
    function trial(spotId, lure, hour, n) {
      const sp = spotId ? g.spots.find(s => s.id === spotId) : null;
      const tally = {};
      let landed = 0, totalKg = 0;
      g.state.lure = lure;
      for (let a = 0; a < n; a++) {
        const x = sp ? sp.x : 0, z = sp ? sp.z : -100;
        g.state.hour = hour;
        g.boat.aboard = true; g.boat.anchored = true;
        g.boat.x = x; g.boat.z = z;
        g.player.x = x; g.player.z = z;
        g.mode = 'fishing';
        g.tackle.state = 'water'; g.tackle.active = true;
        g.tackle.settle = 1; g.tackle.sank = 1;
        g.tackle.x = x; g.tackle.z = z;
        g.tackle.lureX = x; g.tackle.lureZ = z;
        g.engaged = null; g.mouse.down = false;
        let t = 0;
        while (t < 60 * 70) {
          g.state.hour = hour;              // hold the clock for a clean read
          g.time += dt; g.update(dt); t++;
          if (g.tackle.state === 'idle') { g.tackle.state = 'water'; g.tackle.active = true; g.mode = 'fishing'; }
          if (g.mode === 'bite') g.setHook();
          if (g.mode === 'fighting') g.mouse.down = g.fight.tension < 0.7 && g.fight.phase !== 'run';
          if (g.ui.catchOpen) {
            const id = g.lastCatch.species.id;
            tally[id] = (tally[id] || 0) + 1;
            landed++; totalKg += g.lastCatch.kg;
            g.ui.closeCatch();
            break;
          }
          if (!g.fight.active && g.fight.result) { g.fight.result = null; break; }
        }
      }
      const top = Object.entries(tally).sort((a, b) => b[1] - a[1])
        .map(([k, v]) => k + '×' + v).join(' ');
      return (spotId || 'open water').padEnd(11) + ' ' + lure.padEnd(8) +
        String(hour).padStart(3) + 'h  ' + String(landed).padStart(2) + '/' + n +
        '  avg ' + (landed ? (totalKg / landed).toFixed(2) : '0.00').padStart(5) + ' kg  ' + top;
    }

    return [
      trial('deep', 'glow', 1, N),
      trial('deep', 'jig', 13, N),
      trial('flat', 'popper', 19, N),
      trial('reeds', 'worm', 10, N),
      trial('dock', 'worm', 10, N),
      trial('hump', 'spinner', 7, N),
      trial('dropoff', 'minnow', 6, N),
      trial('shelf', 'jig', 14, N),
      trial('point', 'spinner', 18, N),
      trial(null, 'worm', 12, N)
    ].join('\n');
  }, N);

  console.log(out);
  await browser.close();
})();
