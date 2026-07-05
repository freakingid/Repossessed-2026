# CLAUDE.md — Repossessed

Always loaded at the start of a Claude Code session. Read this, then read
`STATUS.md` (and any relevant `STATUS-*.md`) **before touching code**. This file
is non-negotiables + conventions + code map; `STATUS.md` is ground truth for what
is actually built.

## What this is

Repossessed — a standalone, browser-based top-down twin-stick arcade shooter.
HTML5 Canvas + vanilla JavaScript ES modules. **No bundler, no build step, no
transpile** — the browser loads the ES modules directly. Solo developer; you
(Claude Code) are the implementer only.

## Non-negotiables

- **Read `STATUS.md` first**, every session, before any code. Update it at the
  **end** of every session: what changed, and any architectural decision made.
- **Never commit, push, or branch.** The developer runs all git themselves on a
  single `main`. Leave the working tree changed; do not `git` anything.
- **Implementation only.** This session executes an already-reviewed spec or
  phased prompt. If a genuine design decision surfaces that the spec doesn't
  cover, **stop and surface it** — do not invent design. Flag it for the
  conversational/design session and STATUS.md; don't paper over it.
- **`add2026` is external and read-only.** Repossessed reuses patterns from the
  Atomic Dustbin Dan repo (see GDD §13), but that is a *different project*.
  Never commit anything there; never treat its files as this codebase.

## Documentation layers (don't conflate them)

- `GDD.md` (+ `GDD-*.md`) — design **intent**: what the game should be.
- `SPEC-*.md` — **implementation detail** between GDD and code (schemas,
  contracts, algorithms, seams). Before building a subsystem, read its SPEC.
- `CLAUDE.md` (this file) — non-negotiables, conventions, code map.
- `STATUS.md` (+ `STATUS-*.md`) — build **reality** + decisions. You maintain it.

## Tech + test conventions

- **ES modules, browser runtime.** Import with explicit relative paths and
  `.js` extensions. No framework, no npm runtime deps for the game itself.
- **`config.js` is the leaf.** It imports nothing from gameplay. The global game
  state object (`G`) lives in `state.js`. Rendering is split from simulation.
- **Headless smoke tests, no canvas.** Tests are plain `node test-*.js` files
  (`package.json` has `"type": "module"`). A test stubs the browser globals the
  import graph touches (`window`, `AudioContext`, `document`/canvas) **then
  dynamically imports the real modules** — it never inlines copies of the code
  under test. Use a tiny `check(name, ok)` / `throws(name, fn)` harness. Deliver
  tests with the code, not after.
- **One subsystem per file.** See "File size" below.

## Implementation practices (these bind the code — follow them)

- **Prefer `str_replace` over full-file rewrites.** Re-read the current file
  region before editing; keep edits surgical.
- **File size — split on subsystem seams, not byte count.** The cost of a big
  code file is edit-collision risk and re-reading unrelated code each session,
  so keep **one file to one cohesive concern**. Treat ~24 KB as a *smell alarm*
  (go look for a seam), not a hard limit — over 24 KB but genuinely one concern
  is fine; under it but doing two jobs is already a split. (Example seam:
  `level-loader.js` vs `level-generator.js`.) Prefer targeted `grep`/`sed` over
  reading whole files.
- **Circular-import prevention.** If two modules would import each other, have
  one **register callbacks/listeners** rather than importing the other directly
  (e.g. the nav module registers itself as the blocker sink; the loader calls
  the registered sink, never imports nav). **Record any such decision in
  STATUS.md** when it comes up.
- **Sentinel over `Infinity`.** For "permanent"/"never" numeric states use a
  large finite sentinel (e.g. `1e9`), never `Infinity` —
  `JSON.stringify(Infinity)` becomes `null` and silently corrupts save/load.
- **One-way dependency flow.** Leaf modules (e.g. `audio`) import only `config`,
  never gameplay state. Snapshot state into **event payloads** rather than
  reaching back into `G` from a subscriber.
- **Phases flag their own risks.** A prompt/phase you're handed should already
  name its hazards (circular imports, state-machine ordering). If you hit an
  unflagged one, note it in STATUS.md so the next spec accounts for it.

## Code map (target layout — STATUS.md tracks what actually exists)

The repo is greenfield. This is the intended top-level shape, mirroring the
proven ADD module split; it fills in as subsystems land. **Do not assume a file
exists because it's listed here — check.**

```
src/
  config.js        // CFG: tiles, tunables, PLAN/RAMP tables. Leaf — imports nothing.
  state.js         // G (global game state); small pure helpers.
  world.js         // tile-grid primitives: parse, isWall/blocksLOS, tileCenter, floor finders.
  level-loader.js  // Level Definition schema, loadLevel, validate, spawn-rule placement, tile-state.  (SPEC-LEVEL)
  level-plan.js    // generator CONTENT (pure fn of n): eligible/budget/roster/evalRamp.                (SPEC-LEVEL)
  level-generator.js // generator GEOMETRY: generateLevel(n,rng), 4 archetypes, solvability, fallback.  (SPEC-LEVEL)
  player.js        // movement, health/overheal, melee/ranged, carry/vault states.
  enemies.js       // enemy entities + roster;  enemies-ai.js / nav.js for steering + A*.
  projectiles.js   // shots, arrows, shrapnel; ricochet rules.
  combat.js        // damage exchange, attribution/ownership tags.
  abilities.js     // Nova, Lightning, gem economy.
  events.js        // pub/sub; one-way dependency.
  savegame.js      // pure-leaf save/load (rep_-prefixed keys).
  achievements.js  // events subscriber.
  audio.js / music.js  // synth SFX + music registry (synth→ogg swap seam).
  render*.js       // canvas rendering, split from sim; dark-level lighting overlay.
  input.js         // keyboard+mouse / gamepad, input-mode lock.
tests:  test-*.js  // headless, node-run, browser-globals stubbed.
```

When you add or split a module, update this map **and** STATUS.md.