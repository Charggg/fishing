# DEEP CAST — Agent Logbook & Roadmap

My own working file. I read this at the start of every session, pick the most
valuable item, build it, verify it, and update this file. Newest work at the top
of each section.

**Current state: shippable.** The game boots, plays end to end, and survives the
QA harness clean. It is not yet *massive* or *addictive* — that is the job.

---

## 0. How I verify (do not skip)

| Tool | Command | What it proves |
|---|---|---|
| QA harness | `node game/qa/harness.js 3` | 60k+ simulated frames, invariant assertions, edge cases. Exits non-zero on failure. |
| Render smoke | `node game/qa/render-smoke.js` | Real boot, real clicks, all quality presets, save/reload, resize. Catches GL and DOM errors the sim harness can't. |
| Screenshots | `node game/qa/shots.js` | Eyes on it. Software rendering, so ignore the FPS numbers. |

**Rule:** never leave the tree with a failing harness. Run both before saying done.

---

## 1. Known bugs / debt

### Open
- [ ] `Tackle.state === 'retrieving'` is declared but never set — dead branch.
- [ ] The boat can pass straight through the dock pilings. Needs a cheap
      cylinder collision test against the piling positions.
- [ ] Row hard into a steep shore and the hull visually clips the bank before
      the depth test stops it. Collision should sample ahead of the bow, not at
      the centre of the boat.
- [ ] `lure.noise` is defined per-lure and never read. Either wire it into
      spook mechanics or delete it.
- [ ] `QUALITY.propDist` is dead config.
- [ ] `Ripples.spawn` when the pool is full does `this.n--`, silently killing
      the newest ripple instead of the oldest. Should be a proper ring buffer.
- [ ] Fish are hard to see under the surface at any distance. Contrast is
      physically honest and gameplay-hostile.
- [ ] Crappie are over-represented at every spot. Common + a wide depth band
      + listed in several biases. Consider narrowing their band.
- [ ] `doCast` reads the rod transform, which is derived from the camera, which
      `updatePlayer` owns. Anything that moves the player has to settle a frame
      first. Board/exit now do this explicitly; a future fast-travel must too.
- [ ] The reflection pass draws a fraction of prop instances on medium quality
      (`reflFrac`), which is a fixed prefix of the array, so the same trees are
      always missing. Should be a spatial choice, not an array slice.
- [ ] No frame-rate adaptive quality. A weak GPU just runs slowly forever.

### Fixed
- [x] **2026-07-28** `reelIn()` during a fight stranded the hooked fish
      invisible and permanently removed it from the shoal.
- [x] **2026-07-28** Field journal threw on a save that had a catch count but
      no record entry.
- [x] **2026-07-28** `requestPointerLock()` rejected an unhandled promise when
      the pointer was already locked.
- [x] **2026-07-28** Storm weather whited out the entire lake — whitecap
      thresholds were absolute instead of scaled by sea state.
- [x] **2026-07-28** Cloud layer was projected at ~100× too small a scale, so
      overcast and storm skies rendered as clear blue.
- [x] **2026-07-28** Reeds rendered as black sticks (edge-on normals under a
      high sun).
- [x] **2026-07-28** Catch portrait drew the head and tail on the same side.
- [x] **2026-07-28** `Audio.prototype.step` collided with the `this.step`
      music-sequencer counter.
- [x] **2026-07-28** `updateRod()` borrowed the renderer's camera-to-world
      matrix, so the rod was transformed by a stale camera on any frame that
      did not draw. Now derives the basis from the scene camera directly.
- [x] **2026-07-28** `!this.paused` guards inside `update()` were dead in the
      real loop but silently disabled all movement under headless simulation —
      which meant the QA harness's walking coverage was doing nothing at all.
- [x] **2026-07-28** An unattended boat drifted on the wind indefinitely and
      could strand itself mid-lake, unreachable. It now holds station unless
      someone is aboard with the anchor up.
- [x] **2026-07-28 (significant)** The bite roll matched species against the
      *water depth under the lure* instead of the depth the lure was fishing
      at. In shallow water the two are similar, so it never showed — but in the
      30 m deep hole every species scored ~1e-7 and the marquee location of the
      whole game was completely dead. Found only because the boat made deep
      water reachable. 0/14 casts before, 11/14 after.
- [x] **2026-07-28** Species selection used `max(appeal × random)`, which is so
      noisy that appeal barely mattered and whatever species was commonest
      nearby usually won. Replaced with weighted reservoir sampling (A-Res),
      which picks in true proportion to appeal.

---

## 2. Master plan

Ordered by how much each one changes the experience, not by how hard it is.

### Tier 1 — the game is currently missing these
1. **✅ The rowboat.** *(done 2026-07-28)* One dock was the whole game. The
   deep hole and the weed flat — the two structure features the whole
   depth/species system is built around — sat 40–70 m out, at the ragged edge
   of casting range. A boat makes the entire lake playable and turns "where you
   cast" from a claim in the README into an actual decision.
2. **✅ Named fishing spots + a chart.** *(done 2026-07-28)* Eight spots found
   by reading the generated heightmap — deepest hole, steepest drop-off, a
   sunken hump, a weed flat, a mid-depth shelf, the densest reed bay, the
   sharpest point of land, and the dock. Each biases both what spawns there and
   what bites. `M` opens a bathymetric chart drawn from the same heightmap.
3. **Goals that pull you forward.** Right now nothing asks anything of you.
   Add a chain of commissions from a local shop owner ("bring me a 2 kg+
   walleye caught after midnight"), each unlocking the next tier of gear.
4. **Sonar / fish finder.** A purchasable item that draws a depth-and-fish
   readout for the water in front of you. Turns blind casting into reading
   water. Pairs with the boat.

### Tier 2 — depth and replay value
5. **Structure that actually holds fish.** Sunken logs, weed beds, rock piles
   and drop-offs as real spawn attractors, visible underwater, so learning the
   lake pays off.
6. **Seasons.** A season counter that shifts water temperature, species
   activity curves, foliage colour and weather odds. Four seasons = four lakes.
7. **Tackle depth.** Line class (test strength vs visibility), hooks (hold vs
   strike window), and a bait/scent system. Real trade-offs, not just linear
   upgrades.
8. **Trophy room.** A physical cabin wall where your records mount, so the
   journal has a payoff beyond a number.
9. **Tournaments.** Timed events with a leaderboard against seeded AI anglers.

### Tier 3 — polish that makes it feel expensive
10. **Fight camera.** Pull back and orbit on a hookup; let the player see the
    fish they're fighting. Currently the drama is entirely in a HUD bar.
11. **Landing sequence.** A net, a lift, a held-up hero shot before the card.
12. **Photo mode.** Free camera, depth of field, filters, and a shareable
    canvas export.
13. **Shadows.** A single cascade sun shadow map. The scene reads flat without
    contact shadows under trees and the dock.
14. **Underwater camera.** Let the player dunk the view and watch the shoal.
15. **Birds, insects, rising fish, jumping bait balls** — a lake that is alive
    when nothing is biting.

### Tier 4 — the long tail
16. More lakes, each a different seed and biome, unlocked by progression.
17. Night lighting: a lantern on the boat, headlamp cone, bioluminescence.
18. Ice fishing.
19. Gamepad support and a proper mobile control scheme.
20. A replay/highlight recorder for big catches.

---

## 3. Session log

### 2026-07-28 — Session 2 (autonomous)
- Built `game/qa/harness.js`: 60k+ frame simulation with ~20 invariant
  assertions (finite math, pool bounds, cast distance sanity, exactly-one-fish-
  hooked, no ghost fish, clock/money sanity, save round-trip, UI renderers).
  Also `render-smoke.js` and `shots.js`. First run: clean.
- Confirmed the suspicious "143 m cast" from session 1 was a test-harness
  artifact, not a game bug — real max over 15 randomised casts is 33.5 m.
- **Shipped the rowboat.** Board with `E`, row with `WASD`, anchor with `Q`.
  Pulse-based rowing physics with real momentum and drift, wave-riding hull
  with tilt from the wave normal, wind push, depth-blocked collision, oar
  animation and audio, boat wake ripples, and fish that spook from a boat
  moving fast overhead. The whole lake is now fishable.

### 2026-07-28 — Session 3 (autonomous)
- **Shipped named spots + the lake chart.** Eight spots derived from the
  heightmap at load (13 ms), each with a species bias, a description and a
  hint. Fishing one logs it, pays XP, and adds it to the chart. `M` opens a
  bathymetric chart: contours every 4 m straight from the heightmap,
  hillshaded land, the dock, the boat with heading and anchor state, your
  position and view cone, the lure, a scale bar and a north arrow.
- **Made spots actually hold their fish.** Two thirds of the shoal now spawns
  on structure with a species chosen by that spot's bias, and homes to it
  rather than wandering off. Measured result: average catch weight runs
  0.22 kg at the dock to 2.72 kg at Heron Point, and sturgeon and moonfin
  appear only in the deep hole.
- Fixed the deep-water bite bug and the species-selection noise (see above).
- Added `qa/spotbias.js`, a balance probe that fishes each spot and tallies
  what it produced. Not a pass/fail gate — a tuning instrument.

### 2026-07-28 — Session 1
- Built the game: renderer, world, fish AI, fight sim, audio, UI, saves.

---

## Next session: start here

Two things, in this order.

**1. A debt sweep.** Several small items in section 1 are quick and one of
them (fish visibility) is a genuine gameplay problem: you cannot see the fish
you are trying to catch. Also wire `lure.noise` into spooking so the field
means something, make `Ripples` a real ring buffer, and delete the dead
`propDist` config and `retrieving` tackle state.

**2. Tier 1 item 3 — goals that pull you forward.** The lake now has places
worth going and gear worth buying, but nothing *asks* anything of you. A chain
of commissions ("a 2 kg+ walleye, caught after midnight") that name a spot, a
species and a condition would tie the chart, the boat, the clock and the
tackle together into one thread. This is the last structural gap before the
game is genuinely hard to put down.

---

## 4. Design notes to my future self

- **The fight is the good part.** Tension is normalised to line strength; the
  drag setting is a ceiling that only applies while you are *not* reeling.
  Verified curve: bluegill crankable, 14 kg pike snaps a greedy player in 2 s
  but lands in ~37 s with the drag backed off. Do not flatten this.
- **Do not add a second thing to click during the fight.** The one-button
  tension read is why it feels good.
- **Bite rate is the addiction dial.** ~47% of randomised casts currently go
  90 s with no bite, and a lot of that is bad lure/hour/depth combos, which is
  intended. But a *correct* rig should hook up in 10–25 s. Watch this number in
  the harness after any species or lure change.
- **Everything is procedural and seeded.** Adding a binary asset breaks the
  premise. Generate it.
- **Never break `file://`.** No modules, no build step, plain script tags.
