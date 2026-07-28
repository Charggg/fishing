/* =========================================================================
   DEEP CAST — ui.js
   Everything on top of the canvas: HUD, panels, the catch card (including a
   procedurally drawn portrait of whatever you just landed).
   ========================================================================= */
(function (DC) {
  'use strict';

  var M = DC.M, F = DC.F, Sp = DC.Species;

  function $(id) { return document.getElementById(id); }

  function UI() {
    this.game = null;
    this.el = {};
    this.openPanel = null;
    this.catchOpen = false;
    this.paused = false;
    this.toasts = [];
    this.lureSlots = [];
    this.shopTab = 'lures';
    this.lastHUD = {};
    this.cacheDom();
  }

  UI.prototype.cacheDom = function () {
    var ids = [
      'loading', 'load-fill', 'load-step', 'start', 'btn-play', 'hud', 'crosshair',
      'clock-time', 'clock-day', 'clock-ic', 'weather-ic', 'weather-name', 'money',
      'level', 'xp', 'dex', 'lurebar', 'hint', 'rig-rod', 'rig-lure', 'rig-depth',
      'rig-dist', 'rig-boat', 'rig-boat-row', 'rig-spot', 'rig-spot-row', 'spots',
      'map', 'map-canvas', 'map-found', 'map-list', 'map-legend',
      'cast-meter', 'cm-fill', 'prompt', 'fight', 'fight-name',
      'fight-phase', 'fb-tension', 'fb-stamina', 'fb-line', 'fb-dist', 'fb-drag',
      'toasts', 'catch', 'catch-banner', 'catch-art', 'catch-name', 'catch-latin',
      'catch-weight', 'catch-length', 'catch-value', 'catch-grade',
      'catch-grade-label', 'catch-tags', 'catch-desc', 'btn-catch-ok',
      'journal', 'journal-summary', 'dex-grid', 'shop', 'shop-money', 'shop-body',
      'help', 'pause', 'stats', 'fatal', 'fatal-msg',
      'set-quality', 'set-master', 'set-music', 'set-sfx', 'set-sens', 'set-fov',
      'set-invert', 'btn-resume', 'btn-help2', 'btn-reset'
    ];
    for (var i = 0; i < ids.length; i++) this.el[ids[i]] = $(ids[i]);
  };

  UI.prototype.attach = function (game) {
    var self = this, e = this.el;
    this.game = game;

    e['btn-play'].addEventListener('click', function () {
      e.start.classList.add('hidden');
      e.hud.classList.remove('hidden');
      game.requestLock();
      if (!game.state.seenTutorial) {
        game.state.seenTutorial = true;
        game.save();
        setTimeout(function () { self.toggleHelp(); }, 400);
      }
    });

    e['btn-catch-ok'].addEventListener('click', function () { self.closeCatch(); });

    document.querySelectorAll('[data-close]').forEach(function (btn) {
      btn.addEventListener('click', function () { self.closePanel(); });
    });

    document.querySelectorAll('.shop-tabs .tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        document.querySelectorAll('.shop-tabs .tab').forEach(function (t) { t.classList.remove('active'); });
        tab.classList.add('active');
        self.shopTab = tab.getAttribute('data-tab');
        self.renderShop();
        game.audio.ui(true);
      });
    });

    e['btn-resume'].addEventListener('click', function () { game.requestLock(); });
    e['btn-help2'].addEventListener('click', function () { self.setPaused(false); self.toggleHelp(); });
    e['btn-reset'].addEventListener('click', function () {
      if (confirm('Erase your save? Records, money and gear all go.')) game.resetSave();
    });

    e['set-quality'].value = game.renderer.qualityName;
    e['set-quality'].addEventListener('change', function () { game.setQuality(this.value); });

    function vol(id, which) {
      var stored = localStorage.getItem('deepcast.vol.' + which);
      if (stored !== null) { e[id].value = stored; game.audio.setVolume(which, stored / 100); }
      e[id].addEventListener('input', function () {
        game.audio.setVolume(which, this.value / 100);
        localStorage.setItem('deepcast.vol.' + which, this.value);
      });
    }
    vol('set-master', 'master');
    vol('set-music', 'music');
    vol('set-sfx', 'sfx');

    var sens = localStorage.getItem('deepcast.sens');
    if (sens) e['set-sens'].value = sens;
    game.mouse.sensitivity = e['set-sens'].value / 100;
    e['set-sens'].addEventListener('input', function () {
      game.mouse.sensitivity = this.value / 100;
      localStorage.setItem('deepcast.sens', this.value);
    });

    var fov = localStorage.getItem('deepcast.fov');
    if (fov) e['set-fov'].value = fov;
    game.scene.fov = M.rad(+e['set-fov'].value);
    e['set-fov'].addEventListener('input', function () {
      game.scene.fov = M.rad(+this.value);
      localStorage.setItem('deepcast.fov', this.value);
    });

    e['set-invert'].addEventListener('change', function () { game.mouse.invert = this.checked; });

    this.buildLureBar();
  };

  /* ------------------------------------------------------------ loading */
  UI.prototype.setLoading = function (pct, text) {
    this.el['load-fill'].style.width = Math.round(pct * 100) + '%';
    this.el['load-step'].textContent = text;
  };
  UI.prototype.hideLoading = function () {
    this.el['load-fill'].style.width = '100%';
    this.el.loading.classList.add('hidden');
  };
  UI.prototype.showStart = function () { this.el.start.classList.remove('hidden'); };
  UI.prototype.fatal = function (msg) {
    this.el.loading.classList.add('hidden');
    this.el['fatal-msg'].textContent = msg;
    this.el.fatal.classList.remove('hidden');
  };

  /* ---------------------------------------------------------------- HUD */
  UI.prototype.buildLureBar = function () {
    var self = this, game = this.game;
    var bar = this.el.lurebar;
    bar.innerHTML = '';
    this.lureSlots = [];
    Sp.LURES.forEach(function (lure, i) {
      var d = document.createElement('div');
      d.className = 'lure-slot';
      d.innerHTML = '<div class="em">' + lure.icon + '</div>' +
        '<div class="nm">' + lure.name + '</div>' +
        '<div class="kb">' + (i + 1) + '</div>';
      d.title = lure.name + ' — ' + lure.desc;
      d.addEventListener('click', function () {
        if (game.state.lures.indexOf(lure.id) >= 0) game.selectLure(lure.id);
        else { self.showToast('Locked — buy it in the shop [B].', 'warn'); game.audio.deny(); }
      });
      bar.appendChild(d);
      self.lureSlots.push({ el: d, lure: lure });
    });
  };

  UI.prototype.refreshLureBar = function () {
    var st = this.game.state;
    for (var i = 0; i < this.lureSlots.length; i++) {
      var s = this.lureSlots[i];
      var owned = st.lures.indexOf(s.lure.id) >= 0;
      s.el.classList.toggle('locked', !owned);
      s.el.classList.toggle('active', st.lure === s.lure.id);
    }
  };

  var CLOCK_ICONS = [
    [0, '🌙'], [5, '🌅'], [8, '☀️'], [17, '🌇'], [20, '🌙']
  ];
  function clockIcon(h) {
    var ic = '🌙';
    for (var i = 0; i < CLOCK_ICONS.length; i++) if (h >= CLOCK_ICONS[i][0]) ic = CLOCK_ICONS[i][1];
    return ic;
  }

  UI.prototype.setHUD = function (d) {
    var e = this.el, last = this.lastHUD;
    if (d.money !== last.money) e.money.textContent = F.money(d.money);
    if (d.level !== last.level) e.level.textContent = 'Lv ' + d.level;
    if (d.xp !== last.xp) e.xp.textContent = d.xp + ' xp';
    var clock = F.clock(d.hour);
    if (clock !== last.clock) {
      e['clock-time'].textContent = clock;
      e['clock-ic'].textContent = clockIcon(d.hour);
    }
    if (d.day !== last.day) e['clock-day'].textContent = 'Day ' + d.day;
    if (d.weather.label !== last.weather) {
      e['weather-name'].textContent = d.weather.label;
      e['weather-ic'].textContent = d.weather.icon;
    }
    if (d.caught !== last.caught) e.dex.textContent = d.caught + '/' + d.total;
    if (d.rod.name !== last.rod) e['rig-rod'].textContent = d.rod.name;
    if (d.lure.id !== last.lure) { e['rig-lure'].textContent = d.lure.name; this.refreshLureBar(); }
    e['rig-depth'].textContent = d.depth > 0.05 ? d.depth.toFixed(1) + ' m deep' : '—';
    e['rig-dist'].textContent = d.castDist > 0.5 ? d.castDist.toFixed(1) + ' m out' : '—';
    if (e['spots'] && d.spotsFound !== last.spotsFound) {
      e['spots'].textContent = d.spotsFound + '/' + d.spotsTotal;
    }
    if (e['rig-spot-row']) {
      var known = d.spot && this.game.state.spots && this.game.state.spots[d.spot.id];
      e['rig-spot-row'].classList.toggle('hidden', !d.spot);
      if (d.spot) {
        e['rig-spot'].textContent = (known ? d.spot.icon + ' ' + d.spot.name : '❓ unmarked water');
        e['rig-spot'].style.color = d.spotFishing ? 'var(--accent)' : 'var(--dim)';
      }
    }
    if (e['rig-boat-row']) {
      e['rig-boat-row'].classList.toggle('hidden', !d.boat);
      if (d.boat) {
        e['rig-boat'].textContent = (d.anchored ? '⚓ ' : '🚣 ') + d.boatDepth.toFixed(1) + ' m under';
        e['rig-boat'].style.color = d.anchored ? 'var(--accent)' : 'var(--ink)';
      }
    }
    if (d.hint !== last.hint) e.hint.textContent = d.hint;

    this.lastHUD = {
      money: d.money, level: d.level, xp: d.xp, clock: clock, day: d.day,
      weather: d.weather.label, caught: d.caught, rod: d.rod.name, lure: d.lure.id, hint: d.hint,
      spotsFound: d.spotsFound
    };

    if (this.statsOpen) {
      e.stats.textContent =
        'fps      ' + d.fps.toFixed(0) + '\n' +
        'mode     ' + d.mode + '\n' +
        'casts    ' + this.game.state.casts + '\n' +
        'landed   ' + this.game.state.totalCatches + '\n' +
        'snapped  ' + this.game.state.breaks + '\n' +
        'lost     ' + this.game.state.escapes + '\n' +
        'weight   ' + F.weight(this.game.state.totalWeight) + '\n' +
        'fish     ' + this.game.shoal.drawn + ' drawn';
    }
  };

  UI.prototype.setCastMeter = function (p) {
    var e = this.el['cast-meter'];
    if (p < 0) { if (!e.classList.contains('hidden')) e.classList.add('hidden'); return; }
    e.classList.remove('hidden');
    this.el['cm-fill'].style.width = (p * 100).toFixed(1) + '%';
  };

  UI.prototype.showPrompt = function (text, kind) {
    var e = this.el.prompt;
    e.textContent = text;
    e.className = kind || '';
    e.classList.remove('hidden');
  };
  UI.prototype.hidePrompt = function () { this.el.prompt.classList.add('hidden'); };

  UI.prototype.flashLure = function (lure) {
    this.refreshLureBar();
    this.showToast(lure.icon + '  ' + lure.name + ' — fishes at ' + lure.depth.toFixed(1) + ' m', 'good');
  };

  /* -------------------------------------------------------------- fight */
  UI.prototype.setFight = function (d) {
    var e = this.el;
    e.fight.classList.remove('hidden');
    e['fight-name'].textContent = d.name;
    e['fight-name'].style.color = Sp.RARITY[d.rarity].color;
    e['fight-phase'].textContent =
      d.phase === 'run' ? 'RUNNING — give line' :
        d.phase === 'give' ? 'GIVING — reel!' : 'holding';
    e['fb-tension'].style.width = Math.min(d.tension, 1) * 100 + '%';
    e['fb-stamina'].style.width = d.stamina * 100 + '%';
    e['fb-line'].style.width = M.sat(1 - d.line / Math.max(d.start, 1)) * 100 + '%';
    e['fb-dist'].textContent = d.line.toFixed(1) + ' m';
    e['fb-drag'].textContent = Math.round(d.drag * 100) + '%';
    e.fight.classList.toggle('danger', d.tension > 0.88);
  };
  UI.prototype.hideFight = function () {
    this.el.fight.classList.add('hidden');
    this.el.fight.classList.remove('danger');
  };

  /* ------------------------------------------------------------- toasts */
  UI.prototype.showToast = function (text, kind) {
    var host = this.el.toasts;
    var d = document.createElement('div');
    d.className = 'toast ' + (kind || '');
    d.textContent = text;
    host.appendChild(d);
    while (host.children.length > 4) host.removeChild(host.firstChild);
    setTimeout(function () {
      d.classList.add('out');
      setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 450);
    }, 2600);
  };

  /* --------------------------------------------------------- catch card */
  // Draws the fish from the same radius profile the 3D mesh uses, so the
  // portrait actually matches the thing you just pulled out of the water.
  var PROFILE = [
    [0.00, 0.020], [0.05, 0.050], [0.12, 0.080], [0.22, 0.128],
    [0.34, 0.172], [0.46, 0.200], [0.56, 0.208], [0.66, 0.198],
    [0.76, 0.172], [0.86, 0.128], [0.94, 0.075], [1.00, 0.022]
  ];
  function radiusAt(t) {
    for (var i = 1; i < PROFILE.length; i++) {
      if (t <= PROFILE[i][0]) {
        var a = PROFILE[i - 1], b = PROFILE[i];
        var k = (t - a[0]) / (b[0] - a[0]);
        return M.lerp(a[1], b[1], M.smoothstep(0, 1, k));
      }
    }
    return 0.02;
  }
  function rgb(c, mul) {
    mul = mul || 1;
    return 'rgb(' + Math.round(M.sat(c[0] * mul) * 255) + ',' +
      Math.round(M.sat(c[1] * mul) * 255) + ',' + Math.round(M.sat(c[2] * mul) * 255) + ')';
  }

  UI.prototype.drawFishPortrait = function (sp, kg) {
    var cv = this.el['catch-art'];
    var g = cv.getContext('2d');
    var W = cv.width, H = cv.height;
    g.clearRect(0, 0, W, H);

    var pad = 46;
    var len = W - pad * 2;
    var cy = H * 0.52;
    var hgt = len * 0.30 * (sp.body[1] / 1.2) / Math.max(sp.body[0], 0.6);
    var slim = sp.body[0];

    // Water-ish backdrop.
    var bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, 'rgba(20,44,64,0.55)');
    bg.addColorStop(1, 'rgba(6,14,24,0.1)');
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);

    function bodyX(t) { return pad + t * len; }   // t=0 tail (left), t=1 nose (right)
    function bodyY(t, side) {
      var r = radiusAt(t) / 0.208;
      return cy - side * r * hgt - Math.sin(Math.PI * t) * hgt * 0.05;
    }

    // Caudal fin.
    g.beginPath();
    g.moveTo(bodyX(0.03), cy);
    g.lineTo(pad - len * 0.12, cy - hgt * 1.05);
    g.lineTo(pad - len * 0.05, cy);
    g.lineTo(pad - len * 0.12, cy + hgt * 1.05);
    g.closePath();
    g.fillStyle = rgb(sp.fin, 0.95);
    g.fill();

    // Dorsal + anal fins.
    g.beginPath();
    g.moveTo(bodyX(0.62), bodyY(0.62, 1));
    g.quadraticCurveTo(bodyX(0.45), cy - hgt * 1.30, bodyX(0.24), bodyY(0.24, 1));
    g.closePath();
    g.fillStyle = rgb(sp.fin, 0.85);
    g.fill();
    g.beginPath();
    g.moveTo(bodyX(0.34), bodyY(0.34, -1));
    g.quadraticCurveTo(bodyX(0.24), cy + hgt * 1.18, bodyX(0.14), bodyY(0.14, -1));
    g.closePath();
    g.fill();

    // Body.
    g.beginPath();
    g.moveTo(bodyX(0), cy);
    var t;
    for (t = 0; t <= 1.0001; t += 0.02) g.lineTo(bodyX(t), bodyY(t, 1));
    for (t = 1; t >= -0.0001; t -= 0.02) g.lineTo(bodyX(t), bodyY(t, -1));
    g.closePath();
    var grad = g.createLinearGradient(0, cy - hgt, 0, cy + hgt);
    grad.addColorStop(0, rgb(sp.dorsal, 0.8));
    grad.addColorStop(0.42, rgb(sp.dorsal));
    grad.addColorStop(0.66, rgb(sp.belly, 0.95));
    grad.addColorStop(1, rgb(sp.belly));
    g.fillStyle = grad;
    g.fill();
    g.save();
    g.clip();

    // Scales + mottling.
    g.globalAlpha = 0.13;
    g.fillStyle = '#000';
    for (var sx = pad - 10; sx < W; sx += 9) {
      for (var sy = cy - hgt; sy < cy + hgt; sy += 7) {
        g.beginPath();
        g.arc(sx + ((sy / 7) | 0) % 2 * 4.5, sy, 3.6, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.globalAlpha = 0.22;
    for (var b = 0; b < 9; b++) {
      var bx = pad + len * (0.08 + b * 0.1);
      g.fillRect(bx, cy - hgt, 4 + (b % 3) * 3, hgt * 2);
    }
    g.restore();

    // Lateral line + gill plate.
    g.globalAlpha = 0.3;
    g.strokeStyle = '#000';
    g.lineWidth = 1.6;
    g.beginPath();
    for (t = 0.08; t <= 0.94; t += 0.03) g.lineTo(bodyX(t), cy - hgt * 0.12 * Math.sin(t * 2.6));
    g.stroke();
    g.beginPath();
    g.moveTo(bodyX(0.80), bodyY(0.80, 1) + 2);
    g.quadraticCurveTo(bodyX(0.76), cy, bodyX(0.80), bodyY(0.80, -1) - 2);
    g.stroke();
    g.globalAlpha = 1;

    // Pectoral fin.
    g.beginPath();
    g.moveTo(bodyX(0.72), cy + hgt * 0.10);
    g.quadraticCurveTo(bodyX(0.60), cy + hgt * 0.72, bodyX(0.66), cy + hgt * 0.15);
    g.closePath();
    g.fillStyle = rgb(sp.fin, 1.05);
    g.globalAlpha = 0.9;
    g.fill();
    g.globalAlpha = 1;

    // Mouth + eye.
    g.strokeStyle = 'rgba(0,0,0,0.55)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(bodyX(0.995), cy + hgt * 0.06);
    g.lineTo(bodyX(0.90), cy + hgt * 0.16);
    g.stroke();

    var ex = bodyX(0.885), ey = cy - hgt * 0.30;
    var er = Math.max(hgt * 0.15, 4);
    g.beginPath(); g.arc(ex, ey, er, 0, Math.PI * 2);
    g.fillStyle = '#f2efe6'; g.fill();
    g.beginPath(); g.arc(ex, ey, er * 0.55, 0, Math.PI * 2);
    g.fillStyle = '#10141a'; g.fill();
    g.beginPath(); g.arc(ex - er * 0.25, ey - er * 0.25, er * 0.2, 0, Math.PI * 2);
    g.fillStyle = 'rgba(255,255,255,0.85)'; g.fill();

    if (sp.glow) {
      g.globalCompositeOperation = 'lighter';
      var gl = g.createRadialGradient(W / 2, cy, 4, W / 2, cy, len * 0.5);
      gl.addColorStop(0, 'rgba(120,180,255,0.35)');
      gl.addColorStop(1, 'rgba(120,180,255,0)');
      g.fillStyle = gl;
      g.fillRect(0, 0, W, H);
      g.globalCompositeOperation = 'source-over';
    }

    // Scale bar so the size reads at a glance.
    g.fillStyle = 'rgba(220,235,250,0.55)';
    g.font = '11px ui-monospace, monospace';
    g.fillText(Sp.lengthFor(sp, kg).toFixed(0) + ' cm', pad, H - 10);
    g.fillRect(pad, H - 24, len, 2);
    g.fillRect(pad, H - 28, 2, 10);
    g.fillRect(pad + len - 2, H - 28, 2, 10);
  };

  UI.prototype.showCatch = function (c) {
    var e = this.el, sp = c.species;
    this.catchOpen = true;
    var rar = Sp.RARITY[sp.rarity];

    e['catch-banner'].textContent = c.record ? 'NEW PERSONAL BEST' : (c.first ? 'NEW SPECIES' : 'NICE CATCH');
    e['catch-banner'].style.background = 'linear-gradient(90deg, ' + rar.color + ', ' + rar.color + '99)';
    e['catch-name'].textContent = sp.name;
    e['catch-name'].style.color = rar.color;
    e['catch-latin'].textContent = sp.latin;
    e['catch-weight'].textContent = F.weight(c.kg);
    e['catch-length'].textContent = F.length(c.cm);
    e['catch-value'].textContent = F.money(c.value);
    e['catch-grade'].style.width = (c.grade * 100).toFixed(0) + '%';
    e['catch-grade-label'].textContent =
      c.grade > 0.92 ? 'MONSTER FOR THE SPECIES' :
        c.grade > 0.72 ? 'a proper specimen' :
          c.grade > 0.4 ? 'a good average fish' : 'a modest one';
    e['catch-desc'].textContent = sp.desc;

    var tags = [];
    tags.push({ t: rar.name, c: rar.color });
    if (c.first) tags.push({ t: 'FIRST CATCH', c: '#7fe3d8' });
    if (c.record) tags.push({ t: 'RECORD', c: '#ffc45c' });
    if (c.grade > 0.9) tags.push({ t: 'TROPHY', c: '#ff8a5c' });
    tags.push({ t: c.lure.icon + ' ' + c.lure.name.toUpperCase(), c: '#93a4b8' });
    tags.push({ t: F.clock(c.hour), c: '#93a4b8' });
    e['catch-tags'].innerHTML = tags.map(function (t) {
      return '<span class="tag" style="color:' + t.c + '">' + t.t + '</span>';
    }).join('');

    this.drawFishPortrait(sp, c.kg);
    e.catch.classList.remove('hidden');
    if (document.exitPointerLock) document.exitPointerLock();
  };

  UI.prototype.closeCatch = function () {
    this.catchOpen = false;
    this.el.catch.classList.add('hidden');
    this.game.requestLock();
  };

  /* -------------------------------------------------------------- panels */
  UI.prototype.anyPanelOpen = function () {
    return !!this.openPanel || this.catchOpen || this.paused ||
      !this.el.start.classList.contains('hidden');
  };

  UI.prototype.showPanel = function (name) {
    if (this.openPanel === name) return this.closePanel();
    this.closePanel();
    this.openPanel = name;
    this.el[name].classList.remove('hidden');
    if (document.exitPointerLock) document.exitPointerLock();
    this.game.audio.ui(true);
  };

  UI.prototype.closePanel = function () {
    if (!this.openPanel) return;
    this.el[this.openPanel].classList.add('hidden');
    this.openPanel = null;
    this.game.audio.ui(false);
    if (!this.paused && !this.catchOpen) this.game.requestLock();
  };

  UI.prototype.toggleJournal = function () {
    if (this.openPanel === 'journal') return this.closePanel();
    this.renderJournal();
    this.showPanel('journal');
  };
  UI.prototype.toggleShop = function () {
    if (this.openPanel === 'shop') return this.closePanel();
    this.renderShop();
    this.showPanel('shop');
  };
  UI.prototype.toggleHelp = function () {
    if (this.openPanel === 'help') return this.closePanel();
    this.showPanel('help');
  };
  UI.prototype.toggleMap = function () {
    if (this.openPanel === 'map') return this.closePanel();
    this.renderMap();
    this.showPanel('map');
  };
  UI.prototype.toggleStats = function () {
    this.statsOpen = !this.statsOpen;
    this.el.stats.classList.toggle('hidden', !this.statsOpen);
  };

  UI.prototype.setPaused = function (v) {
    this.paused = v;
    this.el.pause.classList.toggle('hidden', !v);
    if (v) this.closePanel();
  };

  UI.prototype.handleKey = function (k, e) {
    if (k === 'escape') {
      if (this.catchOpen) { this.closeCatch(); return true; }
      if (this.openPanel) { this.closePanel(); return true; }
      return false;
    }
    if (k === 'enter' && this.catchOpen) { this.closeCatch(); return true; }
    if (this.catchOpen) return true;
    return false;
  };

  /* ------------------------------------------------------------- journal */
  UI.prototype.renderJournal = function () {
    var st = this.game.state;
    var found = Object.keys(st.caught).length;
    var best = null;
    for (var id in st.records) {
      if (!best || st.records[id].kg > st.records[best].kg) best = id;
    }
    this.el['journal-summary'].innerHTML =
      '<div><b>' + found + ' / ' + Sp.SPECIES.length + '</b>species logged</div>' +
      '<div><b>' + st.totalCatches + '</b>fish landed</div>' +
      '<div><b>' + F.weight(st.totalWeight) + '</b>total weight</div>' +
      '<div><b>' + (best ? Sp.byId[best].name : '—') + '</b>personal best</div>' +
      '<div><b>' + st.casts + '</b>casts made</div>' +
      '<div><b>' + st.breaks + '</b>lines snapped</div>' +
      '<div><b>' + this.game.discoveredSpots().length + ' / ' + (this.game.spots || []).length +
      '</b>spots on the chart</div>';

    var html = Sp.SPECIES.map(function (sp) {
      var n = st.caught[sp.id] || 0;
      var rec = st.records[sp.id];
      var rar = Sp.RARITY[sp.rarity];
      if (!n) {
        return '<div class="dex-card locked">' +
          '<div class="dex-top"><div class="dex-name">???</div>' +
          '<div class="dex-rar" style="color:' + rar.color + '">' + rar.name.toUpperCase() + '</div></div>' +
          '<div class="dex-swatch" style="background:linear-gradient(90deg,#333,#555)"></div>' +
          '<div class="dex-stat"><span>Not yet caught</span></div>' +
          '<div class="dex-hint">' + describeHabitat(sp) + '</div></div>';
      }
      return '<div class="dex-card">' +
        '<div class="dex-top"><div class="dex-name">' + sp.name + '</div>' +
        '<div class="dex-rar" style="color:' + rar.color + '">' + rar.name.toUpperCase() + '</div></div>' +
        '<div class="dex-swatch" style="background:linear-gradient(90deg,' +
        rgb(sp.dorsal) + ',' + rgb(sp.belly) + ')"></div>' +
        '<div class="dex-stat"><span>Caught</span><b>' + n + '</b></div>' +
        // A save written by an older build can have a count without a record.
        '<div class="dex-stat"><span>Best</span><b>' + (rec ? F.weight(rec.kg) : '—') + '</b></div>' +
        '<div class="dex-stat"><span>Length</span><b>' + (rec ? F.length(rec.cm) : '—') + '</b></div>' +
        '<div class="dex-hint">' + describeHabitat(sp) + '</div></div>';
    }).join('');
    this.el['dex-grid'].innerHTML = html;
  };

  function describeHabitat(sp) {
    var slots = ['night', 'dawn', 'day', 'dusk'];
    var bestI = 0;
    for (var i = 1; i < 4; i++) if (sp.act[i] > sp.act[bestI]) bestI = i;
    var bestLure = null, bestVal = 0;
    for (var id in sp.lures) if (sp.lures[id] > bestVal) { bestVal = sp.lures[id]; bestLure = id; }
    return sp.depth[0].toFixed(0) + '–' + sp.depth[1].toFixed(0) + ' m · most active at ' +
      slots[bestI] + ' · likes the ' + (Sp.lureById[bestLure] ? Sp.lureById[bestLure].name.toLowerCase() : '?');
  }

  /* --------------------------------------------------------------- chart
     A bathymetric chart drawn straight from the same heightmap the terrain
     mesh and the physics read, so the contours are the real lake bed. The
     terrain layer never changes, so it is rasterised once and cached. */
  var MAP_EXTENT = 190;          // world units covered, half-width
  var CONTOUR = 4;               // metres between depth contours

  // Bathymetric ramp, shallow to deep.
  var DEPTH_RAMP = [
    [0.0, [190, 224, 226]], [1.5, [140, 200, 214]], [3.5, [92, 172, 196]],
    [7.0, [56, 138, 178]], [12.0, [40, 104, 150]], [18.0, [30, 74, 120]],
    [26.0, [22, 52, 92]], [40.0, [16, 36, 68]]
  ];
  var LAND_RAMP = [
    [0.0, [214, 200, 158]], [2.5, [150, 168, 108]], [10.0, [104, 138, 84]],
    [26.0, [96, 106, 76]], [50.0, [126, 124, 112]], [90.0, [206, 210, 214]]
  ];
  function ramp(table, v) {
    for (var i = 1; i < table.length; i++) {
      if (v <= table[i][0]) {
        var a = table[i - 1], b = table[i];
        var k = (v - a[0]) / (b[0] - a[0]);
        return [
          a[1][0] + (b[1][0] - a[1][0]) * k,
          a[1][1] + (b[1][1] - a[1][1]) * k,
          a[1][2] + (b[1][2] - a[1][2]) * k
        ];
      }
    }
    return table[table.length - 1][1];
  }

  UI.prototype.buildMapTerrain = function () {
    if (this._mapTerrain) return this._mapTerrain;
    var g = this.game, w = g.world;
    var N = 512;
    var cv = document.createElement('canvas');
    cv.width = N; cv.height = N;
    var ctx = cv.getContext('2d');
    var img = ctx.createImageData(N, N);
    var px = img.data;
    var scale = (MAP_EXTENT * 2) / N;

    for (var j = 0; j < N; j++) {
      var wz = -MAP_EXTENT + (j + 0.5) * scale;
      for (var i = 0; i < N; i++) {
        var wx = -MAP_EXTENT + (i + 0.5) * scale;
        var h = w.sample(wx, wz);
        var col;
        if (h < 0) {
          col = ramp(DEPTH_RAMP, -h);
          // Contour lines: darken where a depth band boundary is crossed.
          var hr = w.sample(wx + scale, wz), hd = w.sample(wx, wz + scale);
          var band = Math.floor(-h / CONTOUR);
          if (Math.floor(-hr / CONTOUR) !== band || Math.floor(-hd / CONTOUR) !== band) {
            col = [col[0] * 0.72, col[1] * 0.72, col[2] * 0.74];
          }
        } else {
          col = ramp(LAND_RAMP, h);
          // Hillshade from the north-west so the terrain reads as relief.
          var e = scale;
          var gx = (w.sample(wx + e, wz) - w.sample(wx - e, wz)) / (2 * e);
          var gz = (w.sample(wx, wz + e) - w.sample(wx, wz - e)) / (2 * e);
          var shade = M.clamp(0.72 + (-gx * 0.55 - gz * 0.55) * 1.6, 0.35, 1.5);
          col = [col[0] * shade, col[1] * shade, col[2] * shade];
        }
        var k2 = (j * N + i) * 4;
        px[k2] = col[0]; px[k2 + 1] = col[1]; px[k2 + 2] = col[2]; px[k2 + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    this._mapTerrain = cv;
    return cv;
  };

  UI.prototype.renderMap = function () {
    var g = this.game;
    if (!g.spots) return;
    var cv = this.el['map-canvas'];
    var ctx = cv.getContext('2d');
    var W = cv.width, H = cv.height;
    var st = g.state;

    function toPx(x, z) {
      return [(x + MAP_EXTENT) / (MAP_EXTENT * 2) * W, (z + MAP_EXTENT) / (MAP_EXTENT * 2) * H];
    }

    ctx.clearRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.buildMapTerrain(), 0, 0, W, H);

    // Vignette so the chart sits inside its frame.
    var vg = ctx.createRadialGradient(W / 2, H / 2, W * 0.32, W / 2, H / 2, W * 0.72);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(2,6,12,0.34)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);

    // --- the dock
    var d = g.dock;
    var a = toPx(d.x, d.z), b = toPx(d.endX, d.endZ);
    ctx.strokeStyle = 'rgba(60,40,28,0.95)';
    ctx.lineWidth = 7; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    ctx.strokeStyle = 'rgba(190,160,120,0.9)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();

    // --- spots
    for (var i = 0; i < g.spots.length; i++) {
      var s = g.spots[i];
      var found = !!(st.spots && st.spots[s.id]);
      var p = toPx(s.x, s.z);
      var rpx = s.radius / (MAP_EXTENT * 2) * W;
      if (!found) {
        // Hint at unexplored structure without giving it away.
        ctx.setLineDash([4, 6]);
        ctx.strokeStyle = 'rgba(200,220,235,0.20)';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(p[0], p[1], rpx, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
        continue;
      }
      ctx.fillStyle = 'rgba(127,227,216,0.14)';
      ctx.beginPath(); ctx.arc(p[0], p[1], rpx, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(127,227,216,0.75)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p[0], p[1], rpx, 0, Math.PI * 2); ctx.stroke();

      // A drawn pin, not an emoji: canvases cannot be trusted to have the font.
      ctx.save();
      ctx.translate(p[0], p[1]);
      ctx.fillStyle = '#7fe3d8';
      ctx.strokeStyle = 'rgba(6,14,22,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, 9);
      ctx.bezierCurveTo(-8, -1, -7.5, -12, 0, -12);
      ctx.bezierCurveTo(7.5, -12, 8, -1, 0, 9);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#08131d';
      ctx.beginPath(); ctx.arc(0, -5, 3.1, 0, Math.PI * 2); ctx.fill();
      ctx.restore();

      ctx.textAlign = 'center';
      ctx.font = '600 13px ui-sans-serif, system-ui, sans-serif';
      ctx.textBaseline = 'top';
      var label = s.name;
      var tw = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(4,10,18,0.78)';
      ctx.fillRect(p[0] - tw / 2 - 5, p[1] + rpx + 4, tw + 10, 18);
      ctx.fillStyle = '#dff2f6';
      ctx.fillText(label, p[0], p[1] + rpx + 6);
    }

    // --- the boat
    var bt = g.boat;
    var bp = toPx(bt.x, bt.z);
    ctx.save();
    ctx.translate(bp[0], bp[1]);
    // World heading 0 faces -Z, which is up on the chart.
    ctx.rotate(-bt.heading);
    ctx.fillStyle = bt.aboard ? '#ffc45c' : '#c9a06a';
    ctx.strokeStyle = 'rgba(10,16,24,0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -11); ctx.lineTo(6, 8); ctx.lineTo(0, 4); ctx.lineTo(-6, 8);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
    if (bt.anchored) {
      ctx.strokeStyle = '#ffc45c';
      ctx.lineWidth = 1.8;
      var ax = bp[0] + 14, ay = bp[1] - 12;
      ctx.beginPath();
      ctx.moveTo(ax, ay - 5); ctx.lineTo(ax, ay + 5);
      ctx.moveTo(ax - 4, ay - 2); ctx.lineTo(ax + 4, ay - 2);
      ctx.moveTo(ax - 5, ay + 2); ctx.quadraticCurveTo(ax, ay + 9, ax + 5, ay + 2);
      ctx.stroke();
    }

    // --- the player, with a view cone (hidden while aboard: same place)
    if (!bt.aboard) {
      var pp = toPx(g.player.x, g.player.z);
      var yaw = g.player.yaw;
      ctx.save();
      ctx.translate(pp[0], pp[1]);
      ctx.rotate(-yaw);
      var cone = ctx.createLinearGradient(0, 0, 0, -46);
      cone.addColorStop(0, 'rgba(127,227,216,0.42)');
      cone.addColorStop(1, 'rgba(127,227,216,0)');
      ctx.fillStyle = cone;
      ctx.beginPath(); ctx.moveTo(0, 0);
      ctx.arc(0, 0, 46, -Math.PI / 2 - 0.55, -Math.PI / 2 + 0.55);
      ctx.closePath(); ctx.fill();
      ctx.restore();
      ctx.fillStyle = '#7fe3d8';
      ctx.strokeStyle = 'rgba(6,12,20,0.9)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(pp[0], pp[1], 5, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
    }

    // --- where the lure is sitting
    if (g.tackle.state !== 'idle') {
      var tp = toPx(g.tackle.x, g.tackle.z);
      ctx.fillStyle = '#ff6b6b';
      ctx.strokeStyle = 'rgba(6,12,20,0.9)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(tp[0], tp[1], 3.5, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
    }

    // --- north arrow and scale bar
    ctx.fillStyle = 'rgba(4,10,18,0.72)';
    ctx.fillRect(W - 58, 12, 46, 52);
    ctx.fillStyle = '#dff2f6';
    ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('N', W - 35, 52);
    ctx.beginPath();
    ctx.moveTo(W - 35, 20); ctx.lineTo(W - 41, 40); ctx.lineTo(W - 35, 35);
    ctx.lineTo(W - 29, 40); ctx.closePath();
    ctx.fill();

    var barWorld = 50;
    var barPx = barWorld / (MAP_EXTENT * 2) * W;
    ctx.fillStyle = 'rgba(4,10,18,0.72)';
    ctx.fillRect(W - barPx - 24, H - 40, barPx + 16, 28);
    ctx.fillStyle = '#dff2f6';
    ctx.fillRect(W - barPx - 16, H - 22, barPx, 3);
    ctx.fillRect(W - barPx - 16, H - 26, 2, 10);
    ctx.fillRect(W - 18, H - 26, 2, 10);
    ctx.font = '10px ui-monospace, monospace';
    ctx.fillText(barWorld + ' m', W - barPx / 2 - 16, H - 33);

    // --- legend + list
    this.el['map-legend'].innerHTML =
      '<i><span class="sw" style="background:#8fd0dd"></span>shallow</i>' +
      '<i><span class="sw" style="background:#388ab2"></span>mid</i>' +
      '<i><span class="sw" style="background:#162444"></span>deep</i>' +
      '<i>contours every ' + CONTOUR + ' m</i>';

    var found = g.discoveredSpots().length;
    this.el['map-found'].textContent = found + ' / ' + g.spots.length + ' spots';
    this.el['map-list'].innerHTML = g.spots.map(function (sp) {
      var known = !!(st.spots && st.spots[sp.id]);
      if (!known) {
        return '<div class="map-card locked"><div class="mc-top">' +
          '<span>❓</span><span class="mc-name">Unmarked water</span>' +
          '<span class="mc-depth">—</span></div>' +
          '<div class="mc-hint">Cast here to log it.</div></div>';
      }
      return '<div class="map-card"><div class="mc-top">' +
        '<span>' + sp.icon + '</span><span class="mc-name">' + sp.name + '</span>' +
        '<span class="mc-depth">' + sp.depth.toFixed(1) + ' m</span></div>' +
        '<div class="mc-hint">' + sp.hint + '</div></div>';
    }).join('');
  };

  /* ---------------------------------------------------------------- shop */
  UI.prototype.renderShop = function () {
    var self = this, game = this.game, st = game.state;
    this.el['shop-money'].textContent = F.money(st.money);
    var body = this.el['shop-body'];
    body.innerHTML = '';

    if (this.shopTab === 'rest') {
      var options = [
        ['🌅', 'Dawn', 5.5, 'Bass and trout are on the hunt.'],
        ['☀️', 'Midday', 12, 'Panfish and carp in the shallows.'],
        ['🌇', 'Dusk', 19.5, 'The best hour on the lake, and everyone knows it.'],
        ['🌙', 'Midnight', 0.5, 'Walleye, catfish, and whatever the glow jig finds.']
      ];
      body.innerHTML = '<div class="shop-desc" style="margin-bottom:14px">Fish do not bite around the clock. ' +
        'Sit on the dock and wait for a better hour.</div>';
      options.forEach(function (o) {
        var row = document.createElement('div');
        row.className = 'shop-item';
        row.innerHTML = '<div class="shop-em">' + o[0] + '</div><div class="shop-info">' +
          '<div class="shop-name">Wait until ' + o[1] + '</div>' +
          '<div class="shop-desc">' + o[3] + '</div></div>';
        var b = document.createElement('button');
        b.className = 'shop-buy';
        b.textContent = F.clock(o[2]);
        b.addEventListener('click', function () { game.rest(o[2]); self.closePanel(); });
        row.appendChild(b);
        body.appendChild(row);
      });
      return;
    }

    var isRod = this.shopTab === 'rods';
    var items = isRod ? Sp.RODS : Sp.LURES;
    var owned = isRod ? st.rods : st.lures;
    var equipped = isRod ? st.rod : st.lure;

    items.forEach(function (item) {
      var has = owned.indexOf(item.id) >= 0;
      var isEq = equipped === item.id;
      var row = document.createElement('div');
      row.className = 'shop-item' + (isEq ? ' equipped' : (has ? ' owned' : ''));
      var stats = isRod
        ? 'line ×' + item.line.toFixed(2) + '   reel ×' + item.reel.toFixed(2) +
        '   cast ×' + item.cast.toFixed(2) + '   feel ×' + item.sens.toFixed(2)
        : 'depth ' + item.depth.toFixed(1) + ' m   reach ' + item.radius + ' m   patience ×' + item.patience.toFixed(2);
      row.innerHTML =
        '<div class="shop-em">' + (isRod ? '🎣' : item.icon) + '</div>' +
        '<div class="shop-info"><div class="shop-name">' + item.name + '</div>' +
        '<div class="shop-desc">' + item.desc + '</div>' +
        '<div class="shop-stats">' + stats + '</div></div>';
      var b = document.createElement('button');
      if (isEq) { b.className = 'shop-buy equipped'; b.textContent = 'Equipped'; }
      else if (has) { b.className = 'shop-buy owned'; b.textContent = 'Equip'; }
      else if (st.money < item.cost) { b.className = 'shop-buy cant'; b.textContent = F.money(item.cost); }
      else { b.className = 'shop-buy'; b.textContent = F.money(item.cost); }
      b.addEventListener('click', function () {
        if (isEq) return;
        if (game.buy(isRod ? 'rod' : 'lure', item.id)) {
          self.renderShop();
          self.refreshLureBar();
          self.showToast((has ? 'Equipped ' : 'Bought ') + item.name, 'good');
        } else {
          self.showToast('Not enough money — ' + F.money(item.cost - st.money) + ' short.', 'bad');
        }
      });
      row.appendChild(b);
      body.appendChild(row);
    });
  };

  DC.UI = UI;
})(DC);
