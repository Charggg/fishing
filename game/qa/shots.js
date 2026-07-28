/* Screenshot rig. Drives the real game, freezes the sim, and captures frames.
   Software rendering here, so ignore FPS — this is for eyes only.
   Usage: node game/qa/shots.js [outDir]                                     */
const pw = require('./pw');
const path = require('path');
const fs = require('fs');

const GAME = 'file://' + path.resolve(__dirname, '..', 'index.html');
const OUT = process.argv[2] || path.resolve(__dirname, 'out');

const SHOTS = [
  { tag: 'dock-morning', frames: 60, setup: g => {
      g.state.hour = 9.4; g.player.pitch = -0.08;
    } },
  { tag: 'boat-boarded', frames: 90, setup: g => {
      g.state.hour = 7.2; g.player.pitch = -0.16;
      const sp = g.world.spawn(g.dock);
      g.player.x = sp.x; g.player.z = sp.z; g.player.yaw = sp.yaw;
      if (!g.boat.aboard) g.toggleBoat();
      g.player.yaw = g.boat.heading + 0.5;
    } },
  { tag: 'boat-rowing', frames: 420, setup: g => {
      g.state.hour = 8.0; g.player.pitch = -0.20;
      if (!g.boat.aboard) g.toggleBoat();
      if (g.boat.anchored) g.toggleAnchor();
      g.boat.heading = Math.atan2(-(30 - g.boat.x), -(-40 - g.boat.z));
      g.player.yaw = g.boat.heading;
      g.keys['w'] = true;
    } },
  { tag: 'boat-lookdown', frames: 30, setup: g => {
      g.keys['w'] = false; g.player.pitch = -0.62; g.player.yaw = g.boat.heading - 0.9;
    } },
  { tag: 'boat-dusk', frames: 300, setup: g => {
      g.state.hour = 18.6; g.player.pitch = -0.04;
      if (!g.boat.anchored) g.toggleAnchor();
      g.player.yaw = g.boat.heading + 2.2;
    } },
  { tag: 'fish-view', frames: 120, setup: g => {
      g.state.hour = 12.0; g.player.pitch = -0.72;
      const sp = g.spots.find(s => s.id === 'flat') || g.spots[1];
      if (!g.boat.aboard) g.toggleBoat();
      if (!g.boat.anchored) g.toggleAnchor();
      g.boat.x = sp.x; g.boat.z = sp.z;
      g.player.x = sp.x; g.player.z = sp.z;
      g.player.yaw = 1.1;
      g.keys['w'] = false;
      // Gather a shoal under the boat so the shot has something to show.
      let n = 0;
      for (const f of g.shoal.fish) {
        if (n >= 14) break;
        const a = n / 14 * Math.PI * 2, r = 2.5 + (n % 5) * 1.4;
        f.x = sp.x + Math.cos(a) * r;
        f.z = sp.z + Math.sin(a) * r;
        f.y = -1.1 - (n % 4) * 0.5;
        f.tx = f.x; f.tz = f.z; f.ty = f.y;
        if (n < 3) f.state = 'approach';
        n++;
      }
    } },
  { tag: 'sonar', frames: 600, setup: g => {
      g.state.hour = 10.2; g.player.pitch = -0.10;
      g.state.gear = ['sonar']; g.sonar.on = true;
      // Drift across the drop-off so the trace has real structure in it, not
      // a flat line: a sounder over featureless water proves nothing.
      const sp = g.spots.find(s => s.id === 'dropoff') || g.spots[0];
      if (!g.boat.aboard) g.toggleBoat();
      if (g.boat.anchored) g.toggleAnchor();
      g.boat.x = sp.x - 26; g.boat.z = sp.z - 26;
      g.player.x = g.boat.x; g.player.z = g.boat.z;
      g.boat.heading = Math.atan2(-(sp.x - g.boat.x), -(sp.z - g.boat.z));
      g.player.yaw = g.boat.heading;
      g.keys['w'] = true;
    } },
  { tag: 'boat-night-cast', frames: 200, setup: g => {
      g.keys['w'] = false;
      g.state.hour = 1.4; g.player.pitch = -0.14;
      g.state.lures = ['worm', 'glow']; g.state.lure = 'glow';
      g.mode = 'idle'; g.tackle.state = 'idle';
      g.mode = 'charging'; g.castPower = 0.75; g.doCast();
    } }
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
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
  });

  for (const shot of SHOTS) {
    await page.evaluate(({ src, frames }) => {
      const g = window.DEEPCAST;
      g.paused = true;
      new Function('g', src)(g);
      const wantHour = g.state.hour;
      for (let i = 0; i < frames; i++) { g.time += 1 / 60; g.update(1 / 60); }
      // Simulated frames advance the clock; pin it back to what the shot asked
      // for and settle the environment.
      g.state.hour = wantHour;
      for (let i = 0; i < 4; i++) { g.time += 1 / 60; g.update(1 / 60); g.state.hour = wantHour; }
    }, { src: '(' + shot.setup.toString() + ')(g)', frames: shot.frames });
    await page.waitForTimeout(3200);          // let the slow software frame land
    await page.screenshot({ path: path.join(OUT, shot.tag + '.png') });
    process.stdout.write(shot.tag + ' ');
  }
  console.log('\nerrors: ' + (errs.length ? errs.join('\n') : 'none'));
  await browser.close();
})();
