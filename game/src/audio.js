/* =========================================================================
   DEEP CAST — audio.js
   Every sound is synthesised at runtime with the Web Audio API: the lake,
   the wind, the birds, the reel, and a generative score that reacts to the
   time of day and to whether something large is currently trying to escape.
   ========================================================================= */
(function (DC) {
  'use strict';

  var M = DC.M;

  function Audio() {
    this.ctx = null;
    this.ready = false;
    this.enabled = true;
    this.vol = { master: 0.85, music: 0.55, sfx: 0.9 };
    this.mood = 'calm';
    this.nextNote = 0;
    this.step = 0;
    this.chordIndex = 0;
    this.rng = M.mulberry32(0xBEEF);
    this.birdTimer = 4;
    this.lastReelClick = 0;
  }

  // Musical scaffolding: a slow modal progression that never resolves hard.
  var SCALES = {
    calm: [0, 2, 4, 7, 9, 11, 14, 16],           // lydian-ish pentatonic blend
    night: [0, 3, 5, 7, 10, 12, 15, 17],          // minor pentatonic + 9th
    fight: [0, 3, 5, 6, 7, 10, 12, 15]            // blues, tense
  };
  var PROGRESSIONS = {
    calm: [[0, 4, 7, 11], [-3, 2, 5, 9], [-5, 0, 4, 7], [2, 5, 9, 12]],
    night: [[0, 3, 7, 10], [-4, 0, 3, 8], [-2, 3, 5, 10], [-5, 0, 3, 7]],
    fight: [[0, 3, 7, 10], [1, 4, 8, 11], [0, 3, 6, 10], [-2, 2, 5, 9]]
  };

  function midiToHz(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  Audio.prototype.init = function () {
    if (this.ctx) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    var ctx = this.ctx = new AC();

    this.master = ctx.createGain();
    this.master.gain.value = this.vol.master;
    // A gentle limiter keeps the mix from clipping when a lot lands at once.
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -10;
    this.limiter.knee.value = 12;
    this.limiter.ratio.value = 8;
    this.limiter.attack.value = 0.004;
    this.limiter.release.value = 0.25;
    this.master.connect(this.limiter);
    this.limiter.connect(ctx.destination);

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.vol.music;
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = this.vol.sfx;

    // Shared reverb — a synthesised impulse response (exponentially decaying
    // noise), which is plenty for an outdoor space.
    this.verb = ctx.createConvolver();
    this.verb.buffer = this._impulse(2.6, 2.5);
    this.verbGain = ctx.createGain();
    this.verbGain.gain.value = 0.30;
    this.verb.connect(this.verbGain);
    this.verbGain.connect(this.master);

    this.musicBus.connect(this.master);
    this.sfxBus.connect(this.master);
    this.musicBus.connect(this.verb);
    this.sfxBus.connect(this.verb);

    // Muffle everything when the camera goes under.
    this.underFilter = ctx.createBiquadFilter();
    this.underFilter.type = 'lowpass';
    this.underFilter.frequency.value = 20000;

    this.noiseBuf = this._noise(3.0);
    this._buildAmbience();
    this.ready = true;
    this.nextNote = ctx.currentTime + 0.4;
  };

  Audio.prototype._noise = function (secs) {
    var ctx = this.ctx;
    var n = Math.floor(ctx.sampleRate * secs);
    var buf = ctx.createBuffer(1, n, ctx.sampleRate);
    var d = buf.getChannelData(0);
    var last = 0;
    for (var i = 0; i < n; i++) {
      var w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;      // a little brown tilt
      d[i] = w * 0.7 + last * 2.2;
    }
    // Crossfade the seam so the loop is inaudible.
    var fade = Math.floor(ctx.sampleRate * 0.05);
    for (var j = 0; j < fade; j++) {
      var k = j / fade;
      d[j] = d[j] * k + d[n - fade + j] * (1 - k);
    }
    return buf;
  };

  Audio.prototype._impulse = function (secs, decay) {
    var ctx = this.ctx;
    var n = Math.floor(ctx.sampleRate * secs);
    var buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (var c = 0; c < 2; c++) {
      var d = buf.getChannelData(c);
      for (var i = 0; i < n; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
      }
    }
    return buf;
  };

  Audio.prototype._loopNoise = function (destination) {
    var src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.connect(destination);
    src.start();
    return src;
  };

  Audio.prototype._buildAmbience = function () {
    var ctx = this.ctx;
    this.amb = {};

    // --- lake surface: two bands of filtered noise, slowly breathing
    var wash = ctx.createBiquadFilter();
    wash.type = 'bandpass'; wash.frequency.value = 480; wash.Q.value = 0.55;
    var washGain = ctx.createGain(); washGain.gain.value = 0.10;
    wash.connect(washGain); washGain.connect(this.master);
    this._loopNoise(wash);

    var shimmer = ctx.createBiquadFilter();
    shimmer.type = 'bandpass'; shimmer.frequency.value = 2400; shimmer.Q.value = 0.9;
    var shimGain = ctx.createGain(); shimGain.gain.value = 0.028;
    shimmer.connect(shimGain); shimGain.connect(this.master);
    this._loopNoise(shimmer);

    // Slow LFOs so the water never sounds static.
    var lfo = ctx.createOscillator(); lfo.frequency.value = 0.09;
    var lfoGain = ctx.createGain(); lfoGain.gain.value = 0.045;
    lfo.connect(lfoGain); lfoGain.connect(washGain.gain); lfo.start();

    var lfo2 = ctx.createOscillator(); lfo2.frequency.value = 0.14;
    var lfo2Gain = ctx.createGain(); lfo2Gain.gain.value = 0.016;
    lfo2.connect(lfo2Gain); lfo2Gain.connect(shimGain.gain); lfo2.start();

    // --- wind through the pines
    var wind = ctx.createBiquadFilter();
    wind.type = 'lowpass'; wind.frequency.value = 380; wind.Q.value = 0.4;
    var windGain = ctx.createGain(); windGain.gain.value = 0.05;
    wind.connect(windGain); windGain.connect(this.master);
    this._loopNoise(wind);

    // --- night crickets (amplitude-modulated hiss)
    var cr = ctx.createBiquadFilter();
    cr.type = 'bandpass'; cr.frequency.value = 4600; cr.Q.value = 7;
    var crGain = ctx.createGain(); crGain.gain.value = 0.0;
    var crMod = ctx.createOscillator(); crMod.type = 'square'; crMod.frequency.value = 11;
    var crModGain = ctx.createGain(); crModGain.gain.value = 0.016;
    crMod.connect(crModGain); crModGain.connect(crGain.gain); crMod.start();
    cr.connect(crGain); crGain.connect(this.master);
    this._loopNoise(cr);

    this.amb.wash = washGain;
    this.amb.shimmer = shimGain;
    this.amb.wind = windGain;
    this.amb.windFilter = wind;
    this.amb.crickets = crGain;
    this.amb.cricketMod = crModGain;
  };

  Audio.prototype.resume = function () {
    if (!this.ctx) this.init();
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  };

  Audio.prototype.setVolume = function (which, v) {
    this.vol[which] = v;
    if (!this.ready) return;
    if (which === 'master') this.master.gain.value = v;
    if (which === 'music') this.musicBus.gain.value = v;
    if (which === 'sfx') this.sfxBus.gain.value = v;
  };

  // ------------------------------------------------------------- ambience
  Audio.prototype.updateAmbience = function (dt, s) {
    if (!this.ready) return;
    var ctx = this.ctx, t = ctx.currentTime;
    var night = s.night;
    var windAmt = M.sat(s.wind);

    this.amb.wash.gain.setTargetAtTime(0.055 + windAmt * 0.10 + s.nearWater * 0.05, t, 0.6);
    this.amb.shimmer.gain.setTargetAtTime((0.012 + windAmt * 0.03) * (1 - s.underwater * 0.9), t, 0.6);
    this.amb.wind.gain.setTargetAtTime(0.022 + windAmt * 0.11, t, 0.9);
    this.amb.windFilter.frequency.setTargetAtTime(240 + windAmt * 620, t, 0.9);
    this.amb.cricketMod.gain.setTargetAtTime(night * 0.02 * (1 - s.underwater), t, 1.2);
    this.master.gain.setTargetAtTime(this.vol.master * (s.underwater > 0.5 ? 0.7 : 1.0), t, 0.2);

    // Occasional wildlife.
    this.birdTimer -= dt;
    if (this.birdTimer <= 0) {
      this.birdTimer = M.randRange(this.rng, night > 0.5 ? 9 : 3.5, night > 0.5 ? 26 : 12);
      if (s.underwater < 0.5) {
        if (night > 0.55) { if (this.rng() < 0.5) this.owl(); else this.loon(); }
        else if (this.rng() < 0.82) this.bird();
        else this.loon();
      }
    }
  };

  // ---------------------------------------------------------------- voices
  Audio.prototype._env = function (dest, t, a, d, peak) {
    var g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    g.connect(dest);
    return g;
  };

  Audio.prototype.tone = function (opts) {
    if (!this.ready || !this.enabled) return;
    var ctx = this.ctx;
    var t = opts.when || ctx.currentTime;
    var o = ctx.createOscillator();
    o.type = opts.type || 'sine';
    o.frequency.setValueAtTime(opts.f0, t);
    if (opts.f1 !== undefined) {
      if (opts.glide === 'exp') o.frequency.exponentialRampToValueAtTime(Math.max(opts.f1, 1), t + opts.dur);
      else o.frequency.linearRampToValueAtTime(opts.f1, t + opts.dur);
    }
    var g = this._env(opts.dest || this.sfxBus, t, opts.attack || 0.008, opts.dur, opts.gain || 0.2);
    o.connect(g);
    if (opts.detune) o.detune.value = opts.detune;
    o.start(t);
    o.stop(t + (opts.attack || 0.008) + opts.dur + 0.05);
  };

  Audio.prototype.noiseBurst = function (opts) {
    if (!this.ready || !this.enabled) return;
    var ctx = this.ctx;
    var t = opts.when || ctx.currentTime;
    var src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    var f = ctx.createBiquadFilter();
    f.type = opts.filter || 'bandpass';
    f.frequency.setValueAtTime(opts.f0, t);
    if (opts.f1 !== undefined) f.frequency.exponentialRampToValueAtTime(Math.max(opts.f1, 20), t + opts.dur);
    f.Q.value = opts.q === undefined ? 1.2 : opts.q;
    var g = this._env(opts.dest || this.sfxBus, t, opts.attack || 0.006, opts.dur, opts.gain || 0.2);
    src.connect(f); f.connect(g);
    src.start(t, Math.random() * 2);
    src.stop(t + (opts.attack || 0.006) + opts.dur + 0.05);
  };

  // ------------------------------------------------------------------- sfx
  Audio.prototype.cast = function (power) {
    var p = M.sat(power);
    this.noiseBurst({ f0: 700 + p * 900, f1: 240, dur: 0.42, gain: 0.06 + p * 0.13, q: 0.9, attack: 0.05 });
    this.tone({ type: 'sine', f0: 180 + p * 90, f1: 60, dur: 0.3, gain: 0.03, glide: 'exp' });
  };

  Audio.prototype.splash = function (size) {
    var s = M.clamp(size, 0.2, 3);
    this.noiseBurst({ f0: 2600 * (1 / s), f1: 380, dur: 0.30 * s, gain: 0.10 + s * 0.10, q: 0.7, attack: 0.004 });
    this.noiseBurst({ f0: 700, f1: 180, dur: 0.5 * s, gain: 0.05 * s, q: 1.6, attack: 0.02, filter: 'lowpass' });
    this.tone({ type: 'sine', f0: 420 / s, f1: 120 / s, dur: 0.16 * s, gain: 0.05 * s, glide: 'exp' });
  };

  Audio.prototype.plunk = function () {
    this.tone({ type: 'sine', f0: 620, f1: 210, dur: 0.13, gain: 0.11, glide: 'exp' });
    this.noiseBurst({ f0: 1800, f1: 700, dur: 0.07, gain: 0.05 });
  };

  Audio.prototype.nibble = function () {
    this.tone({ type: 'sine', f0: 900, f1: 640, dur: 0.07, gain: 0.05, glide: 'exp' });
  };

  Audio.prototype.bite = function () {
    var t = this.ctx ? this.ctx.currentTime : 0;
    this.tone({ type: 'triangle', f0: 880, dur: 0.10, gain: 0.14, when: t });
    this.tone({ type: 'triangle', f0: 1320, dur: 0.14, gain: 0.11, when: t + 0.07 });
    this.noiseBurst({ f0: 900, f1: 300, dur: 0.22, gain: 0.10, when: t });
  };

  Audio.prototype.hookset = function () {
    var t = this.ctx ? this.ctx.currentTime : 0;
    this.noiseBurst({ f0: 3200, f1: 500, dur: 0.18, gain: 0.16, q: 0.6 });
    this.tone({ type: 'sawtooth', f0: 150, f1: 70, dur: 0.25, gain: 0.10, glide: 'exp' });
    this.tone({ type: 'sine', f0: 1400, f1: 700, dur: 0.12, gain: 0.07, glide: 'exp', when: t + 0.02 });
  };

  Audio.prototype.reelClick = function (rate) {
    if (!this.ready) return;
    var t = this.ctx.currentTime;
    if (t - this.lastReelClick < 0.055 / Math.max(rate, 0.25)) return;
    this.lastReelClick = t;
    this.noiseBurst({ f0: 2600 + Math.random() * 900, dur: 0.022, gain: 0.045, q: 5, attack: 0.001 });
  };

  Audio.prototype.drag = function (level) {
    if (!this.ready) return;
    var t = this.ctx.currentTime;
    if (t - (this.lastDrag || 0) < 0.032) return;
    this.lastDrag = t;
    this.noiseBurst({ f0: 1400 + level * 2200, dur: 0.03, gain: 0.02 + level * 0.05, q: 8, attack: 0.002 });
  };

  Audio.prototype.creak = function (level) {
    this.tone({ type: 'sawtooth', f0: 90 + level * 40, f1: 120 + level * 70, dur: 0.4, gain: 0.02 + level * 0.05 });
  };

  Audio.prototype.snap = function () {
    var t = this.ctx ? this.ctx.currentTime : 0;
    this.noiseBurst({ f0: 5200, f1: 900, dur: 0.09, gain: 0.22, q: 0.5, attack: 0.001 });
    this.tone({ type: 'sawtooth', f0: 900, f1: 90, dur: 0.35, gain: 0.10, glide: 'exp' });
    this.tone({ type: 'sine', f0: 70, dur: 0.5, gain: 0.09, when: t + 0.02 });
  };

  Audio.prototype.fanfare = function (rarity) {
    if (!this.ready) return;
    var t = this.ctx.currentTime;
    var root = 60 + Math.min(rarity, 5) * 2;
    var chord = rarity >= 3 ? [0, 4, 7, 11, 14] : [0, 4, 7, 12];
    for (var i = 0; i < chord.length; i++) {
      this.tone({
        type: 'triangle', f0: midiToHz(root + chord[i]), dur: 0.75 + i * 0.12,
        gain: 0.10 - i * 0.012, when: t + i * 0.075, attack: 0.01
      });
      this.tone({
        type: 'sine', f0: midiToHz(root + chord[i] + 12), dur: 0.5,
        gain: 0.05, when: t + i * 0.075, attack: 0.01
      });
    }
    if (rarity >= 4) {
      for (var j = 0; j < 8; j++) {
        this.tone({
          type: 'sine', f0: midiToHz(root + 24 + chord[j % chord.length]),
          dur: 0.4, gain: 0.045, when: t + 0.4 + j * 0.06
        });
      }
    }
  };

  Audio.prototype.ui = function (up) {
    this.tone({ type: 'square', f0: up ? 660 : 440, f1: up ? 880 : 330, dur: 0.05, gain: 0.035, glide: 'exp' });
  };

  Audio.prototype.buy = function () {
    var t = this.ctx ? this.ctx.currentTime : 0;
    this.tone({ type: 'triangle', f0: 880, dur: 0.09, gain: 0.08, when: t });
    this.tone({ type: 'triangle', f0: 1320, dur: 0.16, gain: 0.07, when: t + 0.07 });
  };

  Audio.prototype.deny = function () {
    this.tone({ type: 'square', f0: 200, f1: 130, dur: 0.16, gain: 0.06, glide: 'exp' });
  };

  // Named `footstep`, not `step` — `this.step` is the music sequencer counter.
  Audio.prototype.footstep = function (onWood) {
    if (onWood) {
      this.noiseBurst({ f0: 420 + Math.random() * 260, dur: 0.06, gain: 0.05, q: 2.2 });
      this.tone({ type: 'sine', f0: 160, f1: 90, dur: 0.08, gain: 0.035, glide: 'exp' });
    } else {
      this.noiseBurst({ f0: 300 + Math.random() * 200, dur: 0.07, gain: 0.035, q: 1.2, filter: 'lowpass' });
    }
  };

  Audio.prototype.bird = function () {
    if (!this.ready) return;
    var t = this.ctx.currentTime;
    var n = 2 + ((this.rng() * 4) | 0);
    var base = 1900 + this.rng() * 1600;
    for (var i = 0; i < n; i++) {
      var f0 = base * (0.85 + this.rng() * 0.4);
      this.tone({
        type: 'sine', f0: f0, f1: f0 * (1.15 + this.rng() * 0.5),
        dur: 0.06 + this.rng() * 0.05, gain: 0.025, glide: 'exp',
        when: t + i * (0.09 + this.rng() * 0.09)
      });
    }
  };

  Audio.prototype.loon = function () {
    if (!this.ready) return;
    var t = this.ctx.currentTime;
    var f = 520 + this.rng() * 120;
    this.tone({ type: 'sine', f0: f * 0.7, f1: f, dur: 0.5, gain: 0.035, glide: 'exp', when: t, attack: 0.12 });
    this.tone({ type: 'sine', f0: f, f1: f * 0.62, dur: 0.9, gain: 0.030, glide: 'exp', when: t + 0.55, attack: 0.1 });
  };

  Audio.prototype.owl = function () {
    if (!this.ready) return;
    var t = this.ctx.currentTime;
    var f = 300 + this.rng() * 60;
    this.tone({ type: 'sine', f0: f, f1: f * 0.9, dur: 0.28, gain: 0.035, glide: 'exp', when: t, attack: 0.06 });
    this.tone({ type: 'sine', f0: f * 0.95, f1: f * 0.82, dur: 0.42, gain: 0.030, glide: 'exp', when: t + 0.42, attack: 0.07 });
  };

  Audio.prototype.jumpSplash = function () {
    this.splash(1.8);
    this.noiseBurst({ f0: 5000, f1: 1200, dur: 0.16, gain: 0.09, q: 0.6 });
  };

  Audio.prototype.thunder = function () {
    if (!this.ready) return;
    var t = this.ctx.currentTime;
    this.noiseBurst({ f0: 160, f1: 45, dur: 2.2, gain: 0.20, q: 0.4, filter: 'lowpass', attack: 0.25, when: t });
    this.noiseBurst({ f0: 900, f1: 120, dur: 0.5, gain: 0.10, q: 0.5, when: t + 0.05 });
  };

  // ----------------------------------------------------------------- music
  Audio.prototype.setMood = function (mood) {
    if (this.mood === mood) return;
    this.mood = mood;
    this.step = 0;
    this.chordIndex = 0;
  };

  Audio.prototype.pad = function (t, midi, dur, gain) {
    var ctx = this.ctx;
    var f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(320, t);
    f.frequency.linearRampToValueAtTime(1250, t + dur * 0.45);
    f.frequency.linearRampToValueAtTime(400, t + dur);
    f.Q.value = 1.4;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + dur * 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    f.connect(g); g.connect(this.musicBus);
    for (var i = 0; i < 3; i++) {
      var o = ctx.createOscillator();
      o.type = i === 2 ? 'triangle' : 'sawtooth';
      o.frequency.value = midiToHz(midi + (i === 2 ? 12 : 0));
      o.detune.value = (i - 1) * 7;
      o.connect(f);
      o.start(t);
      o.stop(t + dur + 0.1);
    }
  };

  Audio.prototype.pluck = function (t, midi, gain, dur) {
    var ctx = this.ctx;
    dur = dur || 1.1;
    var o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = midiToHz(midi);
    var o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = midiToHz(midi + 12);
    var f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(4200, t);
    f.frequency.exponentialRampToValueAtTime(600, t + dur);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f); o2.connect(f); f.connect(g); g.connect(this.musicBus);
    o.start(t); o.stop(t + dur + 0.05);
    o2.start(t); o2.stop(t + dur + 0.05);
  };

  Audio.prototype.bass = function (t, midi, dur, gain) {
    var ctx = this.ctx;
    var o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = midiToHz(midi);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.06);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.musicBus);
    o.start(t); o.stop(t + dur + 0.05);
  };

  // Lookahead scheduler — called every frame, schedules a little ahead of now.
  Audio.prototype.updateMusic = function () {
    if (!this.ready || !this.enabled || this.vol.music <= 0.001) return;
    var ctx = this.ctx;
    var beat = this.mood === 'fight' ? 0.36 : 0.52;
    var horizon = ctx.currentTime + 0.6;
    var guard = 0;
    while (this.nextNote < horizon && guard++ < 24) {
      var t = this.nextNote;
      var prog = PROGRESSIONS[this.mood] || PROGRESSIONS.calm;
      var scale = SCALES[this.mood] || SCALES.calm;
      var chord = prog[this.chordIndex % prog.length];
      var root = this.mood === 'night' ? 50 : 53;
      if (this.mood === 'fight') root = 48;

      if (this.step % 16 === 0) {
        // New chord: lay down a pad and a root.
        this.chordIndex++;
        chord = prog[this.chordIndex % prog.length];
        var padDur = beat * 16;
        for (var c = 0; c < chord.length; c++) {
          this.pad(t, root + 12 + chord[c], padDur, 0.026 + (c === 0 ? 0.012 : 0));
        }
        this.bass(t, root - 12 + chord[0], beat * 8, 0.085);
      }
      if (this.step % 8 === 4) {
        this.bass(t, root - 12 + chord[0] + (this.rng() < 0.3 ? 7 : 0), beat * 4, 0.055);
      }

      // Melody: sparse in calm, insistent in a fight.
      var density = this.mood === 'fight' ? 0.62 : (this.mood === 'night' ? 0.24 : 0.32);
      if (this.rng() < density) {
        var deg = scale[(this.rng() * scale.length) | 0];
        var oct = this.rng() < 0.3 ? 12 : 0;
        this.pluck(t, root + 12 + deg + oct, 0.05 + this.rng() * 0.03, this.mood === 'fight' ? 0.5 : 1.3);
      }
      if (this.mood === 'fight' && this.step % 4 === 0) {
        this.noiseBurst({ f0: 180, f1: 70, dur: 0.16, gain: 0.05, q: 1.0, filter: 'lowpass', when: t, dest: this.musicBus });
      }

      this.step++;
      this.nextNote += beat;
    }
    // If the tab was backgrounded, do not try to catch up on hours of music.
    if (this.nextNote < ctx.currentTime - 1) this.nextNote = ctx.currentTime + 0.2;
  };

  DC.Audio = Audio;
})(DC);
