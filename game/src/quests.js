/* =========================================================================
   DEEP CAST — quests.js
   Commissions: a chain of concrete asks from the woman who runs the tackle
   shop. Each one names a thing to catch and a condition to catch it under,
   and between them they teach every system in the game in the order you
   need to learn it.

   A goal is a plain object of optional predicates. Everything present must
   match; anything absent is a don't-care. Adding a new condition means
   adding one line to `matches`, not a new goal type.
   ========================================================================= */
(function (DC) {
  'use strict';

  var M = DC.M;

  /* Conditions a goal may set:
       species    id, or an array of ids
       rarity     minimum rarity index
       minKg      minimum weight
       minGrade   minimum fraction of the species' maximum size (0..1)
       spot       spot id the lure must have been sitting on
       anySpot    true: must be on some named spot
       hours      [from, to] game hours, wrapping past midnight
       weather    id, or an array of ids
       lure       id, or an array of ids
       fromBoat   true: must have been hooked from the boat
       minRange   metres from the dock at the moment of the hookup
       count      how many qualifying fish (default 1)                   */
  var COMMISSIONS = [
    {
      id: 'first', title: 'Just catch something',
      from: 'Marguerite, Tackle & Bait',
      text: 'You look like you have never held a rod. Go on then — anything at all, ' +
        'off the end of my dock. A worm will do it.',
      goal: { count: 1 },
      reward: { money: 120, xp: 60 },
      teaches: 'casting'
    },
    {
      id: 'panfish', title: 'Three off the dock',
      from: 'Marguerite',
      text: 'Bring me three fish from the old dock. Any three. I want to know you ' +
        'can do it twice in a row, not once by accident.',
      goal: { spot: 'dock', count: 3 },
      reward: { money: 260, xp: 110 },
      teaches: 'the spot system'
    },
    {
      id: 'bass', title: 'A proper bass',
      from: 'Marguerite',
      text: 'A largemouth over a kilo. They sit in the shallow weed and hit things ' +
        'off the surface — a popper or a spinner, first light or last.',
      goal: { species: ['largemouth', 'smallmouth'], minKg: 1.0, count: 1 },
      reward: { money: 480, xp: 180, unlock: 'spinner' },
      teaches: 'lure choice'
    },
    {
      id: 'offshore', title: 'Get off the dock',
      from: 'Marguerite',
      text: 'The boat is not an ornament. Row out — properly out, eighty metres or ' +
        'more — drop the anchor, and bring me back whatever takes it.',
      goal: { fromBoat: true, minRange: 80, count: 1 },
      reward: { money: 620, xp: 240 },
      teaches: 'the boat'
    },
    {
      id: 'structure', title: 'Learn the bottom',
      from: 'Marguerite',
      text: 'Find me three fish off three different marked spots. Not the dock. ' +
        'The lake has shape to it and you should know where.',
      goal: { anySpot: true, excludeSpot: 'dock', distinctSpots: 3, count: 3 },
      reward: { money: 900, xp: 360 },
      teaches: 'the chart'
    },
    {
      id: 'night', title: 'After dark',
      from: 'Marguerite',
      text: 'A walleye, and it has to be after dark. Those glassy eyes are built ' +
        'for it — they hunt when you cannot see your own hands.',
      goal: { species: 'walleye', hours: [21, 4], count: 1 },
      reward: { money: 1400, xp: 500, unlock: 'glow' },
      teaches: 'the clock'
    },
    {
      id: 'deep', title: 'The Cauldron',
      from: 'Marguerite',
      text: 'There is a hole out there deeper than the church is tall. Get a jig ' +
        'down into it and bring me anything that lives that far from the sun.',
      goal: { spot: 'deep', count: 1 },
      reward: { money: 1800, xp: 620 },
      teaches: 'deep water'
    },
    {
      id: 'pike', title: 'Something with teeth',
      from: 'Marguerite',
      text: 'A northern over six kilos. It will take line off you and it will not ' +
        'be polite about it. Back your drag off and let it run.',
      goal: { species: ['pike', 'pickerel', 'musky'], minKg: 6, count: 1 },
      reward: { money: 2800, xp: 900 },
      teaches: 'the fight'
    },
    {
      id: 'weather', title: 'Fish the weather',
      from: 'Marguerite',
      text: 'Everyone goes home when it rains. That is exactly when the good ones ' +
        'come up. Something rare or better, in the wet.',
      goal: { rarity: 2, weather: ['rain', 'storm'], count: 1 },
      reward: { money: 3600, xp: 1200 },
      teaches: 'weather'
    },
    {
      id: 'trophy', title: 'A wall fish',
      from: 'Marguerite',
      text: 'Not just big for you. Big for the species — the top tenth of what ' +
        'that fish can grow to. I will know if you fudge it.',
      goal: { minGrade: 0.90, count: 1 },
      reward: { money: 5200, xp: 1800 },
      teaches: 'patience'
    },
    {
      id: 'sturgeon', title: 'The old one',
      from: 'Marguerite',
      text: 'There is a sturgeon in that hole older than my grandmother. Twenty ' +
        'kilos at least. You will need line you can trust.',
      goal: { species: 'sturgeon', minKg: 20, count: 1 },
      reward: { money: 9000, xp: 3000 },
      teaches: 'gear'
    },
    {
      id: 'moonfin', title: 'The thing in the deep',
      from: 'Marguerite',
      text: 'People say there is something down there that looks back at you. ' +
        'Glow jig, the Cauldron, after midnight. Bring it up and I will believe you.',
      goal: { species: 'moonfin', count: 1 },
      reward: { money: 20000, xp: 8000 },
      teaches: 'everything'
    }
  ];

  function asList(v) { return v === undefined ? null : (Array.isArray(v) ? v : [v]); }

  function inHours(range, hour) {
    var a = range[0], b = range[1];
    return a <= b ? (hour >= a && hour < b) : (hour >= a || hour < b);
  }

  /**
   * Does this catch satisfy the goal?
   * `c` is the catch record built by Game.landFish.
   */
  function matches(goal, c) {
    var list;
    if ((list = asList(goal.species)) && list.indexOf(c.species.id) < 0) return false;
    if (goal.rarity !== undefined && c.species.rarity < goal.rarity) return false;
    if (goal.minKg !== undefined && c.kg < goal.minKg) return false;
    if (goal.minGrade !== undefined && c.grade < goal.minGrade) return false;
    if (goal.spot !== undefined && (!c.spot || c.spot.id !== goal.spot)) return false;
    if (goal.anySpot && !c.spot) return false;
    if (goal.excludeSpot && c.spot && c.spot.id === goal.excludeSpot) return false;
    if (goal.hours && !inHours(goal.hours, c.hour)) return false;
    if ((list = asList(goal.weather)) && list.indexOf(c.weather) < 0) return false;
    if ((list = asList(goal.lure)) && list.indexOf(c.lure.id) < 0) return false;
    if (goal.fromBoat && !c.fromBoat) return false;
    if (goal.minRange !== undefined && c.range < goal.minRange) return false;
    return true;
  }

  // One line a player can read at a glance in the HUD.
  function summarise(goal) {
    var bits = [];
    var sp = asList(goal.species);
    if (sp) {
      bits.push(sp.map(function (id) { return DC.Species.byId[id].name; }).join(' / '));
    } else if (goal.rarity !== undefined) {
      bits.push(DC.Species.RARITY[goal.rarity].name + ' or better');
    } else {
      bits.push('any fish');
    }
    if (goal.minKg !== undefined) bits.push('over ' + DC.F.weight(goal.minKg));
    if (goal.minGrade !== undefined) bits.push('top ' + Math.round((1 - goal.minGrade) * 100) + '% for size');
    if (goal.spot) bits.push('at ' + spotName(goal.spot));
    if (goal.distinctSpots) bits.push('from ' + goal.distinctSpots + ' different spots');
    else if (goal.anySpot) bits.push('on a marked spot');
    if (goal.hours) bits.push('between ' + DC.F.clock(goal.hours[0]) + ' and ' + DC.F.clock(goal.hours[1]));
    if (goal.weather) bits.push('in the ' + asList(goal.weather).join(' or '));
    if (goal.fromBoat) bits.push('from the boat');
    if (goal.minRange !== undefined) bits.push(goal.minRange + ' m+ from the dock');
    var s = bits.join(', ');
    if (goal.count > 1 && !goal.distinctSpots) s = goal.count + '× ' + s;
    return s;
  }

  function spotName(id) {
    var k = DC.SPOT_KINDS && DC.SPOT_KINDS[id];
    return k ? k.name : id;
  }

  DC.Quests = {
    LIST: COMMISSIONS,
    matches: matches,
    summarise: summarise,
    spotName: spotName,
    byId: (function () {
      var m = {};
      COMMISSIONS.forEach(function (q, i) { q.index = i; m[q.id] = q; });
      return m;
    })()
  };
})(DC);
