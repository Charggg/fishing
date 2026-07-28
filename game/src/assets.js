/* =========================================================================
   DEEP CAST — assets.js
   Every mesh and texture in this game is generated in code at load time.
   There is not a single binary asset. Vertex layout for all solid meshes:
       aPos(3) aNormal(3) aColor(3) aFlex(1)   -> stride 10 floats / 40 bytes
   aFlex drives per-vertex animation (wind sway on foliage, tail whip on fish).
   ========================================================================= */
(function (DC) {
  'use strict';

  var M = DC.M;
  var STRIDE = 10;

  // -------------------------------------------------------------- builder
  function Mesh() {
    this.v = [];      // interleaved vertex data
    this.idx = [];    // triangle indices
    this.count = 0;   // vertex count
  }
  Mesh.prototype.vert = function (px, py, pz, nx, ny, nz, r, g, b, flex) {
    this.v.push(px, py, pz, nx, ny, nz, r, g, b, flex || 0);
    return this.count++;
  };
  Mesh.prototype.tri = function (a, b, c) { this.idx.push(a, b, c); };
  Mesh.prototype.quad = function (a, b, c, d) { this.idx.push(a, b, c, a, c, d); };
  Mesh.prototype.build = function () {
    return {
      data: new Float32Array(this.v),
      indices: new Uint32Array(this.idx),
      indexCount: this.idx.length,
      vertexCount: this.count,
      stride: STRIDE
    };
  };
  // Merge another mesh in, optionally offset/scaled/rotated about Y.
  Mesh.prototype.append = function (other, ox, oy, oz, scale, rotY) {
    ox = ox || 0; oy = oy || 0; oz = oz || 0;
    scale = scale === undefined ? 1 : scale;
    rotY = rotY || 0;
    var c = Math.cos(rotY), s = Math.sin(rotY);
    var base = this.count;
    for (var i = 0; i < other.v.length; i += STRIDE) {
      var px = other.v[i] * scale, py = other.v[i + 1] * scale, pz = other.v[i + 2] * scale;
      var nx = other.v[i + 3], ny = other.v[i + 4], nz = other.v[i + 5];
      this.v.push(
        px * c + pz * s + ox, py + oy, -px * s + pz * c + oz,
        nx * c + nz * s, ny, -nx * s + nz * c,
        other.v[i + 6], other.v[i + 7], other.v[i + 8], other.v[i + 9]
      );
      this.count++;
    }
    for (var j = 0; j < other.idx.length; j++) this.idx.push(other.idx[j] + base);
  };

  // ------------------------------------------------------- geometry helpers
  function addCylinder(m, r0, r1, h, segs, col0, col1, flex0, flex1, capTop, capBot) {
    var slope = (r0 - r1) / Math.max(h, 1e-4);
    var ringA = [], ringB = [];
    for (var i = 0; i <= segs; i++) {
      var a = i / segs * M.TAU;
      var ca = Math.cos(a), sa = Math.sin(a);
      var nl = Math.hypot(ca, slope, sa);
      var nx = ca / nl, ny = slope / nl, nz = sa / nl;
      ringA.push(m.vert(ca * r0, 0, sa * r0, nx, ny, nz, col0[0], col0[1], col0[2], flex0));
      ringB.push(m.vert(ca * r1, h, sa * r1, nx, ny, nz, col1[0], col1[1], col1[2], flex1));
    }
    for (var j = 0; j < segs; j++) m.quad(ringA[j], ringA[j + 1], ringB[j + 1], ringB[j]);
    if (capTop && r1 > 1e-4) {
      var ct = m.vert(0, h, 0, 0, 1, 0, col1[0], col1[1], col1[2], flex1);
      var top = [];
      for (var k = 0; k <= segs; k++) {
        var a2 = k / segs * M.TAU;
        top.push(m.vert(Math.cos(a2) * r1, h, Math.sin(a2) * r1, 0, 1, 0, col1[0], col1[1], col1[2], flex1));
      }
      for (var k2 = 0; k2 < segs; k2++) m.tri(ct, top[k2 + 1], top[k2]);
    }
    if (capBot && r0 > 1e-4) {
      var cb = m.vert(0, 0, 0, 0, -1, 0, col0[0], col0[1], col0[2], flex0);
      var bot = [];
      for (var q = 0; q <= segs; q++) {
        var a3 = q / segs * M.TAU;
        bot.push(m.vert(Math.cos(a3) * r0, 0, Math.sin(a3) * r0, 0, -1, 0, col0[0], col0[1], col0[2], flex0));
      }
      for (var q2 = 0; q2 < segs; q2++) m.tri(cb, bot[q2], bot[q2 + 1]);
    }
  }

  function addBox(m, cx, cy, cz, sx, sy, sz, col, flex) {
    var hx = sx / 2, hy = sy / 2, hz = sz / 2;
    var faces = [
      [[1, 0, 0], [[hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz], [hx, -hy, hz]]],
      [[-1, 0, 0], [[-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz], [-hx, -hy, -hz]]],
      [[0, 1, 0], [[-hx, hy, -hz], [-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz]]],
      [[0, -1, 0], [[-hx, -hy, hz], [-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz]]],
      [[0, 0, 1], [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]]],
      [[0, 0, -1], [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]]]
    ];
    for (var f = 0; f < faces.length; f++) {
      var n = faces[f][0], vs = faces[f][1], ids = [];
      // Slight per-face shading variation so untextured boxes still read as 3D.
      var tint = 1 + n[1] * 0.06 + n[0] * 0.03;
      for (var i = 0; i < 4; i++) {
        ids.push(m.vert(
          cx + vs[i][0], cy + vs[i][1], cz + vs[i][2],
          n[0], n[1], n[2],
          col[0] * tint, col[1] * tint, col[2] * tint, flex || 0
        ));
      }
      m.quad(ids[0], ids[1], ids[2], ids[3]);
    }
  }

  function addSphere(m, cx, cy, cz, r, segs, rings, col, flex, squashY) {
    squashY = squashY === undefined ? 1 : squashY;
    var grid = [];
    for (var j = 0; j <= rings; j++) {
      var phi = j / rings * Math.PI;
      var row = [];
      for (var i = 0; i <= segs; i++) {
        var th = i / segs * M.TAU;
        var nx = Math.sin(phi) * Math.cos(th);
        var ny = Math.cos(phi);
        var nz = Math.sin(phi) * Math.sin(th);
        row.push(m.vert(
          cx + nx * r, cy + ny * r * squashY, cz + nz * r,
          nx, ny / squashY, nz,
          col[0], col[1], col[2], flex || 0
        ));
      }
      grid.push(row);
    }
    for (var jj = 0; jj < rings; jj++) {
      for (var ii = 0; ii < segs; ii++) {
        m.quad(grid[jj][ii], grid[jj + 1][ii], grid[jj + 1][ii + 1], grid[jj][ii + 1]);
      }
    }
  }

  // A flat, double-sided blade — fins, leaves, reeds.
  function addBlade(m, pts, normal, col, flexFn) {
    var ids = [], idsB = [];
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      var fx = flexFn ? flexFn(p, i) : 0;
      ids.push(m.vert(p[0], p[1], p[2], normal[0], normal[1], normal[2], col[0], col[1], col[2], fx));
      idsB.push(m.vert(p[0], p[1], p[2], -normal[0], -normal[1], -normal[2], col[0] * 0.85, col[1] * 0.85, col[2] * 0.85, fx));
    }
    for (var t = 1; t < pts.length - 1; t++) {
      m.tri(ids[0], ids[t], ids[t + 1]);
      m.tri(idsB[0], idsB[t + 1], idsB[t]);
    }
  }

  // ------------------------------------------------------------- fish body
  // Radius profile from tail peduncle (t=0) to snout (t=1).
  var FISH_PROFILE = [
    [0.00, 0.020], [0.05, 0.050], [0.12, 0.080], [0.22, 0.128],
    [0.34, 0.172], [0.46, 0.200], [0.56, 0.208], [0.66, 0.198],
    [0.76, 0.172], [0.86, 0.128], [0.94, 0.075], [1.00, 0.022]
  ];
  function fishRadius(t) {
    for (var i = 1; i < FISH_PROFILE.length; i++) {
      if (t <= FISH_PROFILE[i][0]) {
        var a = FISH_PROFILE[i - 1], b = FISH_PROFILE[i];
        var k = (t - a[0]) / (b[0] - a[0]);
        return M.lerp(a[1], b[1], M.smoothstep(0, 1, k));
      }
    }
    return FISH_PROFILE[FISH_PROFILE.length - 1][1];
  }

  /**
   * Fish model, unit length along +X (nose at x=+0.5, tail fin behind x=-0.5).
   * Colour is baked as a two-tone gradient: dorsal (top) vs ventral (belly),
   * which the shader remaps per-instance so every species reuses this mesh.
   * Red channel of aColor = "how dorsal is this vertex", green = fin mask.
   */
  function buildFishMesh(rings, segs) {
    var m = new Mesh();
    rings = rings || 22; segs = segs || 12;
    var grid = [];
    for (var j = 0; j <= rings; j++) {
      var t = j / rings;
      var x = -0.5 + t;                       // tail -> nose
      var r = fishRadius(t);
      var row = [];
      var bodyFlex = Math.pow(M.sat((0.62 - t) / 0.62), 1.6); // whip grows toward tail
      for (var i = 0; i <= segs; i++) {
        var a = i / segs * M.TAU;
        var ca = Math.cos(a), sa = Math.sin(a);
        var yy = ca * r * 1.30;               // taller than wide
        var zz = sa * r * 0.68;
        yy += -0.018 * Math.sin(Math.PI * t); // belly droop
        var nl = Math.hypot(ca / 1.30, sa / 0.68);
        var dorsal = M.sat(ca * 0.5 + 0.5);
        row.push(m.vert(x, yy, zz, 0, (ca / 1.30) / nl, (sa / 0.68) / nl, dorsal, 0, 0, bodyFlex));
      }
      grid.push(row);
    }
    for (var jj = 0; jj < rings; jj++) {
      for (var ii = 0; ii < segs; ii++) {
        m.quad(grid[jj][ii], grid[jj][ii + 1], grid[jj + 1][ii + 1], grid[jj + 1][ii]);
      }
    }

    // Caudal (tail) fin — forked, and it flexes hardest of all.
    addBlade(m, [
      [-0.50, 0.00, 0], [-0.66, 0.22, 0], [-0.76, 0.19, 0],
      [-0.68, 0.00, 0], [-0.76, -0.19, 0], [-0.66, -0.22, 0]
    ], [0, 0, 1], [0.5, 1, 0], function (p) {
      return Math.pow(M.sat((0.62 - (p[0] + 0.5)) / 0.62), 1.6) + (-p[0] - 0.5) * 0.9;
    });

    // Dorsal fin.
    addBlade(m, [
      [0.10, 0.20, 0], [0.02, 0.33, 0], [-0.16, 0.30, 0], [-0.20, 0.13, 0]
    ], [0, 0, 1], [0.95, 1, 0], function (p) {
      return Math.pow(M.sat((0.62 - (p[0] + 0.5)) / 0.62), 1.6);
    });

    // Anal fin.
    addBlade(m, [
      [-0.10, -0.17, 0], [-0.18, -0.28, 0], [-0.30, -0.22, 0], [-0.30, -0.10, 0]
    ], [0, 0, 1], [0.1, 1, 0], function (p) {
      return Math.pow(M.sat((0.62 - (p[0] + 0.5)) / 0.62), 1.6);
    });

    // Pectoral fins, one per side.
    for (var s = -1; s <= 1; s += 2) {
      addBlade(m, [
        [0.16, -0.02, 0.10 * s], [0.02, -0.10, 0.24 * s], [0.04, 0.02, 0.22 * s]
      ], [0, 1, 0], [0.4, 1, 0], function () { return 0.12; });
    }
    return m.build();
  }

  // ------------------------------------------------------------ trees/props
  function buildConifer(rng) {
    var m = new Mesh();
    var trunk = [0.30, 0.21, 0.14];
    var h = M.randRange(rng, 4.5, 8.0);
    addCylinder(m, 0.20, 0.11, h * 0.42, 7, trunk, trunk, 0, 0.05, false, false);
    var g = M.randRange(rng, 0.72, 1.0);
    var needle = [0.10 * g, 0.30 * g, 0.13 * g];
    var deep = [0.06 * g, 0.20 * g, 0.10 * g];
    var layers = 4;
    for (var i = 0; i < layers; i++) {
      var f = i / (layers - 1);
      var y = h * (0.22 + f * 0.62);
      var r = M.lerp(1.55, 0.5, f);
      var lh = M.lerp(2.2, 1.4, f);
      var mm = new Mesh();
      addCylinder(mm, r, 0.02, lh, 9, deep, needle, 0.15 + f * 0.35, 0.5 + f * 0.5, false, true);
      m.append(mm, 0, y, 0, 1, rng() * 6.28);
    }
    return m.build();
  }

  function buildBroadleaf(rng) {
    var m = new Mesh();
    var trunk = [0.33, 0.24, 0.17];
    var h = M.randRange(rng, 3.6, 6.4);
    addCylinder(m, 0.26, 0.15, h * 0.62, 7, trunk, trunk, 0, 0.1, false, false);
    var g = M.randRange(rng, 0.75, 1.15);
    var leaf = [0.20 * g, 0.36 * g, 0.13 * g];
    var blobs = 3 + ((rng() * 3) | 0);
    for (var i = 0; i < blobs; i++) {
      var ang = rng() * M.TAU;
      var rad = M.randRange(rng, 0, 1.1);
      var rr = M.randRange(rng, 1.1, 1.9);
      var tone = M.randRange(rng, 0.82, 1.15);
      addSphere(m,
        Math.cos(ang) * rad, h * 0.62 + M.randRange(rng, -0.2, 1.5), Math.sin(ang) * rad,
        rr, 8, 6, [leaf[0] * tone, leaf[1] * tone, leaf[2] * tone], 0.85, 0.8);
    }
    return m.build();
  }

  function buildBush(rng) {
    var m = new Mesh();
    var g = M.randRange(rng, 0.7, 1.1);
    var leaf = [0.17 * g, 0.30 * g, 0.12 * g];
    var blobs = 2 + ((rng() * 3) | 0);
    for (var i = 0; i < blobs; i++) {
      addSphere(m,
        M.randRange(rng, -0.5, 0.5), M.randRange(rng, 0.3, 0.8), M.randRange(rng, -0.5, 0.5),
        M.randRange(rng, 0.45, 0.85), 7, 5, leaf, 1.0, 0.75);
    }
    return m.build();
  }

  // Cattails / reeds for the shallows. Blades get a strongly upward-biased
  // normal: a truly edge-on normal reads as a black stick under a high sun.
  function buildReeds(rng) {
    var m = new Mesh();
    var n = 9 + ((rng() * 8) | 0);
    for (var i = 0; i < n; i++) {
      var ang = rng() * M.TAU;
      var rad = Math.sqrt(rng()) * 0.55;
      var ox = Math.cos(ang) * rad;
      var oz = Math.sin(ang) * rad;
      var h = M.randRange(rng, 0.85, 1.75);
      var lean = M.randRange(rng, -0.32, 0.32);
      var w = M.randRange(rng, 0.055, 0.095);
      var g = M.randRange(rng, 0.8, 1.2);
      var col = [0.26 * g, 0.42 * g, 0.17 * g];
      var tip = [0.42 * g, 0.52 * g, 0.22 * g];
      var dir = rng() * M.TAU;
      var dx = Math.cos(dir), dz = Math.sin(dir);
      var nx = dz * 0.45, ny = 1.0, nz = -dx * 0.45;
      var nl = Math.hypot(nx, ny, nz);
      (function (hh) {
        addBlade(m, [
          [ox - dz * w, 0, oz + dx * w],
          [ox + dz * w, 0, oz - dx * w],
          [ox + dx * lean + dz * w * 0.25, hh, oz + dz * lean - dx * w * 0.25],
          [ox + dx * lean - dz * w * 0.25, hh, oz + dz * lean + dx * w * 0.25]
        ], [nx / nl, ny / nl, nz / nl], col, function (p) { return Math.pow(p[1] / hh, 1.4); });
      })(h);
      // Every so often, an actual cattail head.
      if (rng() < 0.32) {
        var head = new Mesh();
        addCylinder(head, 0.030, 0.026, 0.20, 6, [0.30, 0.20, 0.10], [0.24, 0.15, 0.07], 0.9, 1.0, true, true);
        m.append(head, ox + dx * lean, h - 0.06, oz + dz * lean, 1, 0);
      }
      if (rng() < 0.5) {
        var blade2 = new Mesh();
        addBlade(blade2, [
          [-w * 0.7, 0, 0], [w * 0.7, 0, 0],
          [w * 0.4, h * 0.72, lean * 0.8], [-w * 0.4, h * 0.72, lean * 0.8]
        ], [0.3, 1.0, 0.2], tip, function (p) { return Math.pow(p[1] / h, 1.4); });
        m.append(blade2, ox, 0, oz, 1, rng() * M.TAU);
      }
    }
    return m.build();
  }

  function buildRock(rng) {
    var m = new Mesh();
    var segs = 8, rings = 6, grid = [];
    var g = M.randRange(rng, 0.85, 1.15);
    var col = [0.40 * g, 0.39 * g, 0.37 * g];
    var seedA = rng() * 100, seedB = rng() * 100;
    for (var j = 0; j <= rings; j++) {
      var phi = j / rings * Math.PI, row = [];
      for (var i = 0; i <= segs; i++) {
        var th = i / segs * M.TAU;
        var nx = Math.sin(phi) * Math.cos(th);
        var ny = Math.cos(phi);
        var nz = Math.sin(phi) * Math.sin(th);
        var bump = 1 + 0.52 * M.noise2(seedA + nx * 3.1 + nz * 1.1, seedB + ny * 3.4 + nz * 1.9);
        var shade = 0.85 + 0.3 * M.sat(ny * 0.5 + 0.5);
        row.push(m.vert(nx * bump, ny * bump * 0.64, nz * bump, nx, ny * 1.3, nz,
          col[0] * shade, col[1] * shade, col[2] * shade, 0));
      }
      grid.push(row);
    }
    for (var jj = 0; jj < rings; jj++) {
      for (var ii = 0; ii < segs; ii++) {
        m.quad(grid[jj][ii], grid[jj + 1][ii], grid[jj + 1][ii + 1], grid[jj][ii + 1]);
      }
    }
    return m.build();
  }

  function buildLilypad(rng) {
    var m = new Mesh();
    var n = 2 + ((rng() * 3) | 0);
    for (var k = 0; k < n; k++) {
      var cx = M.randRange(rng, -1.3, 1.3), cz = M.randRange(rng, -1.3, 1.3);
      var r = M.randRange(rng, 0.42, 0.85);
      var g = M.randRange(rng, 0.7, 1.05);
      var col = [0.17 * g, 0.35 * g, 0.16 * g];
      var segs = 14;
      var c = m.vert(cx, 0.02, cz, 0, 1, 0, col[0] * 1.15, col[1] * 1.15, col[2] * 1.15, 0.2);
      var ring = [];
      for (var i = 0; i <= segs; i++) {
        var a = i / segs * M.TAU;
        // Notch cut out of one side, like a real lily pad.
        var notch = M.smoothstep(0.30, 0.0, Math.abs(M.angDiff(a, 0.8)));
        var rr = r * (1 - notch * 0.85) * (1 + 0.06 * Math.sin(a * 5));
        ring.push(m.vert(cx + Math.cos(a) * rr, 0.02, cz + Math.sin(a) * rr, 0, 1, 0,
          col[0], col[1], col[2], 0.35));
      }
      for (var i2 = 0; i2 < segs; i2++) m.tri(c, ring[i2], ring[i2 + 1]);
    }
    return m.build();
  }

  /* ------------------------------------------------------------- the boat
     A clinker-ish rowboat, lofted from station curves. Bow points along -Z so
     the hull shares the camera's heading convention: forward = (-sin h, -cos h).

     Stations run bow (t=0) to transom (t=1). Each is a curve swept by u in
     [-1,1] from the port gunwale, down through the keel, up to starboard. */
  var BOAT_LEN = 3.7;

  function boatBeam(t) {
    var tbl = [
      [0.00, 0.045], [0.10, 0.240], [0.24, 0.430], [0.40, 0.570],
      [0.56, 0.645], [0.72, 0.660], [0.88, 0.630], [1.00, 0.560]
    ];
    for (var i = 1; i < tbl.length; i++) {
      if (t <= tbl[i][0]) {
        var a = tbl[i - 1], b = tbl[i];
        return M.lerp(a[1], b[1], M.smoothstep(0, 1, (t - a[0]) / (b[0] - a[0])));
      }
    }
    return 0.56;
  }
  // Sheer line: gunwale rides high at bow and stern, dips amidships.
  function boatSheer(t) { return 0.62 - 0.21 * Math.sin(Math.PI * Math.pow(t, 0.9)); }
  // Keel line: deepest just aft of amidships, rising to the stem and transom.
  function boatKeel(t) { return -0.34 * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.78)), 0.55) - 0.02; }

  function boatPoint(t, u, inset, rise) {
    var beam = Math.max(boatBeam(t) - inset, 0.01);
    var gun = boatSheer(t);
    var keel = boatKeel(t) + rise;
    var au = Math.abs(u);
    return [
      beam * (u < 0 ? -1 : 1) * Math.pow(au, 0.72),
      keel + (gun - keel) * Math.pow(au, 1.85),
      -BOAT_LEN / 2 + t * BOAT_LEN
    ];
  }

  /* Loft a shell and derive vertex normals from the parametric grid, which is
     cleaner than accumulating face normals for a surface this smooth. */
  function addBoatShell(m, NS, NU, inset, rise, col, flip) {
    var grid = [], pts = [];
    var s, u, i, j;
    for (i = 0; i <= NS; i++) {
      var t = i / NS;
      var row = [];
      for (j = 0; j <= NU; j++) {
        row.push(boatPoint(t, -1 + 2 * j / NU, inset, rise));
      }
      pts.push(row);
    }
    function at(i, j) {
      return pts[M.clamp(i, 0, NS) | 0][M.clamp(j, 0, NU) | 0];
    }
    for (i = 0; i <= NS; i++) {
      var ids = [];
      for (j = 0; j <= NU; j++) {
        var p = pts[i][j];
        var dt = [], du = [];
        var a = at(i + 1, j), b = at(i - 1, j);
        var c = at(i, j + 1), d = at(i, j - 1);
        for (var k = 0; k < 3; k++) { dt[k] = a[k] - b[k]; du[k] = c[k] - d[k]; }
        var nx = du[1] * dt[2] - du[2] * dt[1];
        var ny = du[2] * dt[0] - du[0] * dt[2];
        var nz = du[0] * dt[1] - du[1] * dt[0];
        var nl = Math.hypot(nx, ny, nz) || 1;
        var f = flip ? -1 : 1;
        // A little plank banding so the hull is not a flat colour.
        var band = 0.9 + 0.14 * (Math.abs(Math.sin(p[1] * 22.0)) > 0.55 ? 1 : 0);
        ids.push(m.vert(p[0], p[1], p[2], nx / nl * f, ny / nl * f, nz / nl * f,
          col[0] * band, col[1] * band, col[2] * band, 0));
      }
      grid.push(ids);
    }
    for (i = 0; i < NS; i++) {
      for (j = 0; j < NU; j++) {
        if (flip) m.quad(grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]);
        else m.quad(grid[i][j], grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j]);
      }
    }
    return grid;
  }

  function buildBoat() {
    var m = new Mesh();
    var NS = 20, NU = 12;
    var paint = [0.20, 0.32, 0.34];     // faded green-blue topsides
    var inner = [0.31, 0.25, 0.185];    // bare wood inside, weathered grey-brown
    var rail = [0.235, 0.185, 0.135];
    var trim = [0.46, 0.41, 0.33];

    var outer = addBoatShell(m, NS, NU, 0, 0, paint, false);
    var lining = addBoatShell(m, NS, NU, 0.055, 0.075, inner, true);

    // Gunwale cap: a rail joining the outer and inner top edges, both sides.
    for (var i = 0; i < NS; i++) {
      for (var e = 0; e < 2; e++) {
        var j = e === 0 ? 0 : NU;
        var t0 = i / NS, t1 = (i + 1) / NS;
        var u = e === 0 ? -1 : 1;
        var a = boatPoint(t0, u, 0, 0), b = boatPoint(t1, u, 0, 0);
        var c = boatPoint(t0, u, 0.055, 0.075), d = boatPoint(t1, u, 0.055, 0.075);
        var ia = m.vert(a[0], a[1], a[2], 0, 1, 0, rail[0], rail[1], rail[2], 0);
        var ib = m.vert(b[0], b[1], b[2], 0, 1, 0, rail[0], rail[1], rail[2], 0);
        var ic = m.vert(c[0], c[1], c[2], 0, 1, 0, rail[0], rail[1], rail[2], 0);
        var id = m.vert(d[0], d[1], d[2], 0, 1, 0, rail[0], rail[1], rail[2], 0);
        if (u < 0) m.quad(ia, ib, id, ic); else m.quad(ia, ic, id, ib);
      }
    }

    // Transom: closes the stern between the outer and inner shells.
    var tr = [];
    for (var j2 = 0; j2 <= NU; j2++) {
      var uu = -1 + 2 * j2 / NU;
      var po = boatPoint(1, uu, 0, 0);
      var pi = boatPoint(1, uu, 0.055, 0.075);
      tr.push([
        m.vert(po[0], po[1], po[2], 0, 0.1, 1, rail[0], rail[1], rail[2], 0),
        m.vert(pi[0], pi[1], pi[2], 0, 0.1, 1, rail[0] * 1.1, rail[1] * 1.1, rail[2] * 1.1, 0)
      ]);
    }
    for (var j3 = 0; j3 < NU; j3++) m.quad(tr[j3][0], tr[j3][1], tr[j3 + 1][1], tr[j3 + 1][0]);

    // Floorboards.
    for (var fb = 0; fb < 5; fb++) {
      var ft = 0.24 + fb * 0.13;
      var fz = -BOAT_LEN / 2 + ft * BOAT_LEN;
      addBox(m, 0, boatKeel(ft) + 0.10, fz, boatBeam(ft) * 1.15, 0.035, 0.16, inner, 0);
    }

    // Thwarts (seats) fore and aft, plus a rowing bench amidships.
    [0.30, 0.50, 0.82].forEach(function (st, idx) {
      var sz = -BOAT_LEN / 2 + st * BOAT_LEN;
      var sy = boatSheer(st) - 0.14;
      addBox(m, 0, sy, sz, boatBeam(st) * 1.9, 0.055, 0.26,
        idx === 1 ? trim : [inner[0] * 1.15, inner[1] * 1.15, inner[2] * 1.15], 0);
    });

    // Oarlocks on the gunwale, level with the rowing bench.
    var lockT = 0.50;
    var lockZ = -BOAT_LEN / 2 + lockT * BOAT_LEN;
    for (var sgn = -1; sgn <= 1; sgn += 2) {
      var lk = new Mesh();
      addCylinder(lk, 0.035, 0.030, 0.11, 8, [0.42, 0.44, 0.47], [0.52, 0.54, 0.58], 0, 0, true, true);
      m.append(lk, sgn * boatBeam(lockT), boatSheer(lockT), lockZ, 1, 0);
    }

    // Stem post and a mooring cleat at the bow.
    var stem = new Mesh();
    addCylinder(stem, 0.05, 0.035, 0.20, 8, rail, trim, 0, 0, true, false);
    m.append(stem, 0, boatSheer(0.02) - 0.05, -BOAT_LEN / 2 + 0.10, 1, 0);

    // A bailing bucket, because every rowboat has one.
    var bucket = new Mesh();
    addCylinder(bucket, 0.11, 0.13, 0.20, 10, [0.45, 0.28, 0.16], [0.55, 0.34, 0.19], 0, 0, false, true);
    m.append(bucket, 0.22, boatKeel(0.86) + 0.12, -BOAT_LEN / 2 + 0.86 * BOAT_LEN, 1, 0);

    return m.build();
  }

  // One oar, shaft along +X with the pivot at the oarlock. The left oar is the
  // same mesh rotated 180 degrees about Y, so winding stays correct.
  function buildOar() {
    var m = new Mesh();
    var wood = [0.55, 0.44, 0.30];
    var dark = [0.42, 0.33, 0.22];
    var shaft = new Mesh();
    addCylinder(shaft, 0.028, 0.022, 1.62, 8, dark, wood, 0, 0, true, true);
    // Rotate the shaft from +Y onto +X by building it and swapping axes.
    var d = shaft.v;
    for (var i = 0; i < d.length; i += STRIDE) {
      var px = d[i], py = d[i + 1];
      d[i] = py - 0.42; d[i + 1] = -px;         // pivot 0.42 in from the grip
      var nx = d[i + 3], ny = d[i + 4];
      d[i + 3] = ny; d[i + 4] = -nx;
    }
    m.append(shaft, 0, 0, 0, 1, 0);
    // Blade.
    addBlade(m, [
      [1.02, 0, -0.035], [1.44, 0, -0.085], [1.62, 0, 0], [1.44, 0, 0.085], [1.02, 0, 0.035]
    ], [0, 1, 0], wood, function () { return 0; });
    addBox(m, 1.30, 0, 0, 0.60, 0.018, 0.16, dark, 0);
    // Grip.
    var grip = new Mesh();
    addCylinder(grip, 0.032, 0.032, 0.14, 8, [0.30, 0.24, 0.18], [0.30, 0.24, 0.18], 0, 0, true, true);
    var gd = grip.v;
    for (var k = 0; k < gd.length; k += STRIDE) {
      var gx = gd[k], gy = gd[k + 1];
      gd[k] = gy - 0.50; gd[k + 1] = -gx;
      var gnx = gd[k + 3], gny = gd[k + 4];
      gd[k + 3] = gny; gd[k + 4] = -gnx;
    }
    m.append(grip, 0, 0, 0, 1, 0);
    return m.build();
  }

  // --------------------------------------------------------------- the dock
  function buildDock(length, width) {
    var m = new Mesh();
    var plank = [0.34, 0.28, 0.22];
    var plankDark = [0.26, 0.21, 0.16];
    var post = [0.21, 0.17, 0.13];
    var n = Math.floor(length / 0.44);
    for (var i = 0; i < n; i++) {
      var z = -i * 0.44 - 0.22;
      var w = (i % 3 === 0) ? 0.94 : 1.0;
      var c = (i % 2 === 0) ? plank : plankDark;
      addBox(m, 0, 0.02, z, width, 0.09, 0.38 * w, [c[0], c[1], c[2]], 0);
    }
    // Stringers under the deck.
    for (var s = -1; s <= 1; s += 2) {
      addBox(m, s * (width / 2 - 0.16), -0.10, -length / 2, 0.16, 0.22, length, plankDark, 0);
    }
    // Pilings, sunk well below the waterline.
    var posts = Math.max(2, Math.floor(length / 2.4));
    for (var p = 0; p <= posts; p++) {
      var pz = -(p / posts) * (length - 0.3) - 0.15;
      for (var sx = -1; sx <= 1; sx += 2) {
        addCylinder(m, 0.17, 0.15, 3.2, 8, post, post, 0, 0, true, false);
        var mm = new Mesh();
        addCylinder(mm, 0.17, 0.15, 3.6, 8, [post[0] * 0.7, post[1] * 0.7, post[2] * 0.7], post, 0, 0, true, false);
        m.append(mm, sx * (width / 2 - 0.17), -3.4, pz, 1, 0);
      }
    }
    // Hand rail on the last stretch, for silhouette.
    for (var sr = -1; sr <= 1; sr += 2) {
      addBox(m, sr * (width / 2 - 0.06), 0.78, -length * 0.78, 0.07, 0.07, length * 0.42, post, 0);
      for (var q = 0; q < 4; q++) {
        var qz = -length * 0.58 - q * (length * 0.42 / 3);
        addBox(m, sr * (width / 2 - 0.06), 0.42, qz, 0.09, 0.75, 0.09, post, 0);
      }
    }
    return m.build();
  }

  // ------------------------------------------------------- first-person rod
  function buildRod() {
    var m = new Mesh();
    var cork = [0.62, 0.47, 0.29];
    var graphite = [0.16, 0.17, 0.20];
    var tipCol = [0.42, 0.43, 0.47];
    var metal = [0.55, 0.57, 0.62];
    var accent = [0.85, 0.30, 0.16];

    // Grip + blank run along +Y locally; the renderer orients it in view space.
    addCylinder(m, 0.032, 0.030, 0.30, 10, cork, cork, 0, 0, true, true);
    var mm = new Mesh();
    addCylinder(mm, 0.030, 0.026, 0.10, 10, accent, accent, 0, 0, false, false);
    m.append(mm, 0, 0.30, 0, 1, 0);
    // Tapered blank in segments so it can bend convincingly in the shader.
    var segs = 9, base = 0.40, total = 2.05;
    for (var i = 0; i < segs; i++) {
      var t0 = i / segs, t1 = (i + 1) / segs;
      var r0 = M.lerp(0.024, 0.0055, t0);
      var r1 = M.lerp(0.024, 0.0055, t1);
      var c0 = [M.lerp(graphite[0], tipCol[0], t0), M.lerp(graphite[1], tipCol[1], t0), M.lerp(graphite[2], tipCol[2], t0)];
      var c1 = [M.lerp(graphite[0], tipCol[0], t1), M.lerp(graphite[1], tipCol[1], t1), M.lerp(graphite[2], tipCol[2], t1)];
      var seg = new Mesh();
      addCylinder(seg, r0, r1, total / segs, 8, c0, c1, t0 * t0, t1 * t1, false, false);
      m.append(seg, 0, base + t0 * total, 0, 1, 0);
      // Line guides.
      if (i > 1) {
        var gr = new Mesh();
        addCylinder(gr, r1 * 2.6, r1 * 2.4, 0.012, 8, metal, metal, t1 * t1, t1 * t1, true, true);
        m.append(gr, 0, base + t1 * total - 0.02, 0, 1, 0);
      }
    }
    /* Spinning reel, hanging under the blank on its stem. Two bare coaxial
       cylinders (what this used to be) read as a claw from the viewmodel
       angle; it needs the silhouette a reel actually has — foot, stem, body,
       then a lipped spool with line on it. */
    /* Light enough to read. The reel hangs on the shaded side of the blank,
       so anything as dark as the graphite here renders as one black blob and
       the shape work is wasted. */
    var body = [0.34, 0.36, 0.41];
    var bodyL = [0.50, 0.53, 0.58];
    var lineCol = [0.82, 0.83, 0.78];

    addBox(m, 0.0, 0.30, -0.038, 0.030, 0.075, 0.048, bodyL, 0);   // foot on the blank
    addBox(m, 0.0, 0.302, -0.072, 0.024, 0.052, 0.036, body, 0);   // stem

    var housing = new Mesh();                                       // gearbox
    addCylinder(housing, 0.034, 0.034, 0.056, 12, body, body, 0, 0, true, true);
    m.append(housing, 0.0, 0.276, -0.108, 1, 0);
    addBox(m, 0.0, 0.307, -0.108, 0.046, 0.028, 0.062, bodyL, 0);

    // Rotor cup, then the spool: a line pack sandwiched between two flanges,
    // which is the read that says "reel" at a glance.
    var rotor = new Mesh();
    addCylinder(rotor, 0.038, 0.040, 0.028, 14, body, bodyL, 0, 0, false, true);
    m.append(rotor, 0.0, 0.338, -0.108, 1, 0);
    var lip = new Mesh();
    addCylinder(lip, 0.042, 0.042, 0.008, 14, bodyL, bodyL, 0, 0, true, true);
    m.append(lip, 0.0, 0.368, -0.108, 1, 0);
    var line = new Mesh();
    addCylinder(line, 0.036, 0.036, 0.024, 14, lineCol, lineCol, 0, 0, false, false);
    m.append(line, 0.0, 0.376, -0.108, 1, 0);
    var lip2 = new Mesh();
    addCylinder(lip2, 0.042, 0.038, 0.010, 14, bodyL, bodyL, 0, 0, true, true);
    m.append(lip2, 0.0, 0.402, -0.108, 1, 0);

    // Bail wire, arcing over the spool.
    for (var b = 0; b < 5; b++) {
      var ba = -0.5 + b / 4 * 2.6;
      addBox(m, Math.sin(ba) * 0.044, 0.370 + Math.cos(ba) * 0.044, -0.108,
        0.011, 0.011, 0.011, metal, 0);
    }
    return m.build();
  }

  // Rotate a finished mesh about Z in place. Used to aim limb pieces that were
  // easier to build along +Y.
  function rotateMeshZ(mesh, a) {
    var c = Math.cos(a), sn = Math.sin(a), d = mesh.v;
    for (var i = 0; i < d.length; i += STRIDE) {
      var x = d[i], y = d[i + 1];
      d[i] = x * c - y * sn; d[i + 1] = x * sn + y * c;
      var nx = d[i + 3], ny = d[i + 4];
      d[i + 3] = nx * c - ny * sn; d[i + 4] = nx * sn + ny * c;
    }
  }

  /* A hand gripping a rod. Local +Y is the rod axis, the palm sits on +X and
     the fingers wrap around the -Z side. Without these the rod is a pole
     floating in the corner of the screen with nothing holding it.

     opts.armLen / opts.armAngle aim the forearm. The elbow is never modelled,
     so an arm only looks right if it is long enough to leave the frame: one
     that stops early leaves a severed stump floating over the water. */
  function buildHand(opts) {
    opts = opts || {};
    var armLen = opts.armLen === undefined ? 0.34 : opts.armLen;
    var armAng = opts.armAngle === undefined ? Math.PI * 0.92 : opts.armAngle;
    var m = new Mesh();
    var skin = [0.66, 0.47, 0.38];
    var skinD = [0.55, 0.38, 0.30];
    var skinL = [0.72, 0.53, 0.43];
    var cuff = opts.sleeve || [0.26, 0.32, 0.35];

    // Palm and the back of the hand. Kept slim — a fist on a 3 cm grip is a
    // small thing, and an oversized one reads as a wooden block.
    addBox(m, 0.042, 0.000, 0.000, 0.038, 0.098, 0.072, skin, 0);
    addBox(m, 0.053, 0.010, 0.000, 0.020, 0.074, 0.062, skinL, 0);

    /* Four fingers, each three segments curling around the front of the grip.
       Pitch is a hair under the segment thickness so neighbours touch: leave a
       real gap and at viewmodel range the hand reads as a stack of loose
       slabs rather than a fist. */
    for (var i = 0; i < 4; i++) {
      var y = -0.033 + i * 0.0215;
      var t = 0.0225 - Math.abs(i - 1.4) * 0.0016;
      addBox(m, 0.006, y, -0.034, 0.052, t, 0.022, i % 2 ? skin : skinL, 0);
      addBox(m, -0.024, y, -0.021, 0.024, t * 0.92, 0.030, skinD, 0);
      addBox(m, 0.030, y, -0.030, 0.017, t * 1.05, 0.019, skinL, 0);
    }

    // Thumb, laid along the far side.
    addBox(m, 0.022, -0.038, 0.034, 0.048, 0.022, 0.024, skinL, 0);
    addBox(m, -0.006, -0.026, 0.038, 0.027, 0.020, 0.022, skin, 0);

    /* Wrist, then a sleeved forearm running back out of frame.
       Two pieces, not one: a bare wrist that stays slimmer than the palm (a
       forearm wider than the hand it belongs to reads as a length of pipe),
       then the shirt, which starts just below the hand so the arm is not one
       long tube of skin. rotateMeshZ(a) sends (0,t,0) to (-t*sin a, t*cos a),
       so that is where each piece and the cuff band have to be placed. */
    var sn = Math.sin(armAng), cs = Math.cos(armAng);
    var at = function (t) { return [0.052 - t * sn, -0.026 + t * cs, 0.008]; };
    // Short, so the cuff clears the bottom of the frame and is actually seen.
    var wristLen = Math.min(0.055, armLen * 0.20);
    var wrist = new Mesh();
    addCylinder(wrist, 0.027, 0.034, wristLen + 0.01, 10, skin, skin, 0, 0, false, false);
    rotateMeshZ(wrist, armAng);
    var w0 = at(0);
    m.append(wrist, w0[0], w0[1], w0[2], 1, 0);

    var sleeve = new Mesh();
    addCylinder(sleeve, 0.040, 0.048, armLen - wristLen, 10, cuff,
      [cuff[0] * 0.72, cuff[1] * 0.72, cuff[2] * 0.72], 0, 0, true, false);
    rotateMeshZ(sleeve, armAng);
    var s0 = at(wristLen);
    m.append(sleeve, s0[0], s0[1], s0[2], 1, 0);

    // Rolled cuff at the join, slightly proud of the sleeve.
    var band = new Mesh();
    addCylinder(band, 0.043, 0.043, 0.022, 10, [cuff[0] * 1.25, cuff[1] * 1.25, cuff[2] * 1.25],
      [cuff[0] * 1.25, cuff[1] * 1.25, cuff[2] * 1.25], 0, 0, false, false);
    rotateMeshZ(band, armAng);
    var b0 = at(wristLen - 0.004);
    m.append(band, b0[0], b0[1], b0[2], 1, 0);

    return m.build();
  }

  /* Reel geometry, shared with the rod pose code. The crank axle sits beside
     the spool; the knob orbits it at CRANK_R. The left hand orbits that same
     circle, so these have to agree or the hand floats off the handle. */
  var REEL_SEAT = [0.048, 0.307, -0.108];
  var CRANK_R = 0.085;

  /* Local-space far end of a forearm built with these options. QA uses it to
     prove the arm really does leave the frame rather than stopping in mid-air
     — see the note in buildHand about severed stumps. */
  function handArmTip(opts) {
    opts = opts || {};
    var armLen = opts.armLen === undefined ? 0.34 : opts.armLen;
    var armAng = opts.armAngle === undefined ? Math.PI * 0.92 : opts.armAngle;
    return [0.052 - armLen * Math.sin(armAng), -0.026 + armLen * Math.cos(armAng), 0.008];
  }

  /* The reel crank, which spins independently of the rod.
     The axle lies across the rod (+X) and the arm radiates along +Y, so a
     rotation about X sweeps it round. The old arm lay *along* the spin axis,
     which meant the handle turned without ever appearing to move. */
  function buildReelHandle() {
    var m = new Mesh();
    var metal = [0.20, 0.21, 0.24], knobCol = [0.55, 0.40, 0.25];
    var axle = new Mesh();
    addCylinder(axle, 0.010, 0.010, 0.055, 8, metal, metal, 0, 0, true, true);
    rotateMeshZ(axle, -Math.PI / 2);           // +Y -> +X
    m.append(axle, 0, 0, 0, 1, 0);
    addBox(m, 0.055, 0.045, 0, 0.016, 0.090, 0.016, metal, 0);
    var knob = new Mesh();
    addCylinder(knob, 0.016, 0.016, 0.045, 10, knobCol, knobCol, 0, 0, true, true);
    rotateMeshZ(knob, -Math.PI / 2);
    m.append(knob, 0.050, CRANK_R, 0, 1, 0);
    return m.build();
  }

  // ---------------------------------------------------------------- bobber
  function buildBobber() {
    var m = new Mesh();
    var red = [0.86, 0.16, 0.13], white = [0.94, 0.94, 0.95];
    var segs = 14, rings = 10, grid = [];
    for (var j = 0; j <= rings; j++) {
      var phi = j / rings * Math.PI, row = [];
      for (var i = 0; i <= segs; i++) {
        var th = i / segs * M.TAU;
        var nx = Math.sin(phi) * Math.cos(th);
        var ny = Math.cos(phi);
        var nz = Math.sin(phi) * Math.sin(th);
        var c = ny > 0.02 ? red : white;
        row.push(m.vert(nx * 0.075, ny * 0.075, nz * 0.075, nx, ny, nz, c[0], c[1], c[2], 0));
      }
      grid.push(row);
    }
    for (var jj = 0; jj < rings; jj++) {
      for (var ii = 0; ii < segs; ii++) {
        m.quad(grid[jj][ii], grid[jj + 1][ii], grid[jj + 1][ii + 1], grid[jj][ii + 1]);
      }
    }
    addCylinder(m, 0.010, 0.004, 0.10, 6, [0.15, 0.15, 0.17], [0.9, 0.55, 0.1], 0, 0, true, false);
    var eye = new Mesh();
    addCylinder(eye, 0.012, 0.012, 0.012, 6, [0.6, 0.62, 0.66], [0.6, 0.62, 0.66], 0, 0, true, true);
    m.append(eye, 0, -0.082, 0, 1, 0);
    return m.build();
  }

  // A tiny ring for ripple decals on the water surface.
  function buildRing(segs) {
    var m = new Mesh();
    segs = segs || 40;
    var inner = [], outer = [];
    for (var i = 0; i <= segs; i++) {
      var a = i / segs * M.TAU;
      var ca = Math.cos(a), sa = Math.sin(a);
      inner.push(m.vert(ca * 0.72, 0, sa * 0.72, 0, 1, 0, 0, 0, 0, 0));
      outer.push(m.vert(ca, 0, sa, 0, 1, 0, 1, 1, 1, 1));
    }
    for (var j = 0; j < segs; j++) m.quad(inner[j], outer[j], outer[j + 1], inner[j + 1]);
    return m.build();
  }

  // ------------------------------------------------------------- textures
  // Tiling water normal map + a foam mask in alpha.
  function makeWaterNormalTexture(size) {
    size = size || 256;
    var h = new Float32Array(size * size);
    var foam = new Float32Array(size * size);
    var i, j, x, y;
    for (j = 0; j < size; j++) {
      for (i = 0; i < size; i++) {
        var u = i / size, v = j / size;
        var sum = 0, amp = 1, norm = 0, freq = 4;
        for (var o = 0; o < 5; o++) {
          sum += amp * M.noise2Tiled(u * freq, v * freq, freq);
          norm += amp;
          amp *= 0.55; freq *= 2;
        }
        h[j * size + i] = sum / norm;
        var f = 0, fa = 1, fn = 0, ff = 6;
        for (var o2 = 0; o2 < 3; o2++) {
          f += fa * Math.abs(M.noise2Tiled(u * ff + 11.3, v * ff + 5.7, ff));
          fn += fa; fa *= 0.5; ff *= 2;
        }
        foam[j * size + i] = f / fn;
      }
    }
    var px = new Uint8Array(size * size * 4);
    var strength = 2.6;
    for (j = 0; j < size; j++) {
      for (i = 0; i < size; i++) {
        var l = h[j * size + ((i - 1 + size) % size)];
        var r = h[j * size + ((i + 1) % size)];
        var d = h[((j - 1 + size) % size) * size + i];
        var uu = h[((j + 1) % size) * size + i];
        var nx = (l - r) * strength, nz = (d - uu) * strength, ny = 1;
        var len = Math.hypot(nx, ny, nz);
        var k = (j * size + i) * 4;
        px[k] = ((nx / len) * 0.5 + 0.5) * 255;
        px[k + 1] = ((ny / len) * 0.5 + 0.5) * 255;
        px[k + 2] = ((nz / len) * 0.5 + 0.5) * 255;
        px[k + 3] = M.sat(foam[j * size + i] * 1.6) * 255;
      }
    }
    return { data: px, size: size };
  }

  // General-purpose tiling noise: 4 independent octaves in 4 channels.
  function makeNoiseTexture(size) {
    size = size || 128;
    var px = new Uint8Array(size * size * 4);
    for (var j = 0; j < size; j++) {
      for (var i = 0; i < size; i++) {
        var u = i / size, v = j / size;
        var k = (j * size + i) * 4;
        px[k] = (M.noise2Tiled(u * 4, v * 4, 4) * 0.5 + 0.5) * 255;
        px[k + 1] = (M.noise2Tiled(u * 8 + 3.1, v * 8 + 7.7, 8) * 0.5 + 0.5) * 255;
        px[k + 2] = (M.noise2Tiled(u * 16 + 1.9, v * 16 + 2.3, 16) * 0.5 + 0.5) * 255;
        px[k + 3] = (M.noise2Tiled(u * 32 + 5.5, v * 32 + 9.1, 32) * 0.5 + 0.5) * 255;
      }
    }
    return { data: px, size: size };
  }

  DC.Assets = {
    Mesh: Mesh,
    STRIDE: STRIDE,
    addCylinder: addCylinder,
    addBox: addBox,
    addSphere: addSphere,
    addBlade: addBlade,
    buildFishMesh: buildFishMesh,
    buildConifer: buildConifer,
    buildBroadleaf: buildBroadleaf,
    buildBush: buildBush,
    buildReeds: buildReeds,
    buildRock: buildRock,
    buildLilypad: buildLilypad,
    buildDock: buildDock,
    buildBoat: buildBoat,
    buildOar: buildOar,
    BOAT_LEN: BOAT_LEN,
    boatBeam: boatBeam,
    boatSheer: boatSheer,
    buildRod: buildRod,
    buildHand: buildHand,
    handArmTip: handArmTip,
    buildReelHandle: buildReelHandle,
    CRANK_R: CRANK_R,
    REEL_SEAT: REEL_SEAT,
    buildBobber: buildBobber,
    buildRing: buildRing,
    makeWaterNormalTexture: makeWaterNormalTexture,
    makeNoiseTexture: makeNoiseTexture
  };
})(DC);
