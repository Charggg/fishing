/* =========================================================================
   DEEP CAST — render.js
   The renderer. Four geometry passes per frame:
     1. planar reflection (mirrored camera, above-water geometry only)
     2. refraction       (below-water geometry + depth, for the water shader)
     3. main scene       (terrain, props, fish, water, sky, effects)
     4. post             (bright pass -> separable blur -> tonemap composite)
   ========================================================================= */
(function (DC) {
  'use strict';

  var M = DC.M, M4 = DC.M4, V3 = DC.V3;
  var GLX = DC.GLX, Sh = DC.Shaders, A = DC.Assets;

  // Fixed attribute slots shared by every program.
  var LOC = {
    aPos: 0, aNormal: 1, aColor: 2, aFlex: 3,
    aAO: 2, aVar: 3, aT: 1, aCorner: 0,
    iPosScale: 4, iRotTint: 5,
    iPosSize: 4, iRot: 5, iDorsal: 6, iBelly: 7, iFin: 8, iShape: 9,
    iColor: 5, iParam: 5
  };

  var UP_Y = new Float32Array([0, 1, 0]);

  /* `dpr` caps the device-pixel ratio for the 3D buffer. A Windows desktop at
     125% scaling reports 1.25, which is 1.6x the pixels for no visible gain in
     a game — the HUD is DOM and stays crisp regardless.
     `propDist` is the distance past which trees stop being drawn at all. */
  var QUALITY = {
    low:    { scale: 0.62, refl: 0.25, refr: 0.35, bloom: false, water: 120, fishDist: 55,  reflProps: false, reflFrac: 0,    dpr: 1.0,  propDist: 150, terrainLod: true },
    medium: { scale: 0.82, refl: 0.34, refr: 0.45, bloom: true,  water: 170, fishDist: 80,  reflProps: true,  reflFrac: 0.5,  dpr: 1.0,  propDist: 240, terrainLod: true },
    high:   { scale: 1.00, refl: 0.45, refr: 0.55, bloom: true,  water: 240, fishDist: 120, reflProps: true,  reflFrac: 0.85, dpr: 1.25, propDist: 380, terrainLod: true },
    ultra:  { scale: 1.00, refl: 0.65, refr: 0.75, bloom: true,  water: 320, fishDist: 160, reflProps: true,  reflFrac: 1.0,  dpr: 1.5,  propDist: 900, terrainLod: false }
  };

  // Float32 -> IEEE half. Used for the terrain height texture.
  var _f32 = new Float32Array(1);
  var _i32 = new Int32Array(_f32.buffer);
  function toHalf(v) {
    _f32[0] = v;
    var x = _i32[0];
    var bits = (x >> 16) & 0x8000;
    var m = (x >> 12) & 0x07ff;
    var e = (x >> 23) & 0xff;
    if (e < 103) return bits;
    if (e > 142) return bits | 0x7c00;
    if (e < 113) { m |= 0x0800; return bits | ((m >> (114 - e)) + ((m >> (113 - e)) & 1)); }
    bits |= ((e - 112) << 10) | (m >> 1);
    return bits + (m & 1);
  }

  function Renderer(canvas) {
    this.canvas = canvas;
    var opts = {
      alpha: false, antialias: false, depth: true, stencil: false,
      powerPreference: 'high-performance', preserveDrawingBuffer: false
    };
    var gl = canvas.getContext('webgl2', opts);
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.gl = gl;
    this.hasFloat = !!gl.getExtension('EXT_color_buffer_float');
    if (!this.hasFloat) gl.getExtension('EXT_color_buffer_half_float');
    this.quality = QUALITY.high;
    this.qualityName = 'high';
    this.width = 1; this.height = 1;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    this.proj = M4.create();
    this.view = M4.create();
    this.viewProj = M4.create();
    this.invViewProj = M4.create();
    this.mirror = M4.create();
    this.tmpA = M4.create();
    this.tmpB = M4.create();
    this.model = M4.create();
    this.normalMat = new Float32Array(9);
    this.camToWorld = M4.create();
    this.near = 0.08;
    this.far = 1400;

    this._buildPrograms();
    this._buildStatic();
  }

  Renderer.prototype._buildPrograms = function () {
    var gl = this.gl, S = Sh.S, build = Sh.build;
    var P = {};
    function mk(name, vs, fs, defs) {
      P[name] = GLX.program(gl, build(vs, defs), build(fs, defs), name, LOC);
    }
    mk('sky', S.skyVert, S.skyFrag);
    mk('terrain', S.terrainVert, S.terrainFrag);
    mk('solid', S.solidVert, S.solidFrag);
    mk('solidInst', S.solidVert, S.solidFrag, { INSTANCED: true });
    mk('fish', S.fishVert, S.fishFrag);
    mk('water', S.waterVert, S.waterFrag);
    mk('ripple', S.rippleVert, S.rippleFrag);
    mk('particle', S.particleVert, S.particleFrag);
    mk('line', S.lineVert, S.lineFrag);
    mk('bright', S.fsVert, S.brightFrag);
    mk('blur', S.fsVert, S.blurFrag);
    mk('composite', S.fsVert, S.compositeFrag);
    this.P = P;
  };

  Renderer.prototype._buildStatic = function () {
    var gl = this.gl;
    this.fsVAO = GLX.fullscreenVAO(gl, LOC.aPos);

    // Particle quad corners.
    var corners = new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]);
    this.particleCorner = GLX.buffer(gl, corners);
    this.particleInstPos = gl.createBuffer();
    this.particleInstCol = gl.createBuffer();
    this.particleVAO = GLX.vao(gl, [
      { buffer: this.particleCorner, loc: LOC.aCorner, size: 2 },
      { buffer: this.particleInstPos, loc: LOC.iPosSize, size: 4, divisor: 1 },
      { buffer: this.particleInstCol, loc: LOC.iColor, size: 4, divisor: 1 }
    ]);

    // Fishing line: a dynamic strip.
    this.lineSegs = 42;
    this.lineData = new Float32Array((this.lineSegs + 1) * 4);
    this.lineBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.lineData.byteLength, gl.DYNAMIC_DRAW);
    this.lineVAO = GLX.vao(gl, [
      { buffer: this.lineBuf, loc: LOC.aPos, size: 3, stride: 16, offset: 0 },
      { buffer: this.lineBuf, loc: LOC.aT, size: 1, stride: 16, offset: 12 }
    ]);

    // Procedural textures.
    var wn = A.makeWaterNormalTexture(256);
    this.texWaterNormal = GLX.texture2D(gl, {
      width: wn.size, height: wn.size, data: wn.data,
      wrap: gl.REPEAT, mipmap: true, aniso: 8
    });
    var nz = A.makeNoiseTexture(128);
    this.texNoise = GLX.texture2D(gl, {
      width: nz.size, height: nz.size, data: nz.data,
      wrap: gl.REPEAT, mipmap: true
    });
  };

  // --------------------------------------------------------------- meshes
  Renderer.prototype.makeSolidMesh = function (mesh) {
    var gl = this.gl;
    var vb = GLX.buffer(gl, mesh.data);
    var ib = GLX.buffer(gl, mesh.indices, gl.ELEMENT_ARRAY_BUFFER);
    var st = A.STRIDE * 4;
    var vao = GLX.vao(gl, [
      { buffer: vb, loc: LOC.aPos, size: 3, stride: st, offset: 0 },
      { buffer: vb, loc: LOC.aNormal, size: 3, stride: st, offset: 12 },
      { buffer: vb, loc: LOC.aColor, size: 3, stride: st, offset: 24 },
      { buffer: vb, loc: LOC.aFlex, size: 1, stride: st, offset: 36 }
    ], ib);
    return { vao: vao, count: mesh.indexCount, vb: vb, ib: ib };
  };

  /* Instanced prop group.
     The instance buffers are DYNAMIC because every pass re-uploads only the
     instances that survive frustum and distance culling. Before this, all
     6,825 props were drawn three times a frame whether or not they were behind
     the camera — about 2.8 million triangles of which most were off screen. */
  Renderer.prototype.makeInstancedMesh = function (mesh, instances) {
    var gl = this.gl;
    var st = A.STRIDE * 4;
    var vb = GLX.buffer(gl, mesh.data);
    var ib = GLX.buffer(gl, mesh.indices, gl.ELEMENT_ARRAY_BUFFER);
    var n = instances.length;
    var posScale = new Float32Array(n * 4);
    var rotTint = new Float32Array(n * 4);
    for (var i = 0; i < n; i++) {
      var it = instances[i];
      posScale[i * 4] = it.x; posScale[i * 4 + 1] = it.y;
      posScale[i * 4 + 2] = it.z; posScale[i * 4 + 3] = it.s;
      rotTint[i * 4] = it.rot;
      rotTint[i * 4 + 1] = it.tint; rotTint[i * 4 + 2] = it.tint; rotTint[i * 4 + 3] = it.tint;
    }
    var pb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, pb);
    gl.bufferData(gl.ARRAY_BUFFER, posScale, gl.DYNAMIC_DRAW);
    var rb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, rb);
    gl.bufferData(gl.ARRAY_BUFFER, rotTint, gl.DYNAMIC_DRAW);
    var vao = GLX.vao(gl, [
      { buffer: vb, loc: LOC.aPos, size: 3, stride: st, offset: 0 },
      { buffer: vb, loc: LOC.aNormal, size: 3, stride: st, offset: 12 },
      { buffer: vb, loc: LOC.aColor, size: 3, stride: st, offset: 24 },
      { buffer: vb, loc: LOC.aFlex, size: 1, stride: st, offset: 36 },
      { buffer: pb, loc: LOC.iPosScale, size: 4, divisor: 1 },
      { buffer: rb, loc: LOC.iRotTint, size: 4, divisor: 1 }
    ], ib);

    /* Bounding radius of one instance at unit scale, so the cull can test a
       sphere instead of the mesh. Measured from the mesh rather than guessed,
       because a conifer and a lilypad are nothing like the same size. */
    var rad2 = 0;
    for (var v = 0; v < mesh.data.length; v += A.STRIDE) {
      var dx = mesh.data[v], dy = mesh.data[v + 1], dz = mesh.data[v + 2];
      var d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > rad2) rad2 = d2;
    }
    return {
      vao: vao, count: mesh.indexCount, instances: n, instData: instances,
      posScale: posScale, rotTint: rotTint, pb: pb, rb: rb,
      radius: Math.sqrt(rad2),
      cullPos: new Float32Array(n * 4), cullRot: new Float32Array(n * 4)
    };
  };

  Renderer.prototype.uploadTerrain = function (terrain) {
    var gl = this.gl;
    var vb = GLX.buffer(gl, terrain.data);
    var ib = GLX.buffer(gl, terrain.indices, gl.ELEMENT_ARRAY_BUFFER);
    var st = 8 * 4;
    this.terrain = {
      vao: GLX.vao(gl, [
        { buffer: vb, loc: LOC.aPos, size: 3, stride: st, offset: 0 },
        { buffer: vb, loc: LOC.aNormal, size: 3, stride: st, offset: 12 },
        { buffer: vb, loc: LOC.aAO, size: 1, stride: st, offset: 24 },
        { buffer: vb, loc: LOC.aVar, size: 1, stride: st, offset: 28 }
      ], ib),
      count: terrain.indexCount,
      chunks: terrain.chunks || null
    };
    if (terrain.lodIndices) {
      var lib = GLX.buffer(gl, terrain.lodIndices, gl.ELEMENT_ARRAY_BUFFER);
      this.terrainLod = {
        vao: GLX.vao(gl, [
          { buffer: vb, loc: LOC.aPos, size: 3, stride: st, offset: 0 },
          { buffer: vb, loc: LOC.aNormal, size: 3, stride: st, offset: 12 },
          { buffer: vb, loc: LOC.aAO, size: 1, stride: st, offset: 24 },
          { buffer: vb, loc: LOC.aVar, size: 1, stride: st, offset: 28 }
        ], lib),
        count: terrain.lodIndexCount
      };
    }
  };

  Renderer.prototype.uploadHeightmap = function (heights, size, extent) {
    var gl = this.gl;
    var half = new Uint16Array(heights.length);
    for (var i = 0; i < heights.length; i++) half[i] = toHalf(M.clamp(heights[i], -60, 200));
    var t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, size, size, 0, gl.RED, gl.HALF_FLOAT, half);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.bindTexture(gl.TEXTURE_2D, null);
    this.texHeight = t;
    this.terrainExtent = extent;
  };

  /* Water surface: a camera-centred polar disc.

     The vertex shader was always written for one — it reads `aPos + uCenter`
     and takes `vDist = length(aPos)` — but this function built a uniform
     square grid and uCenter was passed as (0,0), so the design was never
     finished. A uniform grid spends its triangles evenly across 380 metres,
     which means far too many out at the horizon where they cover a pixel each
     and no more near the boat than anywhere else.

     Rings grow with a power curve, so density follows the camera: fine detail
     where the waves are actually legible, sparse where it is a thin band near
     the skyline. Same visual result for roughly a tenth of the geometry, and
     it can now reach much further out for almost nothing, which also fixes
     the water running out before the far shore when you row to one end. */
  Renderer.prototype.buildWaterGrid = function (n, extent) {
    var gl = this.gl;
    var rings = Math.max(12, Math.round(n * 0.24));
    var segs = Math.max(24, Math.round(n * 0.52));
    var radius = Math.max(extent, 40) * 2.3;      // comfortably past the far shore

    var verts = new Float32Array((1 + rings * segs) * 2);
    var p = 0;
    verts[p++] = 0; verts[p++] = 0;               // centre, under the camera
    for (var k = 1; k <= rings; k++) {
      var r = radius * Math.pow(k / rings, 2.15);
      for (var i = 0; i < segs; i++) {
        var a = i / segs * M.TAU;
        verts[p++] = Math.cos(a) * r;
        verts[p++] = Math.sin(a) * r;
      }
    }

    var idx = new Uint32Array(segs * 3 + (rings - 1) * segs * 6);
    var q = 0;
    for (var c = 0; c < segs; c++) {              // centre fan
      idx[q++] = 0;
      idx[q++] = 1 + c;
      idx[q++] = 1 + ((c + 1) % segs);
    }
    for (var kk = 1; kk < rings; kk++) {          // quads between rings
      var base = 1 + (kk - 1) * segs, next = 1 + kk * segs;
      for (var j = 0; j < segs; j++) {
        var j2 = (j + 1) % segs;
        idx[q++] = base + j; idx[q++] = next + j; idx[q++] = base + j2;
        idx[q++] = base + j2; idx[q++] = next + j; idx[q++] = next + j2;
      }
    }

    var vb = GLX.buffer(gl, verts);
    var ib = GLX.buffer(gl, idx, gl.ELEMENT_ARRAY_BUFFER);
    if (this.water && this.water.vao) gl.deleteVertexArray(this.water.vao);
    this.water = {
      vao: GLX.vao(gl, [{ buffer: vb, loc: LOC.aPos, size: 2 }], ib),
      count: q, radius: radius
    };
  };

  Renderer.prototype.buildFishBuffers = function (mesh, count) {
    var gl = this.gl;
    var st = A.STRIDE * 4;
    var vb = GLX.buffer(gl, mesh.data);
    var ib = GLX.buffer(gl, mesh.indices, gl.ELEMENT_ARRAY_BUFFER);
    function dyn(n) {
      var b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, count * n * 4, gl.DYNAMIC_DRAW);
      return b;
    }
    var bPos = dyn(4), bRot = dyn(4), bDor = dyn(3), bBel = dyn(3), bFin = dyn(4), bShape = dyn(3);
    this.fish = {
      vao: GLX.vao(gl, [
        { buffer: vb, loc: LOC.aPos, size: 3, stride: st, offset: 0 },
        { buffer: vb, loc: LOC.aNormal, size: 3, stride: st, offset: 12 },
        { buffer: vb, loc: LOC.aColor, size: 3, stride: st, offset: 24 },
        { buffer: vb, loc: LOC.aFlex, size: 1, stride: st, offset: 36 },
        { buffer: bPos, loc: LOC.iPosSize, size: 4, divisor: 1 },
        { buffer: bRot, loc: LOC.iRot, size: 4, divisor: 1 },
        { buffer: bDor, loc: LOC.iDorsal, size: 3, divisor: 1 },
        { buffer: bBel, loc: LOC.iBelly, size: 3, divisor: 1 },
        { buffer: bFin, loc: LOC.iFin, size: 4, divisor: 1 },
        { buffer: bShape, loc: LOC.iShape, size: 3, divisor: 1 }
      ], ib),
      count: mesh.indexCount,
      buffers: { pos: bPos, rot: bRot, dor: bDor, bel: bBel, fin: bFin, shape: bShape },
      drawn: 0
    };
  };

  Renderer.prototype.buildRippleBuffers = function (mesh, max) {
    var gl = this.gl;
    var st = A.STRIDE * 4;
    var vb = GLX.buffer(gl, mesh.data);
    var ib = GLX.buffer(gl, mesh.indices, gl.ELEMENT_ARRAY_BUFFER);
    var bPos = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, bPos);
    gl.bufferData(gl.ARRAY_BUFFER, max * 4 * 4, gl.DYNAMIC_DRAW);
    var bPar = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, bPar);
    gl.bufferData(gl.ARRAY_BUFFER, max * 4 * 4, gl.DYNAMIC_DRAW);
    this.ripple = {
      vao: GLX.vao(gl, [
        { buffer: vb, loc: LOC.aPos, size: 3, stride: st, offset: 0 },
        { buffer: vb, loc: LOC.aColor, size: 3, stride: st, offset: 24 },
        { buffer: vb, loc: LOC.aFlex, size: 1, stride: st, offset: 36 },
        { buffer: bPos, loc: LOC.iPosSize, size: 4, divisor: 1 },
        { buffer: bPar, loc: LOC.iParam, size: 4, divisor: 1 }
      ], ib),
      count: mesh.indexCount,
      buffers: { pos: bPos, par: bPar }
    };
  };

  // --------------------------------------------------------------- sizing
  Renderer.prototype.setQuality = function (name, extent) {
    this.qualityName = name;
    this.quality = QUALITY[name] || QUALITY.high;
    this.buildWaterGrid(this.quality.water, extent || 190);
    this.resize(true);
  };

  Renderer.prototype.resize = function (force) {
    var gl = this.gl;
    var dpr = Math.min(window.devicePixelRatio || 1, this.quality.dpr || 2);
    var cw = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    var ch = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (!force && cw === this.canvas.width && ch === this.canvas.height) return;
    this.canvas.width = cw;
    this.canvas.height = ch;

    var q = this.quality;
    var w = Math.max(2, Math.floor(cw * q.scale));
    var h = Math.max(2, Math.floor(ch * q.scale));
    this.width = w; this.height = h;

    if (this.fbScene) this.fbScene.dispose();
    if (this.fbRefl) this.fbRefl.dispose();
    if (this.fbRefr) this.fbRefr.dispose();
    if (this.fbBloomA) this.fbBloomA.dispose();
    if (this.fbBloomB) this.fbBloomB.dispose();

    this.fbScene = GLX.framebuffer(gl, w, h, { float: this.hasFloat, depth: true });
    this.fbRefl = GLX.framebuffer(gl, Math.max(2, (w * q.refl) | 0), Math.max(2, (h * q.refl) | 0), { float: this.hasFloat });
    this.fbRefr = GLX.framebuffer(gl, Math.max(2, (w * q.refr) | 0), Math.max(2, (h * q.refr) | 0), { float: this.hasFloat, depthTexture: true });
    var bw = Math.max(2, (w * 0.25) | 0), bh = Math.max(2, (h * 0.25) | 0);
    this.fbBloomA = GLX.framebuffer(gl, bw, bh, { float: this.hasFloat, depth: false });
    this.fbBloomB = GLX.framebuffer(gl, bw, bh, { float: this.hasFloat, depth: false });
  };

  // ------------------------------------------------------------- uniforms
  Renderer.prototype._sky = function (p, s) {
    var gl = this.gl, u = p.u;
    if (u.uSunDir) gl.uniform3fv(u.uSunDir, s.sun.dir);
    if (u.uLightDir) gl.uniform3fv(u.uLightDir, s.sun.lightDir);
    if (u.uBetaR) gl.uniform3fv(u.uBetaR, s.sun.betaR);
    if (u.uBetaM) gl.uniform3fv(u.uBetaM, s.sun.betaM);
    if (u.uSunE) gl.uniform1f(u.uSunE, s.sun.E);
    if (u.uMieG) gl.uniform1f(u.uMieG, s.sun.mieG);
    if (u.uNightSky) gl.uniform3fv(u.uNightSky, s.sun.nightSky);
    if (u.uSkyDim) gl.uniform1f(u.uSkyDim, s.skyDim);
    if (u.uFogDensity) gl.uniform1f(u.uFogDensity, s.fogDensity);
    if (u.uFogHeight) gl.uniform1f(u.uFogHeight, s.fogHeight);
    if (u.uSunColor) gl.uniform3fv(u.uSunColor, s.sun.color);
    if (u.uAmbSky) gl.uniform3fv(u.uAmbSky, s.ambSky);
    if (u.uAmbGround) gl.uniform3fv(u.uAmbGround, s.ambGround);
    if (u.uCamPos) gl.uniform3fv(u.uCamPos, s.camPos);
    if (u.uTime) gl.uniform1f(u.uTime, s.time);
    if (u.uNoise) GLX.bindTex(gl, 0, this.texNoise, u.uNoise);
  };

  Renderer.prototype._waves = function (p, s) {
    var gl = this.gl, u = p.u;
    if (u.uWaves) gl.uniform4fv(u.uWaves, s.waveData);
    if (u.uWaveTime) gl.uniform1f(u.uWaveTime, s.waveTime);
    if (u.uWaveScale) gl.uniform1f(u.uWaveScale, s.waveScale);
  };

  // ------------------------------------------------------------ geometry
  Renderer.prototype._drawTerrain = function (s, vp, clip, lod) {
    var gl = this.gl, p = this.P.terrain;
    var t = (lod && this.quality.terrainLod && this.terrainLod) ? this.terrainLod : this.terrain;
    gl.useProgram(p.prog);
    this._sky(p, s);
    gl.uniformMatrix4fv(p.u.uViewProj, false, vp);
    gl.uniform4fv(p.u.uClipPlane, clip);
    gl.uniform1f(p.u.uWetness, s.wetness || 1);
    gl.bindVertexArray(t.vao);

    // The full-detail mesh is chunked, so most of the map behind the camera
    // never reaches the vertex shader. The LOD mesh is small enough that
    // culling it would cost more than drawing it.
    var ch = t.chunks;
    if (!ch) {
      gl.drawElements(gl.TRIANGLES, t.count, gl.UNSIGNED_INT, 0);
      this.statChunks = 1;
      return;
    }
    frustumPlanes(vp, _planes);
    var drawn = 0;
    for (var i = 0; i < ch.length; i++) {
      var c = ch[i];
      var vis = true;
      for (var pl = 0; pl < 6; pl++) {
        var q = pl * 4;
        var nx = _planes[q], ny = _planes[q + 1], nz = _planes[q + 2], nd = _planes[q + 3];
        // Positive vertex of the AABB: if even that is outside, the box is out.
        var px = nx >= 0 ? c.maxX : c.minX;
        var py = ny >= 0 ? c.maxY : c.minY;
        var pz = nz >= 0 ? c.maxZ : c.minZ;
        if (nx * px + ny * py + nz * pz + nd < 0) { vis = false; break; }
      }
      if (!vis) continue;
      drawn++;
      gl.drawElements(gl.TRIANGLES, c.count, gl.UNSIGNED_INT, c.start * 4);
    }
    this.statChunks = drawn;
  };

  // `filter`: 0 = everything, 1 = above-water props only, 2 = in-water props only.
  // `frac` thins instance counts for the cheap passes.
  /* Six frustum planes straight out of a view-projection matrix (Gribb-Hartmann).
     Normalised so a plane test gives a real signed distance, which is what lets
     the cull subtract an instance's bounding radius. */
  var _planes = new Float32Array(24);
  function frustumPlanes(m, out) {
    for (var i = 0; i < 6; i++) {
      var r = i >> 1, sgn = (i & 1) ? -1 : 1;
      var a = m[3] + sgn * m[r], b = m[7] + sgn * m[4 + r];
      var c = m[11] + sgn * m[8 + r], d = m[15] + sgn * m[12 + r];
      var len = Math.hypot(a, b, c) || 1;
      out[i * 4] = a / len; out[i * 4 + 1] = b / len;
      out[i * 4 + 2] = c / len; out[i * 4 + 3] = d / len;
    }
  }

  Renderer.prototype._drawProps = function (s, vp, clip, groups, filter, frac, maxDist) {
    var gl = this.gl, p = this.P.solidInst;
    gl.useProgram(p.prog);
    this._sky(p, s);
    gl.uniformMatrix4fv(p.u.uViewProj, false, vp);
    gl.uniform4fv(p.u.uClipPlane, clip);
    gl.uniform2fv(p.u.uWind, s.wind);
    gl.uniform1f(p.u.uWindStrength, s.windStrength);
    gl.uniform1f(p.u.uSpecular, 0.05);
    gl.uniform1f(p.u.uEmissive, 0.0);
    gl.uniform1f(p.u.uNoFog, 0.0);
    gl.uniform3f(p.u.uBend, 0, 0, 0);

    frustumPlanes(vp, _planes);
    var cx = s.camPos[0], cy = s.camPos[1], cz = s.camPos[2];
    var far2 = maxDist ? maxDist * maxDist : Infinity;
    var drawn = 0, tested = 0;

    for (var i = 0; i < groups.length; i++) {
      var g = groups[i];
      if (!g || !g.instances) continue;
      if (filter === 1 && g.water) continue;
      if (filter === 2 && !g.water) continue;

      var src = g.posScale, srcR = g.rotTint;
      var dst = g.cullPos, dstR = g.cullRot;
      var lim = frac ? Math.max(1, (g.instances * frac) | 0) : g.instances;
      var n = 0;
      for (var k = 0; k < lim; k++) {
        var o = k * 4;
        var x = src[o], y = src[o + 1], z = src[o + 2], sc = src[o + 3];
        var dx = x - cx, dy = y - cy, dz = z - cz;
        if (dx * dx + dy * dy + dz * dz > far2) continue;
        var rad = g.radius * sc;
        // Sphere vs frustum. Bail on the first plane that excludes it.
        var vis = true;
        for (var pl = 0; pl < 6; pl++) {
          var q = pl * 4;
          if (_planes[q] * x + _planes[q + 1] * y + _planes[q + 2] * z + _planes[q + 3] < -rad) { vis = false; break; }
        }
        tested++;
        if (!vis) continue;
        var d = n * 4;
        dst[d] = x; dst[d + 1] = y; dst[d + 2] = z; dst[d + 3] = sc;
        dstR[d] = srcR[o]; dstR[d + 1] = srcR[o + 1];
        dstR[d + 2] = srcR[o + 2]; dstR[d + 3] = srcR[o + 3];
        n++;
      }
      if (!n) continue;
      drawn += n;
      gl.bindBuffer(gl.ARRAY_BUFFER, g.pb);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, dst, 0, n * 4);
      gl.bindBuffer(gl.ARRAY_BUFFER, g.rb);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, dstR, 0, n * 4);
      gl.bindVertexArray(g.vao);
      gl.drawElementsInstanced(gl.TRIANGLES, g.count, gl.UNSIGNED_INT, 0, n);
    }
    this.statPropsDrawn = drawn;
    this.statPropsTested = tested;
  };

  Renderer.prototype._drawSolid = function (s, vp, clip, mesh, model, tint, spec, emissive, noFog, bend) {
    var gl = this.gl, p = this.P.solid;
    gl.useProgram(p.prog);
    this._sky(p, s);
    gl.uniformMatrix4fv(p.u.uViewProj, false, vp);
    gl.uniform4fv(p.u.uClipPlane, clip);
    gl.uniform2fv(p.u.uWind, s.wind);
    gl.uniform1f(p.u.uWindStrength, 0);
    gl.uniformMatrix4fv(p.u.uModel, false, model);
    M4.normalMat3(this.normalMat, model);
    gl.uniformMatrix3fv(p.u.uNormalMat, false, this.normalMat);
    gl.uniform3fv(p.u.uTint, tint || [1, 1, 1]);
    gl.uniform1f(p.u.uSpecular, spec || 0);
    gl.uniform1f(p.u.uEmissive, emissive || 0);
    gl.uniform1f(p.u.uNoFog, noFog ? 1 : 0);
    if (bend) gl.uniform3fv(p.u.uBend, bend);
    else gl.uniform3f(p.u.uBend, 0, 0, 0);
    gl.bindVertexArray(mesh.vao);
    gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_INT, 0);
  };

  // Static, individually-placed meshes (the dock). Drawn in every pass so it
  // reflects in the water and its pilings show up through it.
  Renderer.prototype._drawSolids = function (s, vp, clip) {
    if (!s.solids) return;
    for (var i = 0; i < s.solids.length; i++) {
      var o = s.solids[i];
      this._drawSolid(s, vp, clip, o.mesh, o.matrix, o.tint, o.spec, o.emissive, false, null);
    }
  };

  Renderer.prototype._drawFish = function (s, vp, clip, count) {
    if (!count) return;
    var gl = this.gl, p = this.P.fish;
    gl.useProgram(p.prog);
    this._sky(p, s);
    gl.uniformMatrix4fv(p.u.uViewProj, false, vp);
    gl.uniform4fv(p.u.uClipPlane, clip);
    gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(this.fish.vao);
    gl.drawElementsInstanced(gl.TRIANGLES, this.fish.count, gl.UNSIGNED_INT, 0, count);
    gl.enable(gl.CULL_FACE);
  };

  Renderer.prototype.uploadFish = function (shoal, count) {
    var gl = this.gl, b = this.fish.buffers;
    function up(buf, data, n) {
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, n);
    }
    up(b.pos, shoal.iPosSize, count * 4);
    up(b.rot, shoal.iRot, count * 4);
    up(b.dor, shoal.iDorsal, count * 3);
    up(b.bel, shoal.iBelly, count * 3);
    up(b.fin, shoal.iFin, count * 4);
    up(b.shape, shoal.iShape, count * 3);
    this.fish.drawn = count;
  };

  // ------------------------------------------------------------ the frame
  Renderer.prototype.render = function (s) {
    var gl = this.gl;
    this.resize(false);
    var q = this.quality;

    var aspect = this.width / this.height;
    M4.perspective(this.proj, s.fov, aspect, this.near, this.far);
    var target = [
      s.camPos[0] + s.forward[0], s.camPos[1] + s.forward[1], s.camPos[2] + s.forward[2]
    ];
    M4.lookAt(this.view, s.camPos, target, s.up || UP_Y);
    M4.multiply(this.viewProj, this.proj, this.view);
    M4.invert(this.invViewProj, this.viewProj);
    M4.invert(this.camToWorld, this.view);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.disable(gl.BLEND);

    var NOCLIP = [0, 0, 0, 1];
    var ABOVE = [0, 1, 0, 0.12];    // keep y >= -0.12
    var BELOW = [0, -1, 0, 0.45];   // keep y <=  0.45

    // ---------------------------------------------------- 1. reflection
    M4.reflectionY(this.mirror, 0);
    M4.multiply(this.tmpA, this.viewProj, this.mirror);
    this.fbRefl.bind();
    if (this._benchNoRefl) { gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); } else {
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.cullFace(gl.FRONT);          // mirroring flips winding
    this._drawTerrain(s, this.tmpA, ABOVE, true);
    this._drawSolids(s, this.tmpA, ABOVE);
    if (q.reflProps && s.propGroups) this._drawProps(s, this.tmpA, ABOVE, s.propGroups, 1, q.reflFrac, q.propDist * 0.7);
    if (s.fishCount) this._drawFish(s, this.tmpA, ABOVE, s.fishCount);
    }
    gl.cullFace(gl.BACK);

    // ---------------------------------------------------- 2. refraction
    this.fbRefr.bind();
    gl.clearColor(s.deepTint[0] * 0.25, s.deepTint[1] * 0.3, s.deepTint[2] * 0.32, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!this._benchNoRefr) {
      this._drawTerrain(s, this.viewProj, BELOW, true);
      this._drawSolids(s, this.viewProj, BELOW);
      if (s.propGroups) this._drawProps(s, this.viewProj, BELOW, s.propGroups, 2, 1, 90);
      if (s.fishCount) this._drawFish(s, this.viewProj, BELOW, s.fishCount);
    }

    // ---------------------------------------------------- 3. main scene
    this.fbScene.bind();
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    this._drawTerrain(s, this.viewProj, NOCLIP);
    this._drawSolids(s, this.viewProj, NOCLIP);
    if (s.propGroups) this._drawProps(s, this.viewProj, NOCLIP, s.propGroups, 0, 1, q.propDist);
    if (s.fishCount) this._drawFish(s, this.viewProj, NOCLIP, s.fishCount);

    // water
    if (!this._benchNoWater) {
    var pw = this.P.water;
    gl.useProgram(pw.prog);
    this._sky(pw, s);
    this._waves(pw, s);
    gl.uniformMatrix4fv(pw.u.uViewProj, false, this.viewProj);
    // Snap to a coarse step so the disc does not shimmer as the camera creeps.
    gl.uniform2f(pw.u.uCenter,
      Math.round(s.camPos[0] / 4) * 4, Math.round(s.camPos[2] / 4) * 4);
    gl.uniform2f(pw.u.uScreen, this.width, this.height);
    gl.uniform1f(pw.u.uNear, this.near);
    gl.uniform1f(pw.u.uFar, this.far);
    gl.uniform1f(pw.u.uTerrainExtent, this.terrainExtent);
    gl.uniform3fv(pw.u.uShallowTint, s.shallowTint);
    gl.uniform3fv(pw.u.uDeepTint, s.deepTint);
    GLX.bindTex(gl, 1, this.texWaterNormal, pw.u.uWaterNormal);
    GLX.bindTex(gl, 2, this.texHeight, pw.u.uHeight);
    GLX.bindTex(gl, 3, this.fbRefl.color, pw.u.uReflect);
    GLX.bindTex(gl, 4, this.fbRefr.color, pw.u.uRefract);
    GLX.bindTex(gl, 5, this.fbRefr.depth, pw.u.uRefractDepth);
    gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(this.water.vao);
    gl.drawElements(gl.TRIANGLES, this.water.count, gl.UNSIGNED_INT, 0);
    gl.enable(gl.CULL_FACE);
    }

    // sky fills whatever is left
    if (!this._benchNoSky) {
    var ps = this.P.sky;
    gl.useProgram(ps.prog);
    this._sky(ps, s);
    gl.uniformMatrix4fv(ps.u.uInvViewProj, false, this.invViewProj);
    gl.uniform3fv(ps.u.uMoonDir, s.moonDir);
    gl.uniform1f(ps.u.uNightAmount, s.nightAmount);
    gl.uniform1f(ps.u.uCloudCover, s.cloudCover);
    gl.uniform1f(ps.u.uCloudDark, s.cloudDark);
    gl.uniform2fv(ps.u.uWind, s.wind);
    gl.depthMask(false);
    gl.bindVertexArray(this.fsVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.depthMask(true);
    }

    // rod + bobber sit in world space, so they just draw normally
    if (s.rod && s.rod.visible) {
      this._drawSolid(s, this.viewProj, NOCLIP, this.meshRod, s.rod.matrix, [1, 1, 1], 0.35, s.rod.emissive || 0, true, s.rod.bend);
      this._drawSolid(s, this.viewProj, NOCLIP, this.meshReelHandle, s.rod.handleMatrix, [1, 1, 1], 0.5, s.rod.emissive || 0, true, null);
      if (this.meshHandR) this._drawSolid(s, this.viewProj, NOCLIP, this.meshHandR, s.rod.handR, [1, 1, 1], 0.06, s.rod.emissive || 0, true, null);
      if (this.meshHandL) this._drawSolid(s, this.viewProj, NOCLIP, this.meshHandL, s.rod.handL, [1, 1, 1], 0.06, s.rod.emissive || 0, true, null);
    }
    if (s.bobber && s.bobber.visible) {
      this._drawSolid(s, this.viewProj, NOCLIP, this.meshBobber, s.bobber.matrix, [1, 1, 1], 0.5, s.bobber.glow || 0, false);
    }

    // ---- transparent layer
    gl.enable(gl.BLEND);
    gl.depthMask(false);

    if (s.rippleCount) {
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      var pr = this.P.ripple;
      gl.useProgram(pr.prog);
      this._waves(pr, s);
      gl.uniformMatrix4fv(pr.u.uViewProj, false, this.viewProj);
      gl.uniform3fv(pr.u.uSunColor, s.sun.color);
      gl.uniform3fv(pr.u.uAmbSky, s.ambSky);
      gl.disable(gl.CULL_FACE);
      gl.bindVertexArray(this.ripple.vao);
      gl.drawElementsInstanced(gl.TRIANGLES, this.ripple.count, gl.UNSIGNED_INT, 0, s.rippleCount);
      gl.enable(gl.CULL_FACE);
    }

    if (s.lineCount > 1) {
      var pl = this.P.line;
      gl.useProgram(pl.prog);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.uniformMatrix4fv(pl.u.uViewProj, false, this.viewProj);
      gl.uniform4fv(pl.u.uColor, s.lineColor);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.lineData, 0, s.lineCount * 4);
      gl.bindVertexArray(this.lineVAO);
      gl.drawArrays(gl.LINE_STRIP, 0, s.lineCount);
    }

    if (s.particleCount) {
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      var pp = this.P.particle;
      gl.useProgram(pp.prog);
      gl.uniformMatrix4fv(pp.u.uViewProj, false, this.viewProj);
      gl.uniform3f(pp.u.uRight, this.camToWorld[0], this.camToWorld[1], this.camToWorld[2]);
      gl.uniform3f(pp.u.uUp, this.camToWorld[4], this.camToWorld[5], this.camToWorld[6]);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.particleInstPos);
      gl.bufferData(gl.ARRAY_BUFFER, s.particles.instPos.subarray(0, s.particleCount * 4), gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.particleInstCol);
      gl.bufferData(gl.ARRAY_BUFFER, s.particles.instCol.subarray(0, s.particleCount * 4), gl.DYNAMIC_DRAW);
      gl.bindVertexArray(this.particleVAO);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, s.particleCount);
    }

    gl.depthMask(true);
    gl.disable(gl.BLEND);

    // ---------------------------------------------------- 4. post
    this._post(s);
    gl.bindVertexArray(null);
  };

  Renderer.prototype._post = function (s) {
    var gl = this.gl;
    gl.disable(gl.DEPTH_TEST);
    gl.bindVertexArray(this.fsVAO);

    var bloomTex = this.fbBloomB.color;
    if (this.quality.bloom) {
      var pb = this.P.bright;
      this.fbBloomA.bind();
      gl.useProgram(pb.prog);
      GLX.bindTex(gl, 0, this.fbScene.color, pb.u.uTex);
      gl.uniform1f(pb.u.uThreshold, s.bloomThreshold);
      gl.uniform1f(pb.u.uExposure, s.exposure);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      var pblur = this.P.blur;
      gl.useProgram(pblur.prog);
      for (var pass = 0; pass < 2; pass++) {
        this.fbBloomB.bind();
        GLX.bindTex(gl, 0, this.fbBloomA.color, pblur.u.uTex);
        gl.uniform2f(pblur.u.uDir, 1 / this.fbBloomA.width, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);

        this.fbBloomA.bind();
        GLX.bindTex(gl, 0, this.fbBloomB.color, pblur.u.uTex);
        gl.uniform2f(pblur.u.uDir, 0, 1 / this.fbBloomB.height);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      bloomTex = this.fbBloomA.color;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    var pc = this.P.composite;
    gl.useProgram(pc.prog);
    GLX.bindTex(gl, 0, this.fbScene.color, pc.u.uTex);
    GLX.bindTex(gl, 1, bloomTex, pc.u.uBloom);
    gl.uniform1f(pc.u.uExposure, s.exposure);
    gl.uniform1f(pc.u.uBloomAmount, this.quality.bloom ? s.bloom : 0);
    gl.uniform1f(pc.u.uVignette, s.vignette);
    gl.uniform1f(pc.u.uTime, s.time);
    gl.uniform1f(pc.u.uGrain, s.grain);
    gl.uniform1f(pc.u.uUnderwater, s.underwater);
    gl.uniform3fv(pc.u.uUnderTint, s.underTint);
    gl.uniform1f(pc.u.uFlash, s.flash);
    gl.uniform3fv(pc.u.uFlashColor, s.flashColor);
    gl.uniform1f(pc.u.uSaturation, s.saturation);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.enable(gl.DEPTH_TEST);
  };

  Renderer.QUALITY = QUALITY;
  DC.Renderer = Renderer;
})(DC);
