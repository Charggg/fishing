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
| Spot balance | `node game/qa/spotbias.js` | Fishes every spot and tallies the species. A tuning instrument, not a gate. |
| **Everything** | `node game/qa/all.js` | Runs the whole suite and prints a scorecard. `--quick` for a ~3 min pass. Use this before saying done. |
| Quest chain | `node game/qa/questplay.js` | A bot that reads the chart and plays the commission chain. Proves it is completable. |
| Frame cost | `node game/qa/bench.js [preset]` | Milliseconds per frame under SwiftShader. **Absolute numbers are meaningless** — no GPU here. A/B ratios are not. |
| Ablation | `node game/qa/ablate.js [preset]` | Turns one system off at a time and reports what it was costing. Use this before optimising anything. |
| Viewmodel | `node game/qa/viewmodel.js --probe` | Measures where the rod, hands and forearms land on screen across a whole crank revolution. Exits non-zero. Drop `--probe` to also render the rod with pieces suppressed one at a time. |
| Crop | `node game/qa/crop.js <png> <x> <y> <w> <h> [zoom]` | Zooms into a screenshot. There is no image library here, so it borrows the browser's canvas. |

**Rule:** never leave the tree with a failing harness. Run both before saying done.

**On the viewmodel specifically:** it cannot be checked by reading the code, and
it cannot be checked by glancing at a screenshot either — I "verified" the rod
twice by eye while it was mounted upside down, because I was looking for *is the
rod visible* instead of *is it the right way up*. Measure it. Every rule in
`viewmodel.js` exists because something shipped broken past a visual check.

QA scripts resolve Playwright through `game/qa/pw.js`, so they run with a plain
`node game/qa/<script>.js` from any directory — no `NODE_PATH` needed.

---

## 1. Known bugs / debt

### Open
- [ ] The boat can pass straight through the dock pilings. Needs a cheap
      cylinder collision test against the piling positions.
- [ ] Row hard into a steep shore and the hull visually clips the bank before
      the depth test stops it. Collision should sample ahead of the bow, not at
      the centre of the boat.
- [ ] Crappie are over-represented at every spot. Common + a wide depth band
      + listed in several biases. Consider narrowing their band.
- [ ] `doCast` reads the rod transform, which is derived from the camera, which
      `updatePlayer` owns. Anything that moves the player has to settle a frame
      first. Board/exit now do this explicitly; a future fast-travel must too.
- [ ] The reflection pass draws a fraction of prop instances on medium quality
      (`reflFrac`), which is a fixed prefix of the array, so the same trees are
      always missing. Should be a spatial choice, not an array slice.
- [ ] The water surface is a uniform 240x240 grid (~115k triangles) regardless
      of how much of it is on screen. A radial or clipmap grid would cut it
      hard. Worth ~18% of a frame.
- [ ] Rarity is not gated by level or luck: a mythic can turn up on day one at
      level 1, which happened to the player on their first session and cheapens
      the whole ladder. Weight the roll by level.

### Fixed
- [x] **2026-07-28** *(user-reported)* **Insanely low frame rate.** Measured
      rather than guessed, which mattered: my confident first theory (per-pixel
      analytic sky in the fog) turned out to be 6% of the frame. The real costs
      were 6,825 prop instances drawn three times a frame with **no frustum
      culling at all**, a 194k-triangle terrain drawn three times, and a
      four-octave fbm (four dependent texture fetches) evaluated per fragment
      across most of the screen. Frame cost is now 1.8x-2.5x lower depending on
      preset, before counting the device-pixel-ratio cap.
- [x] **2026-07-28** *(user-reported)* **The oars stroked in opposite
      directions.** The port oar is built by flipping its frame 180 degrees,
      which reverses whichever angles turn about the flipped axes. Both oars
      were fed the same sweep, so one pulled while the other pushed. The lift
      must *not* be mirrored, which I got wrong on the first attempt and caught
      by measuring blade positions through a stroke.
- [x] **2026-07-28** *(user-reported)* **A hooked fish did not move.** Its
      bearing only changed on a fight phase transition, so between phases it
      sat perfectly still and then teleported sideways. It now eases toward a
      target bearing with a constant weave and a vertical wander on top.
      Harness measures it: a hooked fish now ranges ~21 m during a fight.
- [x] **2026-07-28** *(user-reported)* The rod viewmodel was mounted upside
      down. `cameraBasis()` negated the up column, so the whole first-person
      rig was inverted — the player read as holding the rod overhead from knee
      height. Shipped past two of my own visual checks.
- [x] **2026-07-28** The left hand was parented to the spinning crank knob, so
      its 34 cm forearm swung through a full circle every revolution and read
      on screen as a bare arm sweeping across the sky. The hand's *position*
      now follows the knob; its *orientation* comes from the rod.
- [x] **2026-07-28** Both forearms ended inside the frame — severed stumps
      floating over the water, since the elbow is never modelled. Arms are now
      long enough to leave the frame, and `viewmodel.js` asserts it.
- [x] **2026-07-28** The left forearm ran straight through the right fist and
      the two limbs fused into one column of flesh. Splayed inboard, and the
      probe now measures the clearance.
- [x] **2026-07-28** The shirt cuff was positioned off a different angle than
      the arm it belonged to, so it floated beside the arm instead of on it.
- [x] **2026-07-28** The reel crank arm lay *along* its own spin axis, so the
      handle turned without ever appearing to move. Axle now lies across the
      rod and the arm radiates from it.
- [x] **2026-07-28** `#commission` sat at a hardcoded `top: 138px` while the
      rig readout above it grows a row aboard the boat and another on a spot —
      the banner covered the Spot row. Both are now one flex column.
- [x] **2026-07-28** The harness's own rod invariant was wrong twice over: it
      measured against world Y (so looking up or down "failed"), and it did not
      exempt the cast whip (which deliberately swings the rod past vertical).
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
- [x] **2026-07-28** Fish were nearly invisible under the surface. The fish
      shader applied full absorption for the downward light path on top of the
      water shader's absorption for the camera path — correct, and unplayable.
      Weakened the fish half, sharpened the fresnel edge, added a flank flash,
      and gave a fish that has committed to your lure a slight highlight.
- [x] **2026-07-28** Every centred HUD element used `position:absolute;
      left:50%`, which caps an element's shrink-to-fit width at *half* the
      viewport. The bite prompt had been wrapping onto two lines, and the top
      bar wrapped to two rows as soon as a sixth chip was added. All of them
      now span the full width and centre with the layout.
- [x] **2026-07-28** `Ripples.spawn` on a full pool discarded the newest ripple
      instead of the oldest. Now retires the oldest.
- [x] **2026-07-28** Removed dead code: the never-assigned `retrieving` tackle
      state and the unread `QUALITY.propDist`.

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
3. **✅ Goals that pull you forward.** *(done 2026-07-28)* Twelve commissions
   from Marguerite, who runs the tackle shop. Each names a fish and a condition,
   and between them they teach every system in the order you need it: casting,
   spots, lures, the boat, the chart, the clock, deep water, the fight, weather,
   patience, gear, and finally the Moonfin. `C` opens the list; the active one
   is pinned to the HUD. Two of them unlock a lure.
4. **✅ Sonar / fish finder.** *(done 2026-07-28)* The Loon Mk II, $2,600 in the
   new shop **Gear** tab. Works from the boat only — the transducer is on the
   transom — and draws a real right-to-left waterfall: bottom contour, hard
   bottom return, depth grid, and fish marks whose brightness is return
   strength and whose width is fish size. `G` toggles it. It advances on pings
   (0.16 s), not on frames, so the trace survives a dropped frame or an open
   panel, and it is the first thing in the game that makes the *depth* system
   perceivable while you are still deciding where to cast.

**Tier 1 is now complete.**

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
- **Debt sweep.** Made fish visible underwater, wired `lure.noise` into
  spooking so a topwater popper landing on a bluegill's head genuinely scares
  it while a pike shrugs (a real cost for the loud, long-reaching lures, and
  now shown in the shop), fixed the ripple pool eviction, deleted two pieces
  of dead code, and fixed the centred-HUD CSS bug above.

### 2026-07-28 — Session 4 (autonomous)
- **Shipped the commission chain.** Twelve asks in `src/quests.js`, each a set
  of optional predicates (species, rarity, weight, size grade, spot, hour
  window, weather, lure, from-the-boat, range from the dock, count, distinct
  spots) so adding a condition is one line rather than a new goal type. The
  conditions are snapshotted at the hookup, not at the landing, because by
  then the lure is out of the water and the clock has moved.
- HUD banner, `C` panel that opens scrolled to the active one, and completion
  folded into the catch card — the moment the player is already looking.
- `qa/questplay.js`: a bot that picks the lure each species likes best, the
  hour it is most active, and the spot whose bias favours it, then plays the
  chain. It clears 10 of 12; the last two (a 20 kg sturgeon, the Moonfin) are
  deliberate endgame asks. Notably it *stalled* at "a walleye after dark"
  until I taught it to consult the chart — which is exactly the intended
  puzzle, and good evidence the chart is load-bearing rather than decorative.
- Harness now verifies every goal summarises to readable English, names real
  species and spots, that a non-matching catch never advances the chain, and
  that all twelve complete and pay out.

### 2026-07-28 — Session 5 (autonomous)
The player looked at the screenshots and said the angler seemed to be holding
the rod "insanely high" with the view "at the knees". They were right, and the
cause was mine: `cameraBasis()` negated the up column, mounting the entire
viewmodel upside down. I had visually signed off on that rod twice.

- Fixed the basis, then rebuilt the whole first-person rig around it: two hands
  with separate arm rigs, a reel that reads as a reel (foot, stem, gearbox,
  lipped spool with line on it, bail wire) instead of two bare cylinders, and a
  crank whose arm actually sweeps when it turns.
- Wrote `qa/viewmodel.js`. It samples the rig across a full crank revolution and
  asserts: rod upright and on screen, grip below eye level, both hands in frame
  the whole way round, both forearms leaving the bottom edge, and neither
  forearm passing through the opposite hand. Every one of those rules is a bug
  it found. The left-arm angle was *solved* from measured samples rather than
  guessed — see the note at the bottom of this file.
- Wrote `qa/crop.js` (zoom into a screenshot) and `qa/pw.js` (Playwright
  resolver). The QA scripts had only ever run because I was setting `NODE_PATH`
  by hand; any future session would have hit a module-not-found wall.
- Fixed the harness's rod invariant, which was wrong in two independent ways
  and had never actually been executed.
- Fixed the commission banner covering the Spot row of the rig readout.
- Verified: harness 2 sessions ✓, render smoke ✓, questplay 12/12 ✓,
  viewmodel probe ✓, seven screenshots reviewed by eye.

### 2026-07-28 — Session 6 (autonomous)
- **Sonar.** Tier 1 item 4, which closes Tier 1. New shop tab (Gear), a
  $2,600 sounder, `G` to toggle, bottom-left waterfall display. Deliberate
  choices: it pings on a timer rather than per frame (so the trace is stable
  across dropped frames and open panels), the buffer is the single source of
  truth for the display, and it is boat-only — which gives the boat a second
  reason to exist and the shop a non-linear purchase.
- `qa/all.js`: one command for the whole suite plus a scorecard. `--quick`
  runs in ~3 min.
- `REVIEW.md`: a grading kit for a cold session — a paste-in prompt, how to
  run everything, and an honest list of what has never been verified (real-GPU
  framerate, audio, and anything about feel).
- Harness now fits the sounder before the boat run and asserts the ping buffer
  is capped, marks are finite and in range, and nothing pings without a unit.

### 2026-07-28 — Session 7 (autonomous)
The player ran the build on a real Windows PC — the first time this game has
ever run on real hardware — and reported very low frame rates, oars that moved
independently, and a hooked fish that did not move.

- **Built the instruments first.** `qa/bench.js` (frame cost, with a loud
  warning that absolute numbers are meaningless on a software rasteriser) and
  `qa/ablate.js` (turn one system off, measure what it cost). Then used them.
  This immediately killed my leading theory and pointed at the real costs.
- **Prop frustum + distance culling.** 6,825 instances were drawn three times
  a frame regardless of where the camera pointed. -25% frame cost.
- **Terrain chunking and a half-resolution LOD** for the reflection and
  refraction passes. Chunk culling barely helped, which was itself the useful
  result: it proved the terrain is fragment-bound, not vertex-bound, and sent
  me to the fragment shader.
- **fbmLo:** two octaves instead of four for terrain tint, caustics and fish.
  Each octave is a dependent texture fetch. -18% frame cost on its own.
- **Device-pixel-ratio cap per preset.** A Windows desktop at 125% scaling was
  quietly rendering 1.6x the pixels for no visible gain.
- **Adaptive quality.** The renderer now finds its own level and says so, and
  a manual choice locks it off for the session. This matters more than any
  single optimisation, because I cannot test on the hardware it runs on.
- Fixed the oars and the motionless hooked fish; both now have harness
  invariants because both are silent, visual-only failures.
- `P` now reports preset, render resolution, dpr, props surviving the cull and
  terrain chunks — the numbers I would need to diagnose a slow machine from a
  single screenshot.

### 2026-07-28 — Session 1
- Built the game: renderer, world, fish AI, fight sim, audio, UI, saves.

---

## Next session: start here

**All of Tier 1 is now complete.** The lake has places worth going, gear worth
buying, a thread that asks something of you, and an instrument that makes the
water readable. Every remaining gap is presentation, not systems — the
simulation already models far more than the player can perceive, and that gap
is now the whole problem.

In order:
- **The fight camera.** All the drama of a fight is currently in a HUD bar.
  Pull the camera back and orbit on a hookup so the player can *see* the fish.
  This is the single biggest gap between how the game plays and how it feels.
- **A landing sequence** — net, lift, hero shot — before the catch card.
- **Shadows.** The scene reads flat without contact shadows under the trees,
  the dock and the boat.

Open balance question worth a look: crappie are over-represented at nearly
every spot (common, wide depth band, listed in several biases). Narrowing
their band is a one-line experiment; run `spotbias.js` before and after.

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
- **Solve the viewmodel, don't eyeball it.** The hand rig sits behind several
  chained rotations, so "swing the arm left" is not a direction you can guess —
  when I splayed the left arm to clear the right fist it moved *toward* it, and
  the next guess overshot off the frame entirely. What worked: take three
  measured samples from `viewmodel.js`, fit the local-direction → screen-delta
  map, and solve for the angle that clears the other hand while still leaving
  the frame. Two runs instead of ten.
- **The viewmodel is the one thing the player stares at for hours.** It is
  ~2% of the triangles and it was the only thing they commented on.
- **Never optimise without measuring first.** I was certain the per-pixel
  Preetham sky in the fog was the frame killer. It was 6%. The actual costs
  were unculled instancing and a four-octave noise loop — neither of which I
  would have picked. `ablate.js` exists so the next session does not have to
  guess either.
- **A software rasteriser is not useless for performance work.** Absolute
  timings are meaningless, but it runs the same GLSL and the same draw calls,
  so A/B ratios on fragment cost and draw counts hold up. Say which of the two
  you are quoting, every time.
