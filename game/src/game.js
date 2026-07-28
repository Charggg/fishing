/* =========================================================================
   DEEP CAST — game.js
   Boot, world assembly, input, the player, the clock and weather, and the
   cast -> bite -> hookset -> fight -> land loop that the whole thing exists for.
   ========================================================================= */
(function (DC) {
  'use strict';

  var M = DC.M, M4 = DC.M4, F = DC.F;
  var Sp = DC.Species, Ent = DC.Ent, A = DC.Assets;

  var SAVE_KEY = 'deepcast.save.v1';

  var WEATHERS = {
    clear:  { label: 'Clear',    icon: '☀️', cloud: 0.16, dark: 0.00, turb: 2.2, wind: 0.24, fog: 0.00050, wave: 1.00, rain: 0 },
    cloudy: { label: 'Overcast', icon: '☁️', cloud: 0.68, dark: 0.30, turb: 3.6, wind: 0.45, fog: 0.00105, wave: 1.30, rain: 0 },
    fog:    { label: 'Fog',      icon: '🌫️', cloud: 0.34, dark: 0.18, turb: 6.5, wind: 0.08, fog: 0.00900, wave: 0.55, rain: 0 },
    rain:   { label: 'Rain',     icon: '🌧️', cloud: 0.92, dark: 0.55, turb: 4.8, wind: 0.62, fog: 0.00260, wave: 1.70, rain: 1 },
    storm:  { label: 'Storm',    icon: '⛈️', cloud: 1.00, dark: 0.82, turb: 7.5, wind: 0.98, fog: 0.00380, wave: 2.50, rain: 2 }
  };
  var WEATHER_ORDER = ['clear', 'clear', 'cloudy', 'cloudy', 'fog', 'rain', 'storm'];

  // Preetham constants (see shaders.js for the matching fragment code).
  var TOTAL_RAYLEIGH = [5.804542996261093e-6, 1.3562911419845635e-5, 3.0265902468824876e-5];
  var MIE_CONST = [1.8399918514433978e14, 2.7798023919660528e14, 4.0790479543861094e14];

  function Game(canvas, ui) {
    this.canvas = canvas;
    this.ui = ui;
    this.audio = new DC.Audio();
    this.rng = M.mulberry32((Date.now() ^ 0x2545f491) >>> 0);
    this.mode = 'idle';
    this.paused = false;
    this.started = false;
    this.time = 0;
    this.frame = 0;
    this.fps = 60;
    this.lastNow = 0;

    this.keys = Object.create(null);
    this.mouse = { down: false, downTime: 0, sensitivity: 1.0, invert: false };
    this.pointerLocked = false;

    this.player = {
      x: 0, y: 0, z: 0, yaw: 0, pitch: -0.06,
      vy: 0, bob: 0, bobPhase: 0, onDock: false, wading: 0, stepAccum: 0
    };

    this.state = this.defaultState();
    this.env = {
      sunDir: new Float32Array([0, 1, 0]),
      lightDir: new Float32Array([0, 1, 0]),
      moonDir: new Float32Array([0, -1, 0]),
      sunColor: new Float32Array(3),
      betaR: new Float32Array(3),
      betaM: new Float32Array(3),
      nightSky: new Float32Array(3),
      ambSky: new Float32Array(3),
      ambGround: new Float32Array(3),
      shallow: new Float32Array([0.16, 0.36, 0.34]),
      deep: new Float32Array([0.045, 0.13, 0.16]),
      sunE: 0, nightAmount: 0, mieG: 0.80
    };
    this.weather = { current: 'clear', next: 'clear', blend: 1, timer: 240, p: Object.assign({}, WEATHERS.clear) };

    this.tackle = new Ent.Tackle();
    this.fight = new Ent.Fight();
    this.particles = new Ent.Particles(2600);
    this.ripples = new Ent.Ripples(48);
    this.engaged = null;
    this.biteTimer = 0;
    this.strikeTimer = 0;
    this.castPower = 0;
    this.castAnim = 0;
    /* Crank angle. Zero puts the knob at the top of its circle, which is the
       furthest the left hand ever gets from the right one — hang it at the
       bottom instead and the two hands stack into a single lump of flesh. */
    this.reelSpin = 0;
    this.rodBend = new Float32Array(3);
    this.flash = 0;
    this.thunderTimer = -1;
    this.lastCatch = null;
    this.hint = '';
    this.spinnerMove = 0;

    /* The rowboat. `aboard` swaps the whole movement model over; everything
       else about fishing is unchanged, because the rod is camera-relative. */
    this.boat = {
      aboard: false, anchored: false,
      x: 0, z: 0, heading: 0, y: 0,
      vx: 0, vz: 0, vh: 0,
      pitch: 0, roll: 0,
      stroke: 0, strokePower: 0, lastStroke: 0,
      wakeTimer: 0, spookTimer: 0,
      matrix: M4.create(), oarL: M4.create(), oarR: M4.create()
    };

    this.scene = {
      camPos: new Float32Array(3),
      forward: new Float32Array(3),
      up: new Float32Array([0, 1, 0]),
      fov: M.rad(70),
      sun: {
        dir: this.env.sunDir, lightDir: this.env.lightDir, color: this.env.sunColor,
        betaR: this.env.betaR, betaM: this.env.betaM, nightSky: this.env.nightSky,
        E: 0, mieG: 0.8
      },
      ambSky: this.env.ambSky, ambGround: this.env.ambGround,
      moonDir: this.env.moonDir,
      shallowTint: this.env.shallow, deepTint: this.env.deep,
      wind: new Float32Array([1, 0]), windStrength: 0.2,
      waveData: new Float32Array(20), waveTime: 0, waveScale: 1,
      cloudCover: 0.2, cloudDark: 0, nightAmount: 0,
      fogDensity: 0.0012, fogHeight: 0.02, skyDim: 1,
      exposure: 0.52, bloom: 0.14, bloomThreshold: 1.0,
      vignette: 0.38, grain: 0.020, saturation: 1.06,
      underwater: 0, underTint: new Float32Array([0.35, 0.72, 0.85]),
      flash: 0, flashColor: new Float32Array([0.75, 0.82, 1.0]),
      wetness: 1,
      time: 0,
      lineColor: new Float32Array([0.92, 0.95, 1.0, 0.5]),
      lineCount: 0, particleCount: 0, rippleCount: 0, fishCount: 0,
      particles: this.particles,
      rod: {
        visible: true, matrix: M4.create(), handleMatrix: M4.create(),
        handL: M4.create(), handR: M4.create(), emissive: 0.02
      },
      bobber: { visible: false, matrix: M4.create(), glow: 0 },
      propGroups: null
    };
    for (var i = 0; i < Ent.WAVES.length; i++) {
      this.scene.waveData.set(Ent.WAVES[i], i * 4);
    }
  }

  Game.prototype.defaultState = function () {
    return {
      version: 1,
      seed: 20260727,
      money: 150, xp: 0,
      rod: 'starter', lure: 'worm',
      rods: ['starter'], lures: ['worm'],
      records: {}, caught: {},
      totalCatches: 0, totalWeight: 0, casts: 0, breaks: 0, escapes: 0,
      hour: 5.6, day: 1,
      seenTutorial: false,
      boat: null,          // {x, z, heading, anchored, aboard}
      boatSeen: false,
      spots: {},           // id -> true once you have fished it
      quest: 0,            // index into DC.Quests.LIST
      questCount: 0,       // qualifying catches toward the current one
      questSpots: [],      // distinct spot ids counted, for "three spots" goals
      questsDone: []
    };
  };

  Game.prototype.level = function () {
    return 1 + Math.floor(Math.sqrt(this.state.xp / 45));
  };
  Game.prototype.luck = function () {
    return M.sat((this.level() - 1) * 0.055 + (Sp.rodById[this.state.rod].sens - 1) * 0.20);
  };
  Game.prototype.rod = function () { return Sp.rodById[this.state.rod]; };
  Game.prototype.lure = function () { return Sp.lureById[this.state.lure]; };

  /* ====================================================================== */
  /*  BOOT                                                                  */
  /* ====================================================================== */
  Game.prototype.boot = function () {
    var self = this;
    this.load();
    var steps = [
      ['Carving the basin', function () {
        self.world = new DC.World(self.state.seed);
        self.world.generateHeightmap();
      }],
      ['Flooding the valley', function () {
        self.renderer = new DC.Renderer(self.canvas);
        self.renderer.uploadHeightmap(self.world.height, self.world.hmapSize, self.world.extent);
      }],
      ['Building the shoreline', function () {
        var terrain = self.world.buildTerrainMesh();
        self.renderer.uploadTerrain(terrain);
      }],
      ['Planting the treeline', function () {
        self.dock = self.world.placeDock();
        self.props = self.world.scatter(self.dock);
        self.buildProps();
      }],
      ['Sounding the lake', function () {
        self.spots = self.world.findSpots(self.dock, self.props);
        // The dock is where you start, so you already know about it.
        if (!self.state.spots) self.state.spots = {};
        self.state.spots.dock = true;
      }],
      ['Stocking the lake', function () {
        self.shoal = new Ent.Shoal(self.world, 150, self.state.seed, self.spots);
        self.renderer.buildFishBuffers(A.buildFishMesh(22, 12), 170);
        self.renderer.buildRippleBuffers(A.buildRing(44), 48);
      }],
      ['Rigging the rod', function () {
        var r = self.renderer;
        r.meshRod = r.makeSolidMesh(A.buildRod());
        r.meshReelHandle = r.makeSolidMesh(A.buildReelHandle());
        r.meshBobber = r.makeSolidMesh(A.buildBobber());
        /* Two hands, two forearms. The left one starts higher up the rod and
           further from the eye, so it needs a longer arm to clear the bottom
           of the frame instead of ending in mid-air. */
        r.meshHandR = r.makeSolidMesh(A.buildHand(HAND_RIG_R));
        r.meshHandL = r.makeSolidMesh(A.buildHand(HAND_RIG_L));
        // Stashed for qa/viewmodel.js, which checks both arms leave the frame.
        self.scene.rod.armTipR = A.handArmTip(HAND_RIG_R);
        self.scene.rod.armTipL = A.handArmTip(HAND_RIG_L);
        r.meshBoat = r.makeSolidMesh(A.buildBoat());
        r.meshOar = r.makeSolidMesh(A.buildOar());
        r.setQuality(self.detectQuality(), 190);
      }],
      ['Launching the boat', function () { self.setupBoat(); }],
      ['Casting off', function () {
        var sp = self.world.spawn(self.dock);
        self.player.x = sp.x; self.player.z = sp.z; self.player.yaw = sp.yaw;
        self.player.y = self.groundAt(sp.x, sp.z) + 1.62;
        self.bindInput();
        // Prime the rod transform so the very first cast has a real tip position.
        self.updateRod(0);
        self.started = true;
      }]
    ];

    var i = 0;
    function next() {
      if (i >= steps.length) {
        self.ui.hideLoading();
        self.ui.showStart();
        self.lastNow = performance.now();
        requestAnimationFrame(self.loop.bind(self));
        return;
      }
      self.ui.setLoading(i / steps.length, steps[i][0]);
      setTimeout(function () {
        try {
          steps[i][1]();
        } catch (err) {
          console.error(err);
          self.ui.fatal(err.message || String(err));
          return;
        }
        i++;
        next();
      }, 16);
    }
    next();
  };

  Game.prototype.detectQuality = function () {
    var px = window.innerWidth * window.innerHeight * Math.min(window.devicePixelRatio || 1, 2);
    var saved = localStorage.getItem('deepcast.quality');
    if (saved && DC.Renderer.QUALITY[saved]) return saved;
    if (px > 3200000) return 'medium';
    return 'high';
  };

  Game.prototype.buildProps = function () {
    var r = this.renderer, rng = M.mulberry32(this.state.seed ^ 0x1234);
    var groups = [];
    function add(meshFn, list, variant, inWater) {
      var subset = list.filter(function (it) { return it.variant === variant; });
      if (!subset.length) return;
      var g = r.makeInstancedMesh(meshFn(rng), subset);
      g.water = !!inWater;   // only these need drawing in the refraction pass
      groups.push(g);
    }
    for (var i = 0; i < 3; i++) add(A.buildConifer, this.props.trees, i);
    for (var j = 3; j < 6; j++) add(A.buildBroadleaf, this.props.trees, j);
    for (var b = 0; b < 2; b++) add(A.buildBush, this.props.bushes, b);
    for (var k = 0; k < 3; k++) add(A.buildRock, this.props.rocks, k);
    for (var m = 0; m < 3; m++) add(A.buildReeds, this.props.reeds, m, true);
    for (var n = 0; n < 3; n++) add(A.buildLilypad, this.props.pads, n, true);

    // The dock is a single mesh placed with a model matrix.
    var dockMesh = A.buildDock(this.dock.length, this.dock.width);
    this.dockGPU = r.makeSolidMesh(dockMesh);
    this.dockMatrix = M4.create();
    M4.fromTranslation(this.dockMatrix, [this.dock.x, this.dock.deckY, this.dock.z]);
    M4.rotateY(this.dockMatrix, this.dockMatrix, this.dock.yaw);

    this.propGroups = groups;
    this.scene.propGroups = groups;
    this.scene.solids = [
      { mesh: this.dockGPU, matrix: this.dockMatrix, tint: [1, 1, 1], spec: 0.02, emissive: 0 }
    ];
  };

  /* ====================================================================== */
  /*  INPUT                                                                 */
  /* ====================================================================== */
  Game.prototype.bindInput = function () {
    var self = this, c = this.canvas;

    window.addEventListener('keydown', function (e) {
      if (e.repeat) return;
      var k = e.key.toLowerCase();
      self.keys[k] = true;
      if (self.ui.handleKey && self.ui.handleKey(k, e)) return;
      self.onKey(k, e);
    });
    window.addEventListener('keyup', function (e) { self.keys[e.key.toLowerCase()] = false; });
    window.addEventListener('blur', function () { self.keys = Object.create(null); self.mouse.down = false; });

    c.addEventListener('mousedown', function (e) {
      if (!self.pointerLocked) { self.requestLock(); return; }
      if (e.button === 0) { self.mouse.down = true; self.onPrimaryDown(); }
      if (e.button === 2) self.onSecondary();
    });
    window.addEventListener('mouseup', function (e) {
      if (e.button === 0 && self.mouse.down) { self.mouse.down = false; self.onPrimaryUp(); }
    });
    c.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    c.addEventListener('wheel', function (e) {
      e.preventDefault();
      if (self.mode === 'fighting') {
        self.drag = M.clamp((self.drag === undefined ? 0.45 : self.drag) + (e.deltaY > 0 ? -0.06 : 0.06), 0.05, 1);
        self.audio.ui(e.deltaY < 0);
      } else {
        self.cycleLure(e.deltaY > 0 ? 1 : -1);
      }
    }, { passive: false });

    document.addEventListener('mousemove', function (e) {
      if (!self.pointerLocked || self.paused) return;
      var s = self.mouse.sensitivity * 0.0021;
      self.player.yaw -= e.movementX * s;
      self.player.pitch -= e.movementY * s * (self.mouse.invert ? -1 : 1);
      self.player.pitch = M.clamp(self.player.pitch, -1.45, 1.42);
    });

    document.addEventListener('pointerlockchange', function () {
      self.pointerLocked = (document.pointerLockElement === c);
      if (!self.pointerLocked && self.started && !self.ui.anyPanelOpen()) self.setPaused(true);
    });

    // Touch: a minimal two-zone scheme so phones are not locked out.
    var touchLook = null;
    c.addEventListener('touchstart', function (e) {
      self.audio.resume();
      for (var i = 0; i < e.changedTouches.length; i++) {
        var t = e.changedTouches[i];
        if (t.clientX > window.innerWidth * 0.45) {
          touchLook = { id: t.identifier, x: t.clientX, y: t.clientY };
          self.mouse.down = true; self.onPrimaryDown();
        }
      }
      e.preventDefault();
    }, { passive: false });
    c.addEventListener('touchmove', function (e) {
      for (var i = 0; i < e.changedTouches.length; i++) {
        var t = e.changedTouches[i];
        if (touchLook && t.identifier === touchLook.id) {
          self.player.yaw -= (t.clientX - touchLook.x) * 0.005;
          self.player.pitch = M.clamp(self.player.pitch - (t.clientY - touchLook.y) * 0.005, -1.45, 1.42);
          touchLook.x = t.clientX; touchLook.y = t.clientY;
        }
      }
      e.preventDefault();
    }, { passive: false });
    c.addEventListener('touchend', function () {
      touchLook = null;
      if (self.mouse.down) { self.mouse.down = false; self.onPrimaryUp(); }
    });

    window.addEventListener('resize', function () { if (self.renderer) self.renderer.resize(true); });
  };

  Game.prototype.requestLock = function () {
    this.audio.resume();
    // Chrome returns a promise here and rejects if the pointer is already
    // locked (or if the user just escaped out of it) — neither is worth an
    // unhandled rejection in the console.
    if (document.pointerLockElement !== this.canvas && this.canvas.requestPointerLock) {
      try {
        var r = this.canvas.requestPointerLock();
        if (r && typeof r.catch === 'function') r.catch(function () {});
      } catch (e) { /* browser refused the lock; the game still plays */ }
    }
    this.setPaused(false);
  };

  Game.prototype.onKey = function (k, e) {
    if (k === 'escape') { this.setPaused(!this.paused); return; }
    if (k === 'tab') { e.preventDefault(); this.ui.toggleJournal(); return; }
    if (k === 'b') { this.ui.toggleShop(); return; }
    if (k === 'h') { this.ui.toggleHelp(); return; }
    if (k === 'r' && (this.mode === 'fishing' || this.mode === 'flying')) { this.reelIn(); return; }
    if (k === 'e') { this.toggleBoat(); return; }
    if (k === 'q') { this.toggleAnchor(); return; }
    if (k === 'f') { this.cycleLure(1); return; }
    if (k >= '1' && k <= '9') {
      var idx = parseInt(k, 10) - 1;
      var owned = this.ownedLures();
      if (idx < owned.length) this.selectLure(owned[idx].id);
      return;
    }
    if (k === 'm') { this.ui.toggleMap(); return; }
    if (k === 'c') { this.ui.toggleQuests(); return; }
    if (k === 'p') { this.ui.toggleStats(); return; }
  };

  Game.prototype.setPaused = function (v) {
    this.paused = v;
    this.ui.setPaused(v);
    if (v && document.exitPointerLock) document.exitPointerLock();
  };

  Game.prototype.ownedLures = function () {
    var st = this.state;
    return Sp.LURES.filter(function (l) { return st.lures.indexOf(l.id) >= 0; });
  };

  Game.prototype.selectLure = function (id) {
    if (this.state.lures.indexOf(id) < 0) return;
    if (this.mode === 'fighting') return;
    this.state.lure = id;
    this.audio.ui(true);
    this.ui.flashLure(Sp.lureById[id]);
    if (this.tackle.state !== 'idle') this.reelIn();
    this.save();
  };

  Game.prototype.cycleLure = function (dir) {
    var owned = this.ownedLures();
    var i = 0;
    for (var j = 0; j < owned.length; j++) if (owned[j].id === this.state.lure) i = j;
    this.selectLure(owned[(i + dir + owned.length) % owned.length].id);
  };

  /* ====================================================================== */
  /*  FISHING ACTIONS                                                       */
  /* ====================================================================== */
  Game.prototype.onPrimaryDown = function () {
    if (this.paused) return;
    this.audio.resume();
    if (this.mode === 'bite') { this.setHook(); return; }
    if (this.mode === 'idle') { this.mode = 'charging'; this.castPower = 0; return; }
    // In every other state the primary button means "reel".
  };

  Game.prototype.onPrimaryUp = function () {
    if (this.mode === 'charging') this.doCast();
  };

  Game.prototype.onSecondary = function () {
    if (this.mode === 'charging') { this.mode = 'idle'; this.castPower = 0; return; }
    if (this.mode === 'fishing' || this.mode === 'flying') this.reelIn();
  };

  Game.prototype.rodTip = function (out) {
    var m = this.scene.rod.matrix;
    out[0] = m[4] * 2.45 + m[12] + this.rodBend[0];
    out[1] = m[5] * 2.45 + m[13] + this.rodBend[1];
    out[2] = m[6] * 2.45 + m[14] + this.rodBend[2];
    return out;
  };

  var _tip = new Float32Array(3);
  Game.prototype.doCast = function () {
    var p = this.player;
    var rod = this.rod();
    var power = M.sat(this.castPower);
    this.rodTip(_tip);
    var cp = Math.cos(p.pitch);
    var fx = -Math.sin(p.yaw) * cp, fy = Math.sin(p.pitch), fz = -Math.cos(p.yaw) * cp;
    // Bias the throw upward so a flat aim still arcs properly.
    var ux = fx, uy = fy + 0.34, uz = fz;
    var l = Math.hypot(ux, uy, uz);
    ux /= l; uy /= l; uz /= l;
    var speed = (9.5 + power * 17.5) * rod.cast;
    this.tackle.cast(_tip[0], _tip[1], _tip[2], ux, uy, uz, speed);
    this.mode = 'flying';
    this.castAnim = 1;
    this.castPower = 0;
    this.state.casts++;
    this.audio.cast(power);
    this.ui.hidePrompt();
  };

  Game.prototype.reelIn = function () {
    // If a fight is somehow still live, hand the fish back to the shoal rather
    // than leaving it hooked and invisible forever.
    if (this.fight.active || this.fight.fish) {
      var f = this.fight.fish;
      if (f) { f.visible = true; f.state = 'flee'; f.timer = 6; f.spooked = 1; }
      this.fight.reset();
      this.hookedRender = null;
      this.ui.hideFight();
      this.audio.setMood(this.env.nightAmount > 0.5 ? 'night' : 'calm');
    }
    this.tackle.state = 'idle';
    this.tackle.active = false;
    this.mode = 'idle';
    this.releaseEngaged('flee');
    this.ui.hidePrompt();
  };

  Game.prototype.releaseEngaged = function (how) {
    if (!this.engaged) return;
    var f = this.engaged;
    f.visible = true;
    f.state = how === 'flee' ? 'flee' : 'wander';
    f.timer = 4 + this.rng() * 4;
    f.spooked = 1;
    this.engaged = null;
  };

  Game.prototype.setHook = function () {
    if (this.mode !== 'bite' || !this.engaged) return;
    var f = this.engaged;
    var p = this.player;
    this.rodTip(_tip);
    var dist = Math.hypot(f.x - _tip[0], f.z - _tip[2]);
    var ang = Math.atan2(f.z - _tip[2], f.x - _tip[0]);
    f.state = 'hooked';
    f.visible = false;
    this.fight.begin(f, Math.max(dist, 2.2), ang);
    // Snapshot the conditions now: by the time it is landed the lure is out of
    // the water, the clock has moved and the spot lookup has been cleared.
    this.fight.ctx = {
      spot: this.currentSpot,
      fromBoat: this.boat.aboard,
      range: Math.hypot(_tip[0] - this.dock.endX, _tip[2] - this.dock.endZ),
      lure: this.lure(),
      weather: this.weatherName,
      hour: this.state.hour
    };
    this.drag = 0.45;
    this.mode = 'fighting';
    this.audio.hookset();
    this.audio.setMood('fight');
    this.ui.hidePrompt();
    this.ui.showToast('Hooked up!', 'good');
    this.splashAt(f.x, f.z, 1.4);
  };

  Game.prototype.splashAt = function (x, z, size) {
    var n = Math.floor(10 + size * 26);
    var y = Ent.waveHeight(x, z, this.scene.waveTime, this.scene.waveScale);
    for (var i = 0; i < n; i++) {
      var a = this.rng() * M.TAU;
      var sp = (0.6 + this.rng() * 2.6) * size;
      this.particles.spawn(
        x + Math.cos(a) * 0.12 * size, y + 0.04, z + Math.sin(a) * 0.12 * size,
        Math.cos(a) * sp * 0.55, (1.6 + this.rng() * 3.4) * size, Math.sin(a) * sp * 0.55,
        0.028 + this.rng() * 0.05 * size, 0.5 + this.rng() * 0.7,
        0.86, 0.94, 0.98, 0.75, -9.81, 0.35, 1
      );
    }
    this.ripples.spawn(x, z, 0.18 * size, 2.6 * size, 1.5 + size * 0.4, 0.6, 0.3);
    this.ripples.spawn(x, z, 0.05 * size, 1.4 * size, 1.0, 0.4, 0.45);
  };

  /* ====================================================================== */
  /*  ENVIRONMENT                                                           */
  /* ====================================================================== */
  function sunIntensity(cosZ) {
    var cutoff = Math.PI / 1.95, steep = 1.5, EE = 1000;
    return EE * Math.max(0, 1 - Math.exp(-((cutoff - Math.acos(M.clamp(cosZ, -1, 1))) / steep)));
  }

  Game.prototype.updateEnvironment = function (dt) {
    var st = this.state, e = this.env, s = this.scene;

    // --- clock
    st.hour += dt * (60 / 3600) * 60;   // one real second == one game minute
    while (st.hour >= 24) { st.hour -= 24; st.day++; }

    // --- weather transitions
    this.weather.timer -= dt;
    if (this.weather.timer <= 0) {
      this.weather.current = this.weather.next;
      this.weather.next = M.pick(this.rng, WEATHER_ORDER);
      this.weather.blend = 0;
      this.weather.timer = M.randRange(this.rng, 150, 420);
    }
    this.weather.blend = Math.min(1, this.weather.blend + dt / 30);
    var wa = WEATHERS[this.weather.current], wb = WEATHERS[this.weather.next];
    var k = M.smoothstep(0, 1, this.weather.blend);
    var p = this.weather.p;
    for (var key in wa) {
      if (typeof wa[key] === 'number') p[key] = M.lerp(wa[key], wb[key], k);
    }
    this.weatherName = k > 0.5 ? this.weather.next : this.weather.current;

    // --- sun & moon position
    // Near-equinox declination: sunrise lands on 6am, sunset on 6pm.
    var decl = 0.02, lat = 0.72;
    var ha = (st.hour - 12) / 24 * M.TAU;
    var sinAlt = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha);
    // Bend the arc so the sun loiters near the horizon: real twilight is a few
    // minutes, and a fishing game wants a golden hour you can actually fish.
    sinAlt = M.sign(sinAlt) * Math.pow(Math.abs(sinAlt), 1.55);
    var alt = Math.asin(M.clamp(sinAlt, -1, 1));
    var cosAz = (Math.sin(decl) - sinAlt * Math.sin(lat)) / Math.max(Math.cos(alt) * Math.cos(lat), 1e-4);
    var az = Math.acos(M.clamp(cosAz, -1, 1));
    if (ha > 0) az = M.TAU - az;
    var ca = Math.cos(alt);
    e.sunDir[0] = ca * Math.sin(az);
    e.sunDir[1] = Math.sin(alt);
    e.sunDir[2] = -ca * Math.cos(az);

    // Moon: roughly opposite, tilted, and always something to look at.
    var mha = ha + Math.PI;
    var mAlt = Math.asin(M.clamp(Math.sin(lat) * Math.sin(-decl * 0.6) +
      Math.cos(lat) * Math.cos(-decl * 0.6) * Math.cos(mha), -1, 1));
    var mAzC = (Math.sin(-decl * 0.6) - Math.sin(mAlt) * Math.sin(lat)) /
      Math.max(Math.cos(mAlt) * Math.cos(lat), 1e-4);
    var mAz = Math.acos(M.clamp(mAzC, -1, 1));
    if (mha > 0 && mha < M.TAU) mAz = M.TAU - mAz;
    var mca = Math.cos(mAlt);
    e.moonDir[0] = mca * Math.sin(mAz);
    e.moonDir[1] = Math.sin(mAlt);
    e.moonDir[2] = -mca * Math.cos(mAz);

    var elev = e.sunDir[1];
    var moonUp = M.sat(e.moonDir[1] * 3 + 0.1);
    var night = 1 - M.smoothstep(-0.21, -0.015, elev);
    e.nightAmount = night;

    // --- Preetham coefficients
    var sunfade = 1 - M.clamp(1 - Math.exp(elev), 0, 1);
    var rayleigh = M.lerp(1.6, 3.2, M.sat(p.turb / 8)) - (1 - sunfade);
    var mieCoef = M.lerp(0.004, 0.028, M.sat((p.turb - 2) / 6));
    for (var i = 0; i < 3; i++) {
      e.betaR[i] = TOTAL_RAYLEIGH[i] * rayleigh;
      e.betaM[i] = 0.434 * (0.2 * p.turb * 1e-17) * MIE_CONST[i] * mieCoef;
    }
    // Preetham goes black the instant the sun sets; lift it so dawn and dusk
    // get the twenty minutes of glow they deserve.
    e.sunE = sunIntensity(elev + 0.085);
    e.mieG = 0.80;

    var nightGlow = night * (0.55 + 0.45 * moonUp);
    e.nightSky[0] = 0.0022 * nightGlow;
    e.nightSky[1] = 0.0034 * nightGlow;
    e.nightSky[2] = 0.0082 * nightGlow;

    // --- light direction and colour
    var sunUp = M.smoothstep(-0.15, 0.20, elev);
    var warm = M.smoothstep(0.30, 0.02, elev);
    var cloudy = 1 - p.dark * 0.62;
    var intensity = sunUp * 3.1 * cloudy;
    if (elev > 0.015) {
      e.lightDir.set(e.sunDir);
      e.sunColor[0] = M.lerp(1.0, 1.0, warm) * intensity;
      e.sunColor[1] = M.lerp(0.97, 0.46, warm) * intensity;
      e.sunColor[2] = M.lerp(0.93, 0.19, warm) * intensity;
    } else {
      e.lightDir.set(e.moonDir);
      var mi = moonUp * night * 0.26 * cloudy;
      e.sunColor[0] = 0.38 * mi; e.sunColor[1] = 0.52 * mi; e.sunColor[2] = 0.90 * mi;
    }

    var ambD = 0.05 + 0.52 * sunUp;
    var ambN = night * moonUp * 0.16;
    e.ambSky[0] = (0.30 * ambD + 0.10 * ambN) * cloudy + 0.004;
    e.ambSky[1] = (0.40 * ambD + 0.14 * ambN) * cloudy + 0.006;
    e.ambSky[2] = (0.62 * ambD + 0.30 * ambN) * cloudy + 0.012;
    e.ambGround[0] = e.ambSky[0] * 0.34 + 0.004;
    e.ambGround[1] = e.ambSky[1] * 0.32 + 0.004;
    e.ambGround[2] = e.ambSky[2] * 0.26 + 0.005;

    // Water tints shift with the light.
    var murk = M.sat(p.dark * 0.5 + (p.rain > 0 ? 0.2 : 0));
    e.shallow[0] = M.lerp(0.13, 0.10, murk) * (0.25 + sunUp);
    e.shallow[1] = M.lerp(0.34, 0.26, murk) * (0.25 + sunUp);
    e.shallow[2] = M.lerp(0.32, 0.22, murk) * (0.25 + sunUp);
    e.deep[0] = 0.035 + 0.03 * sunUp;
    e.deep[1] = 0.10 + 0.09 * sunUp;
    e.deep[2] = 0.13 + 0.10 * sunUp;

    // --- push into the scene
    s.sun.E = e.sunE;
    s.sun.mieG = e.mieG;
    s.nightAmount = night;
    s.cloudCover = p.cloud;
    s.cloudDark = p.dark;
    s.fogDensity = p.fog;
    s.fogHeight = 0.02;
    s.skyDim = 1 - p.dark * 0.72;
    s.waveScale = p.wave;
    s.windStrength = 0.06 + p.wind * 0.30;
    var windAng = this.time * 0.013;
    s.wind[0] = Math.cos(windAng); s.wind[1] = Math.sin(windAng);
    s.exposure = M.lerp(0.60, 0.335, sunUp) * (1 + night * 0.60) * (1 - p.dark * 0.18);
    s.bloom = 0.10 + night * 0.12;
    s.bloomThreshold = M.lerp(0.55, 1.05, sunUp);
    s.saturation = 1.20 - night * 0.30;
    s.grain = 0.014 + night * 0.022;
    s.vignette = 0.34 + night * 0.16;

    // --- storms
    if (p.rain > 1.4 && this.thunderTimer < 0 && this.rng() < dt * 0.09) {
      this.thunderTimer = 0.4 + this.rng() * 2.4;
      this.flash = 1.0 + this.rng() * 0.7;
    }
    if (this.thunderTimer > 0) {
      this.thunderTimer -= dt;
      if (this.thunderTimer <= 0) { this.audio.thunder(); this.thunderTimer = -1; }
    }
    this.flash = Math.max(0, this.flash - dt * 4.5);
    s.flash = this.flash * 0.5;

    // --- rain
    if (p.rain > 0.05) {
      var rate = p.rain * 260 * dt;
      var count = Math.floor(rate) + (this.rng() < rate % 1 ? 1 : 0);
      var cam = this.player;
      for (var r = 0; r < count; r++) {
        var a = this.rng() * M.TAU, rr = Math.sqrt(this.rng()) * 26;
        this.particles.spawn(
          cam.x + Math.cos(a) * rr, cam.y + 14 + this.rng() * 6, cam.z + Math.sin(a) * rr,
          s.wind[0] * 2.2, -16 - this.rng() * 6, s.wind[1] * 2.2,
          0.016, 1.1, 0.70, 0.78, 0.88, 0.32, -3, 0.02, 0
        );
      }
      if (this.rng() < dt * p.rain * 22) {
        var ax = this.rng() * M.TAU, ar = Math.sqrt(this.rng()) * 22;
        var px = this.player.x + Math.cos(ax) * ar, pz = this.player.z + Math.sin(ax) * ar;
        if (this.world.depthAt(px, pz) > 0.1) this.ripples.spawn(px, pz, 0.02, 0.4, 0.8, 0.35, 0.4);
      }
    }
  };

  /* ====================================================================== */
  /*  PLAYER                                                                */
  /* ====================================================================== */
  Game.prototype.groundAt = function (x, z) {
    var h = this.world.sample(x, z);
    if (this.world.onDock(this.dock, x, z)) return Math.max(h, this.dock.deckY + 0.07);
    return h;
  };

  /* ====================================================================== */
  /*  THE BOAT                                                              */
  /* ====================================================================== */

  // Moor it off the end of the dock, in water deep enough to float.
  Game.prototype.setupBoat = function () {
    var b = this.boat, d = this.dock;
    var saved = this.state.boat;
    if (saved && isFinite(saved.x) && isFinite(saved.z) &&
        this.world.depthAt(saved.x, saved.z) > 0.5) {
      b.x = saved.x; b.z = saved.z; b.heading = saved.heading || 0;
      b.anchored = !!saved.anchored;
    } else {
      // Alongside the dock, a couple of metres off the port side.
      var sideX = -d.dirZ, sideZ = d.dirX;
      var along = d.length - 3.0;
      b.x = d.x + d.dirX * along + sideX * 2.5;
      b.z = d.z + d.dirZ * along + sideZ * 2.5;
      // Nudge outward until it is genuinely afloat.
      for (var i = 0; i < 30 && this.world.depthAt(b.x, b.z) < 0.9; i++) {
        b.x += sideX * 0.4; b.z += sideZ * 0.4;
      }
      b.heading = Math.atan2(-d.dirX, -d.dirZ);
      b.anchored = true;
    }
    b.aboard = false;
    b.y = Ent.waveHeight(b.x, b.z, 0, 1);
    this.scene.solids.push(
      { mesh: this.renderer.meshBoat, matrix: b.matrix, tint: [1, 1, 1], spec: 0.10, emissive: 0 },
      { mesh: this.renderer.meshOar, matrix: b.oarL, tint: [1, 1, 1], spec: 0.06, emissive: 0 },
      { mesh: this.renderer.meshOar, matrix: b.oarR, tint: [1, 1, 1], spec: 0.06, emissive: 0 }
    );
    this.updateBoat(0);
  };

  Game.prototype.boatDistance = function () {
    return Math.hypot(this.player.x - this.boat.x, this.player.z - this.boat.z);
  };

  Game.prototype.toggleBoat = function () {
    var b = this.boat, p = this.player;
    if (this.mode === 'fighting') {
      this.ui.showToast('Not while something is on the line.', 'warn');
      return;
    }
    if (!b.aboard) {
      if (this.boatDistance() > 3.6) return;
      b.aboard = true;
      this.reelIn();
      this.updateBoat(0);
      this.updatePlayer(0);
      this.updateRod(0);
      this.state.boatSeen = true;
      this.audio.footstep(true);
      this.audio.splash(0.35);
      this.ui.showToast('Aboard. [W A S D] to row, [Q] anchor, [E] step out.', 'good');
      this.save();
      return;
    }
    // Stepping out: find somewhere solid within reach.
    var best = null, bestD = 1e9;
    for (var a = 0; a < 16; a++) {
      var ang = a / 16 * M.TAU;
      for (var r = 1.4; r <= 3.4; r += 0.4) {
        var tx = b.x + Math.cos(ang) * r, tz = b.z + Math.sin(ang) * r;
        var solid = this.world.onDock(this.dock, tx, tz) || this.world.sample(tx, tz) > -0.95;
        if (solid && r < bestD) { bestD = r; best = [tx, tz]; }
      }
    }
    if (!best) {
      this.ui.showToast('Too far from shore to step out.', 'warn');
      this.audio.deny();
      return;
    }
    b.aboard = false;
    b.vx = 0; b.vz = 0; b.vh = 0;
    p.x = best[0]; p.z = best[1];
    p.y = this.groundAt(p.x, p.z) + 1.62;
    this.reelIn();
    this.updatePlayer(0);
    this.updateRod(0);
    this.audio.footstep(this.world.onDock(this.dock, p.x, p.z));
    this.save();
  };

  Game.prototype.toggleAnchor = function () {
    var b = this.boat;
    if (!b.aboard) return;
    if (!b.anchored && this.world.depthAt(b.x, b.z) > 22) {
      this.ui.showToast('Too deep to anchor here.', 'warn');
      this.audio.deny();
      return;
    }
    b.anchored = !b.anchored;
    if (b.anchored) { b.vx = 0; b.vz = 0; b.vh = 0; this.audio.splash(0.5); }
    else this.audio.plunk();
    this.ui.showToast(b.anchored ? '⚓ Anchor down.' : '⚓ Anchor up.', 'good');
    this.save();
  };

  var _wv = [0, 0, 0];
  Game.prototype.updateBoat = function (dt) {
    var b = this.boat, s = this.scene, k = this.keys;
    var wave = Ent.waveHeight;

    if (b.aboard && !b.anchored) {
      var throttle = (k['w'] || k['arrowup'] ? 1 : 0) - (k['s'] || k['arrowdown'] ? 0.55 : 0);
      var turn = (k['a'] || k['arrowleft'] ? 1 : 0) - (k['d'] || k['arrowright'] ? 1 : 0);
      if (this.mode === 'fighting' || this.mode === 'charging') throttle *= 0.35;

      // Rowing is pulsed, not continuous: thrust arrives on the pull.
      if (throttle !== 0) {
        b.stroke += dt * (throttle > 0 ? 3.1 : 2.2);
        var pulse = Math.max(0, Math.sin(b.stroke));
        b.strokePower = pulse;
        var accel = throttle * pulse * 7.0;
        var fx = -Math.sin(b.heading), fz = -Math.cos(b.heading);
        b.vx += fx * accel * dt;
        b.vz += fz * accel * dt;
        // Catch of each stroke: splash and a little audio.
        if (Math.sin(b.stroke) > 0.98 && this.time - b.lastStroke > 0.5) {
          b.lastStroke = this.time;
          this.audio.noiseBurst({ f0: 900, f1: 260, dur: 0.20, gain: 0.055, q: 0.9, attack: 0.02 });
          var rx = Math.cos(b.heading), rz = -Math.sin(b.heading);
          for (var o = -1; o <= 1; o += 2) {
            this.ripples.spawn(b.x + rx * o * 1.7, b.z + rz * o * 1.7, 0.06, 0.9, 1.1, 0.32, 0.4);
          }
        }
      } else {
        b.strokePower = M.damp(b.strokePower, 0, 4, dt);
      }
      b.vh += turn * 1.35 * dt;
    } else {
      b.strokePower = M.damp(b.strokePower, 0, 4, dt);
    }

    var holding = b.anchored || !b.aboard;
    if (holding) { b.vx = 0; b.vz = 0; b.vh *= Math.exp(-6 * dt); }
    else {
      // Water drag, plus a slow push from the wind.
      var drag = Math.exp(-1.30 * dt);
      b.vx *= drag; b.vz *= drag;
      b.vh *= Math.exp(-2.7 * dt);
      var push = s.windStrength * 1.7 * dt;
      b.vx += s.wind[0] * push;
      b.vz += s.wind[1] * push;
    }
    b.heading += b.vh * dt;

    var nx = b.x + b.vx * dt, nz = b.z + b.vz * dt;
    if (this.world.depthAt(nx, nz) > 0.55 && Math.hypot(nx, nz) < 178) {
      b.x = nx; b.z = nz;
    } else {
      // Nose into the shallows and stop, rather than beaching.
      b.vx *= -0.20; b.vz *= -0.20;
      if (b.aboard && this.time - (b._bump || 0) > 1.2) {
        b._bump = this.time;
        this.audio.noiseBurst({ f0: 190, f1: 80, dur: 0.24, gain: 0.07, q: 1.4, filter: 'lowpass' });
      }
    }

    // Ride the wave field, and tilt to its slope.
    var t = s.waveTime, ws = s.waveScale;
    b.y = wave(b.x, b.z, t, ws) + 0.02;
    var e = 0.9;
    var hx = (wave(b.x + e, b.z, t, ws) - wave(b.x - e, b.z, t, ws)) / (2 * e);
    var hz = (wave(b.x, b.z + e, t, ws) - wave(b.x, b.z - e, t, ws)) / (2 * e);
    var fwx = -Math.sin(b.heading), fwz = -Math.cos(b.heading);
    var rgx = Math.cos(b.heading), rgz = -Math.sin(b.heading);
    var pitchWant = Math.atan(hx * fwx + hz * fwz) * 1.5 - b.strokePower * 0.035;
    var rollWant = Math.atan(hx * rgx + hz * rgz) * 1.5;
    b.pitch = M.damp(b.pitch, pitchWant, 6, dt);
    b.roll = M.damp(b.roll, rollWant, 6, dt);

    // Transform.
    M4.fromTranslation(b.matrix, [b.x, b.y, b.z]);
    M4.rotateY(b.matrix, b.matrix, b.heading);
    M4.rotateX(b.matrix, b.matrix, b.pitch);
    M4.rotateZ(b.matrix, b.matrix, -b.roll);

    // Oars: sweep fore-and-aft, lifting clear of the water on the recovery.
    var sweep = Math.sin(b.stroke) * 0.62;
    var lift = (1 - Math.max(0, Math.sin(b.stroke))) * 0.55 - 0.18;
    if (!b.aboard) { sweep = 0.9; lift = 0.55; }   // shipped, stowed inboard
    var lockZ = -A.BOAT_LEN / 2 + 0.50 * A.BOAT_LEN;
    var lockX = A.boatBeam(0.50), lockY = A.boatSheer(0.50);
    for (var side = 0; side < 2; side++) {
      var sgn = side === 0 ? -1 : 1;
      var out = side === 0 ? b.oarL : b.oarR;
      M4.identity(_mBoat);
      M4.translate(_mBoat, _mBoat, [sgn * lockX, lockY, lockZ]);
      M4.rotateY(_mBoat, _mBoat, side === 0 ? Math.PI : 0);
      M4.rotateY(_mBoat, _mBoat, sweep);
      M4.rotateZ(_mBoat, _mBoat, -lift);
      M4.multiply(out, b.matrix, _mBoat);
    }

    // First time you wander near it, say what it is. Once.
    if (!b.aboard && !this.state.boatSeen && this.started && this.boatDistance() < 7) {
      this.state.boatSeen = true;
      this.ui.showToast('🚣 A rowboat. Press [E] to take it out on the lake.', 'good');
      this.save();
    }

    var speed = Math.hypot(b.vx, b.vz);

    // Wake ripples and a bow splash while under way.
    if (b.aboard && speed > 0.35) {
      b.wakeTimer -= dt;
      if (b.wakeTimer <= 0) {
        b.wakeTimer = 0.12 / Math.min(speed, 3);
        this.ripples.spawn(b.x - fwx * 1.9, b.z - fwz * 1.9, 0.12, 1.5 + speed * 0.6,
          1.6, 0.20 + speed * 0.06, 0.35);
      }
    }

    // A boat moving overhead puts fish down. This is why you anchor.
    b.spookTimer -= dt;
    if (b.aboard && b.spookTimer <= 0) {
      b.spookTimer = 0.25;
      if (speed > 0.6) {
        var amount = M.sat(speed * 0.45);
        var list = this.shoal.fish;
        for (var i = 0; i < list.length; i++) {
          var f = list[i];
          if (f.state === 'hooked') continue;
          var dx = f.x - b.x, dz = f.z - b.z;
          if (dx * dx + dz * dz < 49) f.spooked = Math.max(f.spooked, amount);
        }
      }
    }
    return speed;
  };
  var _mBoat = M4.create();

  Game.prototype.updatePlayer = function (dt) {
    var p = this.player, k = this.keys;

    // Aboard: the hull moves, the player just sits in it.
    if (this.boat.aboard) {
      var b = this.boat;
      p.onDock = false;
      p.wading = 0;
      p.stepAccum = 0.75;
      p.bobPhase += dt * 1.1;
      p.x = b.x; p.z = b.z;
      // Sit on the aft thwart, high enough to see over the bow and to keep the
      // rod clear of the gunwale.
      var seatZ = -A.BOAT_LEN / 2 + 0.72 * A.BOAT_LEN;
      var sx = -Math.sin(b.heading), sz = -Math.cos(b.heading);
      var eyeX = b.x - sx * seatZ, eyeZ = b.z - sz * seatZ;
      p.y = M.damp(p.y, b.y + 1.34, 18, dt);

      var s2 = this.scene;
      s2.camPos[0] = eyeX;
      s2.camPos[1] = p.y + Math.sin(p.bobPhase) * 0.006;
      s2.camPos[2] = eyeZ;
      var cp2 = Math.cos(p.pitch);
      s2.forward[0] = -Math.sin(p.yaw) * cp2;
      s2.forward[1] = Math.sin(p.pitch);
      s2.forward[2] = -Math.cos(p.yaw) * cp2;
      // Let the horizon roll a little with the hull. Subtle on purpose.
      var rollCam = -b.roll * 0.45;
      var rx2 = Math.cos(p.yaw), rz2 = -Math.sin(p.yaw);
      s2.up[0] = M.damp(s2.up[0], rx2 * Math.sin(rollCam), 8, dt);
      s2.up[1] = Math.cos(rollCam);
      s2.up[2] = M.damp(s2.up[2], rz2 * Math.sin(rollCam), 8, dt);
      s2.underwater = M.damp(s2.underwater, 0, 10, dt);
      return;
    }

    this.scene.up[0] = M.damp(this.scene.up[0], 0, 10, dt);
    this.scene.up[1] = 1;
    this.scene.up[2] = M.damp(this.scene.up[2], 0, 10, dt);

    var fwd = (k['w'] || k['arrowup'] ? 1 : 0) - (k['s'] || k['arrowdown'] ? 1 : 0);
    var strafe = (k['d'] || k['arrowright'] ? 1 : 0) - (k['a'] || k['arrowleft'] ? 1 : 0);
    var sprint = (k['shift'] ? 1 : 0);

    var moving = (fwd !== 0 || strafe !== 0);
    var speed = (3.3 + sprint * 2.9) * (1 - p.wading * 0.55);
    if (this.mode === 'fighting') speed *= 0.5;

    if (moving) {
      var sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
      var dx = (-sy * fwd + cy * strafe);
      var dz = (-cy * fwd - sy * strafe);
      var l = Math.hypot(dx, dz);
      dx /= l; dz /= l;
      var nx = p.x + dx * speed * dt;
      var nz = p.z + dz * speed * dt;
      // Block anything deeper than wading depth, unless we are on the dock.
      var onDock = this.world.onDock(this.dock, nx, nz);
      var gh = this.world.sample(nx, nz);
      if (onDock || gh > -1.05) {
        // Also refuse impossibly steep ground.
        var cur = this.groundAt(p.x, p.z);
        var nxt = onDock ? this.dock.deckY : gh;
        if (nxt - cur < 1.4 * Math.max(speed * dt, 0.05) * 6 || onDock) { p.x = nx; p.z = nz; }
      }
      p.bobPhase += dt * (sprint ? 12.5 : 8.4);
      p.stepAccum += dt * (sprint ? 2.0 : 1.35);
      if (p.stepAccum > 1) {
        p.stepAccum -= 1;
        this.audio.footstep(p.onDock);
      }
    } else {
      p.bobPhase += dt * 1.6;
      p.stepAccum = 0.75;
    }

    p.onDock = this.world.onDock(this.dock, p.x, p.z);
    var ground = this.groundAt(p.x, p.z);
    var targetY = ground + 1.62;
    var terrainH = this.world.sample(p.x, p.z);
    p.wading = M.damp(p.wading, p.onDock ? 0 : M.sat(-terrainH / 1.05), 6, dt);
    p.y = M.damp(p.y, targetY, 14, dt);
    p.bob = Math.sin(p.bobPhase) * (moving ? 0.035 : 0.008) * (sprint ? 1.5 : 1);

    var s = this.scene;
    s.camPos[0] = p.x;
    s.camPos[1] = p.y + p.bob;
    s.camPos[2] = p.z;
    var cp = Math.cos(p.pitch);
    s.forward[0] = -Math.sin(p.yaw) * cp;
    s.forward[1] = Math.sin(p.pitch);
    s.forward[2] = -Math.cos(p.yaw) * cp;
    s.underwater = M.damp(s.underwater, s.camPos[1] < 0 ? 1 : 0, 10, dt);
  };

  /* ====================================================================== */
  /*  ROD + LINE                                                            */
  /* ====================================================================== */
  var _m = M4.create(), _m2 = M4.create();
  // Viewmodel scale: a real 2.4 m rod fills the whole screen at arm's length.
  var ROD_SCALE = 0.82;
  var HAND_SCALE = 1.02;
  var HAND_RIG_R = { armLen: 0.40, armAngle: Math.PI * 0.92 };
  /* On screen the grip hand sits almost directly below the crank hand, so an
     arm dropped straight down from the crank runs through the fist below it
     and the two limbs fuse into one column of flesh. Angle it inboard instead
     — which is also where the left elbow really is. */
  var HAND_RIG_L = { armLen: 0.80, armAngle: Math.PI * 0.869 };
  /* Camera-to-world built straight from the scene camera. Deriving it here
     rather than borrowing the renderer's copy keeps the rod exact even on a
     frame that never drew (headless sim, or a stalled tab). */
  var _camToWorld = M4.create();
  function cameraBasis(out, eye, fwd, up) {
    var fx = fwd[0], fy = fwd[1], fz = fwd[2];
    var fl = Math.hypot(fx, fy, fz) || 1;
    fx /= fl; fy /= fl; fz /= fl;
    var rx = fy * up[2] - fz * up[1];
    var ry = fz * up[0] - fx * up[2];
    var rz = fx * up[1] - fy * up[0];
    var rl = Math.hypot(rx, ry, rz);
    if (rl < 1e-5) { rx = 1; ry = 0; rz = 0; rl = 1; }
    rx /= rl; ry /= rl; rz /= rl;
    var ux = ry * fz - rz * fy;
    var uy = rz * fx - rx * fz;
    var uz = rx * fy - ry * fx;
    // Columns are [right, up, back, eye]. `back` is -forward; `up` is NOT
    // negated — getting that wrong mounts the whole viewmodel upside down.
    out[0] = rx; out[1] = ry; out[2] = rz; out[3] = 0;
    out[4] = ux; out[5] = uy; out[6] = uz; out[7] = 0;
    out[8] = -fx; out[9] = -fy; out[10] = -fz; out[11] = 0;
    out[12] = eye[0]; out[13] = eye[1]; out[14] = eye[2]; out[15] = 1;
    return out;
  }

  Game.prototype.updateRod = function (dt) {
    var s = this.scene, p = this.player;
    var cw = cameraBasis(_camToWorld, s.camPos, s.forward, s.up);

    this.castAnim = Math.max(0, this.castAnim - dt * 3.4);
    var charge = this.mode === 'charging' ? M.sat(this.castPower) : 0;
    var whip = Math.sin(M.sat(this.castAnim) * Math.PI) * (1 - this.castAnim) * 2.4;

    // Hold position in view space, then lift into world space.
    var tiltX = -0.98 + charge * 1.22 - whip * 0.95;
    var tiltZ = -0.34 - charge * 0.18;
    var sway = Math.sin(p.bobPhase * 0.5) * 0.02;

    if (this.mode === 'fighting') {
      tiltX = -1.05 - this.fight.tension * 0.34;
      tiltZ = -0.34;
    }

    /* Hold pose. The butt of the grip has to stay inside the frame, or the rod
       reads as a pole floating in the corner with nothing holding it: at a 70
       degree vertical FOV a point at view z = -0.64 falls off the bottom edge
       once y drops below about -0.45, which the old pose did. */
    M4.identity(_m);
    M4.translate(_m, _m, [0.33, -0.40 + sway, -0.64]);
    M4.rotateZ(_m, _m, tiltZ);
    M4.rotateX(_m, _m, tiltX);
    M4.scale(_m, _m, [ROD_SCALE, ROD_SCALE, ROD_SCALE]);
    M4.multiply(s.rod.matrix, cw, _m);

    // Reel handle spins while retrieving or fighting. The axle lies across the
    // rod, so the crank turns about local X.
    var reeling = this.mouse.down && (this.mode === 'fishing' || this.mode === 'fighting' || this.mode === 'flying');
    this.reelSpin += dt * (reeling ? 13 : 0);
    var seat = A.REEL_SEAT;
    M4.identity(_m2);
    M4.translate(_m2, _m2, [seat[0] * ROD_SCALE, seat[1] * ROD_SCALE, seat[2] * ROD_SCALE]);
    M4.rotateX(_m2, _m2, this.reelSpin);
    M4.multiply(s.rod.handleMatrix, s.rod.matrix, _m2);

    // Right hand wraps the cork grip. Kept low on the butt so it stays clear
    // of the left hand at the reel — closer together they merge into one lump.
    M4.identity(_m2);
    M4.translate(_m2, _m2, [0, 0.075 * ROD_SCALE, 0]);
    M4.rotateY(_m2, _m2, -0.34);
    M4.scale(_m2, _m2, [HAND_SCALE, HAND_SCALE, HAND_SCALE]);
    M4.multiply(s.rod.handR, s.rod.matrix, _m2);

    /* Left hand rides the crank knob so it orbits while line is coming in —
       the clearest read in the game that you are actually reeling.

       Its POSITION follows the knob but its ORIENTATION comes from the rod,
       never from the spinning handle. Parenting the whole hand to the crank
       (as this used to) swings a 34 cm forearm through a full circle every
       revolution, which on screen is a bare arm sweeping across the sky like
       a boom. Only the hand should orbit; the forearm stays pointing down. */
    var ks = Math.sin(this.reelSpin), kc = Math.cos(this.reelSpin);
    M4.identity(_m2);
    M4.translate(_m2, _m2, [(seat[0] + 0.055) * ROD_SCALE,
      (seat[1] + A.CRANK_R * kc) * ROD_SCALE,
      (seat[2] + A.CRANK_R * ks) * ROD_SCALE]);
    M4.rotateY(_m2, _m2, 0.22);
    M4.rotateZ(_m2, _m2, -0.30);            // knuckles rolled onto the knob
    M4.scale(_m2, _m2, [HAND_SCALE, HAND_SCALE, HAND_SCALE]);
    M4.multiply(s.rod.handL, s.rod.matrix, _m2);

    // Bend the blank toward whatever is pulling on it.
    var bendAmt = 0;
    if (this.mode === 'fighting') bendAmt = 0.22 + this.fight.tension * 0.65;
    else if (this.tackle.state === 'water' || this.tackle.state === 'flying') bendAmt = 0.05;
    else if (this.mode === 'charging') bendAmt = 0.10 + charge * 0.22;

    this.rodTipRaw(_tip);
    var tx = 0, ty = -1, tz = 0;
    if (this.tackle.state !== 'idle') {
      tx = this.tackle.x - _tip[0]; ty = this.tackle.y - _tip[1]; tz = this.tackle.z - _tip[2];
      var tl = Math.hypot(tx, ty, tz) || 1;
      tx /= tl; ty /= tl; tz /= tl;
    } else if (this.mode === 'charging') {
      tx = -s.forward[0]; ty = -0.2; tz = -s.forward[2];
    }
    this.rodBend[0] = M.damp(this.rodBend[0], tx * bendAmt, 9, dt);
    this.rodBend[1] = M.damp(this.rodBend[1], ty * bendAmt, 9, dt);
    this.rodBend[2] = M.damp(this.rodBend[2], tz * bendAmt, 9, dt);
    s.rod.bend = this.rodBend;
    // Keep the rod readable after dark — a black silhouette on black water
    // is realistic and completely unplayable.
    s.rod.emissive = 0.02 + this.env.nightAmount * 0.16;
    s.rod.visible = true;
  };

  Game.prototype.rodTipRaw = function (out) {
    var m = this.scene.rod.matrix;
    out[0] = m[4] * 2.45 + m[12];
    out[1] = m[5] * 2.45 + m[13];
    out[2] = m[6] * 2.45 + m[14];
    return out;
  };

  Game.prototype.buildLine = function () {
    var s = this.scene, r = this.renderer;
    if (this.tackle.state === 'idle') { s.lineCount = 0; return; }
    this.rodTip(_tip);
    var ax = _tip[0], ay = _tip[1], az = _tip[2];
    var bx = this.tackle.x, by = this.tackle.y, bz = this.tackle.z;
    var dist = Math.hypot(bx - ax, by - ay, bz - az);
    var tension = this.mode === 'fighting' ? this.fight.tension : (this.mode === 'flying' ? 0.85 : 0.35);
    var sag = M.clamp(dist * 0.055 * (1 - tension * 0.85), 0, 1.3);
    var n = r.lineSegs;
    var d = r.lineData;
    for (var i = 0; i <= n; i++) {
      var t = i / n;
      d[i * 4] = M.lerp(ax, bx, t);
      d[i * 4 + 1] = M.lerp(ay, by, t) - Math.sin(Math.PI * t) * sag;
      d[i * 4 + 2] = M.lerp(az, bz, t);
      d[i * 4 + 3] = t;
    }
    s.lineCount = n + 1;
    var a = 0.34 + tension * 0.32;
    s.lineColor[3] = a;
  };

  /* ====================================================================== */
  /*  FISHING LOGIC                                                         */
  /* ====================================================================== */
  Game.prototype.updateFishing = function (dt) {
    var t = this.tackle, s = this.scene, lure = this.lure();
    var ev = t.update(dt, this.world, s.waveTime, s.waveScale, lure);

    if (ev === 'splash') {
      this.mode = 'fishing';
      this.audio.splash(0.8);
      this.splashAt(t.x, t.z, 0.55);
      this.biteTimer = 0.8;
      // A lure that lands hard clears the timid fish out of the neighbourhood.
      this.spookNearby(t.x, t.z, lure.noise);
    } else if (ev === 'land') {
      this.mode = 'fishing';
      this.audio.plunk();
      this.ui.showToast('Dry land. Reel in and try again.', 'warn');
    }

    // Retrieving: hold the primary button to wind the lure back.
    if (this.mouse.down && (this.mode === 'fishing' || this.mode === 'flying') && t.state === 'water') {
      this.rodTip(_tip);
      var dx = _tip[0] - t.x, dz = _tip[2] - t.z;
      var d = Math.hypot(dx, dz);
      var rate = this.rod().reel * 2.9 * dt;
      this.audio.reelClick(this.rod().reel);
      this.spinnerMove = 1;
      if (d < 1.4) {
        this.reelIn();
      } else {
        t.x += dx / d * Math.min(rate, d);
        t.z += dz / d * Math.min(rate, d);
        t.bobVel -= dt * 2.2;
        if (this.rng() < dt * 6) this.ripples.spawn(t.x, t.z, 0.05, 0.5, 0.9, 0.30, 0.4);
      }
    } else {
      this.spinnerMove = M.damp(this.spinnerMove, 0, 2.2, dt);
    }

    this.trackSpot();
    if (t.active && (this.mode === 'fishing')) this.rollForBites(dt);

    // Engaged-fish state machine.
    var f = this.engaged;
    if (f && f.state !== 'hooked') {
      if (!t.active) { this.releaseEngaged('flee'); return; }
      f.timer -= dt;
      if (f.state === 'inspect' && f.timer <= 0) {
        var accept = this.acceptChance(f);
        if (this.rng() < accept) {
          f.state = 'nibble';
          f.nibbles = 1 + ((this.rng() * 3) | 0);
          f.timer = 0.30;
        } else {
          f.state = 'flee'; f.timer = 5; f.spooked = 1;
          this.engaged = null;
          this.ui.showToast('It looked… and left.', 'warn');
        }
      } else if (f.state === 'nibble' && f.timer <= 0) {
        f.nibbles--;
        t.bobVel -= 1.5 + this.rng() * 1.4;
        this.ripples.spawn(t.x, t.z, 0.05, 0.55, 0.9, 0.5, 0.4);
        this.audio.nibble();
        if (f.nibbles <= 0) {
          f.state = 'strike';
          // Small, timid fish give you barely any window.
          this.strikeTimer = 0.58 + M.sat(f.kg / 8) * 0.9 + f.sp.fight.stamina * 0.12;
          this.strikeTimer *= this.rod().sens;
          t.bobVel -= 5.5;
          this.mode = 'bite';
          this.audio.bite();
          this.ui.showPrompt('FISH ON — CLICK TO SET THE HOOK', 'bite');
          this.splashAt(t.x, t.z, 0.5);
        } else {
          f.timer = 0.22 + this.rng() * 0.5;
        }
      }
    }

    if (this.mode === 'bite') {
      this.strikeTimer -= dt;
      if (this.strikeTimer <= 0) {
        this.mode = 'fishing';
        this.ui.hidePrompt();
        this.ui.showToast('Too slow — it spat the hook.', 'bad');
        this.state.escapes++;
        this.releaseEngaged('flee');
        this.audio.plunk();
      }
    }
  };

  /* Which named spot are we fishing? The lure decides when it is in the
     water; otherwise the boat does, so the HUD can tell you where you are. */
  Game.prototype.trackSpot = function () {
    if (!this.spots) return;
    var t = this.tackle;
    var x, z, fishing;
    if (t.active) { x = t.lureX; z = t.lureZ; fishing = true; }
    else if (this.boat.aboard) { x = this.boat.x; z = this.boat.z; fishing = false; }
    else { x = this.player.x; z = this.player.z; fishing = false; }

    var spot = this.world.spotAt(this.spots, x, z);
    this.currentSpot = fishing ? spot : null;
    this.nearSpot = spot;

    if (spot && fishing && !this.state.spots[spot.id]) {
      this.state.spots[spot.id] = true;
      this.state.xp += 60;
      this.flash = Math.max(this.flash, 0.25);
      this.audio.fanfare(1);
      this.ui.showToast(spot.icon + '  ' + spot.name + ' — new spot logged. [M] for the chart.', 'good');
      this.ui.showToast(spot.hint, 'good');
      this.save();
    }
  };

  Game.prototype.discoveredSpots = function () {
    var st = this.state, out = [];
    for (var i = 0; i < (this.spots || []).length; i++) {
      if (st.spots && st.spots[this.spots[i].id]) out.push(this.spots[i]);
    }
    return out;
  };

  /* Noise. A topwater popper landing on a bluegill's head sends it into the
     weeds; a pike barely notices. This is the cost that balances the loud,
     long-reaching lures against the quiet ones. */
  Game.prototype.spookNearby = function (x, z, noise) {
    if (!noise || noise <= 0.01) return;
    var radius = 4 + noise * 10;
    var list = this.shoal.fish;
    for (var i = 0; i < list.length; i++) {
      var f = list[i];
      if (f.state === 'hooked') continue;
      var d = Math.hypot(f.x - x, f.z - z);
      if (d > radius) continue;
      var bold = M.sat(f.sp.fight.strength / 1.6);
      var amount = noise * (1 - bold * 0.78) * (1 - d / radius);
      if (amount > f.spooked) {
        f.spooked = Math.min(1, amount);
        if (f.state === 'wander' && amount > 0.5) { f.state = 'flee'; f.timer = 2 + amount * 3; }
      }
    }
  };

  Game.prototype.acceptChance = function (f) {
    var lure = this.lure();
    var mul = f.sp.lures[lure.id];
    if (mul === undefined) mul = 0.4;
    var base = 0.46 + 0.34 * M.sat(mul / 1.8);
    base += this.luck() * 0.18;
    base -= f.spooked * 0.25;
    // A moving lure closes the deal for predators.
    if (this.spinnerMove > 0.2 && (lure.id === 'spinner' || lure.id === 'popper' || lure.id === 'minnow')) base += 0.16;
    return M.clamp(base, 0.08, 0.92);
  };

  Game.prototype.rollForBites = function (dt) {
    this.biteTimer -= dt;
    if (this.biteTimer > 0 || this.engaged) return;
    this.biteTimer = 0.4;

    var t = this.tackle, lure = this.lure();
    var ctx = {
      hour: this.state.hour,
      weather: this.weatherName,
      // The depth the LURE is fishing at, not the depth of water under it.
      // Using water depth meant a jig in 30 m of water was matched against
      // every species' band as if it were sitting on the bottom, which made
      // the deep hole effectively unfishable.
      depth: -t.lureY,
      water: this.world.depthAt(t.lureX, t.lureZ),
      lure: lure,
      spot: this.currentSpot
    };
    var radius = lure.radius * (1 + this.luck() * 0.35);
    var best = null, bestW = 0, bestKey = -1;
    var list = this.shoal.fish;
    for (var i = 0; i < list.length; i++) {
      var f = list[i];
      if (f.state !== 'wander' || f.spooked > 0.4) continue;
      var dx = f.x - t.lureX, dy = f.y - t.lureY, dz = f.z - t.lureZ;
      var d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > radius * radius) continue;
      var prox = 1 - Math.sqrt(d2) / radius;
      var w = Sp.appeal(f.sp, ctx) * (0.35 + 0.65 * prox * prox);
      if (w <= 1e-9) continue;
      /* Weighted reservoir sampling (A-Res): key = U^(1/w) picks each candidate
         with probability proportional to w. The old max-of-(w * U) was so noisy
         that appeal barely mattered and whatever was commonest usually won. */
      var key = Math.pow(this.rng(), 1 / w);
      if (key > bestKey) { bestKey = key; best = f; bestW = w; }
    }
    if (!best) return;
    // Scale so a well-matched lure in the right water gets a bite in ~10-25s.
    var chance = M.sat(bestW * 8.5 * lure.patience);
    if (this.rng() < chance) {
      best.state = 'approach';
      best.timer = 12;
      this.engaged = best;
    }
  };

  Game.prototype.updateFight = function (dt) {
    var fight = this.fight, s = this.scene;
    var reeling = this.mouse.down;
    var res = fight.update(dt, reeling, this.drag, this.rod(), this.rng);

    if (reeling) {
      this.audio.reelClick(this.rod().reel * (1.3 - fight.tension));
      if (fight.tension > 0.62) this.audio.drag(fight.tension);
    }
    if (fight.tension > 0.88 && this.rng() < dt * 8) this.audio.creak(fight.tension);

    // Place the hooked fish on its arc.
    var f = fight.fish;
    this.rodTip(_tip);
    var ang = fight.angle;
    var fx = _tip[0] + Math.cos(ang) * fight.line;
    var fz = _tip[2] + Math.sin(ang) * fight.line;
    var surf = Ent.waveHeight(fx, fz, s.waveTime, s.waveScale);
    var bottom = this.world.sample(fx, fz);
    var depth = M.lerp(2.6, 0.32, 1 - fight.stamina) * (fight.phase === 'run' ? 1.35 : 1);
    var fy = Math.max(surf - depth, bottom + 0.3);
    var jumpArc = 0;
    if (fight.jump > 0) {
      var jt = 1 - fight.jump / 0.85;
      jumpArc = Math.sin(jt * Math.PI) * (0.7 + f.kg * 0.05);
      if (fight.jump > 0.82) { this.audio.jumpSplash(); this.splashAt(fx, fz, 1.1); }
    }
    fy = Math.max(fy, surf - 0.5) * (1 - M.sat(jumpArc)) + (surf + jumpArc) * M.sat(jumpArc);
    if (jumpArc <= 0) fy = Math.max(surf - depth, bottom + 0.3);

    var toRod = Math.atan2(_tip[2] - fz, _tip[0] - fx);
    var swim = toRod + Math.PI + (fight.phase === 'run' ? 0.9 : 0.2) * Math.sin(this.time * 3);
    this.hookedRender = {
      fish: f, x: fx, y: fy, z: fz,
      yaw: -swim + Math.PI, pitch: M.clamp((surf - fy) * -0.12, -0.6, 0.6),
      bendScale: 1.4 + fight.tension * 1.6
    };
    // The bobber rides just up the line from the fish.
    var t = this.tackle;
    t.x = M.lerp(fx, _tip[0], 0.12);
    t.z = M.lerp(fz, _tip[2], 0.12);
    t.y = Ent.waveHeight(t.x, t.z, s.waveTime, s.waveScale) - fight.tension * 0.09;
    t.state = 'water';

    if (this.rng() < dt * (2 + fight.tension * 8)) {
      this.ripples.spawn(fx, fz, 0.08, 0.9 + f.kg * 0.03, 1.1, 0.34, 0.35);
    }

    if (res === 'landed') this.landFish();
    else if (res === 'snapped') this.loseFish('Your line snapped.', true);
    else if (res === 'thrown') this.loseFish('It threw the hook.', false);

    this.ui.setFight({
      tension: fight.tension,
      stamina: fight.stamina,
      line: fight.line,
      start: fight.startLine,
      drag: this.drag,
      phase: fight.phase,
      name: f.sp.name,
      rarity: f.sp.rarity
    });
  };

  Game.prototype.loseFish = function (msg, snapped) {
    var f = this.fight.fish;
    this.fight.reset();
    this.mode = 'idle';
    this.tackle.state = 'idle';
    this.tackle.active = false;
    if (f) { f.visible = true; f.state = 'flee'; f.timer = 8; f.spooked = 1; }
    this.engaged = null;
    this.hookedRender = null;
    if (snapped) { this.audio.snap(); this.state.breaks++; }
    else { this.audio.plunk(); this.state.escapes++; }
    this.audio.setMood(this.state.hour > 20 || this.state.hour < 5 ? 'night' : 'calm');
    this.ui.hideFight();
    this.ui.showToast(msg + ' It was a ' + f.sp.name + '.', 'bad');
    this.save();
  };

  Game.prototype.landFish = function () {
    var f = this.fight.fish;
    var st = this.state;
    var sp = f.sp;
    var cm = Sp.lengthFor(sp, f.kg);
    var value = Sp.valueOf(sp, f.kg);
    var grade = Sp.trophyGrade(sp, f.kg);
    var rec = st.records[sp.id];
    var isRecord = !rec || f.kg > rec.kg;

    st.money += value;
    st.xp += Math.round(8 + f.kg * 6 + sp.rarity * 28);
    st.totalCatches++;
    st.totalWeight += f.kg;
    st.caught[sp.id] = (st.caught[sp.id] || 0) + 1;
    if (isRecord) st.records[sp.id] = { kg: f.kg, cm: cm, day: st.day, hour: st.hour };

    this.fight.reset();
    this.mode = 'idle';
    this.tackle.state = 'idle';
    this.tackle.active = false;
    this.hookedRender = null;
    this.engaged = null;

    this.splashAt(f.x, f.z, 1.0);
    this.audio.fanfare(sp.rarity);
    this.audio.setMood(this.state.hour > 20 || this.state.hour < 5 ? 'night' : 'calm');
    this.flash = 0.35 + sp.rarity * 0.1;

    var fc = this.fight.ctx || {};
    this.lastCatch = {
      species: sp, kg: f.kg, cm: cm, value: value, grade: grade,
      record: isRecord, first: st.caught[sp.id] === 1,
      day: st.day, hour: fc.hour !== undefined ? fc.hour : st.hour,
      weather: fc.weather || this.weatherName,
      lure: fc.lure || this.lure(), level: this.level(),
      spot: fc.spot || null, fromBoat: !!fc.fromBoat, range: fc.range || 0
    };
    this.lastCatch.quest = this.checkCommission(this.lastCatch);
    this.ui.hideFight();
    this.ui.showCatch(this.lastCatch);
    this.shoal.respawn(f);
    f.visible = true;
    this.save();
  };

  /* ====================================================================== */
  /*  COMMISSIONS                                                           */
  /* ====================================================================== */

  Game.prototype.commission = function () {
    var Q = DC.Quests;
    var i = this.state.quest || 0;
    return i < Q.LIST.length ? Q.LIST[i] : null;
  };

  /**
   * Score a catch against the active commission.
   * @returns null, {progress, need}, or {completed, reward, next}
   */
  Game.prototype.checkCommission = function (c) {
    var Q = DC.Quests, st = this.state;
    var q = this.commission();
    if (!q) return null;
    if (!Q.matches(q.goal, c)) return null;

    var need = q.goal.count || 1;

    // "Three different spots" counts distinct places, not repeats.
    if (q.goal.distinctSpots) {
      if (!st.questSpots) st.questSpots = [];
      if (!c.spot || st.questSpots.indexOf(c.spot.id) >= 0) {
        return { progress: st.questSpots.length, need: q.goal.distinctSpots, repeat: true };
      }
      st.questSpots.push(c.spot.id);
      st.questCount = st.questSpots.length;
      need = q.goal.distinctSpots;
    } else {
      st.questCount = (st.questCount || 0) + 1;
    }

    if (st.questCount < need) {
      return { progress: st.questCount, need: need };
    }

    // Completed.
    st.money += q.reward.money;
    st.xp += q.reward.xp;
    if (q.reward.unlock && st.lures.indexOf(q.reward.unlock) < 0) st.lures.push(q.reward.unlock);
    if (!st.questsDone) st.questsDone = [];
    st.questsDone.push(q.id);
    st.quest = (st.quest || 0) + 1;
    st.questCount = 0;
    st.questSpots = [];
    return { completed: true, quest: q, reward: q.reward, next: this.commission() };
  };

  Game.prototype.commissionStatus = function () {
    var q = this.commission();
    if (!q) return null;
    var need = q.goal.distinctSpots || q.goal.count || 1;
    return {
      quest: q,
      summary: DC.Quests.summarise(q.goal),
      progress: this.state.questCount || 0,
      need: need,
      done: (this.state.questsDone || []).length,
      total: DC.Quests.LIST.length
    };
  };

  /* ====================================================================== */
  /*  MAIN LOOP                                                             */
  /* ====================================================================== */
  Game.prototype.loop = function (now) {
    requestAnimationFrame(this.loop.bind(this));
    var dt = Math.min((now - this.lastNow) / 1000, 0.05);
    this.lastNow = now;
    if (!this.started) return;
    this.fps = M.lerp(this.fps, 1 / Math.max(dt, 1e-4), 0.06);

    if (!this.paused) {
      this.time += dt;
      this.update(dt);
    } else {
      this.audio.updateMusic();
    }
    this.draw();
    this.frame++;
  };

  Game.prototype.update = function (dt) {
    var s = this.scene;
    s.time = this.time;
    s.waveTime = this.time;

    this.updateEnvironment(dt);
    this.boatSpeed = this.updateBoat(dt);
    this.updatePlayer(dt);
    this.updateRod(dt);

    if (this.mode === 'charging') {
      this.castPower = Math.min(1, this.castPower + dt * 1.15);
      this.ui.setCastMeter(this.castPower);
    } else {
      this.ui.setCastMeter(-1);
    }

    if (this.mode === 'fighting') this.updateFight(dt);
    else if (this.tackle.state !== 'idle') this.updateFishing(dt);

    var lureCtx = this.tackle.active ? {
      active: true, x: this.tackle.lureX, y: this.tackle.lureY, z: this.tackle.lureZ,
      patience: this.lure().patience
    } : null;
    this.shoal.update(dt, { lure: lureCtx });

    this.particles.update(dt);
    this.ripples.update(dt);
    this.buildLine();

    // Bobber transform.
    var t = this.tackle;
    s.bobber.visible = t.state !== 'idle';
    if (s.bobber.visible) {
      M4.fromTranslation(s.bobber.matrix, [t.x, t.y + 0.045, t.z]);
      if (t.state === 'flying') {
        M4.rotateX(s.bobber.matrix, s.bobber.matrix, this.time * 7);
      } else {
        var tilt = M.clamp(t.bobVel * 0.10, -0.5, 0.5);
        M4.rotateZ(s.bobber.matrix, s.bobber.matrix, tilt);
      }
      s.bobber.glow = (this.lure().id === 'glow' && this.env.nightAmount > 0.4) ? 0.6 : 0;
    }

    // Ambient surface life: the odd rise somewhere out on the lake.
    if (this.rng() < dt * 0.55) {
      var ang = this.rng() * M.TAU, rr = 20 + this.rng() * 110;
      var px = Math.cos(ang) * rr, pz = Math.sin(ang) * rr;
      if (this.world.depthAt(px, pz) > 1.2) {
        this.ripples.spawn(px, pz, 0.08, 1.6, 2.0, 0.34, 0.3);
        if (Math.hypot(px - this.player.x, pz - this.player.z) < 55 && this.rng() < 0.5) {
          this.splashAt(px, pz, 0.35);
        }
      }
    }

    this.audio.updateMusic();
    this.audio.updateAmbience(dt, {
      night: this.env.nightAmount,
      wind: this.weather.p.wind,
      underwater: s.underwater,
      nearWater: M.sat(1 - Math.abs(this.player.y - 1.6) / 6)
    });

    this.updateHUD();
  };

  Game.prototype.updateHUD = function () {
    if (this.time - (this._hudAt || -1) < 0.07) return;
    this._hudAt = this.time;
    var st = this.state;
    var hint = '';
    if (this.boat.aboard && this.mode === 'idle') {
      hint = this.boat.anchored
        ? 'Hold [Left Click] to cast  ·  [Q] weigh anchor  ·  [E] step out'
        : '[W A S D] row  ·  [Q] drop anchor to fish steady  ·  [E] step out';
    } else if (!this.boat.aboard && this.boatDistance() < 3.6 && this.mode === 'idle') {
      hint = '[E] board the boat  ·  hold [Left Click] to cast';
    } else if (this.mode === 'idle') hint = 'Hold [Left Click] to charge a cast';
    else if (this.mode === 'charging') hint = 'Release to cast';
    else if (this.mode === 'flying') hint = '…';
    else if (this.mode === 'fishing') hint = 'Wait for a bite  ·  [Left Click] retrieve  ·  [R] reel in';
    else if (this.mode === 'bite') hint = 'CLICK!';
    else if (this.mode === 'fighting') hint = 'Hold [Left Click] to reel  ·  release to give line  ·  [Wheel] drag';

    this.ui.setHUD({
      money: st.money, level: this.level(), xp: st.xp,
      hour: st.hour, day: st.day,
      weather: WEATHERS[this.weatherName],
      lure: this.lure(), rod: this.rod(),
      depth: this.tackle.active ? this.world.depthAt(this.tackle.lureX, this.tackle.lureZ) : 0,
      boat: this.boat.aboard,
      anchored: this.boat.anchored,
      boatDepth: this.boat.aboard ? this.world.depthAt(this.boat.x, this.boat.z) : 0,
      nearBoat: !this.boat.aboard && this.boatDistance() < 3.6,
      spot: this.currentSpot || this.nearSpot || null,
      spotFishing: !!this.currentSpot,
      spotsFound: this.state.spots ? Object.keys(this.state.spots).length : 0,
      spotsTotal: (this.spots || []).length,
      commission: this.commissionStatus(),
      castDist: this.tackle.state !== 'idle'
        ? Math.hypot(this.tackle.x - this.player.x, this.tackle.z - this.player.z) : 0,
      hint: hint,
      mode: this.mode,
      fps: this.fps,
      caught: Object.keys(st.caught).length,
      total: Sp.SPECIES.length
    });
  };

  Game.prototype.draw = function () {
    if (!this.renderer || !this.world) return;
    var s = this.scene, r = this.renderer;

    var extra = this.hookedRender ? [this.hookedRender] : null;
    var n = this.shoal.pack(this.player.x, this.player.z, r.quality.fishDist, extra);
    r.uploadFish(this.shoal, n);
    s.fishCount = n;

    s.particleCount = this.particles.pack();
    s.particles = this.particles;
    s.rippleCount = this.ripples.pack();
    if (s.rippleCount) {
      var gl = r.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, r.ripple.buffers.pos);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.ripples.instPos, 0, s.rippleCount * 4);
      gl.bindBuffer(gl.ARRAY_BUFFER, r.ripple.buffers.par);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.ripples.instParam, 0, s.rippleCount * 4);
    }

    r.render(s);

    // The dock is drawn inside the main pass by piggybacking on the prop path;
    // doing it here keeps the renderer generic.
  };

  /* ====================================================================== */
  /*  PERSISTENCE                                                           */
  /* ====================================================================== */
  Game.prototype.save = function () {
    var b = this.boat;
    this.state.boat = { x: b.x, z: b.z, heading: b.heading, anchored: b.anchored };
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.state));
    } catch (e) { /* private mode, quota — not worth interrupting play */ }
  };

  Game.prototype.load = function () {
    try {
      var raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return;
      var d = JSON.parse(raw);
      if (d && d.version === 1) {
        var def = this.defaultState();
        for (var k in def) if (!(k in d)) d[k] = def[k];
        d.seed = def.seed;   // one lake, always
        this.state = d;
      }
    } catch (e) { /* corrupt save: fall back to a fresh one */ }
  };

  Game.prototype.resetSave = function () {
    localStorage.removeItem(SAVE_KEY);
    this.state = this.defaultState();
    this.save();
    location.reload();
  };

  /* ====================================================================== */
  /*  SHOP                                                                  */
  /* ====================================================================== */
  Game.prototype.buy = function (kind, id) {
    var st = this.state;
    var item = kind === 'rod' ? Sp.rodById[id] : Sp.lureById[id];
    if (!item) return false;
    var list = kind === 'rod' ? st.rods : st.lures;
    if (list.indexOf(id) >= 0) {
      if (kind === 'rod') st.rod = id; else this.selectLure(id);
      this.audio.ui(true);
      this.save();
      return true;
    }
    if (st.money < item.cost) { this.audio.deny(); return false; }
    st.money -= item.cost;
    list.push(id);
    if (kind === 'rod') st.rod = id; else st.lure = id;
    this.audio.buy();
    this.save();
    return true;
  };

  Game.prototype.rest = function (targetHour) {
    var st = this.state;
    if (this.mode === 'fighting') return;
    var delta = targetHour - st.hour;
    if (delta <= 0) { delta += 24; st.day++; }
    st.hour = targetHour;
    this.weather.timer = 0;
    this.reelIn();
    this.ui.showToast('You wait until ' + F.clock(targetHour) + '.', 'good');
    this.audio.setMood(targetHour > 20 || targetHour < 5 ? 'night' : 'calm');
    this.save();
  };

  Game.prototype.setQuality = function (name) {
    localStorage.setItem('deepcast.quality', name);
    this.renderer.setQuality(name, 190);
  };

  DC.Game = Game;
  DC.WEATHERS = WEATHERS;
})(DC);
