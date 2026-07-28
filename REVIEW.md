# Grading Deep Cast in a fresh chat

This file exists so a Claude session that has never seen this project can audit
it properly in one pass. Point a new chat at the repo and paste the prompt
below.

---

## The prompt

> This repo is a browser fishing game built entirely by you (Claude) across
> several autonomous sessions. I have never opened or played it. Grade it.
>
> Read `REVIEW.md` first, then `ROADMAP.md`. Treat both as *claims by a
> previous session*, not as facts — your job includes checking whether they
> are true.
>
> Do all of this:
> 1. Run `node game/qa/all.js`. Report what actually passed.
> 2. Take screenshots (`node game/qa/shots.js`) and **look at them**. Say what
>    looks wrong, not just what renders.
> 3. Find bugs the existing QA does not catch. The suite only tests what a
>    previous session already thought of, which is exactly why things get
>    missed.
> 4. Pick the single highest-value improvement, implement it, verify it, and
>    push to branch `claude/game-or-music-program-en8coo`.
>
> Be blunt. If something is bad, say so and say why.

---

## What this is

A first-person fishing game. Raw WebGL2, no engine, no libraries, no build
step, no binary assets — every mesh, texture and sound is generated in code at
load time. Opening `game/index.html` from the filesystem runs it.

| | |
|---|---|
| Entry point | `game/index.html` (plain script tags, dependency order matters) |
| Renderer | `game/src/render.js` — 4 passes: planar reflection, refraction, main, post |
| World | `game/src/world.js` — one 1024² float heightmap is the single source of truth |
| Game loop | `game/src/game.js` — the big one; player, rod, cast, fight, boat, spots |
| Meshes | `game/src/assets.js` — every model, procedural |
| Fish | `game/src/fish.js`, species table in `game/src/species.js` |
| Commissions | `game/src/quests.js` |
| UI | `game/src/ui.js`, `game/style.css` |
| QA | `game/qa/` |

## How to run everything

```bash
node game/qa/all.js            # whole suite + scorecard, ~6 min
node game/qa/all.js --quick    # ~3 min, skips screenshots
```

Individual tools, all runnable from any directory:

```bash
node game/qa/harness.js 3      # headless sim, invariant assertions, the main gate
node game/qa/render-smoke.js   # real clicks, every quality preset, save/reload, resize
node game/qa/viewmodel.js      # first-person rod/hand geometry (--probe for numbers only)
node game/qa/questplay.js      # bot plays the whole commission chain
node game/qa/spotbias.js 14    # tuning instrument: what each spot yields
node game/qa/shots.js          # screenshots into game/qa/out/
node game/qa/crop.js <png> <x> <y> <w> <h> [zoom]   # zoom into a screenshot
```

There is no `npm install`. Playwright is resolved from the global npm root by
`game/qa/pw.js`. Chromium runs on SwiftShader, so **every FPS number these
produce is meaningless.**

---

## Where the bodies are buried

An honest list, so a reviewer spends their time on real problems rather than
rediscovering known ones.

**Never verified at all:**
- **Real-GPU framerate.** There is no GPU in the build environment. The game
  has never been run on real hardware by anyone, including the user. Frame cost
  is guesswork.
- **Audio.** Synthesised in Web Audio and asserted to not throw. Nobody has
  ever *heard* it.
- **Anything about feel.** Cast timing, fight difficulty, reel speed, walk
  speed, mouse sensitivity. All tuned against a simulation and a screenshot.

**Newest and least battle-tested:** the sonar (shop → Gear → Loon Mk II, `G`
to toggle, boat only). It is one session old. Its display is a 2D canvas in
`ui.js#renderSonar`; its simulation is `game.js#updateSonar`. Start there.

**Known weak spots:**
- `game/src/game.js` is far too big and mixes player, rod, cast, fight, boat,
  spots and commissions in one file.
- Crappie are over-represented at nearly every spot.
- Boat collision samples the hull centre, not ahead of the bow, so it clips
  banks and passes through dock pilings.
- The reflection pass draws a fixed *prefix* of the prop array on medium
  quality, so the same trees are always the missing ones.
- No adaptive quality. A weak GPU just runs slowly forever.
- All the drama of a fight is in a HUD bar. The camera does nothing.

**A caution about the QA suite.** It is good at what it covers and blind
everywhere else — it only encodes what a previous session already thought to
check. The upside-down rod shipped past *two* visual reviews and a full green
suite, because nothing measured which way up the rod was. Assume there is
another one of those. Looking at screenshots with fresh eyes is the highest
-yield thing a new reviewer can do, and it is the one thing I keep getting
wrong.

**A caution about `ROADMAP.md`.** I wrote it. It is a working logbook, not an
audit — it records what I believed at the time. Verify before trusting.

---

## Suggested grading axes

1. **Does it run?** Suite green, no console errors, opens from `file://`.
2. **Does it look right?** Screenshots, especially the first-person rig, the
   water, and the HUD at different times of day.
3. **Is it actually a game?** Is there a reason to cast twice? Does the
   commission chain teach the systems or just gate them?
4. **Is the code honest?** Do the comments match the code? Is anything dead,
   duplicated, or lying?
5. **What is missing?** The gap between what the simulation models and what the
   player can perceive is where this project is weakest.
