# STATUS — Repossessed

**Last updated:** 2026-07-05 (SPEC-PLAYER Phase 4 — input.js device read, mode-lock FSM, deriveSnapshot)
**State in one line:** **Subsystem #1 (Level loader + generator) is BUILT and
tested headlessly.** Foundation (config/state/world) + the **loader** + the
generator's **content half** (`level-plan.js`) + the generator's
**geometry/solvability/assembly half** (`generateLevel(n, rng)` in
`level-generator.js`) are all done; `generateLevel` always returns a loadable,
solvable def (4 archetypes, §5.4 solvability + arena fallback, Q3 dark guard).
Everything a later subsystem owns is stubbed behind a register-callbacks seam
(nav / entity factories / events / light / music).

## How to use this file

Claude Code reads this **first**, every session, before touching code. At the
**end** of every session, update *Build status* and append to the *Decision log*
and *Architecture decisions* sections. This is the cross-session memory — keep it
current or the next session starts blind.

## Build status (mirrors GDD build-status index — all NOT BUILT)

- [x] **§8 Level** — **BUILT.** Loader DONE (schema/validate/loadLevel/tile-state+links/spawn-rule placement; tile set + dark stamps). Generator content DONE (`level-plan.js`: eligible/budget/roster/evalRamp, pure fn of n). Generator geometry/solvability/assembly DONE (`level-generator.js`: 4 archetypes, roster→spawnRules+placements, §5.4 solvability + arena fallback, Q3 `G._prevDark` guard, music-key stamping). Owed by later subsystems: real entity factories (#2/#4), nav sink (#3), events emit (#11), light (#7), MUSIC registry (#11.3).
- [ ] §2 Player — movement, health/overheal, melee, ranged, carry/vault states
- [ ] §7 Interactive objects — crates, barrels, shrapnel, carry physics
- [ ] §6.4 Pathfinding — grid A\*, per-class masks, nav-dirtying
- [ ] §6 Enemies + spawners
- [ ] §5 Abilities — Nova, Lightning, gem economy
- [ ] §3 Power-ups & pickups
- [ ] §12 Meta — menu, pause, options, 5-slot save/load, achievements, high score
- [ ] §9/§10/§11 Scoring, HUD, render/lighting, audio

Repo `src/` contains: `config.js`, `state.js`, `world.js`, `level-loader.js`,
`level-plan.js` (generator content, pure fn of n, 6KB), `level-generator.js`
(geometry/solvability/`generateLevel`, 27KB), `input.js` (device read,
mode-lock FSM, `deriveSnapshot`, new). `world.js` re-adds `moveBody`
(2-source, filtered) + `bodyHitsBlocker`; now imports `state.js` (S4, no cycle).
Tests: `test-config.js`, `test-world.js`, `test-level-loader.js`,
`test-level-content.js`, `test-level-generator.js` (20 checks),
`test-level-integration.js` (16 checks), `test-input.js` (19 checks) — all
green (226 checks total). Subsystem #1 complete; player subsystem (#2) in
progress (SPEC-PLAYER Phase 1 config data done; Phase 2 world.js collision
seam done; Phase 3 level-loader.js coord-keyed plate press + emit export
done; Phase 4 input.js done).

## Implementation sequencing (agreed order)

1. **Level Definition loader + generator**  — `SPEC-LEVEL.md`  ← current
2. Player + carry system
3. Pathfinding infrastructure
4. Enemies + spawners
5. Abilities
6. Meta systems
7. Rendering / lighting

Later subsystems leave **seams** in earlier ones (SPEC-LEVEL §6): nav-blocker
registry (#3), plate-press / key-spend setters (#2), spawner tick (#4),
light-emitter registry (#7), music registry. Fill seams, don't reach across.

## Documentation index (authoritative sources)

- `GDD.md` — design intent (v1.1, complete).
- `CLAUDE.md` — conventions + non-negotiables (loaded every session).
- `SPEC-LEVEL.md` — level loader+generator implementation spec (final, signed off).
- `STATUS.md` — this file.
- `add2026` repo — **external, read-only** reference only (GDD §13); never a
  Repossessed source of truth, never committed to.

## Decision log (append-only)

### 2026-07-05 — SPEC-LEVEL signed off (D1–D3, Q3)
- **D1 — grid field is `tiles`** (array of row-major strings), not `grid`.
  Matches ADD's loader/validator/world primitives. (SPEC-LEVEL §1)
- **D2 — `generateLevel(n, rng)` takes an injected rng.** Content
  (roster / spawn budget / ramp) is a **pure function of `n`**; geometry and
  placement consume the rng — **fresh** seed in production (layout varies per
  visit), **fixed** seed in tests. **No seed is persisted** in saves; resume
  rebuilds a fresh layout with the same n-derived content. (SPEC-LEVEL §1, §5; GDD §12.3)
- **D3 — doors/plates are one model.** Grid char (`d` plate-door, `_` plate,
  `D` locked) places the cell; a `placement` assigns its `id`; `links` wire
  plate→door. Locked `D` doors are pure tiles (key-driven, no id/link).
  (SPEC-LEVEL §1, §3)
- **Q3 — "no two consecutive dark Nights"** tracked via one **unsaved** boolean
  `G._prevDark` (starts `false` on resume; harmless). (SPEC-LEVEL §9)
- **Convention — recommended code split:** implement subsystem #1 as
  `level-loader.js` + `level-generator.js` (SPEC-LEVEL §7), per split-on-seams
  file discipline.

## Architecture / circular-import decisions

### 2026-07-05 — `world` ↔ `level-loader` (register-callbacks)
`world.js` exposes `registerTileStateResolver(fn)`. `level-loader.js` (Phase 3)
will register itself as the resolver at load time; `world.js` never imports
`level-loader.js`. `isWall`/`blocksLOS` consult the resolver first for every
cell (not just `d`/`D`) and fall back to the static `CFG.TILES` flag when no
resolver is registered or the resolver returns a falsy state — this is the
correct behavior since the resolver stub only ever returns a truthy state for
actual door cells. Matches SPEC-LEVEL §7's flagged risk, resolved as
prescribed.

### 2026-07-05 — `level-loader` ↔ `nav` (register-callbacks) — Phase 3
Resolved as flagged (SPEC-LEVEL §6.1/§7). `level-loader.js` exposes
`registerBlockerSink(sink)` and `markNavDirty(tile)`; the default sink is a
no-op object `{registerBlocker(){}, markDirty(){}}`. The loader registers each
movable entity (crate/barrel/spawner) as a blocker **at placement time**
(§4.5 — folds the spec's step-7 pass in) and calls `markNavDirty` on every door
open/close (recomputeDoor + openLockedDoor). `level-loader.js` never imports
nav; nav registers itself as the sink at boot.

### 2026-07-05 — `level-loader` ↔ entity factories (registry + placeholders) — Phase 3
Resolved as flagged (SPEC-LEVEL §6.2/§6.3/§7). `registerEntityFactory(type,fn)`;
the loader ships **placeholder** factories now (minimal inert
`{type,x,y,tc,blocks}`; the `spawner` placeholder also carries `variant`, its
`eligible(G.night)`-filtered enemy table, and ramped `interval`/`liveCap`).
`level-loader.js` does **not** import `player.js`/`enemies.js` (they don't exist
yet — a forward/circular hazard). **Owed by #2/#4:** real player/enemy/spawner
factories that override the placeholders via `registerEntityFactory`. `player`
and `exit` are handled inline (singletons on `G`), not via the registry.

### 2026-07-05 — event emit routed through a seam (events.js not built) — Phase 3
`loadLevel` step 9 emits `level:start`, but `events.js` is a later subsystem and
importing it would break the config/state/world-only rule. Resolved with a
register-callbacks seam: `registerEmit(fn)`, default no-op; the payload is a
snapshot (one-way flow). **Owed:** `events.js` registers its `emit` when it
lands. Keeps loader imports = config/state/world only (acceptance).

### 2026-07-05 — RAMP snapshot hoisted before placements — Phase 3
SPEC-LEVEL §4.1 numbers the `CFG.RAMP`→`G.ramp` snapshot as step 8 (after
placements), but §6.3 requires spawner entities — created during placements
(steps 5–6) — to read ramped `interval`/`liveCap` from `G.ramp`. Resolved by
computing the snapshot immediately after the transient-clear (step 4), before
placements. Still read **exactly once at load, never mid-level** (§8.6 upheld);
only the intra-load ordering moved. Flagged here per "phases flag their own
risks" — the spec's step numbering and §6.3 were in tension.

### 2026-07-05 — `level-loader` ↔ `level-generator` (shared pure ramp eval) — Phase 4
Phase 3 already implemented `CFG.RAMP` evaluation (`clampToward`/tier) inside
`level-loader.js`, private, because `loadLevel` owns the once-at-load `G.ramp`
snapshot (§4.1 step 8). Phase 4's spec calls for an `evalRamp(n)` in
`level-generator.js`. Rather than reimplement `clampToward`/tier a second time
(two divergent copies of §5.5 would be a correctness hazard), the private
`rampValue`/`snapshotRamp` in `level-loader.js` were split: `rampValue` is now
exported, and a new exported `evalRampTable(n)` (pure — returns the table, does
not touch `G`) is the single implementation. `level-loader.js`'s internal
`snapshotRamp(n)` now calls `evalRampTable(n)` and assigns to `G.ramp`;
`level-generator.js`'s `evalRamp(n)` calls the same `evalRampTable` and returns
it without touching `G`. This is a one-way import
(`level-generator.js` → `level-loader.js`), not a cycle — the loader still
never imports the generator. Not a design decision, a mechanical de-dup;
flagged per "phases flag their own risks."

### 2026-07-05 — content/geometry file split (`level-plan.js` + `level-generator.js`) — Phase 5
Adding geometry + solvability + assembly pushed `level-generator.js` past the
24KB file-size smell (SPEC-LEVEL §7 anticipated this). Split on the spec-named
seam: **content** (pure fn of `n` — `eligible`/`budget`/`buildRoster`/
`eligibleSpawnerTable`/`evalRamp`) moved verbatim to **`level-plan.js`**;
**geometry** (`generateLevel(n, rng)`, four archetypes, solvability, fallback)
stays in **`level-generator.js`**. Import chain is one-way, no cycle:
`level-generator.js` → `level-plan.js` → `level-loader.js` → {config,state,world};
the generator also imports config/state directly. `evalRampTable` is still the
single §5.5 implementation (in the loader; plan delegates). `test-level-content.js`
now imports from `level-plan.js`. `level-generator.js` is ~27KB — over the 24KB
smell but genuinely one concern (generating one level: shape → place → prove
solvable → assemble); `isSolvable` is a candidate future split (pure grid→bool,
~4KB) if it needs isolated reuse, left inline for now so the retry/solvability/
assembly loop reads in one place.

### 2026-07-05 — generator is data-only; single G field is `G._prevDark` — Phase 5
`generateLevel` never writes a G entity array (the loader is the sole
world-builder). The **only** G field it touches is the unsaved Q3 dark guard
`G._prevDark` (read in `pickDark`, set after generating; not serialized —
resume starts `false`). Enforced by a source grep in `test-level-generator.js`
(`\bG\.\w+` must all be `G._prevDark`). Determinism (§8.2) therefore depends on
seed **and** `G._prevDark`; the determinism tests reset `G._prevDark=false`
before each compared call (seed + G state are the inputs).

### 2026-07-05 — loose enemies as forward-compatible placements — Phase 5
Early-Night rosters contain enemies whose spawner variant is not yet unlocked
(e.g. a Night-1 skeleton — Bone Pile unlocks Night 2; a ghost — Grave Mound
unlocks Night 6). Those are emitted as **fixed placements of type = the element
name** (`{type:"ghost",…}`). The loader has no factory for them yet, so
`placeEntity` returns null and they are silently ignored (the "unknown type
ignored" forward-compat branch), while solvability still flood-checks their
tiles as reachable. **Owed by #6 (enemies):** register real loose-enemy
factories via `registerEntityFactory` — the defs already carry the placements.
Note: the Phase-4 `buildRoster` weighting is degenerate (repeatedly picks the
cheapest affordable element ⇒ rosters skew all-`ghost`); that is signed-off
content behavior and Q5 (§14.2) tuning, not a generator bug — the generator
places whatever roster it is handed.

### 2026-07-05 — S1 CONFLICT ruling: `G.powerups` canonical keys are `triple/big/fast/bounce` — Phase 1 (SPEC-PLAYER)
Phase-1 (config/state foundation) left `state.js`'s `G.powerups` comment as
`{ tripleShot: …, bigShot: …, fastShot: …, bounceShot: … }`. SPEC-PLAYER §7
(P1: four independent power-up flags) reads/decrements `G.powerups.triple/
big/fast/bounce` — short keys, no `Shot` suffix. Ruling (S1): **spec keys
win** — the comment is corrected to `{ triple, big, fast, bounce }`. No live
code existed to rename (state.js only ever declared the empty `{}` literal +
comment); this is a comment-only fix, not a behavior change. This is the
contract #3 (pickup collection, which writes `G.powerups`) and this phase's
own `CFG.SHOT`-reading code (once player.js lands) must both honor.

### 2026-07-05 — `CFG.PLAYER`/`CFG.SHOT`/`CFG.KEYS` data added — Phase 1 (SPEC-PLAYER)
Added three leaf-data blocks to `config.js` ahead of building `player.js`/
`input.js`/`projectiles.js` (SPEC-PLAYER §1 P7, §2, §3, §7). All px values are
GDD tile/sec or tile-distance values × `TILE(32)`, commented with their tile
source and spec section; `(proposed)` dials are flagged `Q-P1`/`Q-P2` per
SPEC-PLAYER §13 (play-feel tuning, not build blockers). `config.js` stays a
leaf — no new imports (grep-verified by `test-config.js`'s existing
import-discipline check, still green). `CFG.KEYS.gamepad` is left as an empty
stub — SPEC-PLAYER §4.1's gamepad button/axis indices weren't in the fetched
spec excerpt; **owed:** fill in when `input.js` (this subsystem, later phase)
needs them or the full §4.1 table is available. Extended `test-config.js`
(11 → 17 checks): field-presence checks for all three blocks plus spot-check
tile×32 conversions (`speed`=112, `range`=224, `vaultHop`=64). Full suite
(config/world/level-loader/level-content/level-generator/level-integration)
still green, 194 checks total — data-only change, no behavior/build-status
box flipped.

### 2026-07-05 — `world.js` re-adds `moveBody` (filter-as-policy seam, S2) — Phase 2 (SPEC-PLAYER)
`moveBody` (deleted in the Level-loader Phase 2 as "not in §3.1's reuse list")
is re-added, extended to **two** collision sources: the static/tile-state grid
(`bodyHitsWall`, unchanged) and a new `bodyHitsBlocker(x,y,r,filter)` against
`G.crates`/`G.barrels`/`G.spawners` (circle-vs-circle at `r + CFG.TILE/2`).
`bodyHitsBlocker` is deliberately **policy-free**: it takes a `filter(entity)`
predicate from the caller rather than reading carry state itself — the caller
(player.js, later) decides eligibility (e.g. "not the crate I'm carrying").
An omitted filter is always "no block," so existing terrain-only callers are
unaffected. `world.js` now imports `state.js` for `G` (S4) — still a one-way
leaf import, no cycle (state.js imports nothing); `world.js` still must not,
and does not, import `level-loader.js` (grep-verified, now also asserting
world.js imports only config.js/state.js). `node test-world.js` green (28 → 35
checks): per-axis wall slide at a corner, `bodyHitsBlocker` filter true/false/
undefined, and `moveBody` reverting vs. passing through a synthetic crate by
filter. Full suite still green, 201 checks total.

*(Still expected later: real nav grid + entity modules fill the seams above.)*

## Known open items (non-blocking for build)

Tuning / design-feel only — none block implementing the mechanism:
Q1 archetype algorithm play-feel; Q2 key budget (GDD §14.1); Q4 fallback
archetype identity; Q5 the `(proposed)` generator numbers (GDD §14.2).

## Session log

### 2026-07-05 — Phase 1 (config/state foundation)

Phase 1 — config/state/package.json authored; CFG.{TILES,PLAN,RAMP,SPAWNER,GEN}
in place; G run-state + G.ramp slot + G._prevDark added. `node test-config.js`
green (11 checks). `config.js`/`state.js` import nothing (leaf modules,
confirmed structurally by the test). No behavior/build-status box flipped —
data only.

**Spec gap found (not invented around):** SPEC-LEVEL §5.1's `CFG.PLAN.costs`
table omits `lobber`, despite `lobber` being introduced as a roster element on
Night 4 (§5.1 `introductions`). Filled in using the same documented formula
the rest of the table follows (GDD §6.2 pts ÷ 50): Lobber = 100 pts → cost 2
(matches Skeleton's cost, which also has 100 pts). Comment left in
`config.js` at the `costs` table. Flagging here per CLAUDE.md's "surface,
don't invent design" rule — this is a mechanical fill via an existing
formula, not a new tuning decision, but worth a sign-off glance.

### 2026-07-05 — Phase 2 (`world.js` — tile-grid primitives)

Ported from add2026 `src/world.js`: `loadTileGrid`, `isWall`, `blocksLOS`,
`tileCenter`, `randomFloorTileTC`, `randomFloorTile`, `tileFloor`,
`bodyHitsWall`, `hasLineOfSight`. Added `registerTileStateResolver` seam
(§3.2) — see *Architecture / circular-import decisions* above. Deleted (not
stubbed): `bakeConveyors`, `isDestructible`, `destroyShelf`, `pushField`/
`pushAt`/`pushAtWorld`/`applyBeltPush`/`clampNet` (all conveyor-only), and the
Cleaner-patrol-only helpers not required by this phase's spec list
(`tileClearRun`, `rectPerimeterClear`, `isBorderTile`, `moveBody`, `clamp`) —
none were named in SPEC-LEVEL §3.1's reuse list; add back if a later phase's
spec calls for them. `node test-world.js` green (28 checks), `node
test-config.js` still green (11 checks). No import of `level-loader.js` from
`world.js` (grep-verified).

**Spec gap found (not invented around):** `CFG.TILE` (tile pixel size) was
missing from Phase 1's `config.js` — every geometry helper ported in this
phase (`bodyHitsWall`, `tileCenter`, `hasLineOfSight`, `randomFloorTile`)
needs it. Not specified in SPEC-LEVEL or GDD excerpts read this session.
Ported verbatim from add2026 `CFG.TILE: 32` (a fixed pixel constant, not a
design decision) into `config.js`, commented at the point of addition.
Flagging per CLAUDE.md's "surface, don't invent design" rule — this is a
mechanical port of an existing constant, not new tuning, but worth a
sign-off glance in case Repossessed wants a different tile size.

Code map: `src/world.js` now exists.

### 2026-07-05 — Phase 3 (`level-loader.js` — the loader)

Built `src/level-loader.js` (19KB, one concern; under the 24KB smell) +
`test-level-loader.js` (34 checks green, stable across repeated runs since it
exercises `Math.random` scatter). Ported + extended from add2026 `src/level.js`
(`loadLevel`/`validateLevelDef`/`pickTile`/`runSpawnRule`/`zonesWithRole`).

Implements: Level Def v2 `validateLevelDef` (full §4.3 incl. ★links-ref-ids,
★door/plate-on-matching-char [D3], ★avoid-role, ★spawner-variant-in-CFG,
★script-actor no-op seam); the ordered `loadLevel` (§4.1) — validate → parse
grid (no conveyor bake) → build tile-state+link graph (recompute once) → clear
transient/preserve run-state → **ramp snapshot (hoisted, see Arch decisions)** →
placements player-FIRST/exit/rest → spawn rules → emit; the mutable tile-state
store `Map<ty*COLS+tx, DoorState|PlateState>` with `setPlatePressed`/
`openLockedDoor`/`recomputeDoor` (pure, open-iff-any-linked-plate-pressed);
extended spawn-rule placement (400-try + guaranteed-floor fallback, ★never on
plate/exit, ★new types, movable→blocker). Registered the world.js
tile-state resolver (returns door states only — plates fall through to the
static non-solid flag). Ramp evaluation (§5.5 `clampToward`/tier) lives here
because `loadLevel` owns the snapshot; the generator can reuse it.

Tests cover SPEC-LEVEL §8 items **4** (scatter never on solid/plate/exit),
**5** (11 validation rejects), **6** (link graph: press opens / release closes /
two-plate either-opens, read black-box via `world.isWall` on the door tile),
**8** (transient arrays cleared, run-state hp/keys/gems/score/night preserved),
plus an import-discipline grep (config/state/world only).

**No spec gaps requiring invented design.** Two spec-internal tensions were
*resolved procedurally* (not design decisions) and logged under Architecture:
the RAMP step-8-vs-§6.3 ordering, and the `events.js`-not-built emit path.
Owed by later phases: real entity factories (#2/#4), nav sink (#3), events.js
`emit` registration. Generator (`level-generator.js`) is the next build.

### 2026-07-05 — Phase 4 (`level-generator.js` — content evaluators)

Built `src/level-generator.js` (6KB, one concern — content only) +
`test-level-content.js` (79 checks green). Pure functions of `n`, **no `rng`
parameter touched anywhere in this file** (grep-confirmed: no `Math.random`,
no `Date`, no `rng` outside comments).

Implements: `eligible(n)` (union of `CFG.PLAN.introductions.elements` gated by
`night <= n`); `budget(n)` (`min(base + perNight*(n-1), cap)`); `buildRoster(n)`
— the abstract, budget-resolved composition (`{element, asSpawner}` list +
Reaper set-piece flag, `n>=9`, cost 15, at most one) via the newest-tier /
earlier-mix weighting split (§5.2) — **no zone placement, no coordinates**
(Phase 5's job); `eligibleSpawnerTable(variant, n)` (a spawner's enemy table
intersected with `eligible(n)`, for #4's pre-filtered read); `evalRamp(n)` (the
`G.ramp`-shaped snapshot object, delegating to `level-loader.js`'s shared
`evalRampTable` — see Architecture decisions above for why this isn't a second
implementation of §5.5).

Tests cover SPEC-LEVEL §8 items **3** (content purity — budget/eligible/roster
identical across repeated calls, asserted as pure-fn-of-n since this layer has
no seed at all) and **9** (RAMP eval — 8-Night tiers, `add`/`mul` modes, clamp
toward limit for both positive and negative steps, verified with
`lobberErrorRadius` as the negative-step case per the spec's own example);
plus the budget-curve formula/cap, the Night-2-vs-3 `skeletonShooter` gate, and
a wide-`n` sweep (1..200) asserting no RAMP value ever exceeds its clamp
bound in either direction.

**No spec gaps requiring invented design.** One spec-internal tension was
resolved procedurally (not a design decision) and logged under Architecture:
the phase prompt's `evalRamp(n)` vs. Phase 3's already-built private ramp
logic in `level-loader.js` — resolved by exporting/sharing rather than
duplicating. `node test-config.js`, `test-world.js`, `test-level-loader.js`,
and `test-level-content.js` all still green after the export change (no
behavior change to the loader's `snapshotRamp`, confirmed by the still-green
`test-level-loader.js`). Geometry/archetypes/solvability
(`generateLevel(n, rng)`, SPEC-LEVEL §5.3/§5.4) is the next build.

### 2026-07-05 — Phase 5 (`level-generator.js` — geometry / solvability / assembly)

Built the rng-driven half + the top-level entry `generateLevel(n, rng)`,
splitting Phase-4 content out to `level-plan.js` first (file-size seam — see
Architecture decisions). **Subsystem #1 is now complete.** Two test files:
`test-level-generator.js` (20 checks) + `test-level-integration.js` (16 checks),
all green; full suite 188 checks.

Implements (SPEC-LEVEL §5.3/§5.4):
- **RNG (D2):** `makeRng(seed)` mulberry32 → float[0,1); exported for tests
  (fixed seed) and production (fresh seed). No seed persisted anywhere.
- **Footprint:** interpolates `CFG.GEN.footprintMin`→`footprintMax` over
  `footprintGrowNights`, then caps (all `CFG.GEN` dials).
- **Four archetypes**, connectivity by construction: `arena` (rejection-sampled
  isolated `o`/`T` obstacles with clearance), `warrens` (randomized-DFS maze on
  a pitch-3 / 2-tile-corridor cell grid + loop-knock), `halls` (BSP leaves,
  sibling-center corridors, optional `d`/`D` door alcoves), `ring` (solid core,
  ≥2-wide loop, carved spoke chords).
- **Door set pieces (halls):** built as **isolated pocket alcoves** carved out
  of solid space — a pocket reachable ONLY through the one door cell. This makes
  a door provably never on the player→exit path (closing/locking it can only
  isolate the pocket reward), which is what keeps them solvable *by
  construction*. `d` gets door+plate+link+crate; `D` is a pure key-driven tile
  (D3 — no id/link) with a pre-door key + treasure reward.
- **Roster → placements (§5.2):** `buildRoster(n)` (pure) → per-eligible-variant
  spawner `spawnRules` (zone `danger`/`combat`, `avoid:"spawn"`; count collapsed
  by `spawnerPickDivisor`, capped) + bounded fixed loose-enemy / Reaper
  placements on reachable main floor.
- **`props.dark`** from `CFG.PLAN.darkProb` (`n >= beforeNight`, `prob`) with the
  Q3 `G._prevDark` guard (never two consecutive; set-after, unsaved).
  **`props.music`** stamped from the `CFG.GEN.music` archetype pool (§6.5 key
  only).
- **Solvability (`isSolvable`, exported):** iterative flood-fill — a closed
  plate-door is passable once a crate AND its linked plate are reachable; a
  locked door once a key is reachable. check1 exit+every-placement reachable;
  check2 every `D` key reachable in the base (door-closed) flood; check3 every
  `d` has crate+plate reachable in the base flood.
- **Fallback (§5.4):** re-roll geometry with a fresh sub-rng up to
  `CFG.GEN.maxAttempts`; else emit a guaranteed-open `arena` (no doors,
  `props.fallback:true`) + `console.warn`. Exercised by the injected-failure
  test via the `__setCandidateOverride` seam. `generateLevel` therefore always
  returns a loadable, solvable def.

Tests cover §8 items **1** (generator→loader accepts; dims track CFG.COLS/ROWS),
**2** (determinism under fixed seed, differs by seed), **7** (solvability sweep
132 defs; isSolvable rejects a sealed exit as a non-vacuous control; fallback
triggers + is valid under forced failure), a re-assert of **3** (roster pure fn
of n across seeds while layout differs), and re-asserts of **6**/**8**
end-to-end through generated defs (plate-door link graph opens/closes; run-state
preserved / transients cleared). Plus footprint min/cap, archetype variety, the
dark no-consecutive + before-`beforeNight` guards, and the data-only grep (only
`G._prevDark`).

**No spec gaps requiring invented design.** Decisions surfaced & logged under
Architecture: the content/geometry file split; data-only + `G._prevDark`
determinism dependency; loose enemies as forward-compatible placements (owed by
#6). Proposed `CFG.GEN`/`CFG.PLAN` numbers (Q1/Q4/Q5) left as dials, not
blockers. Seams for #2 (plate/key setters), #3 (nav sink), #4 (spawner tick),
#7 (light) and #11.3 (MUSIC) confirmed in place (loader-side, unchanged).

### 2026-07-05 — SPEC-PLAYER Phase 1 (config data + powerups-key fix)

First build phase of subsystem #2 (Player). Data-only: added `CFG.PLAYER`,
`CFG.SHOT`, `CFG.KEYS` to `config.js` and fixed the `G.powerups` comment in
`state.js` to the spec-canonical `triple/big/fast/bounce` keys (S1 ruling —
see Architecture decisions above). No behavior built yet; `player.js`/
`input.js`/`projectiles.js` are the next build.

Extended `test-config.js` (11 → 17 checks): presence checks for all three new
`CFG` blocks plus spot-check tile×32 conversions. Full suite still green
(config/world/level-loader/level-content/level-generator/level-integration),
194 checks total. `config.js` import-discipline check (leaf, no imports)
still passes structurally — no new imports added.

**No spec gaps requiring invented design.** One spec-internal conflict (S1,
flagged in the phase prompt) was resolved procedurally per the given ruling
(spec keys win), not invented: logged under Architecture decisions above.
Owed by later phases: real `player.js`/`input.js`/`projectiles.js` builds
consuming this data; `CFG.KEYS.gamepad` indices (§4.1) left stubbed pending
either `input.js`'s build or a fuller spec excerpt.

### 2026-07-05 — SPEC-PLAYER Phase 2 (`world.js` — moveBody + bodyHitsBlocker)

Re-added `moveBody` (deleted in Level-loader Phase 2) to `world.js`, extended
to two collision sources per §4.2's amendment, and added `bodyHitsBlocker` as
a new policy-free mechanism (filter supplied by the caller — S2 seam). See
Architecture decisions above for the full rationale. `world.js` now imports
`state.js` (S4) in addition to `config.js`; still leaf-only, still no import
of `level-loader.js` (grep-verified both facts).

Extended `test-world.js` (28 → 35 checks): a genuine per-axis wall-corner
slide (verified the body actually diverts, not a vacuous same-position pass),
`bodyHitsBlocker` filter-true/filter-false/no-filter cases against a synthetic
`G.spawners` entry, `moveBody` reverting into vs. passing through a synthetic
`G.crates` entry by filter, and an import-discipline grep asserting `world.js`
imports only `./config.js` and `./state.js`. Full suite green, 201 checks
total (config 17 / world 35 / level-loader 34 / level-content 79 /
level-generator 20 / level-integration 16).

**No spec gaps requiring invented design.** `bodyHitsBlocker` was built
exactly as scoped in the phase prompt — mechanism only, no reach into
`G.player`/carry state. Owed by later phases: `player.js` supplies the actual
`blockerFilter` (carry-state eligibility) when it lands.

### 2026-07-05 — SPEC-PLAYER Phase 3 (`level-loader.js` — coord-keyed plate press + `emit` export)

Two seam additions to the already-shipped loader, both satisfying items owed
to #2 (player) from Phase 3/SPEC-LEVEL: `setPlatePressedAt(tx, ty, pressed)`
delegates to the existing id-keyed `setPlatePressed` (single recompute path —
`recomputeDoor` stays the only place a door's `open` flips); an unlinked `_`
plate (`id == null`) is a harmless no-op since nothing reads it (§4.3). The
previously-internal `emit(type, payload)` is now exported for the player
event seam (§10) — no behavior change, `loadLevel`'s internal emit calls are
the same function.

Extended `test-level-loader.js` (34 → 40 checks): a coord-keyed mirror of the
existing id-keyed link test (press/release via `(tx,ty)` opens/closes the
door, read black-box via `world.isWall`), an unlinked-plate no-op, a
non-plate-tile no-op, and an `emit` type-of-function check. Full suite green,
207 checks total (config 17 / world 35 / level-loader 40 / level-content 79 /
level-generator 20 / level-integration 16). Loader still imports only
config/state/world (unchanged, no new imports needed for either addition).

**No spec gaps requiring invented design.** Both additions were exactly the
seams flagged as owed (SPEC-LEVEL §4.3 delegated coord setter; §10 emit
export).

### 2026-07-05 — SPEC-PLAYER Phase 4 (`input.js` — device read, mode-lock FSM, `deriveSnapshot`)

Built `src/input.js` (new file) + `test-input.js` (19 checks green). Imports
**only** `config.js`/`state.js` (grep-verified in this session; no gameplay
import). `player.js` (later) will import this module's `getSnapshot`/
`deriveSnapshot`; `input.js` never imports `player.js` (one-way flow, §11 risk
resolved as flagged).

Implements (SPEC-PLAYER §3): `deriveSnapshot(rawState, mode)` — the pure,
fully headless-testable core (no `document`/`window`/`performance` reads
inside it); keyboard diagonal move normalized to unit length (two-adjacent-
key sum, ADD §4.1 rule); gamepad move full-speed beyond `CFG.KEYS.deadzone`
regardless of stick depth (ADD §4.6); aim **always present** in both modes
(keyboard: cursor-relative unit vector from a caller-supplied
`{cursorWorld, playerPos}`; gamepad: right-stick unit vector, defaults to
`{x:1,y:0}` inside the deadzone) — the documented divergence from ADD's
`getFireAngle()`-returns-null; `fireHeld` is a separate boolean (LMB / right-
stick-beyond-deadzone). Mode-lock FSM (`lockInputMode`/`clearInputMode`/
`handleTitleDeviceEvent`) is a small explicit state on `G.inputMode`,
testable without real devices. `setKeybinds(map)` is the remap seam (#6 UI
not built). Device-listener glue (`installDeviceListeners`, `pollGamepad`,
internal `rawState`) is thin and isolated from `deriveSnapshot`; it is the
one browser-coupled, minimally-tested part.

**Decisions made, not in the fetched spec excerpt, flagged here (mechanical
fills, not invented design):**
- **`rawState` shape** wasn't specified beyond "device events set an internal
  raw-state." Chose `{keys:Set<KeyboardEvent.code>, cursorWorld:{x,y},
  playerPos:{x,y}, mouseDown, gamepad:{axes,buttons}}` — `cursorWorld`/
  `playerPos` are pre-resolved to world space by the caller (via new
  `setCamera`/`setPlayerPos` setters) so `deriveSnapshot` stays pure and
  never touches `G.player`/camera state itself (one-way boundary, §11).
- **`CFG.KEYS.gamepad` button/axis indices** are still an empty stub (owed
  since Phase 1 — §4.1's full table wasn't in the fetched excerpt). This
  phase's gamepad move/aim/fireHeld read fixed ADD-convention axis indices
  (`axes[0..1]` move, `axes[2..3]` aim) since those aren't remappable per
  spec; **button** binds (nova/lightning/pause/confirm/back/mute) read
  `CFG.KEYS.gamepad.<action>` and safely no-op (`padHeld` treats a missing
  index as unpressed) until that table is filled in — owed to whichever
  later phase has the full §4.1 button-index table (title-screen/pause UI,
  #6, or a spec addendum).
- **Idle gamepad aim defaults to `{x:1,y:0}`** (facing +x) rather than
  holding the last known direction, to keep `deriveSnapshot` a pure function
  of its arguments (no held-state inside the pure core). If play-feel wants
  "hold last aim" instead, that's a `player.js`-side concern (it already
  owns `G.player.angle` persistence per §2's data shape), not this seam.

Full suite green, 226 checks total (config 17 / world 35 / level-loader 40 /
level-content 79 / level-generator 20 / level-integration 16 / input 19).