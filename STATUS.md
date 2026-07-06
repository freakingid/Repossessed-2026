# STATUS — Repossessed

**Last updated:** 2026-07-05 (SPEC-ENEMIES Phase 3 — **`enemies.js` created: the combat spine + the 7-step `tickEnemies` frame order** (§3.5/E11) proven end-to-end with the Ghost. Player-shot→enemy pass (§6.5, Q2 baked-in), melee exchange (§6.2, E6: pair-lockout + crate bumper + bat exemption + melee null-guard), death sweep + `awardKill` seam (§6.3, E8: gems always, score attribution-gated, Q3 baked-in), shared enemy knockback (§6.6), enemy-shot→player hit-test (§6.4, R3). `updateGhost` added to `enemies-ai.js` (§6.1.1). One-way import flow (R6) + the death-sweep-before-AI invariant (R2) recorded below. `test-enemies-combat.js` (66) green; suite **497 total**. Roster beyond the Ghost + spawners + arced ordnance still pending later phases.)
**State in one line:** **Subsystems #1 (Level loader + generator), #2 (Player,
incl. crates §7.1), and #3 (Pathfinding) are BUILT and tested headlessly.**
`nav.js` is complete: infrastructure (masks/occupancy/dirty/seam, Phase 1) +
the A\* solver (`findPath`, Phase 2). Foundation (config/state/world) + the **loader** + the
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
- [x] **§2 Player — BUILT.** `player.js` (movement, health/overheal, melee sinks,
  ranged fire, carry/vault states) + `projectiles.js` (shot motion/range/ricochet)
  complete. **Phase 5** — frame-update ordering skeleton, NORMAL locomotion +
  multiplicative speed stack, two-source carry-aware collision filter, status
  overlays (ENTANGLED shave / STUNNED random-walk + force-drop / POST-HIT invuln),
  world hooks (plate press by weight + resting-crate hold, key-spend on `D`),
  VAULTING kinematics, damage/heal/knockback sinks + abilities registry seam.
  **Phase 6** — crate carry system: automatic pickup (splice + nav-dirty),
  stationary toss, moving drop-vault, wall-vault (1- vs ≥2-thick), STUN force-drop,
  degrade-to-toss rules, `isCarryingCrate()` pushback flag for #4. **Phase 7** —
  ranged fire hook (`tryFire`): volley gate (`fireHeld && cooldown≤0 &&
  playerShotCount+volley ≤ cap`, cap counting `owner==="player"` ONLY), Triple/
  Fast/Big/Bounce per-trigger flags + one-shot-off-each decrement, sfx/audio leaf
  seam, `player:fired` emit; `projectiles.js` `makeShot` factory + `updateShots`
  (integrate/range-expiry/two-source ricochet: crates-always + Bounce-walls,
  per-axis, owner+dmg retained, range not reset). Damage-to-targets deferred to
  #4/combat (enemies/barrels don't exist yet).
- [ ] §7 Interactive objects — **crates (§7.1) BUILT** (carry physics in `player.js`,
  crate-always ricochet in `projectiles.js`); **barrels (§7.2), shrapnel deferred**
  to SPEC-BARRELS (post-#4).
- [x] §6.4 Pathfinding — **BUILT.** `nav.js` complete. **Phase 1
  (infrastructure):** mask predicates (`isNavBlocked`, GROUND/PHANTOM),
  mask-split occupancy grid derived from live `G` arrays (D3), dirty/version
  accounting, `installNav` blocker-sink seam fill. **Phase 2 (`findPath`, grid
  A\*):** 8-directional, orthogonal 1.0 / diagonal √2 cost, octile heuristic,
  per-mask corner-cut prevention (R1 — the crux; predicate is the step's own
  mask), `1e9` gScore sentinel (D6), total-order tie-break f→h→packed-key (D7);
  returns start-exclusive/goal-inclusive `{tx,ty,x,y}` waypoints, `[]` when
  start tile === goal tile, `null` when the goal is blocked or unreachable.
  **Owed by #4 — repath scheduler / round-robin / waypoint steering /
  direct-steer fallback: BUILT** in `enemies-ai.js` (nav consumer layer, see §6
  box + Decision log 2026-07-05). Still owed: `installNav()` wiring into game
  startup (later integration phase); barrel-destruction `markNavDirty`
  (SPEC-BARRELS).
- [ ] §6 Enemies + spawners — **Phase 1 (foundation) done + Phase 2 (nav
  consumer layer) done:** `CFG.ENEMY`/`CFG.GEM` added to `config.js`; three
  shipped-file seam edits landed (`projectiles.js` `makeShot` maxTravel/effect +
  `updateShots` expiry reads `s.maxTravel ?? CFG.SHOT.range`; `player.js`
  `applyEntangle` sink; `level-loader.js` `ENTITY_ARRAY` routes the 8 loose enemy
  types to `"enemies"` + `clearTransient` resets `G.ebolts`). **`enemies-ai.js`
  BUILT** — the nav consumer layer over the pure `nav.js` service (SPEC-ENEMIES
  §3, E2/E3, R1, R6): per-navigator nav sub-block + registry (`addNavigator`/
  `removeNavigator`/`clearNavigators`); repath scheduling (§3.1 eligibility:
  repathTimer floor AND goal-tile-changed OR dirty-path OR no-live-path);
  round-robin budget (§3.2 rotating cursor, ≤`repathBudgetPerFrame` findPath/
  frame, unserviced keep prior path + are first next frame); the once-per-tick
  dirty gate (§3.5 step 2 — **sole consumer of `consumeDirtyTiles`**, R1);
  waypoint-follow steering (§3.3 arriveDist/wpTimeout advance, face toward wp);
  direct-steer fallback (§3.4 `null`→aim-at-player, `[]`→sub-tile approach). Mask
  + mover are **navigator-supplied** so the layer is GROUND/PHANTOM-agnostic;
  `groundMover`/`groundBlockerFilter` provided as the GROUND binding. `updateGhost`
  added here (§6.1.1 — direct steer, no avoidance/repath, per-axis slide only).
  Tests: `test-enemies-nav.js` (24, green). **Phase 3 (combat spine) BUILT** —
  `enemies.js`: the 7-step `tickEnemies` order (§3.5/E11); player-shot→enemy pass
  (§6.5), melee exchange (§6.2/E6), death sweep + `awardKill` (§6.3/E8), shared
  knockback (§6.6), enemy-shot→player (§6.4), Ghost factory (§6.1.1). Roster
  beyond the Ghost, spawners (E4), arced ordnance/`updateEbolts` (E1), the four A*
  types' registration, and the Reaper PHANTOM mover (R4) still pending later
  phases. Tests: `test-enemies-combat.js` (66, green).
- [ ] §5 Abilities — Nova, Lightning, gem economy
- [ ] §3 Power-ups & pickups
- [ ] §12 Meta — menu, pause, options, 5-slot save/load, achievements, high score
- [ ] §9/§10/§11 Scoring, HUD, render/lighting, audio

Repo `src/` contains: `config.js`, `state.js`, `world.js`, `level-loader.js`,
`level-plan.js` (generator content, pure fn of n, 6KB), `level-generator.js`
(geometry/solvability/`generateLevel`, 27KB), `input.js` (device read,
mode-lock FSM, `deriveSnapshot`), `player.js` (locomotion/overlays/sinks +
ordering skeleton + crate carry system + **ranged fire hook**, ~23KB),
`projectiles.js` (**new** — `makeShot` factory + `updateShots` motion/range/
two-source ricochet; imports config/state/world only, never player). `world.js`
re-adds `moveBody` (2-source, filtered) + `bodyHitsBlocker`; now imports
`state.js` (S4, no cycle). `level-loader.js` movable-entity placeholders carry
**pixel** `x,y` (Phase-6 coord reconciliation). `nav.js` (SPEC-PATHFINDING,
COMPLETE: `NAV_MASK`, `isNavBlocked`, `getNavVersion`, `consumeDirtyTiles`,
`installNav` [Phase 1] + `findPath` grid A\* [Phase 2 — 8-dir, octile, per-mask
corner-cut, deterministic]; imports config/state/world/level-loader only, leaf
w.r.t. gameplay). `enemies-ai.js` (**new** — SPEC-ENEMIES Phase 2, the nav
consumer layer: registry + repath scheduler + round-robin budget + dirty gate +
waypoint steering + direct-steer fallback + `updateGhost`; imports config/world/
nav only, sole consumer of `consumeDirtyTiles` [R1], never imported back [R6]).
`enemies.js` (**new** — SPEC-ENEMIES Phase 3, the combat spine: 7-step
`tickEnemies` + player-shot/melee/death-sweep/`awardKill`/knockback/enemy-shot
passes + the Ghost factory; imports config/state/world/player-sinks/level-loader/
enemies-ai, never imported back [R6]). Tests:
`test-config.js` (19), `test-enemies-config.js` (18), `test-world.js` (35),
`test-level-loader.js` (40), `test-level-content.js` (79),
`test-level-generator.js` (20), `test-level-integration.js` (16),
`test-input.js` (19), `test-player.js` (108), `test-projectiles.js` (17),
`test-nav.js` (36), `test-enemies-nav.js` (24), `test-enemies-combat.js` (66) —
all green (**497 checks total**). Subsystems #1, #2, and #3 complete; #4
(Enemies) has its foundation (config/seams) + nav consumer layer + combat spine
+ the Ghost built; the rest of the roster, spawners, and arced ordnance pending.
Next subsystem is #4 (Enemies + spawners), which owns the repath cadence,
round-robin budget, waypoint steering, and direct-steer fallback over `nav.js`
(pending Q1 sign-off — Shape 1 baselined).

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

### 2026-07-05 — `nav.js` occupancy consumed as invalidation-only, not an incremental list — Phase 1 (SPEC-PATHFINDING)
The loader's pre-built blocker-sink seam (`registerBlockerSink`/`markNavDirty`,
SPEC-LEVEL §6.1) hands `nav.js` a whole entity on `registerBlocker`, which could
tempt building an incremental blocker list. **Not done** — that list would go
stale the moment a crate moves (carry system `splice`s + re-inserts, only
calling `markNavDirty`, never re-registering — SPEC-PLAYER §9) or a barrel is
destroyed (SPEC-BARRELS, deferred). Instead `registerBlocker`/`markDirty` are
consumed **purely as invalidation signals** (bump `navVersion`, set
`occupancyDirty`); the mask-split occupancy (`occGround`/`occPhantom`, two
`Set<packedKey>`) is rebuilt lazily from live `G.crates ∪ G.barrels ∪
G.spawners` on the next `isNavBlocked` query. Spawners occupy `GROUND` only
(Q2 baseline — static like terrain to the Reaper, unlike a movable crate/
barrel). GROUND's wall/door truth comes from `world.isWall` live (already
resolves the door-state resolver + OOB) — occupancy never duplicates door
state (would desync on door open). PHANTOM bypasses `isWall` (walls/doors
passable to the Reaper) and has its own explicit OOB guard. This is an
**interpretation of a seam authored before nav existed** (SPEC-PATHFINDING
D3, flagged in the spec itself for a sign-off glance) — not new design, the
spec pinned this reading.

### 2026-07-05 — `findPath` grid A\*: octile heuristic, R1 corner-cut, D7 tie-break — Phase 2 (SPEC-PATHFINDING)
`findPath(sx,sy,gx,gy,mask)` added to `nav.js`, built **entirely on
`isNavBlocked`** — it never hardcodes `world.isWall`, so both masks stay honest
(GROUND: wall+door+object; PHANTOM: object-only). Load-bearing decisions:
- **R1 (the headline — corner-cut × per-mask, the STATUS-flagged Opus-tier
  subtlety): resolved.** A diagonal step `(x,y)→(x+dx,y+dy)` is permitted only
  when **all three** of `isNavBlocked(x+dx,y,mask)`, `isNavBlocked(x,y+dy,mask)`,
  `isNavBlocked(x+dx,y+dy,mask)` are false, **using the step's own mask**. So
  GROUND cannot squeeze a wall corner and PHANTOM's corner-cut is *object-aware,
  not wall-aware* (it slips a wall diagonal but not two diagonally-placed
  crates). Verified by two explicit corner tests (GROUND wall-squeeze between
  `(2,2)`/`(3,3)`; PHANTOM straight diagonal crossing wall `(5,5)`).
- **Heuristic (octile):** `h=(adx+ady)+(√2−2)·min(adx,ady)` — admissible +
  consistent for the {1,√2} cost model, so the closed set never needs re-opening.
- **Tie-break (D7):** open-set min by `f`, then `h` (prefer closer to goal), then
  packed key `ty·COLS+tx` — a **total order**, so identical inputs yield a
  deep-equal path array (determinism test asserts this). `cameFrom` is set only
  on a **strict** gScore improvement, so parent choice is also order-independent.
  Open set is an array-min scan (fine at ~10³ tiles, spec-sanctioned); a `closed`
  Set prevents re-expansion.
- **Sentinel (D6/R6):** absent `gScore` defaults to the finite literal `1e9`,
  never `Infinity` (grep-guarded in `test-nav.js`; the word "Infinity" appears
  nowhere in `nav.js`, comments included).
- **Coords (D5/R5):** start/goal in **pixels** → tile via `(x/TILE)|0`; each
  waypoint carries **both** `{tx,ty}` (identity, for #4's dirty-intersection
  check) and `{x,y}=tileCenter` (pixels, for steering). Path is
  **start-exclusive, goal-inclusive**; `[]` iff start tile === goal tile; `null`
  iff goal blocked (early) or open set exhausts (unreachable). The **start** tile
  is always expandable even when blocked (navigator standing on a dropped crate).
- **Import:** `nav.js` now also imports `tileCenter` from `world.js` (still the
  only allowed edges: config/state/world/level-loader; import-discipline grep
  green). No repath scheduler / navigator registry / `navTick` / steering built —
  Shape-1 baseline (Q1) keeps those in **#4**.

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

### 2026-07-05 — `player.js` register-callbacks seams (S3/§10/§11) — Phase 5 (SPEC-PLAYER)
Three cross-module edges resolved as register-callbacks so `player.js` imports
**only** config/state/world/level-loader/input (grep-asserted in
`test-player.js`), never abilities/enemies/projectiles:
- **abilities (#5) — registry.** `player.js` exposes `registerAbility("nova"|
  "lightning", fn)` (default no-op); the ability edge-trigger in the frame loop
  calls the registered fn. `player.js` never imports `abilities.js`; #5 registers
  its handlers at boot. Abilities are locked while STUNNED (§5.2).
- **enemies (#4) — they call INTO player, player never imports them.** The melee
  overlap loop is #4's; it calls the player's exported sinks
  (`applyDamageToPlayer`/`applyKnockbackToPlayer`) and reads `G.player.loco ===
  "CARRYING"` for the §6.4 pushback rule. `meleeState` is reserved on `G.player`
  for #4's pair-lockout wiring. No player→enemy import exists.
- **events — reuse the loader's `emit` seam (S3).** `player.js` imports the
  loader's already-exported `emit` (Phase 3) for `player:died`, `crate:dropped`,
  `door:unlocked` (snapshot payloads, one-way). No new events module; when
  `events.js` lands it registers its `emit` via the loader's `registerEmit` and
  every producer (loader + player) routes through it unchanged.
- **input — one-way.** `player.js` imports `input.js`'s `getSnapshot` (used by the
  thin production entry `tickPlayer(dt)`); `input.js` imports only config/state.
  The pure `updatePlayer(snapshot, dt)` takes the snapshot as an **argument** — no
  device/canvas import reaches `player.js`, so headless tests drive it with
  synthetic snapshots (§11 testability boundary upheld).

### 2026-07-05 — frame-update ordering skeleton is load-bearing (§11) — Phase 5
`updatePlayer` fixes the §11 order now so Phases 6–7 slot in without reordering:
`snapshot → status timers (iframe/entangle/stun/cooldown) → status-forced drop
(STUN) → [VAULTING? advance vault : move+collision(+plate/key) → carry → abilities
→ fire] → shots update`. VAULTING short-circuits move+carry+fire (the guard is in
even though nothing ENTERS vaulting until Phase 6). Carry actions, fire/volley,
and shot-motion are **named no-op stub hooks** in their slots (`carryActions`,
`tryFire`, `updateShots`); the STUN force-drop calls `dropCarried`, a Phase-5
stub that exits the CARRYING state + emits `crate:dropped` (correct-direction;
the crate LANDING/re-insert is Phase 6). `advanceVault` (the §5.1 lerp + auto-exit)
IS implemented so VAULTING is self-consistent — only vault **entry** (from moving-
release / wall-vault, which is carry-coupled) is deferred to Phase 6.

### 2026-07-05 — FLAGGED HAZARD: crate/blocker entity coords are tile-keyed but `bodyHitsBlocker` reads them as pixels — Phase 5
**Unflagged cross-phase inconsistency surfaced (per CLAUDE.md "phases flag their
own risks").** `world.bodyHitsBlocker` (Phase 2) computes `dx = x - e.x` treating
`e.x,e.y` as **pixel** coords, and `test-world.js`'s synthetic blockers use pixel
coords — but the **loader's placeholder** entity (`mkPlaceholder`) stores `e.x,e.y`
as **TILE** coords with `e.tc` as the pixel center. So collision against a
*loader-placed* crate/spawner would currently mis-measure distance (tile numbers
read as pixels). `player.js` (Phase 5) is unaffected — it supplies only the
carry-aware `blockerFilter` *predicate*; geometry stays in `world.js` — and
`test-player.js` uses pixel-coord synthetic crates (matching the `bodyHitsBlocker`
contract), so all tests are honest. But the mismatch is real and must be resolved
in **Phase 6**, which is where crates are actively spliced/re-inserted and where
the real crate factory (owed by #2) is built. **Resolution options for Phase 6:**
either (a) the real crate/blocker entities carry pixel `x,y` (recommended — matches
`bodyHitsBlocker` + SPEC-PLAYER §2's collision use), or (b) `bodyHitsBlocker`
reads `e.tc`. SPEC-PLAYER §2 pins the crate shape as the loader placeholder
`{type,x,y,tc,blocks}`, so this is a contract reconciliation, not new design — but
it needs a sign-off glance before Phase 6 wires real carry collision.

### 2026-07-05 — RESOLVED (option a): movable entities carry PIXEL x,y — Phase 6 (SPEC-PLAYER)
The Phase-5 flagged coordinate mismatch is resolved as the STATUS-recommended
**option (a)**: `level-loader.js`'s `mkPlaceholder` now stores `e.x,e.y` as the
**pixel** world position (tile center; `tc` unchanged), so all dynamic entities
(player, crates, spawners, later enemies/shots) share **one pixel coordinate
space**. `world.bodyHitsBlocker` already measured `dx=x-e.x` in pixels and the
carry system re-positions dropped crates in pixels, so this makes loader-placed
crates collide/pickup correctly with **no** change to `world.js`. Tile-keyed
lookups (nav-dirty, plate press) derive the tile via `(x/TILE)|0`. Blast radius
was one shipped test assertion: `test-level-loader.js`'s scatter-legality scan
read `e.x,e.y` as tile indices (`map[e.y][e.x]`) — updated to derive the tile
from the pixel center (its *intent*, "no entity on a wall/plate/exit tile," is
unchanged). `test-world.js`/`test-player.js` already used pixel crate coords, so
they were already honest and stayed green. This closes the Phase-5 hazard; the
"real crate factory owed by #2" is satisfied by the reconciled placeholder (carry
state lives on `G.player.carry`, the crate schema is unchanged otherwise).

### 2026-07-05 — carry system: vault detection, degrade rules, adopted behaviors — Phase 6 (SPEC-PLAYER)
`player.js` fills the Phase-5 carry stub hooks with the real bodies (§9, §5.1).
Structure and the load-bearing decisions:
- **Dispatch (in the CARRY slot, AFTER move+collision):** CARRYING + `fireHeld`
  ⇒ release; CARRYING + move-into-wall (no fire) ⇒ wall-vault; hands-free ⇒
  automatic pickup. STUN force-drop stays in the Phase-5 slot BEFORE move
  (`dropCarried`, now a real in-place re-insert). VAULTING short-circuits the
  whole slot (unchanged).
- **Release trigger is LEVEL, not edge** (`fireHeld` true while CARRYING ⇒
  release). It's effectively one-shot because release exits CARRYING; pickup runs
  in the hands-free branch so a fresh pickup can't release the same frame (1-frame
  carry before a held-fire toss). Adopted; flagged for the play-feel pass.
- **Toss reach is grid-snapped to whole tiles:** `floor(tossMax 48 / TILE 32) = 1`,
  so a stationary toss settles **≤1 tile** ahead along aim (within the 1.5 t reach,
  never mid-tile), stopping at the first wall/blocker, min = drop-in-place. This
  avoids the tile-boundary rounding ambiguity of a raw 1.5-tile pixel raycast
  (1.5 t lands on a tile edge). If the play-feel pass wants the extra half-tile,
  bump `tossMax` or change the snap.
- **Vault detection (§9):** moving-release vaults `from + vaultHop(64=2t)` along
  MOVE, landing validated **at ENTRY only** (`!isWall(landingTile)`) — a
  non-walkable landing **degrades to a stationary toss** (the single degrade
  target for *any* vault that can't start). Wall-vault raycasts **tile-by-tile
  from the player tile** along the dominant move axis: `ahead1` solid AND `ahead2`
  walkable ⇒ 1-thick ⇒ drop-against-near-face + vault to the far tile center;
  `ahead2` also solid ⇒ ≥2-thick ⇒ **no vault, just a bump** (crate stays carried).
  VAULTING cannot start while ENTANGLED/STUNNED (`canVault`): moving-release then
  degrades to a toss, wall-vault becomes a plain bump. (STUN also force-drops the
  crate a step earlier, so its carry path is unreachable — `canVault`'s stun test
  is belt-and-suspenders.)
- **Plate hold by resting crates (§7.1.6):** the loader's plate seam is a boolean
  per plate (no refcount), so `player.js` is the single authority: `updatePlatePress`
  OR-combines the player footprint **and** every resting crate's tile into one
  pressed-set and diffs it — a plate releases only when *neither* the player nor
  any crate sits on it. Called from `doMovement` (player moved) AND from every
  pickup/drop (crates changed), so a dropped crate keeps a door open after the
  player walks off, until the crate is removed.
- **Every drop path funnels through `dropCrateAtTile`** (toss / moving-drop /
  wall-vault / stun) so none can miss the `G.crates` push + `markNavDirty` (a
  missed nav-dirty = ghost blocker — the flagged risk). It reuses `carry.entity`
  (preserves identity for future barrels) and re-presses the plate under it.
- **`carry.type` is `"crate"`-only**, shaped to admit `"barrel"` (SPEC-BARRELS)
  without rework; pushback is exposed as `isCarryingCrate()` for #4's melee loop
  (no loop here — #4 executes the 1.5 t enemy pushback + bat exemption, §6.4).
- **Q-P3 adopted:** "moving" = move-input nonzero this frame (a tap at release can
  trigger a vault) — for the play-feel pass. **Q-P4 adopted:** vault landing is
  validated at entry only; an enemy may occupy it mid-hop — land anyway (VAULTING
  is invulnerable + non-colliding), resolve overlap next frame.

### 2026-07-05 — FLAGGED (play-feel, not correctness): two emergent carry edges — Phase 6
Two edges emerge from composing spec-adopted behaviors; both keep state
consistent (no crash/corruption), so they're logged for the play-feel pass, not
fixed by invented design (per CLAUDE.md "surface, don't invent"):
1. **Toss-into-wall re-pickup oscillation.** A stationary toss facing a
   wall/blocker drops the crate **in place** (min 1-tile placement fell back to
   the player's own tile). Since pickup is *automatic on contact* and release is
   *level-triggered*, holding fire against a wall while carrying oscillates
   pickup→toss→pickup every ~2 frames (emitting `crate:pickup`/`crate:dropped`
   each cycle). Normal tosses land 1 tile ahead (32 px > the 28 px pickup range),
   so this only occurs when the toss can't advance at all. A drop→re-pickup
   "must break contact first" latch would fix it if it bothers play-feel.
2. **Diagonal wall-vault on the dominant axis.** Wall-vault triggers on
   *tile-adjacency* along the dominant move axis (the prompt's literal "raycast
   from player tile along move"), not on a tight pixel press (moveBody's
   whole-step revert leaves a fuzzy up-to-step-size gap, so tight adjacency isn't
   reliably reachable). Consequence: moving diagonally with the dominant component
   into a 1-thick wall can vault across it even when the player meant to slide
   along the perpendicular axis. Parallel movement (dominant axis perpendicular to
   the wall) is safe. A "both axes blocked" or intent gate would tighten it.

### 2026-07-05 — `projectiles.js` seam: player→factory (one-way), owner-tag, owner-scoped cap, audio leaf — Phase 7 (SPEC-PLAYER)
`projectiles.js` is the first occupant of subsystem-#2's shot module and the
last cross-module edge of the player build. Decisions:
- **player → projectiles is one-way (§11).** `player.js` imports `makeShot` +
  `updateShots` from `projectiles.js`; `projectiles.js` imports config/state/world
  ONLY and **never** imports `player.js`. The shooter is a **string `owner` tag**
  (`"player"`) on the Shot, not a back-reference — so enemy arrows / shrapnel join
  the same `G.shots` array later behind the same shape with `owner:"enemy"`. This
  **updates the Phase-5 import-discipline rule**: `player.js` now legitimately
  imports `projectiles.js` (still NOT abilities/enemies/combat). The
  `test-player.js` grep was updated accordingly (allow `projectiles.js`; still
  forbid abilities/enemies/combat/audio).
- **Owner-scoped cap (key ADD divergence).** The volley gate counts
  `owner==="player"` shots on screen, **NOT** `G.shots.length` (ADD's rule) — enemy
  shots will share `G.shots` and must not consume the player's cap. Asserted by a
  test that seeds an `owner:"enemy"` shot and confirms it doesn't block a player
  volley.
- **Two-source ricochet (the §12.5 escalation risk — passed first pass, no Opus
  escalation).** `updateShots` reflects per-axis (ADD pattern) off **two** sources:
  **crates always** ricochet ALL straight projectiles (even non-bounce, §7.1.1/
  §13.23) retaining owner+dmg with range NOT reset; the **Bounce power-up
  additionally** ricochets off `isWall`-solid tiles (walls/tombstones/pillars/
  closed doors), range NOT reset, `bounceCount++`. A **non-bounce** shot reflects
  off crates but **expires** on first wall contact. **bounceCount asymmetry:** per
  §8's explicit wording, a crate ricochet does **not** increment `bounceCount`
  (it's the Bounce-power-up wall tally for future achievements); only Bounce-wall
  reflections do. Flagged here as an interpretation of §8, not invented design.
  Crate detection is tile-based (`crateAt`, reads `G.crates` only — barrels don't
  ricochet, they're deferred combat objects).
- **Audio is a leaf seam (§10).** `player.js` calls `sfx.shoot()` once per trigger
  through a `registerSfx(handlers)` seam (default no-op `{shoot(){}}`); it never
  imports `audio.js` (a later leaf subsystem). Same register-callbacks shape as the
  ability seam. **Owed by audio (#11):** register real `sfx.*` handlers at boot.
- **"Fired while carrying" ordering guard (§11).** The frame loop captures
  `wasCarrying = loco==="CARRYING"` **before** the carry step and skips `tryFire`
  when true — so a stationary release-toss (which returns to NORMAL the same frame)
  can't ALSO fire a shot from the same held-fire input. VAULTING is already
  fire-blocked by the outer short-circuit; STUN force-drops before move so a
  stunned player is NORMAL (and CAN fire, §2.5). Tested: cannot-fire-while-CARRYING,
  can-fire-while-STUNNED, cannot-fire-while-VAULTING.

### 2026-07-05 — S1 (`G.powerups` keys) resolution APPLIED — Phase 7
The Phase-1 S1 ruling (canonical keys `triple/big/fast/bounce`, no `Shot` suffix)
is now **exercised in live code**: `tryFire` reads `G.powerups.triple/big/fast/
bounce` and decrements each active counter by 1 per trigger. Fetched ADD source
uses `rapid` (not `fast`) and `G.shots.length` (not owner-scoped) — both
intentional Repossessed divergences (Fast substitutes ADD's Rapid; cap is
owner-scoped), applied as flagged, not papered over. No conflict surfaced against
the local `state.js` contract.

### 2026-07-05 — `enemies-ai.js` nav consumer layer: single-consumer + one-way import — Phase 2 (SPEC-ENEMIES)
The nav consumer layer (repath scheduler / round-robin budget / waypoint steering /
direct-steer fallback) is built as **`enemies-ai.js`**, a thin layer over the pure
`nav.js` service. `nav.js` was **not** touched (no scheduling added to it — per the
phase constraint). Load-bearing decisions:
- **R1 — `consumeDirtyTiles()` is single-consumer; `enemies-ai.js` OWNS it.** The
  dirty gate (`applyDirtyGate`, called once inside `scheduleRepaths`) drains it
  **exactly once per tick**, gated on a `getNavVersion()` change. Because
  `consumeDirtyTiles` clears-on-read, any second consumer would silently lose
  dirtied tiles and crate barricades would stop re-routing. An explicit ownership
  comment marks this in `enemies-ai.js`; the R1 test asserts two ticks in one
  frame drain once (the second sees empty) and an external drain after scheduling
  finds nothing.
- **Dirty-hit is a STICKY per-navigator flag** (`nav.dirtyHit`), set by the gate
  when a drained tile intersects the navigator's `pathTiles`, cleared only on the
  navigator's next actual repath. This is required because the dirty Set is drained
  once per frame but a force-eligible navigator may be **budget-starved** that
  frame — the sticky flag survives to its next slot even though the Set is already
  empty. `nav.dirtyHit` is an internal field on the §2 nav sub-block.
- **R6 — one-way import flow.** `enemies-ai.js` imports **config / world / nav**
  only right now (the allowed set also permits `state` and, later, `projectiles`
  `makeShot`). It is **never** imported by `nav.js` / `player.js` / `projectiles.js`
  (grep-asserted both directions in `test-enemies-nav.js`). Flow is
  `enemies-ai → {nav, world}`, never back.
- **Layer is mask/mover-agnostic (keeps GROUND vs the Reaper's PHANTOM mover out
  of the layer).** A navigator supplies its `mask` (GROUND/PHANTOM, for `findPath`)
  and a `mover(e,dx,dy)` (the class-appropriate `moveBody`+filter). The layer
  computes the displacement magnitude from `e.speed` (treated as **effective**
  px/s — ramp application stays the caller's job per E10, so this layer never
  double-applies `G.ramp.enemySpeedMult`). `groundMover`/`groundBlockerFilter`
  (crates+barrels+spawners all block, §4) are exported as the GROUND binding;
  the Reaper's crates+barrels-only PHANTOM mover (R4 — must NOT use `bodyHitsWall`)
  is owed by `enemies.js`, not built here.
- **R9 upheld:** `arriveDist`(9)/`wpTimeout`(5) read straight from `CFG.ENEMY` as
  px / s — never re-multiplied by `TILE` (the waypoint `x,y` is already a pixel
  tile-center).
- **Test seam:** `__getRepathCount`/`__resetRepathCount` count `findPath`
  invocations (one per repath) for the budget/R1 tests; `__rebuildPathTiles(e)`
  lets a headless test synthesise a path and its dirty-intersection set without a
  live `findPath`. All `__`-prefixed, clearly test-only.

### 2026-07-05 — `enemies.js` combat spine: the 7-step order, `awardKill` seam, one-way flow — Phase 3 (SPEC-ENEMIES)
`enemies.js` built as the enemy combat spine, proven end-to-end with the Ghost
(§6.1.1 — the minimal roster member that exercises chase → melee → death → gems +
score → knockback → crate pushback). Load-bearing decisions:
- **The 7-step `tickEnemies(dt)` order is a CONTRACT (§3.5/E11), noted explicitly
  like `player.js`'s step order:** (1) spawner emit [Phase-4 no-op hook] → (2) nav
  scheduler (`scheduleRepaths`) → (3) player-shot→enemy pass → (4) melee exchange →
  (5) **death sweep** → (6) enemy AI tick over survivors (emergence gate → knockback
  integrate → per-type move/attack) → (7) `updateEbolts` [Phase-7 no-op] +
  enemy-shot→player hit-test. **R2/E11 baked in:** EXPLODE fires in step 6, AFTER
  the step-5 sweep, so a Wraith shot down the frame its FLASH completes is DEFUSED
  (removed before its AI runs). Proven structurally now (a synthetic "would-explode"
  type whose AI is a spy: lethal-in-step-3 → swept → AI never runs; survivor →
  AI runs). The concrete Wraith-defuse test lands in Phase 6.
- **`awardKill(e, cause)` seam + SPEC-SCORING hand-off (E8).** Thin direct impl:
  `cause.startsWith("player-")` (`player-bullet`/`player-melee`) → `G.score +=
  e.points`; `wraith-aoe`/`enemy-*`/unknown → 0. The death sweep drops `e.gems`
  gem pickups **ALWAYS** (position loot, not a score award — **Q3 baked-in: yes,
  friendly-fire kills still drop gems**), regardless of cause. Cause is tagged on
  the lethal blow (`e._cause`, `!e._cause`-guarded so a step-3 bullet tag survives a
  step-4 melee overlap) and read by the sweep. **Owed:** SPEC-SCORING replaces
  `awardKill` with the full chain-of-custody (barrel tags, shrapnel adoption) and #5
  routes Nova/Lightning through the same seam — this phase just hands it the `cause`
  string.
- **Melee null-guard + 3-arg knockback (E6).** `const m = CFG.ENEMY[e.type]?.melee;
  if (m != null) applyDamageToPlayer(m, e.type)` — a meleeless type (the Fire Wraith
  has no `melee` field ⇒ `undefined`) deals 0 to the player but still takes the
  player's 2. Player knockback uses the real **3-arg** signature
  `applyKnockbackToPlayer(dirX, dirY, impulse)` (not `(dir, impulse)`). The pair
  lockout is held on BOTH `e.contact` (the gate) and `G.player.meleeState` (a
  `Set<enemy>`, lazily created; reserved as `null` by `initPlayer`). Crate bumper
  (§6.4): `isCarryingCrate() && e.type !== "bat"` → push `CFG.ENEMY.knockbackPush`
  (≈1.5 t), SKIP the exchange, do NOT lock; bats ignore the bumper and exchange
  normally.
- **Q2 baked-in (§6.5):** a Bounce player-shot is CONSUMED on an enemy hit like any
  other shot (Bounce is a wall ricochet, not a pierce). The shot pass consumes on
  first enemy contact regardless of `s.bounce`.
- **Enemy `speed` stored EFFECTIVE — reconciles §2 vs the enemies-ai contract.**
  §2's data shape comments `speed` as BASE, but the built `enemies-ai` layer
  (`stepToward`/`updateGhost`) treats `e.speed` as **effective** px/s and never
  re-applies the ramp (STATUS §enemies-ai). Resolved by having the factory bake the
  ramp ONCE: `e.speed = speedMul × CFG.PLAYER.speed × (G.ramp.enemySpeedMult ?? 1)`.
  Ramp is snapshotted before placements and never changes mid-level (§8.6), so
  factory-time == read-time (E10: HP/damage never ramp; one place applies speed).
- **Emergence gate applies to collision, not just AI (E4).** Steps 3 (shots) and 4
  (melee) skip `spawn > 0` enemies — an emerging enemy "exists but does not act or
  collide until spawn ≤ 0." (No spawners this phase, so all Ghosts have `spawn = 0`;
  the guard is forward-safe for Phase 4.)
- **Knockback dials added to `CFG.ENEMY` (§6.6, proposed/Q-tuning):**
  `knockbackImpulse` 350 (melee ≈0.5 t), `knockbackPush` 1040 (crate bumper ≈1.5 t),
  `knockbackFriction` 9 (mirrors `CFG.PLAYER`). Shared velocity+friction model
  (`applyKnockbackToEnemy` SETS `e.kvx/kvy`; `integrateEnemyKnockback` decays by
  `exp(-friction·dt)` and routes through `groundMover` so a knocked enemy can't
  tunnel a wall). Flight (Bat, Phase 4) takes it as a **raw** nudge — the fn already
  branches on `nav === "flight"` (R8-shaped now, per the prompt).
- **R3 grep-guard:** no `owner:"player"` producer literal outside `player.js`'s
  `spawnVolley` — asserted over `enemies.js`/`enemies-ai.js` in the test (comments
  reworded to `player-owned` so the guard flags only real producers).
- **Test seams:** the spine's individual passes are re-exported `__`-prefixed
  (`__playerShotEnemyPass`/`__meleeExchange`/`__deathSweep`/`__enemyAITick`/
  `__enemyShotPlayerPass`) so headless tests exercise one step without a full tick's
  side effects; `__setEnemyAI(type, fn)` injects a synthetic type's AI for the R2
  structural proof. All clearly test-only.

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

### 2026-07-05 — SPEC-PLAYER Phase 5 (`player.js` core — ordering, locomotion, overlays, world hooks, sinks)

Built `src/player.js` (new, ~13KB, one concern) + `test-player.js` (49 checks
green). Imports only config/state/world/level-loader/input (grep-asserted); never
abilities/enemies/projectiles. **`updatePlayer(snapshot, dt)` is a pure function
of (snapshot, dt, G)** — the production entry `tickPlayer(dt)` pulls the live
snapshot from `input.getSnapshot` and delegates.

Implements (this phase — NORMAL locomotion + overlays + sinks; carry = Phase 6,
fire/projectiles = Phase 7 as named stub hooks):
- **`initPlayer()`** augments the loader-set `G.player {x,y,tx,ty}` with the §2
  live fields (r/angle/vx-vy/kv/loco/carry/iframe/vault/entangle/stun/stunVec/
  meleeState/cooldown + `_platesPressed`).
- **Frame ordering (§11, load-bearing)** — see Architecture decision above.
- **Movement (§4.1/§4.2):** effective speed = `CFG.PLAYER.speed × Π(P3 modifiers)`
  MULTIPLICATIVE (carry/entangle/stun co-occur) via exported `effectiveMoveSpeed`;
  step through `world.moveBody` with the carry-aware `playerBlockerFilter`
  (hands-free ⇒ only spawners solid, crates/barrels are pickup triggers; carrying
  ⇒ all solid; never the carried entity). Knockback integrated separately, decays
  `exp(-friction·dt)`, zeroed under a 1 px/s threshold, still collides.
- **World hooks (§4.3):** pressure-plate press by weight (footprint-scan `_` tiles
  → `setPlatePressedAt`, released on leaving); key-spend on a closed `D`
  (confirm char via `world.map`, `G.keys--`, `openLockedDoor`, emit
  `door:unlocked`, then the now-passable move proceeds; keys 0 ⇒ just blocked).
- **Overlays (§5.2):** ENTANGLED (×0.35 + ≥60° input-turn shaves 0.3s vs
  `entangleAngle`); STUNNED (input replaced by a random unit vector re-rolled every
  0.3s at ×0.7, forces immediate drop, abilities locked); POST-HIT invuln (0.4s).
  Drivers deferred (#4/#5); logic testable by setting fields directly.
- **Sinks (§6.1/§6.2):** `applyDamageToPlayer` (no-op under iframe/VAULTING; else
  hp-=amount, arm 0.4s iframe, hp≤0 ⇒ DEAD + emit `player:died`, final);
  `healPlayer` (clamps at `G.overhealCap`=30); `applyKnockbackToPlayer` (kv =
  unit(dir)×impulse). `registerAbility` edge seam (locked while stunned).
- **VAULTING kinematics (§5.1):** `advanceVault` lerps from→to over `vaultDur` and
  auto-returns to NORMAL (entry deferred to Phase 6).

Tests cover §12 items 2 (wall slide / spawner block / hands-free-crate-not-blocked
/ carrying-crate-blocked), 3 (multiplicative stack, exact 112×0.85×0.35(×0.70)),
6 (damage subtract + iframe + iframe/VAULTING no-op + heal clamp + DEAD +
`player:died` + death-is-final), 9 (plate opens/closes linked door; key spend at
keys≥1 vs blocked at keys=0), 10 (entangle ≥60° shaves 0.3s / sub-threshold does
not), the STUN random-walk + force-drop (`crate:dropped`, deterministic via a
stubbed `Math.random`), knockback set/decay/settle, the abilities edge+stun-lock
seam, `initPlayer` shape, and the config/state/world/level-loader/input-only import
grep. Full suite green, 275 checks total (config 17 / world 35 / level-loader 40 /
level-content 79 / level-generator 20 / level-integration 16 / input 19 /
player 49).

**Decisions surfaced & logged under Architecture:** the three register-callbacks
seams (abilities registry / enemy-calls-into-player / loader `emit` reuse) + the
one-way input boundary; the load-bearing frame-ordering skeleton and its named
stub hooks; and — flagged as an **unflagged cross-phase hazard** — the crate/
blocker entity coordinate mismatch (loader stores tile `x,y`; `bodyHitsBlocker`
reads pixels), owed to Phase 6 to reconcile (SPEC-PLAYER §2 pins the crate shape,
so it's a contract reconciliation, not new design). **§2 build-status box NOT
flipped to BUILT** (carry + fire pending). No git.

### 2026-07-05 — SPEC-PLAYER Phase 6 (`player.js` — crate carry system)

Filled the Phase-5 carry stub hooks with the real bodies (SPEC-PLAYER §9, §5.1);
`player.js` grew ~13KB→~21KB (still one concern — the player entity). Extended
`test-player.js` (49→88 checks). Also resolved the Phase-5 coordinate hazard by
editing `level-loader.js`'s `mkPlaceholder` (movable entities now carry pixel
`x,y`) + one `test-level-loader.js` assertion. No git. Import discipline held
(player.js still config/state/world/level-loader/input only; added `markNavDirty`
from the loader — same module).

Implements (§9):
- **Pickup** — automatic on hands-free overlap with a free crate (pixel circle at
  `r+TILE/2`): splice from `G.crates`, `markNavDirty` the old tile, `carry =
  {type:"crate", entity}`, `loco="CARRYING"`, emit `crate:pickup`. Locked while
  STUNNED; no swap while carrying (crate stays solid via the Phase-5 filter).
- **Release** (`fireHeld` while CARRYING, P5) — branches on move-input this frame:
  stationary ⇒ short toss (≤1 grid tile along aim, stop at first wall/blocker,
  min drop-in-place, press a `_` under it); moving ⇒ drop-in-place + auto-vault
  `+2t` along move, landing validated at entry, non-walkable ⇒ degrade to toss.
- **Wall-vault** — CARRYING + moving into a 1-thick wall (ahead1 solid, ahead2
  walkable) ⇒ drop against the near face + vault to the far tile; ≥2-thick ⇒ bump
  (crate kept). Crate-only. Guarded by `canVault` (no entry while ENTANGLED/STUNNED).
- **STUN force-drop** — `dropCarried` is now a real in-place re-insert (settles the
  crate on the current tile, presses a `_`, back to NORMAL) BEFORE move resolves.
- **Plate hold** — `updatePlatePress` OR-combines player + resting-crate weight so a
  dropped crate keeps a door open until removed (loader plate seam is a bare
  boolean; player.js is the single OR authority). Called from move + every
  pickup/drop.
- **Pushback flag** — `isCarryingCrate()` exported for #4's melee loop (§6.4); no
  loop here.

All drop paths funnel through `dropCrateAtTile` (guarantees the `G.crates` push +
`markNavDirty`, reuses `carry.entity` for future-barrel identity, re-presses the
plate). `carry.type` is `"crate"`-only, shaped for `"barrel"` later.

Tests added (§12 items 2/7/8/9): pickup (splice + nav-dirty spy + `crate:pickup` +
no-swap), stationary toss (≤1t settle + `crate:dropped(reason=toss)` + NORMAL),
moving drop-vault (VAULTING + invulnerable mid-hop + lands +2t through a wall,
non-colliding + degrade-on-non-walkable-landing), wall-vault (1-thick vaults to
far side / 2-thick bumps, crate kept), STUN real force-drop (re-insert on the
player tile + `reason=stun`), vault status guards (ENTANGLED moving-release
degrades / ENTANGLED wall-vault bumps / STUNNED can't start), and the
dropped-crate-holds-plate lifecycle (press → hold after player leaves → release on
removal). Full suite green, **314 checks** (config 17 / world 35 / level-loader 40
/ level-content 79 / level-generator 20 / level-integration 16 / input 19 /
player 88).

**Decisions surfaced & logged under Architecture:** the coordinate hazard RESOLVED
as option (a) (pixel entity `x,y`); the vault-detection + degrade rules + the
Q-P3/Q-P4 adopted behaviors; and two emergent **play-feel** edges flagged (not
fixed): toss-into-wall re-pickup oscillation, and diagonal wall-vault on the
dominant axis. **§2 build-status box NOT flipped to BUILT** (ranged fire +
projectiles, Phase 7, still pending). No git.

### 2026-07-05 — SPEC-PLAYER Phase 7 (`projectiles.js` + player.js fire hook) — subsystem #2 complete

Built `src/projectiles.js` (new, ~3KB, one concern — player shots) and filled the
Phase-5 fire stub in `player.js` (`tryFire` + `spawnVolley`, ~23KB). Removed the
local `updateShots` stub — `player.js` now imports `updateShots` (+ `makeShot`)
from `projectiles.js` (one-way; `projectiles.js` imports config/state/world only).
Added a `registerSfx` audio leaf seam. **§2 (Player) and §7.1 (crates) build-status
boxes flipped to BUILT; barrels §7.2 remain deferred to SPEC-BARRELS.**

Implements (§7 fire, §8 shots):
- **Fire hook (§7).** Runs only in NORMAL. Per-trigger flags `tri/big/fast/bn`
  from `G.powerups.triple/big/fast/bounce`. `cap = baseMax(3) + (fast?3:0) +
  (tri?3:0)`; `cooldown = 0.25 / (fast?2:1)`; `volley = tri?3:1`. Gate: `fireHeld
  && cooldown≤0 && playerShotCount + volley ≤ cap`, **playerShotCount counts
  `owner==="player"` only** (not `G.shots.length` — enemy arrows share the array
  later). On fire: spawn volley, set cooldown, decrement each active counter by 1,
  `sfx.shoot()` once, emit `player:fired`. Volley muzzles + travels along each
  fan angle (single = aim; Triple = ∓Δ/0/+Δ, Δ=0.2094); Big is TWO independent
  multipliers (r×1.6 AND dmg×2). Facing = fire dir on a firing frame (§2).
- **`makeShot` factory (§2 shape):** `{x,y,vx,vy,r,dmg,traveled,owner,bounce,
  bounceCount}` — no ADD extras.
- **`updateShots` (§8):** integrate, `traveled += |step|`, expire at range(224);
  non-bounce also expires on first wall. Two-source per-axis ricochet (crates
  always / Bounce-walls) — see Architecture note above.

Tests: `test-projectiles.js` (new, 17 checks — range expiry / non-bounce dies on
wall & doesn't reflect / Bounce reflects off wall + crate retaining owner+dmg,
range-not-reset, bounceCount++ / non-bounce crate-always ricochet with no
bounceCount) + extended `test-player.js` (88→108 — base gate + cooldown, Triple
fan ∓12°, Fast half-cooldown +3 cap, Big dmg2/r×1.6, all-four-decrement, bounce
flag, cannot-fire-CARRYING, can-fire-STUNNED, cannot-fire-VAULTING, owner-scoped
cap). **Full suite green, 351 checks** (config 17 / world 35 / level-loader 40 /
level-content 79 / level-generator 20 / level-integration 16 / input 19 /
player 108 / projectiles 17).

**Escalation trigger NOT hit:** the phase flagged the two-source ricochet + owner-
scoped cap (§12.5 tests 4 & 5) as the Opus-escalation risk — both passed on the
first implementation pass. **No spec gaps requiring invented design;** the S1
`G.powerups`-keys ruling was applied in live code and the ADD divergences
(Fast-for-Rapid, owner-scoped cap, crate-always ricochet) applied as flagged. One
§8 interpretation logged (crate ricochet doesn't bump `bounceCount`). No git.

### 2026-07-05 — SPEC-PATHFINDING Phase 1 (`CFG.NAV` + `nav.js` infrastructure)

First build phase of subsystem #3 (Pathfinding). Built `src/nav.js` (new,
~3KB, one concern — well under the 24KB smell) + `test-nav.js` (new, 24 checks
green) + extended `test-config.js` (17→19). Added `CFG.NAV` (`repathMinInterval:
0.5`, `diagonalCost: Math.SQRT2`) to `config.js` — data only, leaf import-count
unchanged (grep-verified still 0 imports).

Implements (SPEC-PATHFINDING §2/§3/§4, everything except `findPath`):
- **`NAV_MASK`** (`GROUND`/`PHANTOM`) + **`isNavBlocked(tx,ty,mask)`** (§D2):
  GROUND = `world.isWall(tx,ty) || occGround.has(tile)` (free terrain/door/OOB
  from the live tile-state resolver); PHANTOM = `outOfBounds(tx,ty) ||
  occPhantom.has(tile)` (walls/doors passable to the Reaper; own explicit OOB
  guard per R4, since it never calls `isWall`).
- **Mask-split occupancy** (`occGround`/`occPhantom`, two `Set<packedKey>`),
  lazily rebuilt from live `G.crates`/`G.barrels`/`G.spawners` on
  `occupancyDirty` (O(#objects)). Crates/barrels occupy **both** masks;
  spawners occupy **GROUND only** (Q2 baseline — see Decision log above).
  Terrain/doors are never copied into occupancy (R3) — GROUND reads them live.
- **Dirty/version mechanism:** `invalidate()` (bump `navVersion`, set
  `occupancyDirty`), `getNavVersion()`, `consumeDirtyTiles()` (drains the
  `Set`, returns `[{tx,ty}]`).
- **Seam fill:** `installNav()` registers a `navBlockerSink` on the loader's
  `registerBlockerSink` (SPEC-LEVEL §6.1) — `registerBlocker`/`markDirty` are
  consumed as invalidation-only signals, never an incremental list (D3 — see
  Decision log above for the full rationale).
- **D6 sentinel:** no `Infinity` anywhere in the file (grep-tested); `gScore`/
  A\* itself doesn't exist yet (Phase 2), so this just confirms the house rule
  wasn't violated by anything shipped this phase.

Tests (`test-nav.js`, §10 items 1/4/5/6/7/8/9(partial)/11/12/13 — items 2/3/10
are A\*-specific and deferred to Phase 2): GROUND wall/floor + closed↔open
plate-door round-trip via a real `setPlatePressedAt` press (live `world.isWall`
round-trip); PHANTOM passes a wall tile and a closed door, rejects OOB tiles
both negative and `>=COLS`; spawner blocks GROUND but not PHANTOM (Q2 baseline
pin); occupancy derives from live `G` — a seeded crate blocks both masks, a
`splice`+`markDirty` clears it, and a `markDirty` with **no** backing `G` entry
blocks nothing (proves invalidation-only consumption, not a stale list);
`getNavVersion` strictly increases per `markDirty` call and `consumeDirtyTiles`
returns exactly the accumulated tiles then clears; `installNav` wiring
end-to-end through a real loader door-press; import-discipline grep (only
config/state/world/level-loader); source grep for zero `Infinity`. Full suite
green, **377 checks total** (config 19 / world 35 / level-loader 40 /
level-content 79 / level-generator 20 / level-integration 16 / input 19 /
player 108 / projectiles 17 / nav 24).

**No spec gaps requiring invented design.** The one interpretation this phase
made (occupancy consumption as invalidation-only, D3) was explicitly flagged
*by the spec itself* as needing a sign-off glance, not discovered — logged
under Decision log above, not invented. **§6.4 build-status box NOT flipped**
(`findPath` is Phase 2, the R1 corner-cut × per-class-mask subtlety flagged
for Opus/thinking-on/high-effort per the phase prompt's own escalation rule).
No git.

### 2026-07-05 — SPEC-PATHFINDING Phase 2 (`findPath` — grid A\*)

Added `findPath(sx,sy,gx,gy,mask)` to `nav.js` (the file's second and final
concern), built entirely on Phase 1's `isNavBlocked`. **Subsystem #3 is now
complete** and the **§6.4 build-status box is FLIPPED to BUILT.** Grid A\*,
8-directional (orthogonal 1.0 / diagonal √2), octile heuristic, corner-cut
prevention under the step's own mask, `1e9` gScore sentinel, total-order
tie-break (f→h→packed-key) for determinism. Returns start-exclusive /
goal-inclusive `{tx,ty,x,y}` waypoints, `[]` when start tile === goal tile,
`null` when the goal is blocked or unreachable; the start tile is always
expandable even if blocked. `nav.js` now also imports `tileCenter` from
`world.js` (still leaf w.r.t. gameplay). See the Decision log entry above for
the full R1/D5/D6/D7 rationale.

Extended `test-nav.js` (24 → 36 checks, +12) covering SPEC-PATHFINDING §10
items **1** (open-floor straight diagonal, monotone, length == chebyshev),
**2** (GROUND wall detour — routes around, crosses no `isWall`, longer than the
blocked straight line), **3** (GROUND corner-cut — two walls meeting at a
diagonal; walk the path, assert every diagonal hop's two shared orthogonals are
GROUND-passable, and the `(2,3)↔(3,2)` wall-squeeze is absent), **4** (plate-door
closed→`null` / press via loader seam→routes through the door tile — a real
`markDirty` round-trip), **5** (PHANTOM ignores walls — straight diagonal that
*crosses* a wall tile, proving PHANTOM corner-cut is object-aware not
wall-aware), **6** (PHANTOM crate-line detour then `splice`+`markDirty`→straight
again), **9** (sealed-pocket goal→`null` via open-set exhaustion; PHANTOM OOB
goal→`null` (R4); start tile === goal tile→`[]`), **10** (determinism — identical
inputs deep-equal across repeated calls). Full suite green, **389 checks total**
(config 19 / world 35 / level-loader 40 / level-content 79 / level-generator 20 /
level-integration 16 / input 19 / player 108 / projectiles 17 / nav 36).

**No spec gaps requiring invented design.** One test assertion self-corrected
mid-build (not a spec/design issue): the PHANTOM crate-detour was first asserted
"longer than straight" by **tile count**, but a diagonal detour can reach the
goal in the *same* tile count as the orthogonal straight line (diagonals cover
both axes) — the honest "routes around" assertion is that the path **leaves the
blocked straight row**, which it must, since the crates seal that row. Fixed and
green. **Owed (unchanged from the spec's seam list):** the repath scheduler /
round-robin / waypoint steering / direct-steer fallback → **#4** (pending **Q1**
sign-off, Shape 1 baselined); `installNav()` wiring into game startup → later
**integration** phase; barrel-destruction `markNavDirty` → **SPEC-BARRELS**.
No git.

### 2026-07-05 — SPEC-ENEMIES Phase 1 (`CFG.ENEMY`/`CFG.GEM` + three shipped-file seam edits)

First build phase of subsystem #4 (Enemies + spawners). Additive data plus
three surgical `str_replace` edits into already-shipped files (SPEC-ENEMIES §5,
§7, E1, E5, E7) — no AI/combat logic built yet. New `test-enemies-config.js`
(18 checks green). Full suite green, **407 checks total** (config 19 / world 35
/ level-loader 40 / level-content 79 / level-generator 20 / level-integration 16
/ input 19 / player 108 / projectiles 17 / nav 36 / enemies-config 18).

- **`config.js` — `CFG.ENEMY` + `CFG.GEM` added** (transcribed from
  SPEC-ENEMIES §5 verbatim): shared nav-consumer dials
  (`repathMinInterval`/`repathBudgetPerFrame:4`/`arriveDist:9`/`wpTimeout:5`),
  all nine per-type stat rows (`ghost`/`skeleton`/`skeletonShooter`/`lobber`/
  `bat`/`spider`/`zombie`/`fireWraith`/`reaper`) + the `spawner` row, and
  `CFG.GEM.energy:5`. Speeds are `speedMul` (resolved to px/s at read time by
  #4's later AI code, never here). **Spider has no base `speedMul`** — its
  speed is entirely described by its burst/pause FSM fields
  (`burstMul`/`burstDur`/`pauseDur`/`retreatDur`), matching SPEC-ENEMIES §5's
  spider row exactly (flagged in the config-sanity test, not a gap). The
  Reaper's `blastRange` (R7, previously `<dial>` in the spec) is set to the
  spec's own proposed value, **448 px (14 t)**, commented `// proposed, Q5/R7`.
  No `Infinity` anywhere (sentinel discipline, grep/recursive-scan tested).
  `config.js` stays a leaf — no new imports.
- **`projectiles.js` (E1)** — `makeShot` gained two new optional params,
  **`maxTravel`** (default `undefined`) and **`effect`** (default `"damage"`),
  both carried onto the returned Shot unchanged alongside every existing field.
  `updateShots`' expiry comparand changed from `s.traveled >= CFG.SHOT.range` to
  `s.traveled >= (s.maxTravel ?? CFG.SHOT.range)` — the only line touched;
  ricochet logic and the non-bounce wall-fizzle are untouched. `updateShots`
  remains owner-agnostic motion (never applies damage).
- **`player.js` (E7)** — added `export function applyEntangle(seconds)`
  (`p.entangle = Math.max(p.entangle, seconds)`, `p.entangleAngle = null`).
  Does not trip iframe (web is 0-damage) and does not gate on `loco` (entangle
  stacks with locomotion per §2.5). Placed next to `applyEntangleShave`; the
  existing entangle machinery (decrement in `tickPlayer`, `entangleMult` in
  `effectiveMoveSpeed`, the shave) is unchanged — this only adds the missing
  setter the Spider web will call.
- **`level-loader.js` (E5 + E1)** — `ENTITY_ARRAY` gained the eight loose-enemy
  element names (`ghost`/`skeleton`/`skeletonShooter`/`lobber`/`bat`/`spider`/
  `zombie`/`fireWraith`), all mapped to `"enemies"`, keys exactly matching
  `CFG.PLAN.introductions` element names (camelCase — `skeletonShooter`/
  `fireWraith`, not snake_case). The existing `reaper → "enemies"` mapping is
  untouched. `clearTransient` now also resets `G.ebolts = []` alongside the
  other transient arrays (the Lobber's arced-ordnance array, §6.1.4/E1 — not a
  straight `Shot`, so it needs its own array cleared each level load).

Tests (`test-enemies-config.js`, new, 18 checks): CFG.ENEMY has all 9 types +
spawner, no Infinity, `CFG.ENEMY` loose-type keys == `CFG.PLAN` element names
(E5 guard); `makeShot` carries `maxTravel`/`effect` when given, defaults
`effect:"damage"`/`maxTravel:undefined` otherwise; `updateShots` expires a
`maxTravel:192` shot before a range-224 default would, and expires an
unspecified shot at `CFG.SHOT.range`; `applyEntangle` raises to the max,
resets `entangleAngle`, leaves `iframe` untouched; `clearTransient` resets
`G.ebolts` to `[]` (verified through a real `loadLevel` call); a real
`loadLevel` placement of a registered stub `"ghost"` factory lands the entity
in `G.enemies` (proves the `ENTITY_ARRAY` extension routes the loose types,
not just a unit-level map lookup).

**No spec gaps requiring invented design.** The phase prompt fully specified
this data and these three edits; the only judgment call was **spider's
missing `speedMul`**, which is not a gap — SPEC-ENEMIES §5's spider row
genuinely has no `speedMul` field (FSM-only speed), so the config-sanity test
was written to expect that, not to paper over it. **Owed by later Phase(s) of
#4:** `enemies.js` itself (roster AI, nav consumer/repath scheduler, melee
exchange loop, death/gem/score sweep) — nothing in this phase built any
behavior, only the data + seam surface it will read. §6 build-status box
correctly NOT flipped to BUILT. No git.

### 2026-07-05 — SPEC-ENEMIES Phase 2 (`enemies-ai.js` — nav consumer layer)

Built `src/enemies-ai.js` (~7KB, one concern — the scheduling/steering layer
between pure `nav.js` and the four A* enemy classes) + `test-enemies-nav.js`
(24 checks green). No roster, no combat, no per-type AI — only the substrate
the Skeleton Shooter / Zombie / Fire Wraith / Reaper will sit on. `nav.js` was
**not** modified (the phase's hard constraint — no scheduling in nav).

Implements (SPEC-ENEMIES §3):
- **Navigator registry + nav sub-block (§2):** `addNavigator(e, mask, mover)` /
  `removeNavigator(e)` / `clearNavigators()`; `initNav` seeds
  `path/wpIndex/wpTimer/repathTimer/goalTile/pathTiles(+dirtyHit)`.
- **Repath scheduling (§3.1):** eligibility = `repathTimer ≤ 0` **AND**
  (goal-tile-changed **OR** `dirtyHit` **OR** no-live-path); on repath, call
  `findPath(e.x,e.y,player.x,player.y,mask)`, reset waypoint/goal state, rebuild
  `pathTiles`, set `repathTimer = repathMinInterval`.
- **Round-robin budget (§3.2):** `scheduleRepaths(player, dt)` decrements every
  floor, runs the dirty gate once, then walks a rotating `cursor` servicing up to
  `CFG.ENEMY.repathBudgetPerFrame` eligible navigators, advancing the cursor past
  the last serviced. Unserviced-but-eligible keep their existing path this frame.
- **Dirty gate (§3.5 step 2, E3, R1):** once per tick, gated on `getNavVersion()`
  change, drain `consumeDirtyTiles()` **exactly once** and set the sticky
  `dirtyHit` on any navigator whose `pathTiles` crosses a drained tile.
- **Steering + fallback (§3.3/§3.4):** `steerNavigator(e, player, dt)` follows
  `path[wpIndex]` (advance on `dist ≤ arriveDist` OR `wpTimer ≤ 0`; face toward
  the waypoint); `null` path → direct-steer at the player, `[]` path → sub-tile
  approach to the player pixel.

Decisions surfaced & logged under Decision log above: **R1 single-consumer
ownership** of `consumeDirtyTiles` (+ the sticky `dirtyHit` rationale for the
budget-starved case), **R6 one-way import flow**, the **mask/mover-agnostic**
parameterization (+ the `e.speed`-is-effective / no-double-ramp contract, E10),
and R9 (arriveDist/wpTimeout are px/s, not re-multiplied by TILE).

Tests (`test-enemies-nav.js`, 24, green) cover the SPEC-ENEMIES §9 nav-consumer
items: corridor monotonic `wpIndex` advance; `wpTimeout` advancing a wedged
navigator (and it never moved); `null`→direct-steer reduces player distance +
faces the player; `[]`→steers to the pixel goal; round-robin budget (≤budget
`findPath`/frame via the repath-count seam, all N serviced within ⌈N/budget⌉
frames, unserviced keep prior path identity); E3 dirty-repath (only the crossed
navigator repaths, `dirtyHit` cleared on repath); R1 single-consumer (two ticks
one frame drain once, external drain after is empty); R6 import discipline both
directions + no literal `Infinity`. Full suite green — **431 checks total**.

**No spec gaps requiring invented design.** The `e.speed`-as-effective /
ramp-stays-with-caller contract is a mechanical seam choice (documented, avoids
double-applying `G.ramp.enemySpeedMult` in a layer that isn't the "one place"),
not new tuning. Owed by the next Phase of #4: `enemies.js` (roster + per-type AI
+ combat), which will bind real `mask`/`mover` per class (incl. the Reaper's
crates+barrels-only PHANTOM mover, R4) and drive `scheduleRepaths` +
`steerNavigator` from `tickEnemies`. No git.

### 2026-07-05 — Phase 3 (`enemies.js` — the combat spine + the Ghost)

Built `src/enemies.js` (the enemy combat spine) + added `updateGhost` to
`enemies-ai.js` + `test-enemies-combat.js` (66 checks green; full suite **497**).
The whole spine is proven end-to-end with the Ghost, the simplest roster member.

Implements (SPEC-ENEMIES §2, §3.5, §6.2, §6.3, §6.4, §6.5, §6.6, E6/E8/E11,
R2/R3/R6): the 7-step `tickEnemies(dt)` frame order (spawner-emit hook [no-op] →
`scheduleRepaths` → player-shot→enemy pass → melee exchange → death sweep →
enemy AI tick [emergence gate → knockback integrate → per-type move/attack] →
`updateEbolts` [no-op] + enemy-shot→player); the player-shot→enemy circle test
(consume-on-hit incl. Bounce, Q2; lethal→`_cause` tag); the melee exchange
(2-to-enemy + null-guarded melee-to-player, 3-arg player knockback + shared enemy
knockback, `e.contact`+`meleeState` pair lockout, crate bumper + bat exemption);
the death sweep (gems ALWAYS via Q3, `awardKill` attribution-gated, `enemy:killed`
emit, splice); shared knockback machinery (`applyKnockbackToEnemy` +
`integrateEnemyKnockback`, ground-`moveBody` vs flight-raw-nudge, R8-shaped); the
enemy-shot→player hit-test (player-only, R3; entangle vs damage); the Ghost
factory (`makeGhost` → `registerEntityFactory("ghost", …)`, effective-speed baked
per E10). `updateGhost` (in `enemies-ai.js`): direct steer, no avoidance/repath,
per-axis slide only — wedges in concave pockets by design.

Tests cover SPEC-ENEMIES §9: melee (E6 — one exchange per contact + lockout +
re-engage, crate bumper no-damage, bat exemption, meleeless null-guard); death
(E8 — gems always, `player-*` adds points, `wraith-aoe` adds 0 but still drops
gems); the frame-order invariant (R2 structural — a synthetic would-explode type
whose AI-spy never runs when it's killed pre-sweep, and DOES run when it
survives); the shot passes (consume incl. Bounce, miss leaves both intact,
enemy-shot damage/entangle, R3 leaves player-owned shots untouched); the Ghost
(slides up a full-height wall, wedges in an inside corner, never pathfinds);
config/factory sanity + R6 import discipline both directions + no `Infinity` +
the R3 producer grep.

**No spec gaps requiring invented design.** Two interpretations logged above (not
new design): `e.speed` stored EFFECTIVE (reconciles §2's "BASE" comment with the
`enemies-ai` read-time contract, ramp baked once per E10) and the emergence gate
applying to collision (steps 3/4 skip `spawn > 0`, per E4 "does not act or
collide"). Owed by later phases: the eight other roster types + their factories,
spawners (E4) with the emergence telegraph, arced ordnance (`updateEbolts`, E1),
the Reaper PHANTOM mover (R4), and the abilities/barrels/scoring seams. No git.