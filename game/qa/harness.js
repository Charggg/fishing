/* =========================================================================
   DEEP CAST — qa/harness.js
   Headless QA. Boots the real game in Chromium, drives it with a scripted
   player, and asserts invariants that should hold no matter what.

   Run:  node game/qa/harness.js [sessions]
   Exits non-zero if any invariant fails, so it can gate a commit.
   ========================================================================= */
const { chromium } = require('playwright-core');
const path = require('path');

const GAME = 'file://' + path.resolve(__dirname, '..', 'index.html');
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const SESSIONS = parseInt(process.argv[2] || '3', 10);

(async () => {
  const browser = await chromium.launch({
    executablePath: CHROME,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required']
  });
  const page = await browser.newPage({ viewport: { width: 900, height: 520 } });

  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message + ' | ' + (e.stack || '').split('\n')[1]));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  await page.goto(GAME);
  await page.waitForFunction(() => window.DEEPCAST && window.DEEPCAST.started, { timeout: 180000 });

  const report = await page.evaluate(async (SESSIONS) => {
    const g = window.DEEPCAST, DC = window.DC;
    const dt = 1 / 60;
    g.paused = true;
    g.audio.enabled = false;

    const fails = [];
    const stats = { casts: 0, bites: 0, landed: 0, snapped: 0, thrown: 0, timeouts: 0, frames: 0 };
    let maxCast = 0, maxParticles = 0, maxRipples = 0, maxFishDrawn = 0, trackDeepest = 0;

    function fail(msg) { if (fails.length < 60) fails.push(msg); }
    function finite(v) { return typeof v === 'number' && isFinite(v); }

    /* ---- invariants checked every simulated frame ---------------------- */
    function check(tag) {
      stats.frames++;
      const p = g.player, t = g.tackle, f = g.fight, s = g.scene;

      if (!finite(p.x) || !finite(p.y) || !finite(p.z)) fail(tag + ': player position not finite');
      if (!finite(p.yaw) || !finite(p.pitch)) fail(tag + ': player angles not finite');
      if (Math.abs(p.pitch) > 1.6) fail(tag + ': pitch out of clamp ' + p.pitch);
      if (Math.hypot(p.x, p.z) > 520) fail(tag + ': player left the map at ' + p.x.toFixed(0) + ',' + p.z.toFixed(0));

      if (!finite(t.x) || !finite(t.y) || !finite(t.z)) fail(tag + ': tackle position not finite');
      if (t.state !== 'idle') {
        const d = Math.hypot(t.x - p.x, t.z - p.z);
        if (d > maxCast) maxCast = d;
        // Longest rod is cast 1.9; nothing should ever exceed ~90 m.
        if (d > 90) fail(tag + ': impossible cast distance ' + d.toFixed(1) + 'm (state ' + t.state + ')');
      }

      if (!finite(f.tension) || !finite(f.stamina) || !finite(f.line)) fail(tag + ': fight numbers not finite');
      if (f.active) {
        if (f.tension < -0.01 || f.tension > 1.26) fail(tag + ': tension out of range ' + f.tension);
        if (f.stamina < -0.01 || f.stamina > 1.01) fail(tag + ': stamina out of range ' + f.stamina);
        if (f.line < 0.3 || f.line > 200) fail(tag + ': line out of range ' + f.line);
        if (!f.fish) fail(tag + ': fight active with no fish');
      }
      // A fight that is over must not leave its panel or fish behind.
      if (!f.active && f.fish && g.mode !== 'fighting') fail(tag + ': stale fight.fish while not fighting');

      // Boat invariants: it must stay afloat, on the map, and finite.
      const b = g.boat;
      if (!finite(b.x) || !finite(b.z) || !finite(b.y) || !finite(b.heading)) fail(tag + ': boat state not finite');
      if (!finite(b.pitch) || !finite(b.roll)) fail(tag + ': boat tilt not finite');
      if (Math.hypot(b.x, b.z) > 185) fail(tag + ': boat left the lake');
      if (b.aboard) trackDeepest = Math.max(trackDeepest, g.world.depthAt(b.x, b.z));
      if (g.world.depthAt(b.x, b.z) < 0.4) fail(tag + ': boat beached in ' +
        g.world.depthAt(b.x, b.z).toFixed(2) + ' m');
      if (Math.hypot(b.vx, b.vz) > 8) fail(tag + ': boat speed runaway ' + Math.hypot(b.vx, b.vz).toFixed(1));
      if (b.aboard && Math.hypot(p.x - b.x, p.z - b.z) > 0.01) fail(tag + ': aboard but player detached from hull');
      if (b.aboard && Math.hypot(s.camPos[0] - b.x, s.camPos[2] - b.z) > 3) fail(tag + ': camera drifted off the boat');
      for (let u = 0; u < 3; u++) if (!finite(s.up[u])) fail(tag + ': camera up not finite');
      if (Math.abs(s.up[1]) < 0.5) fail(tag + ': camera up nearly horizontal (' + s.up[1].toFixed(2) + ')');

      if (g.particles.n > g.particles.max) fail(tag + ': particle pool overflow');
      if (g.ripples.n > g.ripples.max) fail(tag + ': ripple pool overflow');
      maxParticles = Math.max(maxParticles, g.particles.n);
      maxRipples = Math.max(maxRipples, g.ripples.n);

      if (!finite(g.state.hour) || g.state.hour < 0 || g.state.hour >= 24) fail(tag + ': clock broke: ' + g.state.hour);
      if (!finite(g.state.money) || g.state.money < 0) fail(tag + ': money broke: ' + g.state.money);
      if (!finite(s.exposure) || s.exposure <= 0) fail(tag + ': exposure broke: ' + s.exposure);
      for (const k of ['sunDir', 'lightDir', 'moonDir', 'sunColor', 'ambSky']) {
        const v = g.env[k];
        for (let i = 0; i < v.length; i++) if (!isFinite(v[i])) { fail(tag + ': env.' + k + ' not finite'); break; }
      }

      // Exactly one fish may be hooked, and it must be the one being fought.
      let hooked = 0;
      for (const fish of g.shoal.fish) if (fish.state === 'hooked') hooked++;
      if (hooked > 1) fail(tag + ': ' + hooked + ' fish hooked at once');
      if (hooked === 1 && !f.active) fail(tag + ': a fish is hooked but no fight is running');

      // No fish should be permanently invisible outside a fight.
      if (!f.active) {
        let ghosts = 0;
        for (const fish of g.shoal.fish) if (!fish.visible) ghosts++;
        if (ghosts > 0) fail(tag + ': ' + ghosts + ' invisible fish with no fight running');
      }
    }

    function step(n, tag) {
      for (let i = 0; i < n; i++) { g.time += dt; g.update(dt); check(tag); }
    }

    /* ---- one full fishing attempt -------------------------------------- */
    function attempt(rng, tag) {
      g.mode = 'idle'; g.tackle.state = 'idle'; g.tackle.active = false; g.mouse.down = false;
      g.player.pitch = -0.35 + rng() * 0.6;
      g.player.yaw += (rng() - 0.5) * 1.2;
      g.mode = 'charging';
      g.castPower = 0.1 + rng() * 0.9;
      g.doCast();
      stats.casts++;
      let t = 0;
      while (t < 90 * 60) {
        g.time += dt; g.update(dt); check(tag); t++;
        if (g.mode === 'bite') { stats.bites++; if (rng() < 0.85) g.setHook(); }
        if (g.mode === 'fighting') {
          const r = rng();
          g.mouse.down = r < 0.7 ? (g.fight.tension < 0.68 && g.fight.phase !== 'run') : r < 0.85;
        }
        if (!g.fight.active && g.fight.result) {
          if (g.fight.result === 'snapped') stats.snapped++;
          if (g.fight.result === 'thrown') stats.thrown++;
          g.fight.result = null;
          return;
        }
        if (g.ui.catchOpen) { stats.landed++; g.ui.closeCatch(); return; }
      }
      stats.timeouts++;
      g.reelIn();
    }

    /* ---- sessions ------------------------------------------------------ */
    const LURES = DC.Species.LURES.map(l => l.id);
    const RODS = DC.Species.RODS.map(r => r.id);
    g.state.lures = LURES.slice();
    g.state.rods = RODS.slice();

    let seed = 1234;
    function rng() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }

    step(300, 'warmup');

    for (let s = 0; s < SESSIONS; s++) {
      g.state.rod = RODS[s % RODS.length];
      g.state.lure = LURES[s % LURES.length];
      g.state.hour = (s * 3.7) % 24;
      g.weather.current = ['clear', 'cloudy', 'fog', 'rain', 'storm'][s % 5];
      g.weather.next = g.weather.current; g.weather.blend = 1; g.weather.timer = 9999;

      // Wander first — walking must never break anything.
      const keys = ['w', 'a', 's', 'd'];
      for (let k = 0; k < 4; k++) {
        const key = keys[(rng() * 4) | 0];
        g.keys[key] = true; g.keys['shift'] = rng() < 0.5;
        step(60, 'walk');
        g.keys[key] = false; g.keys['shift'] = false;
      }
      for (let a = 0; a < 5; a++) attempt(rng, 'session' + s);
      maxFishDrawn = Math.max(maxFishDrawn, g.shoal.pack(g.player.x, g.player.z, 200, null));
    }

    /* ---- the boat ------------------------------------------------------- */
    (function boatSession() {
      if (g.boat.aboard) g.toggleBoat();
      // Put the player back on the dock (earlier sessions leave them anywhere
      // on the shoreline), then walk the last stretch to the boat under power.
      const spawn = g.world.spawn(g.dock);
      g.player.x = spawn.x; g.player.z = spawn.z; g.player.yaw = spawn.yaw;
      g.player.y = g.groundAt(spawn.x, spawn.z) + 1.62;
      step(30, 'boat-reset');
      let guard = 0;
      while (g.boatDistance() > 3.4 && guard++ < 60) {
        const dx = g.boat.x - g.player.x, dz = g.boat.z - g.player.z;
        g.player.yaw = Math.atan2(-dx, -dz);
        g.keys['w'] = true; step(10, 'boat-approach');
      }
      g.keys['w'] = false;
      if (g.boatDistance() > 3.6) fail('boat: unreachable from the dock, ' +
        g.boatDistance().toFixed(1) + ' m away');
      g.toggleBoat();
      if (!g.boat.aboard) fail('boat: could not board from the dock');

      // Row around the lake in several directions, anchoring at random.
      for (let leg = 0; leg < 8; leg++) {
        g.boat.heading = rng() * Math.PI * 2;
        if (g.boat.anchored) g.toggleAnchor();
        g.keys['w'] = true;
        g.keys[rng() < 0.5 ? 'a' : 'd'] = rng() < 0.4;
        step(60 * 12, 'boat-row' + leg);
        g.keys['w'] = false; g.keys['a'] = false; g.keys['d'] = false;
        step(120, 'boat-coast' + leg);
        g.toggleAnchor();
        step(60, 'boat-anchored' + leg);
        // Fish from wherever we ended up.
        g.state.lure = LURES[(rng() * LURES.length) | 0];
        attempt(rng, 'boat-fish' + leg);
      }

      // Deliberately row at the shore to prove the collision holds.
      if (g.boat.anchored) g.toggleAnchor();
      for (let a = 0; a < 8; a++) {
        g.boat.heading = a / 8 * Math.PI * 2;
        g.keys['w'] = true; step(60 * 20, 'boat-ram' + a); g.keys['w'] = false;
      }

      // Anchoring, unanchoring and boarding must never wedge the state.
      for (let t = 0; t < 12; t++) { g.toggleAnchor(); step(10, 'boat-toggle'); }
      g.toggleBoat();
      step(60, 'boat-exit');
      if (g.boat.aboard) {
        // Legal outcome only if there was genuinely nowhere to stand.
        step(30, 'boat-exit-stuck');
      } else if (g.world.depthAt(g.player.x, g.player.z) > 1.05 &&
                 !g.world.onDock(g.dock, g.player.x, g.player.z)) {
        fail('boat: stepped out into ' + g.world.depthAt(g.player.x, g.player.z).toFixed(2) + ' m of water');
      }
    })();

    /* ---- hostile edge cases -------------------------------------------- */
    // Reel in mid-fight (used to strand the hooked fish).
    (function () {
      const fish = g.shoal.fish[0];
      fish.sp = DC.Species.byId['pike']; fish.kg = 9;
      fish.x = g.player.x + 10; fish.z = g.player.z + 10; fish.y = -2;
      g.tackle.state = 'water'; g.tackle.x = fish.x; g.tackle.z = fish.z;
      g.mode = 'bite'; g.engaged = fish; g.setHook();
      step(30, 'edge-reelin');
      g.reelIn();
      step(30, 'edge-reelin');
      if (g.fight.active) fail('edge: fight survived reelIn');
      if (!fish.visible) fail('edge: fish left invisible after reelIn');
    })();

    // Boarding is not allowed mid-fight.
    (function () {
      if (g.boat.aboard) g.toggleBoat();
      const fish = g.shoal.fish[1];
      fish.sp = DC.Species.byId['carp']; fish.kg = 5;
      fish.x = g.player.x + 8; fish.z = g.player.z + 8; fish.y = -2;
      g.tackle.state = 'water'; g.tackle.x = fish.x; g.tackle.z = fish.z;
      g.mode = 'bite'; g.engaged = fish; g.setHook();
      const wasAboard = g.boat.aboard;
      g.toggleBoat();
      if (g.boat.aboard !== wasAboard) fail('edge: boarded the boat mid-fight');
      step(20, 'edge-boatfight');
      g.reelIn();
      step(20, 'edge-boatfight');
    })();

    // Switch lure and rod mid-cast.
    g.mode = 'charging'; g.castPower = 0.8; g.doCast();
    step(20, 'edge-swap');
    g.selectLure('jig'); g.state.rod = 'abyss';
    step(60, 'edge-swap');
    g.reelIn();

    // Rest / time skip from every mode.
    g.rest(23); step(30, 'edge-rest');
    g.rest(6); step(30, 'edge-rest');

    // Cast straight down and straight up.
    for (const pitch of [-1.4, 1.4]) {
      g.mode = 'idle'; g.tackle.state = 'idle';
      g.player.pitch = pitch; g.mode = 'charging'; g.castPower = 1; g.doCast();
      step(400, 'edge-pitch' + pitch);
      g.reelIn();
    }

    // Long unattended soak: memory and pool stability.
    g.mode = 'idle'; g.tackle.state = 'idle';
    step(60 * 60 * 3, 'soak');

    // Save/load round trip.
    g.save();
    const before = JSON.stringify(g.state);
    g.load();
    if (JSON.stringify(g.state) !== before) fail('save/load did not round-trip');

    // UI renderers must survive whatever state we are in.
    try { g.ui.renderJournal(); } catch (e) { fail('renderJournal threw: ' + e.message); }
    try { g.ui.renderShop(); } catch (e) { fail('renderShop threw: ' + e.message); }
    try {
      g.ui.shopTab = 'rods'; g.ui.renderShop();
      g.ui.shopTab = 'rest'; g.ui.renderShop();
      g.ui.shopTab = 'lures';
    } catch (e) { fail('renderShop tab threw: ' + e.message); }

    let boatRange = 0, boatDeepest = 0;
    boatRange = Math.hypot(g.boat.x - g.dock.endX, g.boat.z - g.dock.endZ);
    boatDeepest = trackDeepest;
    return { fails, stats, maxCast, maxParticles, maxRipples, maxFishDrawn, boatRange, boatDeepest };
  }, SESSIONS);

  const { fails, stats, maxCast, maxParticles, maxRipples, maxFishDrawn } = report;

  console.log('sessions      ' + SESSIONS);
  console.log('frames        ' + stats.frames.toLocaleString());
  console.log('casts         ' + stats.casts);
  console.log('bites         ' + stats.bites);
  console.log('landed        ' + stats.landed);
  console.log('snapped       ' + stats.snapped);
  console.log('threw hook    ' + stats.thrown);
  console.log('no bite (90s) ' + stats.timeouts);
  console.log('max cast      ' + maxCast.toFixed(1) + ' m');
  console.log('peak particles' + String(maxParticles).padStart(6));
  console.log('peak ripples  ' + String(maxRipples).padStart(6));
  console.log('fish drawn    ' + maxFishDrawn);
  console.log('boat range    ' + report.boatRange.toFixed(0) + ' m from the dock');
  console.log('boat depth    ' + report.boatDeepest.toFixed(1) + ' m deepest water reached');
  console.log('');

  const allFails = fails.concat(errors);
  if (allFails.length) {
    console.log('FAILURES (' + allFails.length + '):');
    for (const f of allFails) console.log('  ✗ ' + f);
  } else {
    console.log('✓ all invariants held, no console errors');
  }

  await browser.close();
  process.exit(allFails.length ? 1 : 0);
})();
