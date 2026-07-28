/* =========================================================================
   DEEP CAST — util.js
   Math, noise, and small helpers. No dependencies, no build step.
   Everything hangs off the global DC namespace.
   ========================================================================= */
var DC = window.DC || (window.DC = {});

(function (DC) {
  'use strict';

  // ---------------------------------------------------------------- scalars
  var M = {};
  M.TAU = Math.PI * 2;
  M.clamp = function (v, a, b) { return v < a ? a : (v > b ? b : v); };
  M.sat = function (v) { return v < 0 ? 0 : (v > 1 ? 1 : v); };
  M.lerp = function (a, b, t) { return a + (b - a) * t; };
  M.mix = M.lerp;
  M.smoothstep = function (e0, e1, x) {
    var t = M.sat((x - e0) / (e1 - e0));
    return t * t * (3 - 2 * t);
  };
  M.smootherstep = function (e0, e1, x) {
    var t = M.sat((x - e0) / (e1 - e0));
    return t * t * t * (t * (t * 6 - 15) + 10);
  };
  M.sign = function (v) { return v < 0 ? -1 : (v > 0 ? 1 : 0); };
  M.deg = function (r) { return r * 180 / Math.PI; };
  M.rad = function (d) { return d * Math.PI / 180; };
  // Framerate-independent exponential approach. rate = "how much closes per second".
  M.damp = function (a, b, rate, dt) { return M.lerp(a, b, 1 - Math.exp(-rate * dt)); };
  // Shortest signed angular difference, in (-PI, PI].
  M.angDiff = function (a, b) {
    var d = (b - a) % M.TAU;
    if (d > Math.PI) d -= M.TAU;
    if (d < -Math.PI) d += M.TAU;
    return d;
  };

  // ------------------------------------------------------------------- rng
  // Deterministic, seedable, fast. Same seed => same lake, forever.
  M.mulberry32 = function (seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  M.randRange = function (rng, a, b) { return a + (b - a) * rng(); };
  M.pick = function (rng, arr) { return arr[(rng() * arr.length) | 0]; };
  // Weighted pick: items must expose a numeric `weight`.
  M.pickWeighted = function (rng, arr, weightFn) {
    var total = 0, i;
    for (i = 0; i < arr.length; i++) total += Math.max(0, weightFn(arr[i]));
    if (total <= 0) return arr[(rng() * arr.length) | 0];
    var r = rng() * total;
    for (i = 0; i < arr.length; i++) {
      r -= Math.max(0, weightFn(arr[i]));
      if (r <= 0) return arr[i];
    }
    return arr[arr.length - 1];
  };
  // Normal-ish distribution in [-1,1], clustered at 0 (sum of uniforms).
  M.bell = function (rng) { return (rng() + rng() + rng() - 1.5) / 1.5; };

  // ----------------------------------------------------------------- noise
  // Integer hash -> [0,1). Cheap and good enough for terrain + textures.
  function hash2(x, y) {
    var n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  }
  function hash3(x, y, z) {
    var n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  }
  M.hash2 = hash2;
  M.hash3 = hash3;

  function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }

  // 2D value noise, smooth. Domain is world units; caller scales.
  M.noise2 = function (x, y) {
    var xi = Math.floor(x), yi = Math.floor(y);
    var xf = x - xi, yf = y - yi;
    var u = fade(xf), v = fade(yf);
    var a = hash2(xi, yi), b = hash2(xi + 1, yi);
    var c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
    return M.lerp(M.lerp(a, b, u), M.lerp(c, d, u), v) * 2 - 1;
  };

  // 2D value noise that tiles every `period` units — used for seamless textures.
  M.noise2Tiled = function (x, y, period) {
    var xi = Math.floor(x), yi = Math.floor(y);
    var xf = x - xi, yf = y - yi;
    var u = fade(xf), v = fade(yf);
    function w(ix, iy) {
      return hash2(((ix % period) + period) % period, ((iy % period) + period) % period);
    }
    var a = w(xi, yi), b = w(xi + 1, yi);
    var c = w(xi, yi + 1), d = w(xi + 1, yi + 1);
    return M.lerp(M.lerp(a, b, u), M.lerp(c, d, u), v) * 2 - 1;
  };

  M.noise3 = function (x, y, z) {
    var xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    var xf = x - xi, yf = y - yi, zf = z - zi;
    var u = fade(xf), v = fade(yf), w = fade(zf);
    function g(a, b, c) { return hash3(a, b, c); }
    var c000 = g(xi, yi, zi), c100 = g(xi + 1, yi, zi);
    var c010 = g(xi, yi + 1, zi), c110 = g(xi + 1, yi + 1, zi);
    var c001 = g(xi, yi, zi + 1), c101 = g(xi + 1, yi, zi + 1);
    var c011 = g(xi, yi + 1, zi + 1), c111 = g(xi + 1, yi + 1, zi + 1);
    var x00 = M.lerp(c000, c100, u), x10 = M.lerp(c010, c110, u);
    var x01 = M.lerp(c001, c101, u), x11 = M.lerp(c011, c111, u);
    return M.lerp(M.lerp(x00, x10, v), M.lerp(x01, x11, v), w) * 2 - 1;
  };

  // Fractal Brownian motion. Rotating each octave kills grid-aligned streaks.
  M.fbm2 = function (x, y, octaves, lacunarity, gain) {
    octaves = octaves || 5;
    lacunarity = lacunarity || 2.02;
    gain = gain === undefined ? 0.5 : gain;
    var amp = 0.5, sum = 0, norm = 0;
    var ca = Math.cos(0.7), sa = Math.sin(0.7);
    for (var i = 0; i < octaves; i++) {
      sum += amp * M.noise2(x, y);
      norm += amp;
      var nx = x * ca - y * sa, ny = x * sa + y * ca;
      x = nx * lacunarity; y = ny * lacunarity;
      amp *= gain;
    }
    return sum / norm;
  };

  // Ridged fbm — sharp crests, good for mountain silhouettes.
  M.ridged2 = function (x, y, octaves) {
    octaves = octaves || 5;
    var amp = 0.5, sum = 0, norm = 0;
    var ca = Math.cos(1.1), sa = Math.sin(1.1);
    for (var i = 0; i < octaves; i++) {
      var n = 1 - Math.abs(M.noise2(x, y));
      sum += amp * n * n;
      norm += amp;
      var nx = x * ca - y * sa, ny = x * sa + y * ca;
      x = nx * 2.05; y = ny * 2.05;
      amp *= 0.5;
    }
    return sum / norm;
  };

  // ------------------------------------------------------------------ vec3
  var V3 = {};
  V3.create = function (x, y, z) { return new Float32Array([x || 0, y || 0, z || 0]); };
  V3.set = function (o, x, y, z) { o[0] = x; o[1] = y; o[2] = z; return o; };
  V3.copy = function (o, a) { o[0] = a[0]; o[1] = a[1]; o[2] = a[2]; return o; };
  V3.add = function (o, a, b) { o[0] = a[0] + b[0]; o[1] = a[1] + b[1]; o[2] = a[2] + b[2]; return o; };
  V3.sub = function (o, a, b) { o[0] = a[0] - b[0]; o[1] = a[1] - b[1]; o[2] = a[2] - b[2]; return o; };
  V3.scale = function (o, a, s) { o[0] = a[0] * s; o[1] = a[1] * s; o[2] = a[2] * s; return o; };
  V3.addScaled = function (o, a, b, s) {
    o[0] = a[0] + b[0] * s; o[1] = a[1] + b[1] * s; o[2] = a[2] + b[2] * s; return o;
  };
  V3.dot = function (a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; };
  V3.len = function (a) { return Math.hypot(a[0], a[1], a[2]); };
  V3.dist = function (a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); };
  V3.cross = function (o, a, b) {
    var ax = a[0], ay = a[1], az = a[2], bx = b[0], by = b[1], bz = b[2];
    o[0] = ay * bz - az * by;
    o[1] = az * bx - ax * bz;
    o[2] = ax * by - ay * bx;
    return o;
  };
  V3.normalize = function (o, a) {
    var l = Math.hypot(a[0], a[1], a[2]);
    if (l > 1e-8) { o[0] = a[0] / l; o[1] = a[1] / l; o[2] = a[2] / l; }
    else { o[0] = 0; o[1] = 0; o[2] = 0; }
    return o;
  };
  V3.lerp = function (o, a, b, t) {
    o[0] = a[0] + (b[0] - a[0]) * t;
    o[1] = a[1] + (b[1] - a[1]) * t;
    o[2] = a[2] + (b[2] - a[2]) * t;
    return o;
  };
  V3.transformMat4 = function (o, a, m) {
    var x = a[0], y = a[1], z = a[2];
    var w = m[3] * x + m[7] * y + m[11] * z + m[15];
    w = w || 1;
    o[0] = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w;
    o[1] = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
    o[2] = (m[2] * x + m[6] * y + m[10] * z + m[14]) / w;
    return o;
  };

  // ------------------------------------------------------------------ mat4
  // Column-major, same layout as OpenGL expects.
  var M4 = {};
  M4.create = function () {
    return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  };
  M4.identity = function (o) {
    o[0] = 1; o[1] = 0; o[2] = 0; o[3] = 0;
    o[4] = 0; o[5] = 1; o[6] = 0; o[7] = 0;
    o[8] = 0; o[9] = 0; o[10] = 1; o[11] = 0;
    o[12] = 0; o[13] = 0; o[14] = 0; o[15] = 1;
    return o;
  };
  M4.copy = function (o, a) { o.set(a); return o; };
  M4.multiply = function (o, a, b) {
    var a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
    var a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
    var a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
    var a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
    for (var i = 0; i < 4; i++) {
      var b0 = b[i * 4], b1 = b[i * 4 + 1], b2 = b[i * 4 + 2], b3 = b[i * 4 + 3];
      o[i * 4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
      o[i * 4 + 1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
      o[i * 4 + 2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
      o[i * 4 + 3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
    }
    return o;
  };
  M4.perspective = function (o, fovy, aspect, near, far) {
    var f = 1 / Math.tan(fovy / 2);
    o[0] = f / aspect; o[1] = 0; o[2] = 0; o[3] = 0;
    o[4] = 0; o[5] = f; o[6] = 0; o[7] = 0;
    o[8] = 0; o[9] = 0; o[11] = -1;
    o[12] = 0; o[13] = 0; o[15] = 0;
    o[10] = (far + near) / (near - far);
    o[14] = (2 * far * near) / (near - far);
    return o;
  };
  M4.ortho = function (o, l, r, b, t, n, f) {
    var lr = 1 / (l - r), bt = 1 / (b - t), nf = 1 / (n - f);
    o[0] = -2 * lr; o[1] = 0; o[2] = 0; o[3] = 0;
    o[4] = 0; o[5] = -2 * bt; o[6] = 0; o[7] = 0;
    o[8] = 0; o[9] = 0; o[10] = 2 * nf; o[11] = 0;
    o[12] = (l + r) * lr; o[13] = (t + b) * bt; o[14] = (f + n) * nf; o[15] = 1;
    return o;
  };
  M4.lookAt = function (o, eye, center, up) {
    var z0 = eye[0] - center[0], z1 = eye[1] - center[1], z2 = eye[2] - center[2];
    var len = Math.hypot(z0, z1, z2);
    if (len < 1e-8) { return M4.identity(o); }
    z0 /= len; z1 /= len; z2 /= len;
    var x0 = up[1] * z2 - up[2] * z1;
    var x1 = up[2] * z0 - up[0] * z2;
    var x2 = up[0] * z1 - up[1] * z0;
    len = Math.hypot(x0, x1, x2);
    if (len < 1e-8) { x0 = 1; x1 = 0; x2 = 0; } else { x0 /= len; x1 /= len; x2 /= len; }
    var y0 = z1 * x2 - z2 * x1;
    var y1 = z2 * x0 - z0 * x2;
    var y2 = z0 * x1 - z1 * x0;
    o[0] = x0; o[1] = y0; o[2] = z0; o[3] = 0;
    o[4] = x1; o[5] = y1; o[6] = z1; o[7] = 0;
    o[8] = x2; o[9] = y2; o[10] = z2; o[11] = 0;
    o[12] = -(x0 * eye[0] + x1 * eye[1] + x2 * eye[2]);
    o[13] = -(y0 * eye[0] + y1 * eye[1] + y2 * eye[2]);
    o[14] = -(z0 * eye[0] + z1 * eye[1] + z2 * eye[2]);
    o[15] = 1;
    return o;
  };
  M4.fromTranslation = function (o, v) {
    M4.identity(o); o[12] = v[0]; o[13] = v[1]; o[14] = v[2]; return o;
  };
  M4.translate = function (o, a, v) {
    var x = v[0], y = v[1], z = v[2];
    if (o !== a) M4.copy(o, a);
    o[12] = a[0] * x + a[4] * y + a[8] * z + a[12];
    o[13] = a[1] * x + a[5] * y + a[9] * z + a[13];
    o[14] = a[2] * x + a[6] * y + a[10] * z + a[14];
    o[15] = a[3] * x + a[7] * y + a[11] * z + a[15];
    return o;
  };
  M4.scale = function (o, a, v) {
    var x = v[0], y = v[1], z = v[2];
    o[0] = a[0] * x; o[1] = a[1] * x; o[2] = a[2] * x; o[3] = a[3] * x;
    o[4] = a[4] * y; o[5] = a[5] * y; o[6] = a[6] * y; o[7] = a[7] * y;
    o[8] = a[8] * z; o[9] = a[9] * z; o[10] = a[10] * z; o[11] = a[11] * z;
    o[12] = a[12]; o[13] = a[13]; o[14] = a[14]; o[15] = a[15];
    return o;
  };
  M4.rotateY = function (o, a, rad) {
    var s = Math.sin(rad), c = Math.cos(rad);
    var a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
    var a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
    if (o !== a) { o[4] = a[4]; o[5] = a[5]; o[6] = a[6]; o[7] = a[7]; o[12] = a[12]; o[13] = a[13]; o[14] = a[14]; o[15] = a[15]; }
    o[0] = a00 * c - a20 * s; o[1] = a01 * c - a21 * s;
    o[2] = a02 * c - a22 * s; o[3] = a03 * c - a23 * s;
    o[8] = a00 * s + a20 * c; o[9] = a01 * s + a21 * c;
    o[10] = a02 * s + a22 * c; o[11] = a03 * s + a23 * c;
    return o;
  };
  M4.rotateX = function (o, a, rad) {
    var s = Math.sin(rad), c = Math.cos(rad);
    var a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
    var a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
    if (o !== a) { o[0] = a[0]; o[1] = a[1]; o[2] = a[2]; o[3] = a[3]; o[12] = a[12]; o[13] = a[13]; o[14] = a[14]; o[15] = a[15]; }
    o[4] = a10 * c + a20 * s; o[5] = a11 * c + a21 * s;
    o[6] = a12 * c + a22 * s; o[7] = a13 * c + a23 * s;
    o[8] = a20 * c - a10 * s; o[9] = a21 * c - a11 * s;
    o[10] = a22 * c - a12 * s; o[11] = a23 * c - a13 * s;
    return o;
  };
  M4.rotateZ = function (o, a, rad) {
    var s = Math.sin(rad), c = Math.cos(rad);
    var a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
    var a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
    if (o !== a) { o[8] = a[8]; o[9] = a[9]; o[10] = a[10]; o[11] = a[11]; o[12] = a[12]; o[13] = a[13]; o[14] = a[14]; o[15] = a[15]; }
    o[0] = a00 * c + a10 * s; o[1] = a01 * c + a11 * s;
    o[2] = a02 * c + a12 * s; o[3] = a03 * c + a13 * s;
    o[4] = a10 * c - a00 * s; o[5] = a11 * c - a01 * s;
    o[6] = a12 * c - a02 * s; o[7] = a13 * c - a03 * s;
    return o;
  };
  M4.invert = function (o, a) {
    var a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
    var a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
    var a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
    var a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
    var b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10;
    var b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
    var b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
    var b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
    var b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31;
    var b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
    var det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det) return null;
    det = 1.0 / det;
    o[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
    o[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
    o[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
    o[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
    o[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
    o[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
    o[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
    o[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
    o[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
    o[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
    o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
    o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
    o[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
    o[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
    o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
    o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
    return o;
  };
  // Upper-left 3x3 inverse-transpose, packed as mat3 for normal transforms.
  M4.normalMat3 = function (o, m) {
    var a00 = m[0], a01 = m[1], a02 = m[2];
    var a10 = m[4], a11 = m[5], a12 = m[6];
    var a20 = m[8], a21 = m[9], a22 = m[10];
    var b01 = a22 * a11 - a12 * a21;
    var b11 = -a22 * a10 + a12 * a20;
    var b21 = a21 * a10 - a11 * a20;
    var det = a00 * b01 + a01 * b11 + a02 * b21;
    if (!det) { o[0] = 1; o[1] = 0; o[2] = 0; o[3] = 0; o[4] = 1; o[5] = 0; o[6] = 0; o[7] = 0; o[8] = 1; return o; }
    det = 1.0 / det;
    o[0] = b01 * det;
    o[1] = (-a22 * a01 + a02 * a21) * det;
    o[2] = (a12 * a01 - a02 * a11) * det;
    o[3] = b11 * det;
    o[4] = (a22 * a00 - a02 * a20) * det;
    o[5] = (-a12 * a00 + a02 * a10) * det;
    o[6] = b21 * det;
    o[7] = (-a21 * a00 + a01 * a20) * det;
    o[8] = (a11 * a00 - a01 * a10) * det;
    return o;
  };
  // Mirror a matrix about the plane y = h. Used for the water reflection camera.
  M4.reflectionY = function (o, h) {
    M4.identity(o);
    o[5] = -1;
    o[13] = 2 * h;
    return o;
  };

  // ------------------------------------------------------------- formatting
  var F = {};
  F.money = function (n) {
    return '$' + Math.round(n).toLocaleString('en-US');
  };
  F.weight = function (kg) {
    var lb = kg * 2.20462;
    if (lb < 1) return (lb * 16).toFixed(1) + ' oz';
    return lb.toFixed(2) + ' lb';
  };
  F.length = function (cm) {
    return (cm / 2.54).toFixed(1) + ' in';
  };
  F.clock = function (hours) {
    var h = Math.floor(hours) % 24;
    var m = Math.floor((hours - Math.floor(hours)) * 60);
    var ap = h < 12 ? 'AM' : 'PM';
    var hh = h % 12; if (hh === 0) hh = 12;
    return hh + ':' + (m < 10 ? '0' : '') + m + ' ' + ap;
  };
  F.pad = function (n, w) {
    var s = String(n);
    while (s.length < w) s = '0' + s;
    return s;
  };

  DC.M = M;
  DC.V3 = V3;
  DC.M4 = M4;
  DC.F = F;
})(DC);
