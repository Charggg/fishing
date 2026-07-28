/* =========================================================================
   DEEP CAST — world.js
   Generates the lake: a float heightmap, a warped-grid terrain mesh with
   baked ambient occlusion, the dock, and every scattered prop.
   Everything derives from one integer seed.
   ========================================================================= */
(function (DC) {
  'use strict';

  var M = DC.M;

  var EXTENT = 512;      // world spans [-EXTENT, EXTENT] on X and Z
  var HMAP = 1024;       // heightmap resolution (1 texel per world unit)
  var DMAX = 21.0;       // basin depth at the centre
  var BASE_RADIUS = 132; // mean shoreline radius

  function World(seed) {
    this.seed = seed >>> 0;
    this.extent = EXTENT;
    this.hmapSize = HMAP;
    this.height = null;
    this.rng = M.mulberry32(this.seed);
    this.maxDepth = 0;
  }

  // ------------------------------------------------------- height function
  // Continuous everywhere: basin -> beach -> foothills -> distant peaks.
  World.prototype.rawHeight = function (x, z) {
    var r = Math.hypot(x, z);
    var th = Math.atan2(z, x);

    // Irregular shoreline.
    var edge = BASE_RADIUS * (1
      + 0.20 * Math.sin(3 * th + 1.2)
      + 0.12 * Math.sin(5 * th + 0.4)
      + 0.07 * Math.sin(9 * th + 2.1)
      + 0.04 * Math.sin(13 * th + 5.0));
    var t = r / edge;

    var base;
    if (t < 1) {
      base = -DMAX * Math.pow(1 - t * t, 1.3);
    } else {
      base = 3.4 * (1 - Math.exp(-(t - 1) * 3.0));
    }

    // Rolling detail. Underwater this becomes structure fish like to sit on.
    base += M.fbm2(x * 0.0135 + 91.3, z * 0.0135 - 40.7, 5) * 2.0;
    base += M.fbm2(x * 0.052 - 12.1, z * 0.052 + 8.4, 3) * 0.55;

    // Foothills and the mountain rim that closes the horizon.
    var hills = M.smoothstep(1.05, 2.4, t);
    if (hills > 0) {
      base += M.ridged2(x * 0.0042 + 5.5, z * 0.0042 - 3.3, 5) * 84 * hills;
      base += M.fbm2(x * 0.011, z * 0.011, 4) * 9 * hills;
    }
    base += M.smoothstep(300, 505, r) * 130;   // wall off the map edge

    // A deep hole where the serious fish live.
    var hx = x - 44, hz = z + 34;
    base -= 13.5 * Math.exp(-(hx * hx + hz * hz) / (2 * 40 * 40));
    // A shallow weed flat on the opposite side.
    var sx = x + 62, sz = z - 48;
    base += 6.5 * Math.exp(-(sx * sx + sz * sz) / (2 * 34 * 34)) * (t < 1 ? 1 : 0);

    return base;
  };

  World.prototype.generateHeightmap = function () {
    var N = HMAP;
    var h = new Float32Array(N * N);
    var step = (EXTENT * 2) / (N - 1);
    var min = 1e9;
    for (var j = 0; j < N; j++) {
      var z = -EXTENT + j * step;
      var row = j * N;
      for (var i = 0; i < N; i++) {
        var x = -EXTENT + i * step;
        var v = this.rawHeight(x, z);
        h[row + i] = v;
        if (v < min) min = v;
      }
    }
    this.height = h;
    this.maxDepth = -min;
    return h;
  };

  // Bilinear sample of the generated heightmap. This is the authority — the
  // mesh, the water shader and the physics all read the same numbers.
  World.prototype.sample = function (x, z) {
    var N = HMAP;
    var u = (x + EXTENT) / (2 * EXTENT) * (N - 1);
    var v = (z + EXTENT) / (2 * EXTENT) * (N - 1);
    if (u < 0) u = 0; else if (u > N - 1.001) u = N - 1.001;
    if (v < 0) v = 0; else if (v > N - 1.001) v = N - 1.001;
    var i = u | 0, j = v | 0;
    var fx = u - i, fz = v - j;
    var h = this.height;
    var a = h[j * N + i], b = h[j * N + i + 1];
    var c = h[(j + 1) * N + i], d = h[(j + 1) * N + i + 1];
    return (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz;
  };

  World.prototype.normalAt = function (x, z, out) {
    var e = 1.2;
    var hl = this.sample(x - e, z), hr = this.sample(x + e, z);
    var hd = this.sample(x, z - e), hu = this.sample(x, z + e);
    var nx = hl - hr, nz = hd - hu, ny = 2 * e;
    var l = Math.hypot(nx, ny, nz);
    out[0] = nx / l; out[1] = ny / l; out[2] = nz / l;
    return out;
  };

  World.prototype.depthAt = function (x, z) {
    return Math.max(0, -this.sample(x, z));
  };

  // ------------------------------------------------------- terrain mesh
  // A regular grid with warped spacing: ~1.5 units through the whole play
  // area, stretching out toward the map edge. Regular topology => no cracks.
  function buildAxis() {
    var coords = [0];
    var r = 0;
    while (r < EXTENT) {
      var s = r < 185 ? 1.5 : 1.5 + (r - 185) * 0.105;
      r += s;
      coords.push(Math.min(r, EXTENT));
    }
    var full = [];
    for (var i = coords.length - 1; i > 0; i--) full.push(-coords[i]);
    for (var j = 0; j < coords.length; j++) full.push(coords[j]);
    return full;
  }

  World.prototype.buildTerrainMesh = function () {
    var axis = buildAxis();
    var n = axis.length;
    var verts = new Float32Array(n * n * 8);
    var self = this;
    var nrm = [0, 0, 0];
    var p = 0;
    var k, dirs = 8, rad = [3, 9, 24];
    var cos = new Float32Array(dirs), sin = new Float32Array(dirs);
    for (k = 0; k < dirs; k++) {
      cos[k] = Math.cos(k / dirs * M.TAU);
      sin[k] = Math.sin(k / dirs * M.TAU);
    }

    for (var j = 0; j < n; j++) {
      var z = axis[j];
      for (var i = 0; i < n; i++) {
        var x = axis[i];
        var h = self.sample(x, z);
        self.normalAt(x, z, nrm);

        // Horizon-based ambient occlusion: how much of the sky is blocked?
        var occ = 0;
        for (k = 0; k < dirs; k++) {
          var maxSlope = 0;
          for (var q = 0; q < rad.length; q++) {
            var d = rad[q];
            var hh = self.sample(x + cos[k] * d, z + sin[k] * d);
            var s = (hh - h) / d;
            if (s > maxSlope) maxSlope = s;
          }
          occ += M.sat(maxSlope * 1.15);
        }
        var ao = 1 - (occ / dirs) * 0.85;

        var vary = M.fbm2(x * 0.09 + 3.1, z * 0.09 - 7.7, 3) * 0.5 + 0.5;

        verts[p] = x; verts[p + 1] = h; verts[p + 2] = z;
        verts[p + 3] = nrm[0]; verts[p + 4] = nrm[1]; verts[p + 5] = nrm[2];
        verts[p + 6] = ao; verts[p + 7] = vary;
        p += 8;
      }
    }

    var indices = new Uint32Array((n - 1) * (n - 1) * 6);
    var ip = 0;
    for (var jj = 0; jj < n - 1; jj++) {
      for (var ii = 0; ii < n - 1; ii++) {
        var a = jj * n + ii, b = a + 1, c = a + n, d2 = c + 1;
        indices[ip++] = a; indices[ip++] = c; indices[ip++] = b;
        indices[ip++] = b; indices[ip++] = c; indices[ip++] = d2;
      }
    }
    return { data: verts, indices: indices, indexCount: ip, gridSize: n };
  };

  // ------------------------------------------------------------ the dock
  World.prototype.placeDock = function () {
    // Walk outward along -Z until we break the surface: that's our shoreline.
    var dirX = 0, dirZ = -1;
    var r = 20, shore = null;
    while (r < 260) {
      var h = this.sample(dirX * r, dirZ * r);
      if (h > 0.45) { shore = r; break; }
      r += 0.5;
    }
    if (shore === null) shore = 140;
    var length = 16;
    var startX = dirX * (shore + 1.5), startZ = dirZ * (shore + 1.5);
    // Dock geometry runs along local -Z, so rotate local -Z onto the inward dir.
    var inX = -dirX, inZ = -dirZ;
    var yaw = Math.atan2(-inX, -inZ);
    var deckY = Math.max(this.sample(startX, startZ), 0) + 0.72;
    return {
      x: startX, z: startZ, yaw: yaw, length: length, width: 2.4, deckY: deckY,
      dirX: inX, dirZ: inZ,
      endX: startX + inX * length, endZ: startZ + inZ * length
    };
  };

  // Is this point standing on the dock deck?
  World.prototype.onDock = function (dock, x, z) {
    var dx = x - dock.x, dz = z - dock.z;
    var along = dx * dock.dirX + dz * dock.dirZ;
    var side = dx * -dock.dirZ + dz * dock.dirX;
    return along > -0.6 && along < dock.length + 0.2 && Math.abs(side) < dock.width / 2 + 0.05;
  };

  // ----------------------------------------------------------- scattering
  World.prototype.scatter = function (dock) {
    var rng = M.mulberry32(this.seed ^ 0x9e3779b9);
    var out = { trees: [], bushes: [], rocks: [], reeds: [], pads: [] };
    var nrm = [0, 0, 0];
    var i, x, z, h, ang, r;

    // Forest: patchy, only on gentle land, thinning at altitude.
    var attempts = 26000;
    for (i = 0; i < attempts; i++) {
      ang = rng() * M.TAU;
      r = 118 + Math.pow(rng(), 0.62) * 340;
      x = Math.cos(ang) * r; z = Math.sin(ang) * r;
      h = this.sample(x, z);
      if (h < 1.2 || h > 62) continue;
      this.normalAt(x, z, nrm);
      if (nrm[1] < 0.72) continue;
      var patch = M.fbm2(x * 0.006 + 17.0, z * 0.006 - 5.0, 3) * 0.5 + 0.5;
      var alt = 1 - M.smoothstep(34, 60, h);
      if (rng() > patch * 1.35 * alt) continue;
      // Keep a clearing around the dock so the view is not walled off.
      if (Math.hypot(x - dock.x, z - dock.z) < 16) continue;
      var conifer = (h > 22 || rng() < 0.45) ? 1 : 0;
      out.trees.push({
        x: x, y: h - 0.25, z: z,
        s: M.randRange(rng, 0.75, 1.35) * (conifer ? 1.0 : 0.95),
        rot: rng() * M.TAU,
        tint: 0.82 + rng() * 0.34,
        variant: conifer ? ((rng() * 3) | 0) : 3 + ((rng() * 3) | 0)
      });
      if (out.trees.length > 2900) break;
    }

    for (i = 0; i < 9000; i++) {
      ang = rng() * M.TAU;
      r = 112 + Math.pow(rng(), 0.7) * 190;
      x = Math.cos(ang) * r; z = Math.sin(ang) * r;
      h = this.sample(x, z);
      if (h < 0.35 || h > 30) continue;
      this.normalAt(x, z, nrm);
      if (nrm[1] < 0.78) continue;
      out.bushes.push({
        x: x, y: h - 0.15, z: z, s: M.randRange(rng, 0.6, 1.5),
        rot: rng() * M.TAU, tint: 0.8 + rng() * 0.4,
        variant: (rng() * 2) | 0
      });
      if (out.bushes.length > 1100) break;
    }

    for (i = 0; i < 9000; i++) {
      ang = rng() * M.TAU;
      r = 60 + Math.pow(rng(), 0.6) * 300;
      x = Math.cos(ang) * r; z = Math.sin(ang) * r;
      h = this.sample(x, z);
      if (h < -6 || h > 70) continue;
      var steep = 0; this.normalAt(x, z, nrm); steep = 1 - nrm[1];
      if (rng() > 0.18 + steep * 2.2) continue;
      out.rocks.push({
        x: x, y: h - M.randRange(rng, 0.1, 0.5), z: z,
        s: M.randRange(rng, 0.5, 2.6) * (h > 30 ? 1.6 : 1.0),
        rot: rng() * M.TAU, tint: 0.75 + rng() * 0.5,
        variant: (rng() * 3) | 0
      });
      if (out.rocks.length > 1100) break;
    }

    // Reeds ring the shallows; lily pads sit in the calm bays.
    for (i = 0; i < 26000; i++) {
      ang = rng() * M.TAU;
      r = 90 + rng() * 90;
      x = Math.cos(ang) * r; z = Math.sin(ang) * r;
      h = this.sample(x, z);
      if (h < -1.35 || h > 0.35) continue;
      if (Math.hypot(x - dock.x, z - dock.z) < 7) continue;
      var clump = M.fbm2(x * 0.05 + 61.0, z * 0.05 + 12.0, 3) * 0.5 + 0.5;
      if (rng() > clump * 1.5) continue;
      out.reeds.push({
        x: x, y: Math.min(h, -0.05), z: z, s: M.randRange(rng, 0.7, 1.5),
        rot: rng() * M.TAU, tint: 0.8 + rng() * 0.4,
        variant: (rng() * 3) | 0
      });
      if (out.reeds.length > 1300) break;
    }

    for (i = 0; i < 14000; i++) {
      ang = rng() * M.TAU;
      r = 70 + rng() * 95;
      x = Math.cos(ang) * r; z = Math.sin(ang) * r;
      h = this.sample(x, z);
      if (h < -2.4 || h > -0.45) continue;
      var pad = M.fbm2(x * 0.035 - 22.0, z * 0.035 + 44.0, 3) * 0.5 + 0.5;
      if (rng() > pad * 0.9) continue;
      out.pads.push({
        x: x, y: 0, z: z, s: M.randRange(rng, 0.7, 1.3),
        rot: rng() * M.TAU, tint: 0.85 + rng() * 0.3,
        variant: (rng() * 3) | 0
      });
      if (out.pads.length > 420) break;
    }

    return out;
  };

  // Pick a spawn point: the end of the dock, looking down the lake.
  /* ==================================================================== */
  /*  FISHING SPOTS                                                       */
  /*  Found by reading the generated heightmap, not placed by hand — so    */
  /*  every one of them is a real feature of the lake bed you can see.     */
  /* ==================================================================== */

  var SPOT_KINDS = {
    deep: {
      name: 'The Cauldron', icon: '🕳️',
      desc: 'The deepest water in the lake. Cold, dark, and where the old fish go to sulk.',
      hint: 'Deep jigs and glow. Sturgeon, walleye, catfish — and something else after midnight.',
      bias: { sturgeon: 3.4, moonfin: 3.8, walleye: 2.2, catfish: 2.4, brown: 1.8, crappie: 1.2 }
    },
    dropoff: {
      name: 'The Drop-Off', icon: '📐',
      desc: 'The bottom falls away here in a few metres. Predators patrol the edge.',
      hint: 'Work the lip. Smallmouth, walleye and brown trout hunt the break.',
      bias: { smallmouth: 2.6, walleye: 2.2, brown: 2.0, rainbow: 1.7, crappie: 1.5, pike: 1.3 }
    },
    flat: {
      name: 'The Weed Flat', icon: '🌾',
      desc: 'A broad shallow shelf, soft-bottomed and thick with growth.',
      hint: 'Ambush country. Largemouth, pike and pickerel sit in it all day.',
      bias: { largemouth: 2.8, pike: 2.4, pickerel: 2.4, carp: 2.0, bluegill: 1.8, koi: 1.6 }
    },
    hump: {
      name: 'The Sunken Hump', icon: '⛰️',
      desc: 'A rise on the bottom with deep water all around it. Classic structure.',
      hint: 'Bait stacks up over the top. Smallmouth, walleye and the odd musky.',
      bias: { smallmouth: 2.8, walleye: 2.0, musky: 2.2, perch: 1.8, rainbow: 1.5 }
    },
    shelf: {
      name: 'The Shelf', icon: '🪨',
      desc: 'A flat bench at mid depth, out of the wind and out of the sun.',
      hint: 'Steady middling water. Crappie, perch and trout hold here.',
      bias: { crappie: 2.4, perch: 2.2, rainbow: 1.9, smallmouth: 1.6, brown: 1.4 }
    },
    reeds: {
      name: 'Reed Bay', icon: '🪷',
      desc: 'Thick cattails in a sheltered corner. Warm, shallow, full of life.',
      hint: 'Panfish paradise, and the bass that eat them.',
      bias: { bluegill: 3.0, largemouth: 2.4, pickerel: 2.2, perch: 1.8, koi: 2.0, carp: 1.6 }
    },
    point: {
      name: 'Heron Point', icon: '🪶',
      desc: 'A finger of land reaching out into the lake, with current curling around the tip.',
      hint: 'Fish stack on the point. Everything moves past it eventually.',
      bias: { smallmouth: 2.2, pike: 2.0, musky: 2.0, largemouth: 1.8, walleye: 1.6 }
    },
    dock: {
      name: 'The Old Dock', icon: '🪵',
      desc: 'Shade, pilings and a century of dropped bait. Where everyone starts.',
      hint: 'Reliable panfish. Nothing enormous, but always something.',
      bias: { bluegill: 2.4, crappie: 2.0, perch: 1.9, largemouth: 1.5, carp: 1.4 }
    }
  };

  World.prototype.findSpots = function (dock, props) {
    var self = this;
    var spots = [];

    function add(kind, x, z, radius) {
      var k = SPOT_KINDS[kind];
      spots.push({
        id: kind, kind: kind, name: k.name, icon: k.icon,
        desc: k.desc, hint: k.hint, bias: k.bias,
        x: x, z: z, radius: radius, depth: self.depthAt(x, z)
      });
    }
    // Spots have to be distinct places, not eight labels on one patch of water.
    function clear(x, z, minSep) {
      for (var i = 0; i < spots.length; i++) {
        if (Math.hypot(spots[i].x - x, spots[i].z - z) < minSep) return false;
      }
      return true;
    }

    // --- coarse survey of the lake bed
    var cells = [];
    var STEP = 5;
    for (var x = -168; x <= 168; x += STEP) {
      for (var z = -168; z <= 168; z += STEP) {
        var h = this.sample(x, z);
        if (h > -0.7) continue;
        var gx = (this.sample(x + 9, z) - this.sample(x - 9, z)) / 18;
        var gz = (this.sample(x, z + 9) - this.sample(x, z - 9)) / 18;
        // Relief: how much shallower this is than the ring of water around it.
        var ring = 0;
        for (var a = 0; a < 8; a++) {
          var an = a / 8 * M.TAU;
          ring += this.sample(x + Math.cos(an) * 16, z + Math.sin(an) * 16);
        }
        ring /= 8;
        cells.push({
          x: x, z: z, depth: -h, grad: Math.hypot(gx, gz), relief: h - ring
        });
      }
    }
    if (!cells.length) return spots;

    function best(score) {
      var top = null, topScore = -1e9;
      for (var i = 0; i < cells.length; i++) {
        var v = score(cells[i]);
        if (v > topScore) { topScore = v; top = cells[i]; }
      }
      return topScore > -1e8 ? top : null;
    }

    // The dock is a known spot from the first second of play.
    add('dock', dock.endX, dock.endZ, 15);

    // Deepest water anywhere.
    var c = best(function (q) { return q.depth; });
    if (c) add('deep', c.x, c.z, 26);

    // Steepest slope at fishable depth, well away from the hole.
    c = best(function (q) {
      if (q.depth < 3 || q.depth > 15) return -1e9;
      if (!clear(q.x, q.z, 46)) return -1e9;
      return q.grad;
    });
    if (c) add('dropoff', c.x, c.z, 20);

    // A rise with deep water around it.
    c = best(function (q) {
      if (q.depth < 2.5 || q.depth > 12) return -1e9;
      if (!clear(q.x, q.z, 42)) return -1e9;
      return q.relief;
    });
    if (c && c.relief > 0.8) add('hump', c.x, c.z, 18);

    // Broad, flat, shallow: the weed flat.
    c = best(function (q) {
      if (q.depth < 1.4 || q.depth > 5.0) return -1e9;
      if (!clear(q.x, q.z, 42)) return -1e9;
      return -q.grad;
    });
    if (c) add('flat', c.x, c.z, 26);

    // Flat bench at middling depth.
    c = best(function (q) {
      if (q.depth < 5 || q.depth > 10) return -1e9;
      if (!clear(q.x, q.z, 42)) return -1e9;
      return -q.grad;
    });
    if (c) add('shelf', c.x, c.z, 22);

    // Reed Bay: the densest cluster of the reeds we actually scattered.
    if (props && props.reeds && props.reeds.length) {
      var bestReed = null, bestCount = 0;
      for (var r = 0; r < props.reeds.length; r += 7) {
        var rd = props.reeds[r], count = 0;
        for (var q2 = 0; q2 < props.reeds.length; q2 += 3) {
          var o = props.reeds[q2];
          if (Math.hypot(o.x - rd.x, o.z - rd.z) < 22) count++;
        }
        if (count > bestCount) { bestCount = count; bestReed = rd; }
      }
      if (bestReed) {
        // Sit the marker a little out from the reeds, in fishable water.
        var inx = -bestReed.x, inz = -bestReed.z;
        var il = Math.hypot(inx, inz) || 1;
        var rx = bestReed.x + inx / il * 10, rz = bestReed.z + inz / il * 10;
        for (var g = 0; g < 20 && this.depthAt(rx, rz) < 1.0; g++) {
          rx += inx / il * 3; rz += inz / il * 3;
        }
        if (clear(rx, rz, 34)) add('reeds', rx, rz, 20);
      }
    }

    // Heron Point: where land pushes furthest into the lake.
    var minR = 1e9, minAng = 0;
    for (var t = 0; t < 240; t++) {
      var ang2 = t / 240 * M.TAU;
      var cx = Math.cos(ang2), cz = Math.sin(ang2);
      var rr = 20;
      while (rr < 200 && this.sample(cx * rr, cz * rr) < 0.35) rr += 1.0;
      if (rr < minR) { minR = rr; minAng = ang2; }
    }
    if (minR < 190) {
      var px = Math.cos(minAng) * (minR - 13), pz = Math.sin(minAng) * (minR - 13);
      for (var g2 = 0; g2 < 20 && this.depthAt(px, pz) < 1.2; g2++) {
        px -= Math.cos(minAng) * 2.5; pz -= Math.sin(minAng) * 2.5;
      }
      if (clear(px, pz, 34)) add('point', px, pz, 18);
    }

    for (var i2 = 0; i2 < spots.length; i2++) spots[i2].depth = this.depthAt(spots[i2].x, spots[i2].z);
    return spots;
  };

  World.prototype.spotAt = function (spots, x, z) {
    var best = null, bestD = 1e9;
    for (var i = 0; i < spots.length; i++) {
      var s = spots[i];
      var d = Math.hypot(s.x - x, s.z - z);
      if (d < s.radius && d < bestD) { bestD = d; best = s; }
    }
    return best;
  };

  World.prototype.spawn = function (dock) {
    return {
      x: dock.x + dock.dirX * (dock.length - 2.0),
      z: dock.z + dock.dirZ * (dock.length - 2.0),
      // Camera convention: forward = (-sin(yaw), 0, -cos(yaw)).
      yaw: Math.atan2(-dock.dirX, -dock.dirZ)
    };
  };

  DC.World = World;
  DC.SPOT_KINDS = SPOT_KINDS;
  DC.WORLD_EXTENT = EXTENT;
})(DC);
