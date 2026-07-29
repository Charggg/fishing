/* =========================================================================
   DEEP CAST — entities.js
   Wave field, fish shoal + AI, tackle physics, the fight simulation,
   and the particle / ripple pools.
   ========================================================================= */
(function (DC) {
  'use strict';

  var M = DC.M;
  var Sp = DC.Species;

  /* ------------------------------------------------------------------ waves
     One definition, shared by the GPU (uWaves) and the CPU (bobber float).
     Each entry is [dirX, dirZ, amplitude, wavelength]. */
  var WAVES = [
    [1.00, 0.22, 0.085, 17.0],
    [0.72, -0.70, 0.055, 9.5],
    [-0.35, 0.94, 0.038, 5.4],
    [0.94, 0.34, 0.022, 3.1],
    [-0.80, -0.60, 0.013, 1.7]
  ];

  function waveHeight(x, z, t, scale) {
    var y = 0;
    for (var i = 0; i < WAVES.length; i++) {
      var w = WAVES[i];
      var dl = Math.hypot(w[0], w[1]);
      var dx = w[0] / dl, dz = w[1] / dl;
      var amp = w[2] * scale;
      var k = M.TAU / w[3];
      var c = Math.sqrt(9.81 / k);
      y += amp * Math.sin(k * (dx * x + dz * z - c * t * 0.42));
    }
    return y;
  }

  /* --------------------------------------------------------------- particles
     One flat pool, no allocation during play. */
  function Particles(max) {
    this.max = max;
    this.n = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.fade = new Float32Array(max);
    // GPU-side interleaved instance data, rebuilt each frame.
    this.instPos = new Float32Array(max * 4);
    this.instCol = new Float32Array(max * 4);
  }
  Particles.prototype.spawn = function (x, y, z, vx, vy, vz, size, life, r, g, b, a, grav, drag, fade) {
    var i;
    if (this.n < this.max) i = this.n++;
    else i = (Math.random() * this.max) | 0;   // pool full: recycle at random
    var p3 = i * 3, p4 = i * 4;
    this.pos[p3] = x; this.pos[p3 + 1] = y; this.pos[p3 + 2] = z;
    this.vel[p3] = vx; this.vel[p3 + 1] = vy; this.vel[p3 + 2] = vz;
    this.col[p4] = r; this.col[p4 + 1] = g; this.col[p4 + 2] = b; this.col[p4 + 3] = a;
    this.size[i] = size;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.grav[i] = grav === undefined ? -9.81 : grav;
    this.drag[i] = drag === undefined ? 0.6 : drag;
    this.fade[i] = fade === undefined ? 1 : fade;
    return i;
  };
  Particles.prototype.update = function (dt) {
    var i = 0;
    while (i < this.n) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        var last = --this.n;
        if (i !== last) {
          this.pos.copyWithin(i * 3, last * 3, last * 3 + 3);
          this.vel.copyWithin(i * 3, last * 3, last * 3 + 3);
          this.col.copyWithin(i * 4, last * 4, last * 4 + 4);
          this.size[i] = this.size[last];
          this.life[i] = this.life[last];
          this.maxLife[i] = this.maxLife[last];
          this.grav[i] = this.grav[last];
          this.drag[i] = this.drag[last];
          this.fade[i] = this.fade[last];
        }
        continue;
      }
      var p3 = i * 3;
      var d = Math.exp(-this.drag[i] * dt);
      this.vel[p3] *= d;
      this.vel[p3 + 1] = (this.vel[p3 + 1] + this.grav[i] * dt) * d;
      this.vel[p3 + 2] *= d;
      this.pos[p3] += this.vel[p3] * dt;
      this.pos[p3 + 1] += this.vel[p3 + 1] * dt;
      this.pos[p3 + 2] += this.vel[p3 + 2] * dt;
      i++;
    }
  };
  Particles.prototype.pack = function () {
    for (var i = 0; i < this.n; i++) {
      var p3 = i * 3, p4 = i * 4;
      var t = this.life[i] / this.maxLife[i];
      this.instPos[p4] = this.pos[p3];
      this.instPos[p4 + 1] = this.pos[p3 + 1];
      this.instPos[p4 + 2] = this.pos[p3 + 2];
      this.instPos[p4 + 3] = this.size[i] * (this.fade[i] > 0 ? (0.55 + 0.45 * t) : 1);
      this.instCol[p4] = this.col[p4];
      this.instCol[p4 + 1] = this.col[p4 + 1];
      this.instCol[p4 + 2] = this.col[p4 + 2];
      this.instCol[p4 + 3] = this.col[p4 + 3] * Math.pow(M.sat(t), this.fade[i] > 0 ? 0.8 : 0.0);
    }
    return this.n;
  };

  /* ----------------------------------------------------------------- ripples */
  function Ripples(max) {
    this.max = max;
    this.n = 0;
    this.data = [];
    this.instPos = new Float32Array(max * 4);
    this.instParam = new Float32Array(max * 4);
  }
  Ripples.prototype.spawn = function (x, z, r0, r1, life, alpha, width) {
    var i;
    if (this.n < this.max) {
      i = this.n++;
    } else {
      // Pool full: retire the oldest, not the one we are about to add.
      var oldest = 0, bestAge = -1;
      for (var k = 0; k < this.n; k++) {
        var age = this.data[k].t / this.data[k].life;
        if (age > bestAge) { bestAge = age; oldest = k; }
      }
      i = oldest;
    }
    this.data[i] = { x: x, z: z, r0: r0, r1: r1, t: 0, life: life, alpha: alpha, width: width || 0.28 };
  };
  Ripples.prototype.update = function (dt) {
    var i = 0;
    while (i < this.n) {
      var d = this.data[i];
      d.t += dt;
      if (d.t >= d.life) {
        this.data[i] = this.data[--this.n];
        continue;
      }
      i++;
    }
  };
  Ripples.prototype.pack = function () {
    for (var i = 0; i < this.n; i++) {
      var d = this.data[i];
      var k = d.t / d.life;
      var r = M.lerp(d.r0, d.r1, 1 - Math.pow(1 - k, 2.2));
      this.instPos[i * 4] = d.x;
      this.instPos[i * 4 + 1] = 0;
      this.instPos[i * 4 + 2] = d.z;
      this.instPos[i * 4 + 3] = r;
      this.instParam[i * 4] = d.alpha * (1 - k) * (1 - k);
      this.instParam[i * 4 + 1] = M.clamp(d.width * (0.4 + 0.6 * (1 - k)), 0.05, 0.9);
      this.instParam[i * 4 + 2] = 0;
      this.instParam[i * 4 + 3] = 0;
    }
    return this.n;
  };

  /* -------------------------------------------------------------------- fish */
  function Fish(id) {
    this.id = id;
    this.x = 0; this.y = -2; this.z = 0;
    this.yaw = 0; this.pitch = 0;
    this.tx = 0; this.ty = -2; this.tz = 0;
    this.speed = 1; this.baseSpeed = 1;
    this.bend = 1;
    this.phase = Math.random() * 6.28;
    this.sp = null;
    this.kg = 0.3;
    this.len = 0.2;
    this.state = 'wander';
    this.timer = 0;
    this.interest = 0;
    this.spooked = 0;
    this.alive = true;
    this.visible = true;
  }

  function Shoal(world, count, seed, spots) {
    this.world = world;
    this.spots = spots || [];
    this.rng = M.mulberry32((seed ^ 0x51ed270b) >>> 0);
    this.fish = [];
    this.count = count;
    for (var i = 0; i < count; i++) {
      var f = new Fish(i);
      this.respawn(f, true);
      this.fish.push(f);
    }
    // Instance buffers (18 floats per fish across 5 attributes).
    this.iPosSize = new Float32Array(count * 4);
    this.iRot = new Float32Array(count * 4);
    this.iDorsal = new Float32Array(count * 3);
    this.iBelly = new Float32Array(count * 3);
    this.iFin = new Float32Array(count * 4);
    this.iShape = new Float32Array(count * 3);
    this.drawn = 0;
  }

  /* Place a fish, then choose a species that suits where it landed.
     Most of the shoal lives on structure — that is what makes a named spot
     actually hold its signature fish rather than just re-weighting a roll. */
  Shoal.prototype.respawn = function (f, initial) {
    var rng = this.rng, w = this.world;
    var x, z, depth, tries = 0, spot = null;

    if (this.spots.length && rng() < 0.66) {
      spot = this.spots[(rng() * this.spots.length) | 0];
      for (tries = 0; tries < 20; tries++) {
        var sa = rng() * M.TAU, sr = Math.sqrt(rng()) * spot.radius;
        x = spot.x + Math.cos(sa) * sr;
        z = spot.z + Math.sin(sa) * sr;
        depth = w.depthAt(x, z);
        if (depth >= 0.7) break;
      }
      if (depth < 0.7) spot = null;
    }
    if (!spot) {
      tries = 0;
      do {
        var ang = rng() * M.TAU;
        var r = Math.pow(rng(), 0.55) * 150;
        x = Math.cos(ang) * r; z = Math.sin(ang) * r;
        depth = w.depthAt(x, z);
        tries++;
      } while (depth < 0.7 && tries < 24);
    }

    var candidates = Sp.SPECIES;
    var sp = M.pickWeighted(rng, candidates, function (s) {
      var band = 1;
      if (depth < s.depth[0]) band = Math.exp(-Math.pow((s.depth[0] - depth) / 2.2, 2));
      else if (depth > s.depth[1] * 1.4) band = 0.25;
      var struct = 1;
      if (spot && spot.bias) {
        var b = spot.bias[s.id];
        struct = (b === undefined ? 0.35 : b);
      }
      return band * struct / (1 + s.rarity * 2.2);
    });
    f.home = spot;                      // fish hold on structure, they do not wander off it
    f.sp = sp;
    f.kg = Sp.rollWeight(sp, rng, 0.25);
    f.len = Sp.lengthFor(sp, f.kg) / 100;  // metres
    f.x = x; f.z = z;
    var lo = Math.min(sp.depth[0], depth * 0.8);
    var hi = Math.min(sp.depth[1], Math.max(depth - 0.35, 0.3));
    f.y = -M.randRange(rng, lo, Math.max(hi, lo + 0.1));
    f.baseSpeed = M.randRange(rng, 0.45, 1.05) * (0.75 + 0.35 / Math.max(f.len, 0.12));
    f.baseSpeed = M.clamp(f.baseSpeed, 0.35, 2.4);
    f.speed = f.baseSpeed;
    f.bend = M.randRange(rng, 0.85, 1.25);
    f.phase = rng() * M.TAU;
    f.state = 'wander';
    f.timer = rng() * 3;
    f.spooked = 0;
    this.pickTarget(f);
    if (initial) { f.tx = f.x; f.tz = f.z; f.ty = f.y; }
  };

  Shoal.prototype.pickTarget = function (f) {
    var rng = this.rng, w = this.world;
    var home = f.home;
    for (var i = 0; i < 10; i++) {
      var ang = rng() * M.TAU;
      var dist = M.randRange(rng, 4, 26);
      var tx, tz;
      if (home) {
        // Roam within the structure it lives on; if it has strayed, head back.
        var away = Math.hypot(f.x - home.x, f.z - home.z);
        if (away > home.radius * 1.15) {
          var back = home.radius * 0.55;
          tx = home.x + Math.cos(ang) * back * rng();
          tz = home.z + Math.sin(ang) * back * rng();
        } else {
          var hr = Math.sqrt(rng()) * home.radius;
          tx = home.x + Math.cos(ang) * hr;
          tz = home.z + Math.sin(ang) * hr;
        }
      } else {
        tx = f.x + Math.cos(ang) * dist;
        tz = f.z + Math.sin(ang) * dist;
      }
      var depth = w.depthAt(tx, tz);
      if (depth < 0.6) continue;
      if (Math.hypot(tx, tz) > 165) continue;
      var lo = Math.min(f.sp.depth[0], depth * 0.75);
      var hi = Math.min(f.sp.depth[1], Math.max(depth - 0.3, 0.35));
      f.tx = tx; f.tz = tz;
      f.ty = -M.randRange(rng, lo, Math.max(hi, lo + 0.15));
      return;
    }
    f.tx = f.x * 0.9; f.tz = f.z * 0.9; f.ty = f.y;
  };

  var _fwd = [0, 0, 0];
  Shoal.prototype.update = function (dt, ctx) {
    var w = this.world, rng = this.rng;
    for (var i = 0; i < this.fish.length; i++) {
      var f = this.fish[i];
      if (f.state === 'hooked' || f.state === 'landed') continue;

      f.timer -= dt;
      f.spooked = Math.max(0, f.spooked - dt * 0.5);

      var tx = f.tx, ty = f.ty, tz = f.tz, urgency = 1;

      if (f.state === 'approach' || f.state === 'inspect' || f.state === 'nibble' || f.state === 'strike') {
        if (!ctx.lure || !ctx.lure.active) { f.state = 'wander'; this.pickTarget(f); }
        else {
          tx = ctx.lure.x; ty = ctx.lure.y; tz = ctx.lure.z;
          urgency = f.state === 'approach' ? 1.6 : 0.35;
        }
      } else if (f.state === 'flee') {
        urgency = 2.2;
        if (f.timer <= 0) { f.state = 'wander'; this.pickTarget(f); }
      } else {
        if (f.timer <= 0) { this.pickTarget(f); f.timer = M.randRange(rng, 3, 9); }
      }

      var dx = tx - f.x, dy = ty - f.y, dz = tz - f.z;
      var dist = Math.hypot(dx, dy, dz);
      if (f.state === 'wander' && dist < 1.6) { this.pickTarget(f); f.timer = M.randRange(rng, 3, 9); }

      if (dist > 1e-4) {
        var nx = dx / dist, ny = dy / dist, nz = dz / dist;
        var wantYaw = Math.atan2(-nz, nx);
        var wantPitch = Math.asin(M.clamp(ny, -0.85, 0.85));
        var turn = M.clamp(2.4 * urgency * dt, 0, 0.5);
        f.yaw += M.angDiff(f.yaw, wantYaw) * turn;
        f.pitch += (wantPitch - f.pitch) * turn;
      }

      var sp = f.baseSpeed * urgency * (f.state === 'inspect' || f.state === 'nibble' ? 0.35 : 1);
      f.speed = M.damp(f.speed, sp, 3, dt);

      var cp = Math.cos(f.pitch);
      _fwd[0] = cp * Math.cos(f.yaw);
      _fwd[1] = Math.sin(f.pitch);
      _fwd[2] = -cp * Math.sin(f.yaw);
      f.x += _fwd[0] * f.speed * dt;
      f.y += _fwd[1] * f.speed * dt;
      f.z += _fwd[2] * f.speed * dt;

      // Stay in the water column: below the surface, above the bottom.
      var bottom = w.sample(f.x, f.z);
      var minY = bottom + 0.22 + f.len * 0.2;
      var maxY = -0.12 - f.len * 0.15;
      if (minY > maxY) { this.respawn(f); continue; }
      if (f.y < minY) { f.y = minY; f.pitch = Math.max(f.pitch, 0.05); }
      if (f.y > maxY) { f.y = maxY; f.pitch = Math.min(f.pitch, -0.05); }
      if (Math.hypot(f.x, f.z) > 172) {
        f.yaw = Math.atan2(f.z, -f.x);   // turn back toward the middle
      }

      // A fish that gets close enough starts inspecting the lure.
      if (f.state === 'approach') {
        var ld = Math.hypot(f.x - ctx.lure.x, f.y - ctx.lure.y, f.z - ctx.lure.z);
        if (ld < 0.55 + f.len * 0.5) {
          f.state = 'inspect';
          f.timer = M.randRange(rng, 0.4, 1.9) * ctx.lure.patience;
        }
      }
    }
  };

  // Pack visible fish into instance buffers. `skip` is the hooked fish, which
  // the caller draws itself with a bespoke transform.
  Shoal.prototype.pack = function (camX, camZ, maxDist, extra) {
    var n = 0;
    var list = this.fish;
    var d2max = maxDist * maxDist;
    for (var i = 0; i < list.length; i++) {
      var f = list[i];
      if (!f.visible) continue;
      var dx = f.x - camX, dz = f.z - camZ;
      if (dx * dx + dz * dz > d2max) continue;
      n = this.writeInstance(n, f, f.x, f.y, f.z, f.yaw, f.pitch, 1);
    }
    if (extra) {
      for (var e = 0; e < extra.length; e++) {
        var g = extra[e];
        n = this.writeInstance(n, g.fish, g.x, g.y, g.z, g.yaw, g.pitch, g.bendScale);
      }
    }
    this.drawn = n;
    return n;
  };

  Shoal.prototype.writeInstance = function (n, f, x, y, z, yaw, pitch, bendScale) {
    if (n >= this.count) return n;
    var sp = f.sp;
    var p4 = n * 4, p3 = n * 3;
    this.iPosSize[p4] = x;
    this.iPosSize[p4 + 1] = y;
    this.iPosSize[p4 + 2] = z;
    this.iPosSize[p4 + 3] = f.len;
    this.iRot[p4] = yaw;
    this.iRot[p4 + 1] = pitch;
    this.iRot[p4 + 2] = f.phase;
    this.iRot[p4 + 3] = f.bend * bendScale * (0.6 + f.speed * 0.55);
    this.iDorsal[p3] = sp.dorsal[0]; this.iDorsal[p3 + 1] = sp.dorsal[1]; this.iDorsal[p3 + 2] = sp.dorsal[2];
    this.iBelly[p3] = sp.belly[0]; this.iBelly[p3 + 1] = sp.belly[1]; this.iBelly[p3 + 2] = sp.belly[2];
    this.iFin[p4] = sp.fin[0]; this.iFin[p4 + 1] = sp.fin[1]; this.iFin[p4 + 2] = sp.fin[2];
    // Interested fish get a touch of extra light so you can watch one come to
    // the bait. Subtle enough to read as a flank flash, not a neon sign.
    var interest = (f.state === 'approach' || f.state === 'inspect' ||
                    f.state === 'nibble' || f.state === 'strike') ? 0.20 : 0;
    this.iFin[p4 + 3] = (sp.glow || 0) + interest;
    this.iShape[p3] = sp.body[0]; this.iShape[p3 + 1] = sp.body[1]; this.iShape[p3 + 2] = sp.body[2];
    return n + 1;
  };

  /* ------------------------------------------------------------------ tackle
     Bobber flight, floating, and the lure position that fish home in on. */
  function Tackle() {
    this.state = 'idle';      // idle | flying | water
    this.x = 0; this.y = 0; this.z = 0;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.bob = 0;             // extra vertical offset from nibbles
    this.bobVel = 0;
    this.tilt = 0;
    this.lureX = 0; this.lureY = 0; this.lureZ = 0;
    this.active = false;      // is the lure fishing?
    this.settle = 0;
    this.sank = 0;
    this.patience = 1;
    this.moving = 0;
  }

  Tackle.prototype.cast = function (ox, oy, oz, dirX, dirY, dirZ, power) {
    this.state = 'flying';
    this.x = ox; this.y = oy; this.z = oz;
    this.vx = dirX * power; this.vy = dirY * power; this.vz = dirZ * power;
    this.active = false;
    this.settle = 0;
    this.sank = 0;
    this.bob = 0; this.bobVel = 0;
  };

  Tackle.prototype.update = function (dt, world, time, waveScale, lure) {
    this.patience = lure.patience;
    if (this.state === 'flying') {
      this.vy -= 9.81 * dt;
      var drag = Math.exp(-0.035 * dt * Math.hypot(this.vx, this.vy, this.vz));
      this.vx *= drag; this.vy *= drag; this.vz *= drag;
      this.x += this.vx * dt; this.y += this.vy * dt; this.z += this.vz * dt;
      var surf = waveHeight(this.x, this.z, time, waveScale);
      var ground = world.sample(this.x, this.z);
      if (ground > surf && this.y <= ground + 0.05) {
        // Landed on dry ground — snag.
        this.state = 'water';
        this.y = ground + 0.05;
        this.active = false;
        this.settle = 0;
        return 'land';
      }
      if (this.y <= surf) {
        this.y = surf;
        this.state = 'water';
        this.settle = 0;
        this.sank = 0;
        this.bobVel = -Math.min(Math.abs(this.vy) * 0.28, 2.4);
        return 'splash';
      }
      return null;
    }

    if (this.state === 'water') {
      var s = waveHeight(this.x, this.z, time, waveScale);
      this.bobVel += (-this.bob) * 34 * dt;      // spring back to the surface
      this.bobVel *= Math.exp(-4.5 * dt);
      this.bob += this.bobVel * dt;
      this.y = s + this.bob;
      this.settle += dt;
      this.sank = M.damp(this.sank, 1, 1.6, dt);

      var depth = world.depthAt(this.x, this.z);
      var want = lure.depth * this.sank;
      this.lureY = -Math.min(want, Math.max(depth - 0.3, 0.15));
      this.lureX = this.x; this.lureZ = this.z;
      this.active = depth > 0.35 && this.settle > 0.25;
    }
    return null;
  };

  /* ------------------------------------------------------------------- fight
     A tug-of-war: reeling gains line but loads the rod; the fish runs to
     dump that load back. Hold too much tension and the line parts. */
  function Fight() {
    this.reset();
  }
  Fight.prototype.reset = function () {
    this.active = false;
    this.fish = null;
    this.line = 0;
    this.tension = 0;
    this.stamina = 1;
    this.phase = 'hold';
    this.phaseTime = 0;
    this.overTime = 0;
    this.jump = 0;
    this.angle = 0;
    this.elapsed = 0;
    this.headshake = 0;
    this.result = null;
    this.reeling = false;
    this.slack = 0;
    this.gained = 0;
  };
  /* `rng` is optional but the QA bot always passes one: without it this used
     Math.random and the whole commission playthrough became a coin toss,
     finishing anywhere between 7 and 12 commissions run to run. A gate that
     stochastic cannot tell a balance regression from luck. */
  Fight.prototype.begin = function (fish, dist, angle, rng) {
    rng = rng || Math.random;
    this.reset();
    this.active = true;
    this.fish = fish;
    this.line = dist;
    this.startLine = dist;
    this.tension = 0.22;
    this.stamina = 1;
    this.phase = 'run';
    this.phaseTime = 0.5 + rng() * 0.6;
    this.angle = angle;
    this.angleTarget = angle;
    this.weave = 0;
    this.weavePhase = rng() * M.TAU;
    this.swimAngle = angle;
    this.rise = 0;
  };

  /**
   * @param drag      0..1 player drag setting
   * @param rod       rod stats
   * @returns 'landed' | 'snapped' | 'thrown' | null
   */
  Fight.prototype.update = function (dt, reeling, drag, rod, rng) {
    if (!this.active) return null;
    var f = this.fish, fp = f.sp.fight;
    this.elapsed += dt;
    this.reeling = reeling;

    // Fish power scales with mass but with diminishing returns.
    var mass = Math.pow(f.kg, 0.62);
    var power = fp.strength * mass * 0.34;
    var lineStrength = rod.line * 1.0;

    this.phaseTime -= dt;
    if (this.phaseTime <= 0) {
      var tired = 1 - this.stamina;
      var r = rng();
      if (r < 0.42 * fp.runs * (1 - tired * 0.75)) {
        this.phase = 'run';
        this.phaseTime = M.randRange(rng, 0.6, 1.8) * (1 - tired * 0.4);
        // A target, not the angle itself — see the easing below.
        this.angleTarget += M.randRange(rng, -1.1, 1.1);
      } else if (r < 0.16 + tired * 0.62) {
        // A fresh fish rarely gives anything back. Tire it out first.
        this.phase = 'give';
        this.phaseTime = M.randRange(rng, 0.7, 1.9) * (0.6 + tired);
      } else {
        this.phase = 'hold';
        this.phaseTime = M.randRange(rng, 0.5, 1.4);
      }
      // Jumps: only from acrobatic species, near the surface, with gas left.
      if (this.phase === 'run' && fp.shake > 1.2 && this.stamina > 0.35 && rng() < 0.30) {
        this.jump = 0.85;
      }
    }

    var pull = 0;
    if (this.phase === 'run') pull = power * (0.75 + 0.55 * this.stamina);
    else if (this.phase === 'hold') pull = power * 0.46;
    else pull = -power * 0.12;
    var pullMag = Math.max(pull, 0);

    /* Where the fish actually is.
       The angle used to change only on a phase flip, so between phases the
       fish was frozen in place and then teleported sideways — from the boat it
       read as a fish that does not move at all. Now the phase change sets a
       TARGET and the fish sweeps toward it, with a constant weave on top so
       there is always something happening on the end of the line. A fresh fish
       on a run throws its head about; a beaten one barely wanders. */
    this.angle = M.damp(this.angle, this.angleTarget,
      this.phase === 'run' ? 2.4 : 1.1, dt);
    var life = 0.30 + 0.70 * this.stamina;
    var amp = (this.phase === 'run' ? 0.34 : this.phase === 'hold' ? 0.17 : 0.09) * life;
    this.weave =
      Math.sin(this.elapsed * (1.5 + fp.shake * 0.8) + this.weavePhase) * amp +
      Math.sin(this.elapsed * (3.6 + fp.shake * 1.6) + this.weavePhase * 1.7) * amp * 0.34;
    this.swimAngle = this.angle + this.weave;
    // Vertical wander, so it works the depth as well as the surface.
    this.rise = Math.sin(this.elapsed * (0.9 + fp.shake * 0.5) + this.weavePhase * 0.5) *
      (0.34 + 0.5 * this.stamina) * (this.phase === 'run' ? 1.0 : 0.55);

    // Headshakes spike the tension — that is the flutter you feel in the bar.
    this.headshake = Math.sin(this.elapsed * (7 + fp.shake * 5)) * fp.shake * 0.035 *
      (this.phase === 'run' ? 1 : 0.35) * this.stamina;

    var reelGain = 0;
    if (reeling) {
      var eff = rod.reel * (1.15 - drag * 0.45);
      reelGain = Math.max(eff * (1.90 - this.tension * 1.05), 0.05);
    }

    // Line in/out.
    var dLine = (pull * (1.25 - drag * 0.85)) - reelGain;
    this.line += dLine * dt;
    this.line = M.clamp(this.line, 0.35, this.startLine + 34);

    /* Tension.
       The load scales with how hard the fish is pulling, so a bluegill can be
       cranked straight in while a pike cannot. The drag setting is a ceiling:
       let go of the handle and the spool slips at roughly that value, which is
       why giving line saves you. Clamping the spool by reeling defeats it. */
    var load = pullMag * (0.30 + drag * 0.75);
    if (reeling) load += 0.22 + reelGain * 0.06 + pullMag * 0.80;
    var target = load / Math.max(lineStrength * 0.90, 0.05);
    var dragCap = 0.26 + drag * 0.66;
    target = Math.min(target, reeling ? dragCap + 0.48 : dragCap);
    this.tension = M.damp(this.tension, target, reeling ? 3.2 : 2.4, dt);
    this.tension += this.headshake;
    this.tension = M.clamp(this.tension, 0, 1.25);

    // Stamina drains with the load it is fighting against.
    var work = (0.055 + this.tension * 0.16) / (0.5 + fp.stamina * 0.85);
    this.stamina = Math.max(0, this.stamina - work * dt);

    if (this.jump > 0) this.jump = Math.max(0, this.jump - dt * 1.6);

    if (this.tension >= 1.0) {
      this.overTime += dt;
      if (this.overTime > 0.42) { this.active = false; this.result = 'snapped'; return 'snapped'; }
    } else {
      this.overTime = Math.max(0, this.overTime - dt * 1.5);
    }

    // Slack for too long and a lightly-hooked fish shakes free.
    if (this.tension < 0.045 && this.phase !== 'give') {
      this.slack = (this.slack || 0) + dt;
      if (this.slack > 2.6 && rng() < dt * 0.9) {
        this.active = false; this.result = 'thrown'; return 'thrown';
      }
    } else this.slack = 0;

    if (this.line <= 0.85) { this.active = false; this.result = 'landed'; return 'landed'; }
    return null;
  };

  DC.Ent = {
    WAVES: WAVES,
    waveHeight: waveHeight,
    Particles: Particles,
    Ripples: Ripples,
    Fish: Fish,
    Shoal: Shoal,
    Tackle: Tackle,
    Fight: Fight
  };
})(DC);
