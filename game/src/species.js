/* =========================================================================
   DEEP CAST — species.js
   The fish table, the tackle shop, and the rules that decide what bites.
   Tuning knobs live here; the AI in entities.js just reads them.
   ========================================================================= */
(function (DC) {
  'use strict';

  var M = DC.M;

  // Rarity tiers drive colour, value and the noise the game makes when you
  // land one. Index matches `rarity` on each species.
  var RARITY = [
    { name: 'Common', color: '#9fb2c4', value: 20 },
    { name: 'Uncommon', color: '#5fd08a', value: 46 },
    { name: 'Rare', color: '#5aa8ff', value: 105 },
    { name: 'Epic', color: '#c07bff', value: 240 },
    { name: 'Legendary', color: '#ffb545', value: 560 },
    { name: 'Mythic', color: '#ff5f9e', value: 1300 }
  ];

  /* Lures. `depth` is how deep the rig fishes (metres below the surface),
     `radius` is how far it pulls fish in from, `noise` is how much it spooks
     the timid ones. Species affinities are looked up by lure id. */
  var LURES = [
    {
      id: 'worm', name: 'Nightcrawler', icon: '🪱', cost: 0, depth: 1.6, radius: 9,
      noise: 0.2, patience: 1.15,
      desc: 'The honest classic. Everything eats a worm — just not always the big stuff.'
    },
    {
      id: 'spinner', name: 'Spinner', icon: '🌀', cost: 220, depth: 2.6, radius: 13,
      noise: 0.55, patience: 0.9,
      desc: 'Flash and vibration. Predators track it from a long way off.'
    },
    {
      id: 'popper', name: 'Topwater Popper', icon: '💥', cost: 480, depth: 0.35, radius: 15,
      noise: 0.85, patience: 0.75,
      desc: 'Works the surface film. Explosive strikes at dawn and dusk.'
    },
    {
      id: 'jig', name: 'Deep Jig', icon: '⚓', cost: 760, depth: 7.5, radius: 12,
      noise: 0.3, patience: 1.0,
      desc: 'Drops into the cold water where the heavy fish sulk.'
    },
    {
      id: 'fly', name: 'Dry Fly', icon: '🪶', cost: 640, depth: 0.2, radius: 10,
      noise: 0.1, patience: 1.3,
      desc: 'Barely dents the surface. Trout adore it, nothing else notices.'
    },
    {
      id: 'glow', name: 'Glow Jig', icon: '🔦', cost: 1500, depth: 9.5, radius: 16,
      noise: 0.35, patience: 1.05, night: true,
      desc: 'Charged phosphor. After dark, in deep water, it is unfair.'
    },
    {
      id: 'minnow', name: 'Live Minnow', icon: '🐟', cost: 2600, depth: 4.5, radius: 18,
      noise: 0.45, patience: 1.2,
      desc: 'Nothing beats the real thing. Brings the apex fish out of the weeds.'
    }
  ];

  /* Rods. Line strength sets how much tension you can hold, reel speed sets
     how fast you gain line, and `cast` scales throw distance. */
  var RODS = [
    {
      id: 'starter', name: 'Old Faithful', cost: 0, line: 1.0, reel: 1.0, cast: 1.0, sens: 1.0,
      desc: 'Fibreglass, chipped cork, sentimental value. It has landed worse.'
    },
    {
      id: 'graphite', name: 'Graphite Mk II', cost: 1200, line: 1.35, reel: 1.15, cast: 1.18, sens: 1.15,
      desc: 'Light, fast, forgiving. The obvious first upgrade.'
    },
    {
      id: 'baitcast', name: 'Baitcaster Pro', cost: 4800, line: 1.8, reel: 1.35, cast: 1.4, sens: 1.3,
      desc: 'Serious drag system. Big fish stop feeling like a disaster.'
    },
    {
      id: 'surf', name: 'Longcaster 12', cost: 12000, line: 2.3, reel: 1.5, cast: 1.9, sens: 1.4,
      desc: 'Twelve feet of leverage. Reaches the far shelf from the dock.'
    },
    {
      id: 'abyss', name: 'Abyssal Rig', cost: 34000, line: 3.4, reel: 1.8, cast: 1.7, sens: 1.7,
      desc: 'Braided line rated for things that should not be in a lake.'
    }
  ];

  /* Time-of-day activity weights, sampled from a 4-slot curve:
     [night, dawn, day, dusk]. Blended smoothly by the clock. */
  function actAt(curve, hour) {
    // Slot centres: night 1:00, dawn 6:30, day 13:00, dusk 19:30.
    var centres = [1, 6.5, 13, 19.5];
    var best = 0, total = 0;
    for (var i = 0; i < 4; i++) {
      var d = Math.abs(M.angDiff(centres[i] / 24 * M.TAU, hour / 24 * M.TAU)) / M.TAU * 24;
      var w = Math.exp(-(d * d) / 18);
      best += curve[i] * w;
      total += w;
    }
    return best / Math.max(total, 1e-4);
  }

  var SPECIES = [
    {
      id: 'bluegill', name: 'Bluegill', latin: 'Lepomis macrochirus', rarity: 0,
      kg: [0.05, 0.55], depth: [0.3, 3.5], act: [0.2, 0.9, 1.0, 0.8],
      lures: { worm: 1.6, fly: 1.2, spinner: 0.5, popper: 0.6, jig: 0.2, glow: 0.1, minnow: 0.3 },
      dorsal: [0.16, 0.34, 0.36], belly: [0.86, 0.62, 0.22], fin: [0.10, 0.22, 0.30],
      body: [0.78, 1.30, 0.72], fight: { strength: 0.35, stamina: 0.4, runs: 0.7, shake: 1.4 },
      desc: 'Palm-sized, endlessly curious, and the reason most people learn to fish.'
    },
    {
      id: 'perch', name: 'Yellow Perch', latin: 'Perca flavescens', rarity: 0,
      kg: [0.1, 0.9], depth: [1.0, 6.0], act: [0.2, 1.0, 0.9, 0.9],
      lures: { worm: 1.4, spinner: 1.1, minnow: 1.0, jig: 0.7, fly: 0.4, popper: 0.3, glow: 0.4 },
      dorsal: [0.36, 0.30, 0.10], belly: [0.92, 0.78, 0.30], fin: [0.85, 0.42, 0.12],
      body: [0.95, 1.05, 0.78], fight: { strength: 0.4, stamina: 0.45, runs: 0.8, shake: 1.2 },
      desc: 'Travels in packs. Where there is one, there are forty.'
    },
    {
      id: 'crappie', name: 'Black Crappie', latin: 'Pomoxis nigromaculatus', rarity: 0,
      kg: [0.15, 1.4], depth: [1.5, 7.0], act: [0.5, 1.0, 0.6, 1.0],
      lures: { minnow: 1.5, jig: 1.2, spinner: 0.9, worm: 0.9, glow: 0.7, fly: 0.4, popper: 0.3 },
      dorsal: [0.22, 0.26, 0.26], belly: [0.82, 0.84, 0.80], fin: [0.30, 0.34, 0.32],
      body: [0.85, 1.35, 0.62], fight: { strength: 0.42, stamina: 0.5, runs: 0.9, shake: 1.0 },
      desc: 'Paper-mouthed. Pull too hard and the hook tears straight out.'
    },
    {
      id: 'carp', name: 'Common Carp', latin: 'Cyprinus carpio', rarity: 1,
      kg: [1.2, 14.0], depth: [0.8, 5.0], act: [0.5, 0.9, 1.0, 0.7],
      lures: { worm: 1.5, jig: 0.8, spinner: 0.3, minnow: 0.4, fly: 0.3, popper: 0.2, glow: 0.4 },
      dorsal: [0.34, 0.26, 0.12], belly: [0.78, 0.66, 0.36], fin: [0.42, 0.30, 0.14],
      body: [1.15, 1.20, 0.92], fight: { strength: 1.15, stamina: 1.5, runs: 0.6, shake: 0.5 },
      desc: 'Bulldozer of the shallows. No acrobatics, just relentless weight.'
    },
    {
      id: 'largemouth', name: 'Largemouth Bass', latin: 'Micropterus salmoides', rarity: 1,
      kg: [0.5, 6.5], depth: [0.5, 4.5], act: [0.4, 1.0, 0.6, 1.0],
      lures: { popper: 1.7, spinner: 1.3, minnow: 1.4, worm: 1.0, jig: 0.8, fly: 0.5, glow: 0.6 },
      dorsal: [0.16, 0.28, 0.14], belly: [0.86, 0.86, 0.70], fin: [0.20, 0.32, 0.18],
      body: [1.05, 1.18, 0.82], fight: { strength: 0.95, stamina: 0.9, runs: 1.2, shake: 1.6 },
      desc: 'Ambush artist. Hits the lure like it owes money, then jumps.'
    },
    {
      id: 'smallmouth', name: 'Smallmouth Bass', latin: 'Micropterus dolomieu', rarity: 1,
      kg: [0.4, 4.2], depth: [2.0, 8.0], act: [0.4, 1.0, 0.7, 0.95],
      lures: { spinner: 1.5, jig: 1.2, minnow: 1.2, popper: 1.0, worm: 0.9, fly: 0.7, glow: 0.6 },
      dorsal: [0.36, 0.28, 0.14], belly: [0.88, 0.84, 0.66], fin: [0.40, 0.32, 0.18],
      body: [1.0, 1.12, 0.80], fight: { strength: 1.0, stamina: 1.1, runs: 1.4, shake: 1.5 },
      desc: 'Pound for pound the hardest fighter in fresh water. Ask anyone.'
    },
    {
      id: 'pickerel', name: 'Chain Pickerel', latin: 'Esox niger', rarity: 1,
      kg: [0.4, 3.2], depth: [0.5, 3.5], act: [0.3, 1.0, 0.8, 0.9],
      lures: { spinner: 1.6, minnow: 1.4, popper: 1.1, jig: 0.6, worm: 0.6, fly: 0.5, glow: 0.4 },
      dorsal: [0.24, 0.32, 0.16], belly: [0.86, 0.82, 0.58], fin: [0.30, 0.34, 0.18],
      body: [1.45, 0.92, 0.68], fight: { strength: 0.8, stamina: 0.8, runs: 1.5, shake: 1.7 },
      desc: 'All teeth and bad intentions, wrapped in a green ribbon.'
    },
    {
      id: 'rainbow', name: 'Rainbow Trout', latin: 'Oncorhynchus mykiss', rarity: 2,
      kg: [0.4, 5.5], depth: [2.0, 9.0], act: [0.4, 1.2, 0.7, 1.0],
      lures: { fly: 1.9, spinner: 1.3, worm: 0.9, minnow: 0.9, jig: 0.7, glow: 0.5, popper: 0.6 },
      dorsal: [0.24, 0.34, 0.40], belly: [0.92, 0.90, 0.88], fin: [0.72, 0.36, 0.44],
      body: [1.15, 1.02, 0.74], fight: { strength: 0.9, stamina: 1.2, runs: 1.6, shake: 1.3 },
      desc: 'A stripe of sunset down each flank. Fussy, fast, worth the effort.'
    },
    {
      id: 'brown', name: 'Brown Trout', latin: 'Salmo trutta', rarity: 2,
      kg: [0.8, 9.0], depth: [3.0, 12.0], act: [1.1, 1.0, 0.4, 1.1],
      lures: { fly: 1.6, minnow: 1.4, spinner: 1.2, jig: 0.9, glow: 1.0, worm: 0.8, popper: 0.6 },
      dorsal: [0.34, 0.26, 0.14], belly: [0.90, 0.82, 0.52], fin: [0.52, 0.34, 0.16],
      body: [1.18, 1.02, 0.76], fight: { strength: 1.1, stamina: 1.3, runs: 1.3, shake: 1.2 },
      desc: 'Old, clever, and nocturnal. The big ones did not get big by being brave.'
    },
    {
      id: 'walleye', name: 'Walleye', latin: 'Sander vitreus', rarity: 2,
      kg: [0.7, 8.0], depth: [4.0, 13.0], act: [1.4, 0.9, 0.25, 1.2],
      lures: { glow: 1.8, jig: 1.4, minnow: 1.3, spinner: 1.0, worm: 0.7, fly: 0.2, popper: 0.3 },
      dorsal: [0.36, 0.32, 0.16], belly: [0.90, 0.86, 0.66], fin: [0.52, 0.46, 0.20],
      body: [1.25, 1.0, 0.72], fight: { strength: 1.0, stamina: 1.0, runs: 0.9, shake: 0.8 },
      desc: 'Those glassy eyes are built for the dark. Fish for them at midnight.'
    },
    {
      id: 'catfish', name: 'Channel Catfish', latin: 'Ictalurus punctatus', rarity: 2,
      kg: [1.0, 16.0], depth: [4.0, 14.0], act: [1.4, 0.8, 0.4, 1.0],
      lures: { worm: 1.6, jig: 1.4, minnow: 1.3, glow: 1.1, spinner: 0.4, fly: 0.1, popper: 0.2 },
      dorsal: [0.26, 0.24, 0.22], belly: [0.84, 0.80, 0.70], fin: [0.30, 0.28, 0.26],
      body: [1.30, 1.00, 0.90], fight: { strength: 1.4, stamina: 1.7, runs: 0.5, shake: 0.6 },
      desc: 'Sits on the bottom feeling the whole lake through its whiskers.'
    },
    {
      id: 'pike', name: 'Northern Pike', latin: 'Esox lucius', rarity: 3,
      kg: [1.5, 18.0], depth: [1.0, 6.0], act: [0.5, 1.3, 0.8, 1.1],
      lures: { minnow: 1.8, spinner: 1.5, popper: 1.1, jig: 0.8, worm: 0.5, glow: 0.7, fly: 0.4 },
      dorsal: [0.20, 0.30, 0.18], belly: [0.88, 0.86, 0.62], fin: [0.60, 0.36, 0.20],
      body: [1.60, 0.95, 0.70], fight: { strength: 1.5, stamina: 1.2, runs: 1.8, shake: 1.9 },
      desc: 'A torpedo with a mouthful of needles. Check your leader.'
    },
    {
      id: 'sturgeon', name: 'Lake Sturgeon', latin: 'Acipenser fulvescens', rarity: 4,
      kg: [8.0, 70.0], depth: [8.0, 18.0], act: [1.0, 0.9, 0.8, 0.9],
      lures: { jig: 1.7, glow: 1.4, worm: 1.2, minnow: 1.1, spinner: 0.3, fly: 0.1, popper: 0.1 },
      dorsal: [0.28, 0.28, 0.24], belly: [0.78, 0.76, 0.68], fin: [0.34, 0.34, 0.30],
      body: [1.85, 0.95, 0.85], fight: { strength: 2.4, stamina: 2.6, runs: 0.8, shake: 0.4 },
      desc: 'Older than the trees around this lake. Armour-plated, and it knows.'
    },
    {
      id: 'musky', name: 'Muskellunge', latin: 'Esox masquinongy', rarity: 4,
      kg: [5.0, 32.0], depth: [2.0, 9.0], act: [0.6, 1.1, 0.7, 1.4],
      lures: { minnow: 2.0, spinner: 1.4, popper: 1.2, jig: 0.9, glow: 0.8, worm: 0.3, fly: 0.3 },
      dorsal: [0.30, 0.32, 0.18], belly: [0.88, 0.84, 0.60], fin: [0.55, 0.34, 0.18],
      body: [1.70, 0.98, 0.72], fight: { strength: 2.0, stamina: 1.8, runs: 2.0, shake: 2.0 },
      desc: 'The fish of ten thousand casts. You will believe it after nine thousand.'
    },
    {
      id: 'koi', name: 'Wandering Koi', latin: 'Cyprinus rubrofuscus', rarity: 5,
      kg: [2.0, 12.0], depth: [0.5, 4.0], act: [0.3, 1.4, 1.2, 0.8],
      lures: { worm: 1.4, fly: 1.2, popper: 0.9, spinner: 0.6, jig: 0.6, minnow: 0.5, glow: 0.4 },
      dorsal: [0.94, 0.38, 0.10], belly: [0.98, 0.96, 0.92], fin: [0.98, 0.62, 0.20],
      body: [1.10, 1.22, 0.92], fight: { strength: 1.3, stamina: 1.6, runs: 0.8, shake: 0.7 },
      desc: 'Nobody stocked it. Nobody can explain it. It has been here a while.'
    },
    {
      id: 'moonfin', name: 'Moonfin', latin: 'Selenichthys nocturna', rarity: 5,
      kg: [4.0, 28.0], depth: [10.0, 20.0], act: [2.0, 0.2, 0.0, 0.4],
      lures: { glow: 2.4, jig: 1.1, minnow: 0.8, worm: 0.3, spinner: 0.4, fly: 0.1, popper: 0.1 },
      dorsal: [0.30, 0.44, 0.86], belly: [0.86, 0.92, 1.0], fin: [0.55, 0.72, 1.0],
      body: [1.30, 1.15, 0.70], fight: { strength: 1.9, stamina: 2.2, runs: 1.7, shake: 1.1 },
      glow: 1.0,
      desc: 'Only ever seen under a glow jig, deep, after midnight. It looks back at you.'
    }
  ];

  var BY_ID = {};
  SPECIES.forEach(function (s, i) {
    s.index = i;
    s.value = RARITY[s.rarity].value;
    BY_ID[s.id] = s;
  });
  var LURE_BY_ID = {}; LURES.forEach(function (l) { LURE_BY_ID[l.id] = l; });
  var ROD_BY_ID = {}; RODS.forEach(function (r) { ROD_BY_ID[r.id] = r; });

  /**
   * How likely is this species to show interest right now?
   * Combines time of day, weather, water depth at the lure, and lure type.
   * Returns a raw weight; callers normalise.
   */
  function appeal(sp, ctx) {
    var w = 1;
    w *= 1 / (1 + sp.rarity * 1.35);                       // rarity gate
    w *= Math.pow(actAt(sp.act, ctx.hour), 1.25);          // time of day
    var lureMul = sp.lures[ctx.lure.id];
    w *= (lureMul === undefined ? 0.5 : lureMul);
    // Depth match: full credit inside the band, falling off outside it.
    var d = ctx.depth;
    if (d < sp.depth[0]) w *= Math.exp(-Math.pow((sp.depth[0] - d) / 2.4, 2));
    else if (d > sp.depth[1]) w *= Math.exp(-Math.pow((d - sp.depth[1]) / 3.2, 2));
    // Structure. Fishing the right spot is the biggest single lever there is.
    if (ctx.spot && ctx.spot.bias) {
      var b = ctx.spot.bias[sp.id];
      w *= (b === undefined ? 0.50 : b);
    }
    // Weather.
    if (ctx.weather === 'rain') w *= (sp.rarity >= 2 ? 1.35 : 1.1);
    if (ctx.weather === 'fog') w *= (sp.rarity >= 3 ? 1.5 : 0.9);
    if (ctx.weather === 'storm') w *= (sp.rarity >= 3 ? 1.7 : 0.75);
    return Math.max(w, 0.0001);
  }

  // Roll a size. Big fish are rare; luck (from gear/level) skews the curve.
  function rollWeight(sp, rng, luck) {
    var t = rng();
    var skew = 2.6 - M.sat(luck) * 1.3;   // lower exponent => bigger fish
    t = Math.pow(t, skew);
    // Rare "trophy" spike.
    if (rng() < 0.035 + 0.05 * M.sat(luck)) t = M.lerp(t, 1, 0.75 + rng() * 0.25);
    return M.lerp(sp.kg[0], sp.kg[1], t);
  }

  // Length follows the usual W = a*L^3 relationship, inverted.
  function lengthFor(sp, kg) {
    var slender = sp.body[0];
    var a = 0.0000098 * (1.35 / slender);
    return Math.pow(kg / a, 1 / 3.02);   // centimetres
  }

  // Sublinear in weight so a 40 kg sturgeon is a payday, not a game-ender.
  function valueOf(sp, kg) {
    return Math.round(sp.value * (0.85 + Math.pow(kg, 0.7) * 0.8) * (1 + sp.rarity * 0.10));
  }

  // Fraction of this species' max size — drives the "trophy" tag.
  function trophyGrade(sp, kg) {
    return M.sat((kg - sp.kg[0]) / (sp.kg[1] - sp.kg[0]));
  }

  DC.Species = {
    RARITY: RARITY, LURES: LURES, RODS: RODS, SPECIES: SPECIES,
    byId: BY_ID, lureById: LURE_BY_ID, rodById: ROD_BY_ID,
    actAt: actAt, appeal: appeal, rollWeight: rollWeight,
    lengthFor: lengthFor, valueOf: valueOf, trophyGrade: trophyGrade
  };
})(DC);
