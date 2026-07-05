# SPEC-PATHFINDING — Grid A\*, Per-Class Masks & the Nav-Dirty Grid (`nav.js`)

Implementation-detail layer for **subsystem #3** (sequencing step 3, STATUS.md).
Design intent: **GDD §6.4** (Pathfinding & Navigation Infrastructure); compatibility
posture: **GDD §13.4** (largest net-new engine system — ADD pathfinds *nothing*).
Reads on: SPEC-LEVEL §6.1 (nav-blocker sink seam), SPEC-PLAYER §9 (carry system
already dirties the grid on every crate move).

Scope of this subsystem: build **`src/nav.js`** — a leaf pathfinding *service*
(grid A\* + per-class traversal masks + a lazily-rebuilt object-occupancy grid +
a dirty/version mechanism) that fills the loader's pre-built nav seam. It owns the
**infrastructure**, not enemy behavior: `nav.js` is class-agnostic, takes a mask,
and returns a path. The consumers (Skeleton Shooter / Zombie / Fire Wraith /
Reaper) and the repath *cadence/round-robin/steering* that drive it are **#4
(enemies)** — this spec defines the contract #4 must call, and pins everything in
`nav.js` that is invariant regardless of how the one open architecture fork (Q1)
resolves. **`nav.js` is buildable in full now; Q1 does not block it.**

---

## 1. Resolved decisions (forks the GDD/architecture leave that code cannot skip)

**D1 — `nav.js` is a leaf; it never imports gameplay.** Imports **only**
`config.js`, `state.js`, `world.js`, and the single sink-register function from
`level-loader.js`. It must **never** import `enemies.js` / `enemies-ai.js` /
`player.js` / `combat.js` / `abilities.js` / `projectiles.js`. Enemies call *into*
`nav.js` (one-way), exactly as they call into `player.js`'s sinks (STATUS
"enemies call INTO player"). The `nav.js → level-loader.js` import is one-way and
cycle-free — the loader never imports nav (register-callbacks; SPEC-LEVEL §6.1),
mirroring the already-blessed one-way `level-generator.js → level-loader.js`
import. Grep-asserted in `test-nav.js`.

**D2 — the two masks are thin predicates over existing truth.**
- `GROUND` (Skeleton Shooter, Zombie, Fire Wraith): a tile is blocked iff
  **`world.isWall(tx,ty) || objectAt(tx,ty)`**. `world.isWall` already resolves
  closed doors as solid *live* (the tile-state resolver, world.js) and already
  returns `true` out-of-bounds — GROUND gets terrain, closed doors, and OOB for
  free. `nav.js` adds only the movable-object layer on top.
- `PHANTOM` (Reaper, GDD §6.1.9 inverted mask): blocked iff
  **`outOfBounds(tx,ty) || objectAt(tx,ty)`**. Walls and doors are *passable* (the
  Reaper floats through terrain), so PHANTOM **does not call `world.isWall`** and
  therefore **must supply its own OOB guard** (see R4). Only movable objects stop
  it.

**D3 — occupancy is DERIVED from the live `G` movable arrays, not from an
incremental blocker list.** `objectAt(tx,ty)` is computed from
`G.crates ∪ G.barrels ∪ G.spawners` (every entity there carries `blocks:true`;
see the loader factories), each entity mapped to its tile via `(e.x/CFG.TILE)|0,
(e.y/CFG.TILE)|0` — entities live in **pixels** (SPEC-PLAYER Phase 6 coordinate
reconciliation). This is the single source of truth **because the pre-built seam
cannot be treated as an authoritative list**: the carry system moves a crate by
`splice`-ing it out of `G.crates` and re-inserting it, calling only
`markNavDirty(tile)` — it never re-`registerBlocker`s (SPEC-PLAYER §9), and barrel
destruction (SPEC-BARRELS, deferred) will remove from `G.barrels` + dirty. A
list built from `registerBlocker` calls would go stale on the first move/destroy
(ghost blockers — the exact failure class the carry system guards against). So
`registerBlocker(entity)` and `markDirty(tile)` are consumed **purely as
invalidation signals** (bump version + mark occupancy dirty); the occupancy set
is rebuilt lazily from the `G` arrays on the next query. *This is an
interpretation of a seam authored before nav existed — flagged for the sign-off
glance, but it is the only consumption that stays correct across move/destroy.*
Rebuild cost is O(#objects), not O(grid).

**D4 — enemies are NOT nav blockers.** Only crates/barrels/spawners occupy the
grid (they alone carry `blocks:true`; reaper/pickups are `blocks:false`). A
navigator does not occupy any grid — enemy↔enemy overlap is a steering/separation
concern for #4, never a pathfinding one. (A carried crate is already `splice`d out
of `G.crates`, so it correctly does not occupy — no special case.)

**D5 — coordinate space.** A\* runs in **tile** coords. `findPath` takes and
converts **pixel** start/goal via `(x/CFG.TILE)|0`. Each returned waypoint carries
**both** `{tx,ty}` (tile identity, for #4's "did a dirtied tile hit my path"
check) **and** `{x,y}` = `world.tileCenter(tx,ty)` (pixels, for direct
`moveBody` steering). Get this wrong and #4 either steers to tile-index pixels or
loses the dirty-intersection test (R5).

**D6 — sentinel over `Infinity`.** `gScore` defaults to the finite sentinel
**`1e9`**, never `Infinity` (CLAUDE.md non-negotiable). Paths aren't serialized,
but the house rule holds and it removes a footgun; `test-nav.js` greps the source
for a literal `Infinity`.

**D7 — deterministic A\*.** Tie-break the open set by **f, then h (prefer closer
to goal), then packed key** `ty*CFG.COLS+tx` — a total order, so identical inputs
yield an identical path array (headless reproducibility). The open-set data
structure is the implementer's choice (array-min scan is fine at ~10³ tiles; a
small binary heap is cleaner); the *ordering* is pinned.

**D8 — repath interval semantics (pinning an ambiguous GDD phrase).** GDD §6.4's
"repath every 0.5 s **or** on target-tile change, **whichever is later**" is read
as: a per-navigator **minimum repath interval of `CFG.NAV.repathMinInterval`
(0.5 s)** — a rate floor — with triggers *(a)* the interval elapsing, *(b)* the
navigator's target tile changing, *(c)* a nav-dirty intersecting the navigator's
current path. A dirty that hits the path forces a repath at the next allowed
frame. **This interval/round-robin logic lives with the navigator, not in
`nav.js` under the baseline (Q1)** — `nav.js` ships the *mechanism* that makes it
cheap (`getNavVersion`, `consumeDirtyTiles`, bounded `findPath`); it is stated
here so #4 implements it against a fixed reading.

---

## 2. Data shapes

```js
// Exported mask enum. String repr (hot path is small; clarity > micro-perf).
export const NAV_MASK = { GROUND: "ground", PHANTOM: "phantom" };

// A path is an ordered array of waypoints from the first STEP to the goal.
// The start tile is EXCLUDED; the goal tile CENTER is the last element.
// waypoint: { tx:int, ty:int, x:float, y:float }   // x,y = tileCenter(tx,ty)
//   findPath(...) -> Path (>=1 waypoint) | [] (start tile === goal tile) | null (no path)

// Occupancy: internal. A Set<packedKey> or Uint8Array(COLS*ROWS), rebuilt lazily.
// packedKey = ty * CFG.COLS + tx   (same packing as the loader's tileState store)
```

`CFG.NAV` (add to `config.js`, the leaf — data only, no import change):

```js
NAV: {
  repathMinInterval: 0.5,   // s, per-navigator repath rate floor (GDD §6.4; consumed by #4)
  diagonalCost: Math.SQRT2, // 8-dir step cost; orthogonal = 1.0
  // Per-enemy MASK assignment (which class uses which mask, or none) is ENEMY
  // data and lives with #4 / GDD §6.2 — nav is class-agnostic and takes a mask.
}
```

---

## 3. The occupancy grid + dirty/version mechanism

`nav.js` maintains three pieces of module state:

- `occupancyDirty: bool` — starts `true` (nothing built yet).
- `navVersion: int` — monotonically increasing; **bumped on every invalidation**.
- `dirtyTiles: Set<packedKey>` — tiles changed since the last `consumeDirtyTiles()`.

**`objectAt(tx,ty)`** consults an internal occupancy set. If `occupancyDirty`, it
first **rebuilds** the set from the live arrays:

```
occ = new Set()
for arr in [G.crates, G.barrels, G.spawners]:
    if not arr: continue                      // may be undefined pre-load (defensive)
    for e in arr:
        if not e.blocks: continue             // belt-and-suspenders; all three are blocks:true
        occ.add(pack((e.x/TILE)|0, (e.y/TILE)|0))
occupancyDirty = false
```

Rebuild is O(#objects). Terrain and doors are **not** copied into `occ` — they
come from `world.isWall` live (D2); duplicating door state into occupancy would be
a second source of truth (R3).

**Invalidation** (`invalidate()`): `occupancyDirty = true; navVersion++`.

---

## 4. The seam fill (`installNav`, the blocker sink)

The loader ships a no-op sink until nav registers (SPEC-LEVEL §6.1;
`registerBlockerSink` / `markNavDirty` already exist and are already *called* — by
the loader on door open/close and at placement, and by `player.js` on every
crate pickup/drop). `nav.js` fills it:

```js
import { registerBlockerSink } from "./level-loader.js";   // one-way; loader never imports nav

const navBlockerSink = {
  registerBlocker(_entity) { invalidate(); },              // D3: signal only, not a stored list
  markDirty(tile) {                                        // tile = { tx, ty } (both callers pass this)
    dirtyTiles.add(pack(tile.tx, tile.ty));
    invalidate();
  },
};

export function installNav() { registerBlockerSink(navBlockerSink); }  // boot calls once; idempotent
```

Both dirty callers pass `{tx,ty}` (verified: loader `markNavDirty({tx,ty})` on
`recomputeDoor`/`openLockedDoor`; `player.js` `markNavDirty(crateTile(crate))` /
`markNavDirty({tx,ty})`). `registerBlocker` is handed a whole entity but nav reads
nothing off it beyond "something changed" (D3) — the entity is already pushed to
its `G` array *before* the loader calls `registerBlocker` (loader `placeEntity`
order), so the very next rebuild sees it.

**Note (door correctness):** GROUND reads doors from `world.isWall` live, so a
door open flips passability with **no** occupancy rebuild — the `markDirty` on
door open exists only to *trigger repaths* (a shortcut opened) and to feed
`dirtyTiles`, not to change `objectAt`.

---

## 5. Grid A\* (`findPath`)

```
findPath(sx, sy, gx, gy, mask) -> Path | [] | null
```

1. `s = ((sx/TILE)|0, (sy/TILE)|0)`, `g = ((gx/TILE)|0, (gy/TILE)|0)`.
2. If `s === g` → return `[]` (already on the goal tile).
3. If the **goal** tile is blocked under `mask` → return `null` (let #4 degrade to
   direct steering — Q4). The **start** tile is always expandable regardless of
   blocked-state (the navigator is standing there; a crate may have been dropped
   onto it).
4. Standard A\* to `g`:
   - **Neighbors:** 8-directional.
   - **Step cost:** orthogonal `1.0`, diagonal `CFG.NAV.diagonalCost` (`√2`).
   - **Corner-cut prevention:** a diagonal step `(x,y) → (x+dx, y+dy)`
     (`dx,dy ∈ {−1,+1}`) is allowed only if the destination **and both** shared
     orthogonals `(x+dx, y)` and `(x, y+dy)` are passable **under the same mask**.
     This blocks squeezing through a wall corner (GROUND) or between two diagonally
     placed crates (PHANTOM). *The passability predicate here must be the mask's —
     GROUND checks wall+door+object, PHANTOM checks object-only; using the wrong
     one is R1.*
   - **Heuristic (octile, admissible + consistent for this cost model):**
     `dx=|gx−tx|, dy=|gy−ty|; h = (dx+dy) + (CFG.NAV.diagonalCost − 2)·min(dx,dy)`.
   - **`gScore`/`cameFrom`** keyed by `pack(tx,ty)`; `gScore` default `1e9` (D6).
   - **Tie-break** per D7.
5. On popping `g`, reconstruct via `cameFrom`; emit waypoints start-exclusive,
   goal-inclusive, each `{tx, ty, x:tileCenter.x, y:tileCenter.y}`.
6. Open set exhausted without reaching `g` → return `null`.

**Per-call bound:** the closed set caps expansions at ≤ `COLS·ROWS`; on the target
grids (~40×30 ≈ 1200 tiles) a single path is cheap. No extra node cap is needed.
The *multi-navigator* frame budget (staggering many repaths) is **not** a single
call's concern — see §6 / R7.

---

## 6. Public API (what #4 calls)

| Export | Signature | Purpose |
| :-- | :-- | :-- |
| `NAV_MASK` | `{ GROUND, PHANTOM }` | mask constants |
| `installNav()` | `() → void` | register the loader blocker sink; boot calls once |
| `findPath(sx,sy,gx,gy,mask)` | pixels → `Path \| [] \| null` | the A\* service (§5) |
| `isNavBlocked(tx,ty,mask)` | tile → `bool` | the mask predicate (§D2); for #4 + tests |
| `getNavVersion()` | `() → int` | coarse "grid changed since I last pathed" check |
| `consumeDirtyTiles()` | `() → [{tx,ty}]` | precise changed-tiles since last call (clears) |

**Contract for #4 (documented here; built in #4 — see Q1):** each A\*-navigator
(GROUND: Shooter in HUNT / Zombie / Wraith in APPROACH; PHANTOM: Reaper) caches
its path + the `navVersion` at compute time + a repath timer. It repaths when
*(a)* `timer ≥ CFG.NAV.repathMinInterval`, *(b)* its target tile changed, or
*(c)* `getNavVersion()` differs **and** a `consumeDirtyTiles()` entry lies on its
cached path (D8). Repaths are **staggered round-robin across frames** so a Zombie
horde never spikes one frame (GDD §6.4 budget rule). Between repaths the navigator
follows the cached path by waypoint steering (reuse ADD's `arriveDist` / stuck
`wpTimeout` arrival convention — §10) via `world.moveBody` (two-source collision).
On `findPath → null`, degrade to direct steering toward the goal (Q4) so a boxed
Zombie still "never loses interest" (§6.1.7).

---

## 7. File & size

One file, `src/nav.js`, one cohesive concern (grid A\* + occupancy + dirty/seam).
Estimated ~6–9 KB — under the 24 KB smell; no split. A future split candidate, if
it ever grows, is the pure solver (`aStar(start, goal, isBlockedFn)`) vs. the
occupancy/dirty/seam bookkeeping — left inline for now so the mask→predicate→solve
path reads in one place (same posture as `isSolvable` left inline in the
generator).

---

## 8. Seams to later systems (interfaces only — no behavior here)

- **#4 enemies → nav (one-way):** calls `findPath` / `isNavBlocked` /
  `getNavVersion` / `consumeDirtyTiles`; owns cadence, round-robin, waypoint
  steering, and the direct-steer fallback (§6, Q1). nav never imports #4.
- **loader → nav (register-callbacks, already wired the loader half):** nav's
  `installNav()` registers `navBlockerSink`; the loader already emits
  `registerBlocker` at placement and `markNavDirty` on door open/close.
- **player → nav (already wired the player half):** the carry system already
  calls `markNavDirty` on every pickup/drop (SPEC-PLAYER §9) — nav needs no player
  import; it just receives the dirties.
- **SPEC-BARRELS (deferred):** barrel destruction must `markNavDirty` the vacated
  tile so a PHANTOM/GROUND barricade clears — noted for that spec; not built here.
- **boot/main:** must call `installNav()` once during startup (after the loader
  module is imported, before the first enemy tick). No ordering hazard: the loader
  default sink is a no-op, so a missed `installNav()` degrades to "no dynamic
  blockers," never a crash.

---

## 9. Known implementation risks (flag before building — do not discover mid-impl)

- **R1 — corner-cut × per-class mask interaction (subtle; escalate).** The
  diagonal-passability check must use the **step's own mask** (GROUND:
  wall+door+object; PHANTOM: object-only). It is easy to hardcode `world.isWall`
  in the corner check and silently make PHANTOM obey walls, or make GROUND cut
  corners. This is the interaction STATUS.md itself names as an Opus-tier subtlety
  ("corner-cut prevention × per-class mask interaction is subtle"). **Recommend
  Opus / thinking-on / high-effort for the A\*-core phase**, and test both masks'
  corner behavior explicitly (§10 tests 3, 5, 6).
- **R2 — the stale-list temptation (D3).** The seam hands nav an entity; building
  an incremental blocker list from it goes stale on the first crate-move/barrel-
  destroy (no unregister/re-register exists). Derive from live `G` arrays; treat
  seam calls as invalidation only. A stale list = ghost blockers.
- **R3 — double source of truth for doors.** GROUND doors come from
  `world.isWall` (live). Do **not** also stamp door tiles into occupancy; that
  desyncs on door open (occupancy wouldn't clear). Occupancy = movable objects
  only.
- **R4 — PHANTOM OOB guard.** PHANTOM bypasses `world.isWall`, which was GROUND's
  free OOB reject; PHANTOM must explicitly reject `tx<0||ty<0||tx>=COLS||ty>=ROWS`
  or A\* indexes off-grid / negative.
- **R5 — coordinate space (D5).** Start/goal arrive in pixels; waypoints go out as
  `{tx,ty,x,y}`. Returning tile indices where #4 expects pixels breaks steering;
  dropping `{tx,ty}` breaks #4's dirty-intersection test.
- **R6 — `Infinity` in `gScore` (D6).** Use `1e9`; grep-guarded.
- **R7 — the budget is realized in #4, not #3 (baseline Q1).** `nav.js` ships
  cheap bounded `findPath` + `navVersion` + `consumeDirtyTiles`, but a naive #4
  that repaths every navigator every frame reintroduces the spike §6.4's budget
  rule prevents. Call this out in the #4 prompt so the round-robin stagger is
  built, not bolted on. (If Q1 resolves to Shape 2, the stagger moves *into*
  `nav.js` and this risk moves with it.)

---

## 10. Headless smoke tests (`test-nav.js` — pure logic, no canvas)

Stub browser globals, then dynamically import the real `nav.js` (ADD
`test-*.js` style; `nav`'s import graph is `config/state/world/level-loader`, all
headless-safe). Build synthetic maps via `world.loadTileGrid([...])` and seed
`G.crates` / `G.barrels` / `G.spawners` directly. `tiny check(name, ok)` harness.

1. **Open-floor straight path (GROUND):** monotone path start→goal on empty floor;
   length ≈ chebyshev distance.
2. **Wall detour (GROUND):** a wall segment between start and goal → path routes
   around, crosses no `isWall` tile, longer than the blocked straight line.
3. **Corner-cut prevention (GROUND):** two walls meeting at a diagonal → assert no
   returned diagonal step has a blocked shared-orthogonal (walk the path, check
   each diagonal hop's two orthogonals are GROUND-passable).
4. **Door: closed blocks / open passes (GROUND):** plate-door level; closed →
   detour-or-null through the door tile; press the linked plate via the loader
   seam → repath goes through. (Exercises live `world.isWall` + a real `markDirty`
   round-trip.)
5. **PHANTOM ignores walls:** same wall as test 2 → PHANTOM path is the straight
   diagonal, *crosses* wall tiles (proves walls passable + PHANTOM corner-cut is
   object-aware, not wall-aware).
6. **PHANTOM blocked by crates + dirty rebuild:** a crate line across the PHANTOM
   straight line → routes around; `G.barrels.splice`/`G.crates.splice` the
   blocker + `navBlockerSink.markDirty(tile)` → next path is straight again.
7. **Occupancy derives from live `G` (D3 correctness):** seed a crate, path sees
   it; `splice` it out + `markDirty` → next `findPath` no longer sees it (proves
   derive-from-`G`, not a stale registerBlocker list). Also: `registerBlocker`
   with a *fake* entity NOT in any `G` array does **not** create a phantom blocker
   (invalidation-only).
8. **Version + dirty accounting:** `getNavVersion()` strictly increases on each
   `registerBlocker`/`markDirty`; `consumeDirtyTiles()` returns exactly the
   accumulated tiles then clears (second call returns `[]`).
9. **Degenerate cases:** walled-off pocket goal (GROUND) → `null`; PHANTOM OOB
   goal → `null` (R4); start-tile === goal-tile → `[]`.
10. **Determinism (D7):** identical inputs → deep-equal path arrays across
    repeated calls.
11. **Spawner occupancy (encodes the Q2 baseline):** a spawner tile blocks GROUND
    but is passable to PHANTOM. *This test pins the recommended Q2 resolution — a
    sign-off flip is a visible one-line predicate + test change.*
12. **Import discipline:** grep `nav.js` imports = only
    `./config.js`/`./state.js`/`./world.js`/`./level-loader.js`; never
    enemies/player/combat/abilities/projectiles.
13. **Sentinel:** grep the source for a literal `Infinity` → none (D6).

---

## 11. Open design questions

- **Q1 — where does the repath scheduler live? (architecture fork; NON-blocking
  for building `nav.js`, blocking for the #3↔#4 boundary sign-off.)** The A\*
  service, masks, occupancy, and dirty/version mechanism live in `nav.js`
  *either way* — only the round-robin repath budget + navigator registry + path-
  follow steering differ:
  - **Shape 1 (baseline, recommended):** `nav.js` is a pure stateless service;
    #4 (enemies-ai) owns the navigator set, per-navigator repath timers, the
    round-robin frame budget, and waypoint steering. **Why recommended:** keeps
    `nav.js` a true leaf (no live enemy refs, no spawn/despawn lifecycle to track
    before #4 exists), fully testable headless *now*, and doesn't guess #4's
    entity shape. Cost: the budget guarantee is realized in #4 (R7).
  - **Shape 2:** `nav.js` exposes `registerNavigator({getPos,getGoal,mask,setPath})`
    + `navTick(dt)` and owns the round-robin internally (callbacks, so still no
    enemy import). Cost: front-runs #4's entity/lifecycle, adds a deregister-on-
    death edge before enemies exist, and steering still lives in #4 anyway.
  Recommend **Shape 1**; either way §5's A\* is unchanged. Needs a sign-off glance
  before the #4 spec.
- **Q2 — spawner occupancy in the masks (NON-blocking; spec baselines a
  recommendation).** GDD §6.4's mask prose names only "crates/barrels," but the
  loader registers **spawners** as blockers (`blocks:true`) and collision treats
  them solid. Baseline resolution (test 11): **GROUND blocked by spawners**
  (they're solid collision + registered blockers — a Zombie can't walk through a
  Bone Pile); **PHANTOM passes through spawners** (GDD: "only *movable* objects
  block" the Reaper; a spawner is static, closer to terrain than a barricade, and
  the Reaper's identity is "walls don't stop me, only barricades do"). The
  alternative (spawners block PHANTOM too, since they're registered blockers) is a
  one-predicate flip. Sign-off flips one line + test 11 if desired.
- **Q3 — repath phrasing (confirm D8).** GDD's "whichever is later" is pinned as a
  0.5 s min-interval floor + event triggers. Confirm this reading (the alternative
  literal reading — "never repath until the target tile changes" — would leave a
  navigator on a stale path after a nav-dirty, which contradicts the "force a
  repath on object change" sentence in the same paragraph, so D8 is almost
  certainly intended). Non-blocking (baselined).
- **Q4 — unreachable-goal degrade (confirm; #4 behavior).** `findPath → null` →
  #4 direct-steers toward the goal (matches "never loses interest," §6.1.7).
  Alternative: path to the nearest reachable tile. Baseline is direct-steer;
  `nav.js` just returns `null` either way, so this is a #4 decision — recorded
  here so #4's spec doesn't rediscover it.

---

## 12. ADD source provenance (what was verified, where, disposition)

Pulled live from `add2026` (external, read-only; GDD §13) to verify §13.4 and
harvest reusable conventions:

- **`add2026` has no A\* / pathfinding — VERIFIED, §13.4 "NEW" confirmed.** Source
  grep across `add2026/src` for `astar|openset|heuristic|gscore|reconstructPath|
  pathfind` returns **nothing**; the only "pathfinding" string is a comment in
  `vending.js` stating vending has *none*. Disposition: **A\* authored net-new**
  in `nav.js`.
- **ADD steering = direct-toward + throttled LOS + FIXED patrol waypoints.**
  `enemies.js` (`nearestWaypoint`/`advancePatrol`) and `enemies-ai.js`
  (waypoint-follow with `d.arriveDist` / `e.wpTimer`←`d.wpTimeout`) follow a
  *pre-chosen route*, not a computed path. Disposition: the **arrival convention**
  (`arriveDist` reached-threshold + `wpTimeout` stuck-give-up timer) is a reusable
  *path-follow* pattern for **#4**'s waypoint steering over A\*-generated
  waypoints — flagged for the #4 spec, **not** `nav.js`'s concern (nav produces
  paths; #4 follows them).
- **World primitives already ported (no re-port).** `world.isWall` / `blocksLOS` /
  `tileCenter` / `tileFloor` / `hasLineOfSight` were ported from `add2026`
  `world.js` in SPEC-LEVEL Phase 2 and carry the live door-state resolver; `nav.js`
  reuses them directly. `add2026`'s `droneMoveToward` (clean overshoot-clamped
  free-mover) is a **#4** steering reference, noted, not used by nav.
- **Nothing is committed to `add2026`** (read-only reference only).

---

*End SPEC-PATHFINDING. Next step after human review: generate the phased Claude
Code prompt(s) from this spec (separate pass) — the A\*-core phase should carry the
per-phase override **Opus / thinking-on / high-effort** per R1.*