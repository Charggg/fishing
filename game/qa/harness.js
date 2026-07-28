/* =========================================================================
   DEEP CAST — qa/harness.js
   Headless QA. Boots the real game in Chromium, drives it with a scripted
   player, and asserts invariants that should hold no matter what.

   Run:  node game/qa/harness.js [sessions]
   Exits non-zero if any invariant fails, so it can gate a commit.
   ========================================================================= */
const pw = require('./pw');
const path = require('path');

const GAME = 'file://' + path.resolve(__dirname, '..', 'index.html');
const SESSIONS = parseInt(process.argv[2] || '3', 10);

(async () => {
  const browser = await pw.launch(['--autoplay-policy=no-user-gesture-required']);
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

    const seenFail = Object.create(null);
    function fail(msg) {
      // Collapse repeats: a stuck frame otherwise emits the same line 2000 times.
      const key = msg.replace(/[-0-9.]+/g, '#');
      if (seenFail[key]) { seenFail[key]++; return; }
      seenFail[key] = 1;
      if (fails.length < 40) fails.push(msg);
    }
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

      /* The rod is a viewmodel built in camera space, so a sign error in the
         camera basis silently mounts it upside down and nothing else breaks.
         Assert the tip is above the grip and pointing away from the eye.

         All of this has to be measured against the CAMERA's up, not world Y.
         The rod is welded to the view, so looking down tips it below the
         horizon and looking up lifts the grip over the eye — both perfectly
         correct, and both of which a world-space version of this check calls
         a failure. */
      const rm = s.rod.matrix;
      const fw = s.forward, wu = s.up;
      let rx = fw[1] * wu[2] - fw[2] * wu[1],
        ry = fw[2] * wu[0] - fw[0] * wu[2],
        rz = fw[0] * wu[1] - fw[1] * wu[0];
      const rl = Math.hypot(rx, ry, rz) || 1;
      rx /= rl; ry /= rl; rz /= rl;
      const ux = ry * fw[2] - rz * fw[1],
        uy = rz * fw[0] - rx * fw[2],
        uz = rx * fw[1] - ry * fw[0];
      // Rod axis (local +Y) and grip offset, both projected onto camera up.
      const axisUp = rm[4] * ux + rm[5] * uy + rm[6] * uz;
      const gripUp = (rm[12] - s.camPos[0]) * ux + (rm[13] - s.camPos[1]) * uy +
        (rm[14] - s.camPos[2]) * uz;
      if (!finite(axisUp) || !finite(gripUp)) fail(tag + ': rod transform not finite');
      /* Only the rest pose. A cast deliberately whips the rod back past
         vertical, so axisUp goes negative for a few frames every cast and that
         is the animation working, not a broken basis. The bug this guards
         against lives in the camera basis and shows up at rest too. */
      const atRest = g.castAnim <= 0 && g.mode !== 'charging';
      if (atRest) {
        if (axisUp <= 0) fail(tag + ': rod is upside down (axis dot camera-up ' +
          axisUp.toFixed(2) + ')');
        if (gripUp > 0.05) fail(tag + ': rod grip is above eye level (' + gripUp.toFixed(2) + ')');
        const rdx = rm[4] * 2.45, rdy = rm[5] * 2.45, rdz = rm[6] * 2.45;
        if (rdx * s.forward[0] + rdy * s.forward[1] + rdz * s.forward[2] <= 0) {
          fail(tag + ': rod points back at the camera');
        }
      }

      // Commissions must stay in range and never go backwards.
      const qi = g.state.quest;
      if (!Number.isInteger(qi) || qi < 0 || qi > DC.Quests.LIST.length) {
        fail(tag + ': quest index out of range: ' + qi);
      }
      if (!Number.isInteger(g.state.questCount) || g.state.questCount < 0) {
        fail(tag + ': quest progress broke: ' + g.state.questCount);
      }
      if ((g.state.questsDone || []).length !== qi) {
        fail(tag + ': completed count ' + (g.state.questsDone || []).length + ' != index ' + qi);
      }

      // Spots: discovered ids must be real, and homed fish must point at a spot.
      if (g.state.spots) {
        for (const id in g.state.spots) {
          if (!g.spots.some(sp => sp.id === id)) fail(tag + ': unknown spot id in save: ' + id);
        }
      }

      /* Sonar. The ping buffer is unbounded-looking (it just pushes), so the
         cap is worth asserting: this runs every frame for an entire session
         and a leak here would be invisible until it ate the tab. */
      const sn = g.sonar, gear = DC.Species.gearById.sonar;
      if (sn.pings.length > gear.cols) {
        fail(tag + ': sonar buffer overflow, ' + sn.pings.length + ' > ' + gear.cols);
      }
      if (!g.hasSonar() && sn.pings.length) {
        fail(tag + ': sonar pinged without a sounder aboard');
      }
      for (let pi = sn.pings.length - 1; pi >= 0 && pi > sn.pings.length - 3; pi--) {
        const pg = sn.pings[pi];
        if (!finite(pg.depth) || pg.depth < 0) fail(tag + ': sonar depth bad: ' + pg.depth);
        for (const mk of pg.marks) {
          if (!finite(mk.d) || !finite(mk.gain)) fail(tag + ': sonar mark not finite');
          if (mk.gain < 0 || mk.gain > 1) fail(tag + ': sonar gain out of range ' + mk.gain);
          if (mk.d < -0.5) fail(tag + ': sonar mark above the surface: ' + mk.d);
        }
      }

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

      // Fit the sounder so the ping path is exercised for the whole boat run.
      g.state.gear = ['sonar'];
      g.sonar.on = true;

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

    /* ---- spots and the chart -------------------------------------------- */
    (function spotSession() {
      if (!g.spots || !g.spots.length) { fail('spots: none were found on the lake'); return; }
      if (g.spots.length < 6) fail('spots: only ' + g.spots.length + ' found, expected 8');

      // Every spot must sit in fishable water, inside the lake, and be distinct.
      for (let i = 0; i < g.spots.length; i++) {
        const sp = g.spots[i];
        if (!finite(sp.x) || !finite(sp.z) || !finite(sp.depth)) fail('spot ' + sp.id + ': not finite');
        if (g.world.depthAt(sp.x, sp.z) < 0.6) fail('spot ' + sp.id + ' is on dry land');
        if (Math.hypot(sp.x, sp.z) > 180) fail('spot ' + sp.id + ' is outside the lake');
        if (!sp.bias || !sp.name || !sp.hint) fail('spot ' + sp.id + ': missing metadata');
        for (const other of g.spots) {
          if (other === sp) continue;
          if (Math.hypot(other.x - sp.x, other.z - sp.z) < 12) {
            fail('spots ' + sp.id + ' and ' + other.id + ' are on top of each other');
          }
        }
      }

      // Every homed fish must reference a spot that exists.
      for (const f of g.shoal.fish) {
        if (f.home && !g.spots.some(sp => sp === f.home)) fail('fish homed to an unknown spot');
      }

      // Discover them all the honest way, by putting a lure on each.
      const before = Object.keys(g.state.spots || {}).length;
      for (const sp of g.spots) {
        g.tackle.state = 'water'; g.tackle.active = true;
        g.tackle.x = sp.x; g.tackle.z = sp.z;
        g.tackle.lureX = sp.x; g.tackle.lureZ = sp.z;
        g.trackSpot();
        if (!g.state.spots[sp.id]) fail('spot ' + sp.id + ' did not log when fished');
      }
      g.tackle.state = 'idle'; g.tackle.active = false;
      if (g.discoveredSpots().length !== g.spots.length) fail('discoveredSpots() disagrees with the save');
      if (Object.keys(g.state.spots).length < before) fail('discovering spots lost earlier ones');

      // The chart must render, twice (the terrain layer is cached on first use).
      try { g.ui.renderMap(); g.ui.renderMap(); }
      catch (e) { fail('renderMap threw: ' + e.message); }

      // Fish each spot briefly and confirm bites still happen out there.
      for (const sp of g.spots) {
        if (g.boat.aboard) g.toggleBoat();
        g.boat.x = sp.x; g.boat.z = sp.z; g.boat.anchored = true;
        g.player.x = sp.x; g.player.z = sp.z;
        g.boat.aboard = true;
        // Settle the camera before casting — doCast reads the rod transform,
        // which is derived from the camera, which updatePlayer owns.
        step(4, 'spot-settle');
        g.state.lure = LURES[(rng() * LURES.length) | 0];
        attempt(rng, 'spot-' + sp.id);
      }
      if (g.boat.aboard) g.toggleBoat();
    })();

    /* ---- commissions ---------------------------------------------------- */
    (function questSession() {
      const Q = DC.Quests;
      if (!Q || !Q.LIST.length) { fail('quests: none defined'); return; }

      // Every goal must summarise without throwing, and read as English.
      for (const q of Q.LIST) {
        if (!q.id || !q.title || !q.text || !q.goal || !q.reward) fail('quest ' + q.id + ': incomplete');
        let text;
        try { text = Q.summarise(q.goal); }
        catch (e) { fail('summarise(' + q.id + ') threw: ' + e.message); continue; }
        if (!text || text.length < 3) fail('quest ' + q.id + ': empty summary');
        if (/undefined|NaN|\[object/.test(text)) fail('quest ' + q.id + ': broken summary "' + text + '"');
        if (q.goal.spot && !g.spots.some(sp => sp.id === q.goal.spot)) {
          fail('quest ' + q.id + ' names a spot that does not exist: ' + q.goal.spot);
        }
        const sps = q.goal.species ? (Array.isArray(q.goal.species) ? q.goal.species : [q.goal.species]) : [];
        for (const id of sps) if (!DC.Species.byId[id]) fail('quest ' + q.id + ': unknown species ' + id);
        if (q.reward.unlock && !DC.Species.lureById[q.reward.unlock]) {
          fail('quest ' + q.id + ': unlock is not a lure');
        }
      }

      // A catch that matches nothing must never advance the chain.
      const startIdx = g.state.quest;
      const dud = {
        species: DC.Species.byId['bluegill'], kg: 0.1, grade: 0.1, hour: 12,
        weather: 'clear', lure: DC.Species.lureById['worm'], spot: null,
        fromBoat: false, range: 0
      };
      for (let i = 0; i < 5; i++) g.checkCommission(dud);
      if (g.state.quest < startIdx) fail('quests: chain went backwards');

      // Force each commission to complete and check the payout and hand-off.
      let money = g.state.money;
      for (let guard = 0; guard < Q.LIST.length + 2; guard++) {
        const q = g.commission();
        if (!q) break;
        const need = q.goal.distinctSpots || q.goal.count || 1;
        // Build a catch that satisfies whatever this goal asks for.
        for (let n = 0; n < need + 1; n++) {
          // Pick a species that satisfies whatever the goal actually asks for:
          // a named one, or failing that one of the required rarity.
          let spec;
          if (q.goal.species) {
            spec = DC.Species.byId[Array.isArray(q.goal.species) ? q.goal.species[0] : q.goal.species];
          } else if (q.goal.rarity !== undefined) {
            spec = DC.Species.SPECIES.find(s2 => s2.rarity >= q.goal.rarity);
            if (!spec) { fail('quest ' + q.id + ': no species meets rarity ' + q.goal.rarity); break; }
          } else {
            spec = DC.Species.byId['largemouth'];
          }
          const spotId = q.goal.spot || (q.goal.anySpot || q.goal.distinctSpots
            ? g.spots.filter(s2 => s2.id !== q.goal.excludeSpot)[n % (g.spots.length - 1)].id
            : null);
          const c = {
            species: spec,
            kg: Math.max(q.goal.minKg || 0, spec.kg[1]) ,
            grade: 1, hour: q.goal.hours ? (q.goal.hours[0] + 0.5) % 24 : 12,
            weather: q.goal.weather ? (Array.isArray(q.goal.weather) ? q.goal.weather[0] : q.goal.weather) : 'clear',
            lure: DC.Species.lureById[q.goal.lure || 'worm'],
            spot: spotId ? g.spots.find(s2 => s2.id === spotId) : null,
            fromBoat: true, range: 200
          };
          const res = g.checkCommission(c);
          if (res && res.completed) {
            if (g.state.money <= money) fail('quest ' + q.id + ': completing it paid nothing');
            money = g.state.money;
            break;
          }
          if (n === need) fail('quest ' + q.id + ' did not complete after ' + (need + 1) + ' qualifying catches');
        }
        check('quest-' + q.id);
      }
      if (g.commission() !== null) fail('quests: chain did not run to the end');

      try { g.ui.renderQuests(); } catch (e) { fail('renderQuests threw: ' + e.message); }
      // Put the chain back to the start so later sections see a normal state.
      g.state.quest = 0; g.state.questCount = 0; g.state.questsDone = []; g.state.questSpots = [];
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
    return {
      fails, stats, maxCast, maxParticles, maxRipples, maxFishDrawn, boatRange, boatDeepest,
      spotCount: (g.spots || []).length,
      spotsLogged: Object.keys(g.state.spots || {}).length,
      questCount: DC.Quests.LIST.length
    };
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
  console.log('spots         ' + report.spotCount + ' found, ' + report.spotsLogged + ' logged');
  console.log('commissions   ' + report.questCount + ' in the chain, all verified completable');
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
