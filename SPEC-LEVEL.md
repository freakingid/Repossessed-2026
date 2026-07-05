# SPEC-LEVEL — Level Definition Loader + Generator

**Layer:** SPEC (implementation detail between GDD and code). This document does
**not** restate design intent — it pins the data shapes, contracts, algorithms,
and seams needed to build §8 of the GDD. Where the GDD gives intent, this fixes
mechanism.

**Owns (this spec):** the Level Definition v2 schema; the loader
(`loadLevel` / `validateLevelDef` + spawn-rule placement); the mutable
tile-state store (doors/plates) and plate→door link graph; the endless
generator (`generateLevel(n, rng)` — archetypes, `CFG.PLAN`, `CFG.RAMP`
evaluation, solvability); and the **seams** later subsystems plug into.

**Does not own (later specs, seams only here):** carry/plate-press triggering
(#2), nav-grid A\* (#3), spawner tick/emission (#4), abilities (#5), meta/save
runtime (#6), dark-level rendering (#7). This spec defines the interfaces those
consume or fill; it implements none of their behavior.

**Source verification.** Every "reused/adapted from ADD" claim below was checked
against the real `add2026` source (fetched from GitHub `main`). Provenance table
in §11. Where the GDD's example text and ADD's shipped code disagree, the
disagreement is surfaced in §1, not silently resolved.

**Out of scope by workflow.** No Claude Code prompts, no phased build steps, no
task breakdown — those are generated *from* this spec in a separate step after
the human-review checkpoint.

---

## 1. Resolved decisions (signed off 2026-07-05)

Each was a fork the GDD left open that the loader/generator code cannot be
written without. All four are now **closed** (owner sign-off); the rationale is
kept below as the record. **Summary of rulings:** D1 → `tiles`; D2 → adopt as
stated (injected rng, content = fn of `n`, no persisted seed); D3 → the resolved
one-model door/plate scheme; Q3 (§9) → track one unsaved boolean `G._prevDark`.

**D1 — Grid field name: `tiles` (RESOLVED → `tiles`).**
ADD's loader, validator, and generator all read `def.tiles` (array of row-major
strings). The GDD §8.1 example object labels the same field `grid:`. Since the
entire compat story is "reuse ADD's loader, which never branches on origin"
(§13.24), and the field is load-bearing in three ADD functions,
**recommend `tiles`** and treat the GDD's `grid:` as a cosmetic label to correct.
Cost of choosing `grid` instead: a rename in the reused loader/validator/world
primitives with zero design benefit. *This spec is written assuming `tiles`;
if overridden, find-and-replace the field name only.*

**D2 — Generation determinism / RNG contract (RESOLVED → adopt as stated).**
§8.3 specifies a *seeded* `generateLevel(n, rng)`; §12.3 specifies that a
**resumed Night's layout may differ**. These reconcile exactly one way, which is
adopted here:
- **Content** (roster, spawn budget, ramp params) is a **pure function of `n`** —
  identical on every visit to Night n.
- **Geometry and placement** consume an **injected `rng`** (a seedable PRNG).
  Production seeds it *fresh* each call (`generateLevel(night, makeRng(freshSeed()))`),
  so layouts vary per visit — satisfying §12.3. Tests seed it *fixed*
  (`makeRng(1234)`), so generation is deterministic and assertable.
- **No seed is persisted.** The §12.3 save schema has no seed field and gains
  none. Resume calls `buildLevel()` → `generateLevel(night, freshRng)`; the
  layout differs, the content budget does not. (This is exactly ADD's shipped
  `resumeFromSave` → `buildLevel` behavior, made testable by RNG injection.)

Recommendation: **adopt as stated.** This is the whole reconciliation of the
§8.3↔§12.3 tension; sign off explicitly.

**D3 — Doors/plates: one model from two GDD spellings (RESOLVED → the model below).**
The GDD represents a plate-door both as a grid char (`d`/`_`, §8.2) **and** as a
placement with an id (`{type:"door", id}` / `{type:"plate", id}`, §8.1), wired by
`links`. Resolved model (recommended): the **grid char places the cell**; the
**placement assigns it an id**; **links wire ids**. Concretely: a `door`
placement at (x,y) requires `tiles[y][x] === 'd'`; a `plate` placement requires
`tiles[y][x] === '_'`. Locked doors (`D`, key-driven, §3.6) are **pure tiles** —
no id, no placement, no link. This is the "legal tile" validation of §8.1 made
precise. Adopted below.

---

## 2. Level Definition v2 — schema

A Level Definition is a plain data object. The loader is its only consumer; the
engine never inspects a def's origin (generated vs future hand-authored).

| Field | Type | Req | Default | Notes |
| :--- | :--- | :-: | :--- | :--- |
| `id` | string | yes | — | generated: `"night-<n>"` |
| `name` | string | yes | — | display; generator synthesizes |
| `props` | object | no | `{}` | see below |
| `props.dark` | bool | no | `false` | §8.4 lighting pipeline on |
| `props.music` | string\|null | no | `null` | `MUSIC` registry key (§11.3 GDD) |
| `props.script` | string\|null | no | `null` | reserved scripted-level hook; none in scope |
| `tiles` | string[] | yes | — | Layer 1, row-major, one char per tile (D1) |
| `zones` | Zone[] | no | `[]` | Layer 3 placement-hint rects |
| `placements` | Placement[] | yes | — | fixed exact-coordinate set pieces |
| `links` | Link[] | no | `[]` | plate→door bindings |
| `spawnRules` | SpawnRule[] | no | `[]` | zone-scattered, randomized per visit |
| `cols`,`rows` | int | no | derived | metadata only; loader derives dims from `tiles` |

`cols`/`rows` are **not authoritative** — `loadTileGrid` sets the live world dims
from the grid it parses (ADD `world.js`; the generator may emit them for
convenience but the loader ignores them for sizing).

**Zone** `{ x, y, w, h, role }` — tile coords; `role ∈ {spawn, cover, combat,
danger, any}`. Roles **may overlap** (ADD generator blankets the interior with
`combat`/`cover`/`danger` and carves a `spawn` rect). `any`/absent = whole
interior.

**Placement** `{ type, x, y, ...typeFields }` — `type ∈ {player, exit, spawner,
crate, barrel, plate, door, reaper, food, treasure, key, powerup}`. Type extras:
`spawner` → `variant` (`CFG.SPAWNER` key, §6.3); `plate`/`door` → `id` (string);
`powerup` → optional `kind`.

**Link** `{ plate: <plateId>, door: <doorId> }`.

**SpawnRule** `{ type, count, zone?, avoid?, variant?, kind? }` — `type ∈
{spawner, crate, barrel, powerup, food, treasure, key}`. `zone`/`avoid` are role
names; `variant` for `spawner`, `kind` for `powerup`. **Unknown `type` is
ignored** (forward-compatible — preserves ADD's `runSpawnRule` default branch;
this is what let ADD ship the format before every entity existed).

---

## 3. Tile model + mutable tile-state store

### 3.1 `CFG.TILES` record (extends ADD's flag pattern)

ADD's record is `{name, solid, blocksLOS, destructible}`. Repossessed **drops
`destructible`** (nothing in the grid is destructible — crates are
indestructible entities, not tiles) and **adds `blocksFlight`** (§8.2 has a
Blocks-flight column; bats/ghosts/lobbed arcs need it). Data-driven, one entry
per char:

| Char | name | solid | blocksLOS | blocksFlight | mutable |
| :--- | :--- | :-: | :-: | :-: | :-: |
| `.` | floor | false | false | false | — |
| `#` | wall | true | true | false | — |
| `T` | tombstone | true | true | false | — |
| `o` | pillar | true | true | false | — |
| `D` | lockedDoor | true | true | false | key-unlock |
| `d` | plateDoor | true* | true* | false | plate-linked |
| `_` | plate | false | false | false | pressed-state |

\* `d`/`D` are solid + block LOS **while closed**; an open door reads as plain
floor to every system (collision, LOS, ricochet, Lobber arc). The tile *char*
does not change on open — the mutable-state store below overrides the flags.

`world.js` collision/LOS primitives (`isWall`, `blocksLOS`, `tileCenter`,
`randomFloorTileTC`, `tileFloor`, `bodyHitsWall`, `hasLineOfSight`) are **reused
as-is**, with one change: `isWall`/`blocksLOS` consult the mutable-state store
for `d`/`D` cells before falling back to the static `CFG.TILES` flag (§3.2).
Remove ADD's `isDestructible`/`destroyShelf` (no destructible tiles).

### 3.2 Mutable tile-state store (§13.6)

A small store layered over the static grid, holding runtime state for the two
mutable tile kinds. Keyed by packed tile coord (`ty * cols + tx`):

```
tileState: Map<int, DoorState | PlateState>
DoorState  = { kind:"door",  id, char:"d"|"D", open:boolean }
PlateState = { kind:"plate", id, pressed:boolean }
```

- `isWall(tx,ty)` / `blocksLOS(tx,ty)` for a `d`/`D` cell return `!state.open`.
- `open` for a `D` (locked) door is set true permanently when a key is spent
  against it (trigger owned by #2; the state field + `openLockedDoor(tx,ty)`
  mutator live here).
- `open` for a `d` (plate) door is a **pure recompute** from its linked plates
  (§3.3). Never set directly.
- `pressed` for a `_` plate is set by the carry/entity systems (#2) via
  `setPlatePressed(id, bool)` — a mutator this spec exposes; the *deciding*
  (player/crate weight) is #2's job.

**No `Infinity`, no timers here.** "Permanent" locked-door state is a boolean,
not a sentinel — so the sentinel-over-`Infinity` rule (which exists to survive
`JSON.stringify`) simply doesn't arise in this subsystem. (Flagged because it
*does* arise in save/ability code; not here.)

### 3.3 Link graph + door recompute (pure)

Built at load from `def.links`. A plate-door is open iff **any** linked plate is
pressed (§8.2). Pure function, no side effects beyond the door's `open` field:

```
recomputeDoor(doorId):
  linkedPlates = links where door == doorId
  open = linkedPlates.some(l => tileState[plateOf(l.plate)].pressed)
  if open changed: set DoorState.open; markNavDirty(doorTile)   // §6 seam
```

`setPlatePressed(id, bool)` sets the plate then calls `recomputeDoor` for every
door the plate links to. A door with no live linked plate that is opened by a key
(the `D` case) is independent of this graph.

Any door open/close **dirties the nav grid** at that tile (§6.1 seam) — this is
what makes "hold the door with a crate" change enemy pathing (§6.4).

---

## 4. The Loader

### 4.1 `loadLevel(def)` — ordered contract

The single entry point to a playable level (reused from ADD `level.js`, extended).
Steps run in this exact order; order is load-bearing where noted.

1. `validateLevelDef(def)` — throws on malformed input (§4.3). Fail loud at load,
   never produce a broken world.
2. `loadTileGrid(def.tiles)` — parse grid; sets `CFG.COLS/ROWS` from the grid
   (reused; validates ragged rows / unknown chars). **No conveyor bake** — the
   push-field step is deleted (§13.2), not stubbed.
3. Build `tileState` from `d`/`D`/`_` tiles + `door`/`plate` placements + `links`
   (§3.2–3.3). All doors start closed; all plates start unpressed;
   `recomputeDoor` runs once so any plate authored pre-pressed resolves.
4. **Clear transient arrays; preserve persistent run state** (§4.2).
5. **Resolve fixed placements, player FIRST** (so any set-piece entity that reads
   the player's position on spawn — e.g. a placed Reaper's initial bearing — sees
   it already set), then `exit`, then all other placements (spawners, crates,
   barrels, reaper, food, treasure, key, powerup, plate/door already handled in
   step 3).
6. Run `spawnRules` (§4.4) — zone-scattered, honoring `avoid`.
7. Register all movable/blocking entities (crates, barrels, spawners) with the
   **nav-blocker registry** (§6.1 seam).
8. Reset camera; snapshot `CFG.RAMP` params for this level (§5.5) into
   `G.ramp` — read once here, **never re-read mid-level** (§8.6: nothing mutates
   during play).
9. `emit('level:start', { … })` and arm the wipe-open (reused event/one-shot
   plumbing).

### 4.2 Transient-clear vs persistent-preserve lists

**Cleared every load** (per-level entities/timers): `shots`, `enemies`,
`spawners`, `pickups` (powerups/food/treasure/gems/keys-on-ground), `crates`,
`barrels`, `shrapnel`, `marks`, `floats`, light-emitter registry, `tileState`,
nav grid, `spawnTimer`, `pickupTimer`, and the level-scoped one-shot flags
(`_levelEndEmitted`, `_allEnemiesDeadEmitted`, …).

**Preserved across nights** (run state — carried, per §13.7 & §12.3): player
`hp`/overheal, `gemEnergy`, `storedCharges`, `keys`, `powerups` (remaining shot
counts), `score`, `night`. `newGame()` clears these; `loadLevel` never does.

### 4.3 `validateLevelDef(def)` — full rule list (extends ADD §8.1.4)

Throws a descriptive `Error` on the first failure. Rules (★ = new vs ADD):

1. `tiles` is a non-empty array of equal-length strings of known chars
   (delegated to `loadTileGrid`; validate presence here).
2. Exactly one `player` placement.
3. At least one `exit` placement.
4. Every `spawnRule.zone` (when set and ≠ `any`) names an existing zone role.
5. ★ Every `spawnRule.avoid` (when set) names an existing zone role.
6. ★ Every `links` entry references an existing `plate` id **and** an existing
   `door` id (both must appear as placements).
7. ★ Every `door`/`plate` placement sits on the matching grid char
   (`door`→`d`|`D`, `plate`→`_`) — the D3 reconciliation, enforced.
8. ★ Every `spawner` placement/rule `variant` exists in `CFG.SPAWNER`.
9. ★ If `props.script` is set, its required actors (declared by the script
   registry) are all present in `placements`. (Script registry is empty in
   scope; the check is a no-op until a script is registered — the seam exists.)

Validation is **structural only** — solvability (reachability) is a
*generator-side* guarantee (§5.4), not a loader check, because a future
hand-authored level is trusted to be solvable and the loader must load it
unconditionally.

### 4.4 Spawn-rule placement (extends ADD `pickTile`/`runSpawnRule`)

Reused algorithm: for each rule, place `count` entities on random interior tiles
inside the rule's zone rects (whole interior if `any`/absent), rejecting tiles
that are solid or inside an `avoid` rect; 400-try loop with a guaranteed-floor
fallback so a rule always places. Extensions (★):

- ★ **Never place on a plate tile** (`_`) — plates must stay visible/uncovered
  by scatter (authored crate-on-plate puzzles use *fixed placements*, not rules).
- ★ **Never place on the exit tile.**
- ★ **New entity types** dispatched by `runSpawnRule`'s switch: `spawner`
  (variant-bound, §6.3), `crate`, `barrel`, `food`, `treasure`, `key`,
  `powerup`. Each pushes an entity; movable ones (`crate`/`barrel`/`spawner`)
  additionally register as nav blockers (§6.1 seam).
- Unknown `type` still hits the default branch and is ignored (forward-compat).

### 4.5 Two collision sources (§13.3) — consequence the loader establishes

ADD had one collision truth (the grid). Repossessed has **two**: the static tile
grid (terrain) **and** the dynamic movable-object set (crates/barrels/spawners).
The loader is where both are populated. Downstream collision/LOS/nav queries must
consult **both**; this spec's contract: movable entities register in a single
`blockers` set at placement time (§6.1), so there is exactly one dynamic source
to consult, not N ad-hoc arrays.

---

## 5. The Generator — `generateLevel(n, rng)`

Produces a valid, solvable Level Definition and returns it. **Produces data
only** — never touches `G` entities directly (reused ADD discipline; the loader
is the sole world-builder). Signature takes the Night index `n` and an injected
PRNG `rng` (D2).

### 5.1 `CFG.PLAN` — content schema (n-driven)

Three tables keyed on `n` (the analog of ADD's `LEVEL_PLAN`, which is a flat
`type = PLAN[min(n-1, len-1)]` index; Repossessed's is richer but same
index-by-counter idea):

```
CFG.PLAN = {
  introductions: [                 // first Night each element is eligible
    { night:1, elements:["ghost","skeleton","crate","barrel"] },
    { night:2, elements:["bonePile","key","lockedDoor"] },
    { night:3, elements:["skeletonShooter","plateDoor"] },
    { night:4, elements:["lobber","bat","cauldron","belfry"] },
    { night:5, elements:["spider","eggSac","darkLevel"] },
    { night:6, elements:["zombie","graveMound"] },
    { night:7, elements:["fireWraith","emberPit"] },
    { night:9, elements:["reaper"] },
  ],
  budget:   { base:24, perNight:6, cap:120 },   // B(n) = 24 + 6·(n−1), capped 120
  costs:    { ghost:1, skeleton:2, skeletonShooter:3, bat:3, fireWraith:3,
              zombie:4, spider:4, spawner:6, reaper:15 },  // §6.2 pts ÷ 50
  weights:  { newestTier:0.40, earlierMix:0.60 },          // (proposed, §14.2)
  darkProb: { beforeNight:5, prob:0.25, noConsecutive:true }, // (proposed, §14.2)
}
```

`eligible(n)` = union of `elements` for all introductions with `night ≤ n`.
Spawner output is filtered by the same gate: a Bone Pile on Night 2 emits only
skeletons until shooters unlock on Night 3 (§8.3) — the spawner's weighted table
(§6.3) is intersected with `eligible(n)` at generation time and the result is
stamped onto the spawner entity so #4's tick reads a pre-filtered table.

### 5.2 Spawn-budget algorithm

```
B = min(base + perNight·(n−1), cap)
loop while B ≥ cheapest affordable element:
  pick category: spawner vs loose enemy   (bias toward spawners as B grows)
  pick element from eligible(n), weighted so newestTier (elements introduced
    on the highest night ≤ n) get weights.newestTier of the mass and all
    earlier elements share weights.earlierMix
  if cost[element] ≤ B: emit it (spawner → spawnRule in a danger/combat zone;
    loose enemy → spawner-less placement or a small preplace), B −= cost
  else: drop element from the affordable set
Reaper: at most one, only when n ≥ 9, emitted as a fixed set-piece placement
  (not a spawnRule), costs 15 from B.
```

Composition is emitted as `spawnRules` (zone-scattered spawners) plus at most a
handful of fixed placements (Reaper, and any preplaced loose enemies). Exact
category-bias curve and preplace counts are **proposed** (§14.2) and live as
`CFG` dials.

### 5.3 Axis-1 geometry — archetypes (n-independent shape, footprint grows with n)

`generateLevel` picks one of four archetypes uniformly from `rng`. Footprint
interpolates `~24×26 → 30×34` with `n`, then caps (proposed curve, §14.2). Each
algorithm below is **proposed** — the GDD names the archetypes and their intent;
these pin a buildable method. All four emit `tiles`, `zones`, and the
`player`/`exit` fixed placements, and guarantee connectivity by construction
(re-checked in §5.4).

- **`arena`** — perimeter wall; scatter `k` solid clusters (`o` pillars, `T`
  tombstones) by rejection sampling with a clearance radius, avoiding the start
  pocket and a radius around the exit. `k` scales mildly with footprint. Open by
  construction.
- **`warrens`** — randomized-DFS maze (recursive backtracker) on a coarse
  2-tile-corridor cell grid, then knock `m` extra walls to add loops (a *perfect*
  maze reads badly for twin-stick; loops give flanking routes). Start/exit at far
  cells. Connected by construction.
- **`halls`** — BSP partition into rooms; connect adjacent rooms with 1–2-tile
  doorway gaps in shared walls. A subset of doorways become `d` (plate-door) or
  `D` (locked-door) set pieces when the Plan has unlocked them (n ≥ 3 / n ≥ 2).
  Connectivity via the room-adjacency graph.
- **`ring`** — a solid core block (walls/pillars) centered, leaving a perimeter
  loop ≥2 tiles wide plus 1–2 radial spokes; start and exit on opposite arcs.
  Connected by construction.

`props.dark` set from `CFG.PLAN.darkProb` (n ≥ 5, 25%, never two dark nights
consecutively — the "consecutive" guard reads the *previous* night's flag, which
is derivable from `n` only if we also gate on parity or track it in `G`; **see
Q3**). `props.music` chosen from the archetype→track pool (§11.3 seam, §6.5).

### 5.4 Solvability (generator-side, NEW — ADD had none)

After emitting a candidate def, run these checks *before* returning it:

1. **Flood-fill connectivity** from the `player` tile reaches the `exit` tile and
   **every** placement tile (through open/passable cells; closed plate-doors are
   treated as passable *if* a reachable crate can press their plate — see 3).
2. **Locked-door reachability:** every `D` door's key is placed in the region
   reachable from start **without crossing that door**.
3. **Plate-door solvability:** every plate-door puzzle has **≥1 crate reachable**
   without first needing that door open.

**Failure handling (NEW — the GDD says "must pass" but not the failure path):**
re-roll geometry with a fresh sub-`rng` up to `CFG.GEN.maxAttempts` (proposed
**8**); if still failing, emit the archetype's **guaranteed-valid fallback**
(a plain `arena` with start/exit, no locked/plate doors) and log a telemetry
warning. The generator therefore **always** returns a loadable, solvable def —
`loadLevel` never has to defend against an unsolvable generated level. (See Q3.)

### 5.5 Axis-2 behavior — `CFG.RAMP` evaluation

`CFG.RAMP` is the §8.6 table as data. Each param declares base / step / limit /
mode (`add` or `mul`; paired params like `batPause{Min,Max}` are two entries):

```
tier = floor((n − 1) / 8)
value(param) = param.mode === "mul"
  ? clampToward(param.base * param.step ** tier, param.limit)
  : clampToward(param.base + param.step * tier, param.limit)
```

`clampToward` clamps toward the limit regardless of step sign (some steps are
negative, e.g. `lobberErrorRadius`). Evaluated **once at load** (§4.1 step 8),
snapshotted into `G.ramp`; nothing re-reads `CFG.RAMP` mid-level. The eight
params, bases, steps, and limits are the §8.6 table verbatim — they are ordinary
`CFG` values (tuning is a config edit).

---

## 6. Seams to later systems (interfaces only — no behavior here)

Each seam is a narrow, one-way interface so the level module stays a **producer**
that leaf systems consume, avoiding cycles (§7).

- **§6.1 Nav-blocker registry (#3).** Loader calls `nav.registerBlocker(entity)`
  for each crate/barrel/spawner and `nav.markDirty(tile)` on door open/close.
  `nav` is not imported by `level.js`; it **registers itself** as the blocker
  sink at boot (register-callbacks pattern, §7). Until #3 lands, a no-op sink
  satisfies the interface.
- **§6.2 Plate-press setters (#2).** This spec exposes `setPlatePressed(id,bool)`
  and `openLockedDoor(tx,ty)`; the carry/entity systems *call* them. Deciding
  *what presses a plate* (player/crate weight) and *what spends a key* is #2's.
- **§6.3 Spawner tick (#4).** Loader instantiates the spawner **entity** with its
  `variant`, its Plan-filtered enemy table (§5.1), and its ramped
  interval/live-cap (from `G.ramp`). The per-frame emit loop is #4.
- **§6.4 Light-emitter registry (#7).** Loader sets `props.dark`; light sources
  (player lantern, barrels, exit glow, muzzle, wraith, abilities) register radii
  via `light.register(source)`. The masked-overlay renderer is #7. Dark changes
  information only — no sim branch here.
- **§6.5 Music registry (#11.3).** `props.music` is a key into the `MUSIC`
  registry; selection code reads the key, the registry resolves `synth`→`ogg`
  later with no format/selection change. Loader only stamps the key.

---

## 7. Known implementation risks (flag before building — do not discover mid-impl)

- **Circular import: `level` ↔ `nav`.** Nav needs blockers from the loader; the
  loader must not import nav (nav imports world/level state). **Resolution:** nav
  registers itself as the blocker sink at boot; `level.js` imports only `config`
  and `world` primitives and calls the registered sink. Record this in STATUS.md
  when built.
- **Circular import: `level` ↔ entity modules.** `runSpawnRule` constructs
  crates/barrels/spawners. Keep entity *factories* in the entity modules and have
  the loader call factory functions passed in / imported one-way (entities import
  `config`, not `level`). Snapshot state into event payloads rather than reaching
  back into `G` from subscribers (one-way flow).
- **Ordering: player-before-exit-before-rules** (§4.1 step 5) is load-bearing;
  reordering breaks any set piece that reads player position on spawn.
- **Ordering: `tileState` before placements/rules** (§4.1 step 3 before 5–6) so
  spawn-rule "never on a plate" and door-open flags are already known.
- **`CFG.RAMP` snapshot timing** — read once at load into `G.ramp`; a subscriber
  reading `CFG.RAMP` live mid-level would violate §8.6.
- **Sentinel-over-`Infinity`** — N/A in this subsystem (door state is boolean; no
  serialized "permanent" numeric). Flagged only to confirm it was considered.
- **File-size discipline** — `level.js` in ADD is ~26KB, already over the 24KB
  soft limit. Repossessed's loader+generator is larger (mutable tiles, links,
  solvability, four archetypes). **Recommend splitting on build**:
  `level-loader.js` (schema, `loadLevel`, `validate`, spawn-rule placement,
  tile-state) and `level-generator.js` (archetypes, `CFG.PLAN`/`CFG.RAMP`
  evaluation, solvability). Both behind the same public surface. Decide at review.

---

## 8. Headless smoke tests (pure logic, no canvas — ADD test-loader style)

Model on ADD's `test-loader.js`: stub browser globals, dynamically import the
**real** modules, tiny `check`/`throws` harness. Deliver before the phase is
called done. Minimum assertions:

1. **Generator → loader accepts.** `generateLevel(5, makeRng(1))` produces a def
   that `loadLevel` accepts; grid dims track `CFG.COLS/ROWS`.
2. **Determinism under fixed seed.** `generateLevel(5, makeRng(1))` deep-equals a
   second call with `makeRng(1)`; differs from `makeRng(2)` (D2).
3. **Content purity.** Spawn budget and eligible roster for a fixed `n` are
   identical across different seeds (content = fn of n).
4. **Spawn rules never on solid / plate / exit.** Placed entity tiles are all
   non-solid, non-plate, non-exit.
5. **Validation rejects** (throws): zero players; two players; no exit; unknown
   zone role; unknown `avoid` role; ragged grid; unknown tile char; `link` to a
   missing plate/door id; `door` placement off a `d`/`D` tile; `plate` off `_`.
6. **Link graph.** Pressing a linked plate opens its door; releasing (with no
   other linked plate pressed) closes it; a door with two plates opens on either.
7. **Solvability.** Every def out of the generator passes flood-fill start→exit
   and start→every-placement; locked-door keys are pre-door-reachable; the
   fallback triggers and is valid when solvability is forced to fail (inject a
   generator that returns an unsolvable candidate).
8. **Persistent-vs-transient.** After `loadLevel`, transient arrays are cleared
   and player run-state (hp/keys/gems/score/night) is untouched.
9. **RAMP evaluation.** `value()` steps on 8-Night tiers; `mul` and `add` modes;
   clamps toward the limit for negative steps.

---

## 9. Open design questions

**Q3 — RESOLVED (2026-07-05) → track `G._prevDark`, unsaved.** The
"never two dark Nights consecutively" guard reads one boolean of run state,
`G._prevDark`, set after each generation and **not** serialized (consistent with
D2's no-layout-persistence rule — on resume it simply starts `false`, at worst
permitting one dark Night that could otherwise have been suppressed; harmless).
The generator's solvability-retry counter (§5.4) is local to the call, not `G`
state. The pure-parity-of-`n` alternative is dropped.

Still open:

- **Q1 — Archetype algorithm sign-off.** The four generation algorithms (§5.3)
  and their parameters (cluster counts, loop-knock count, BSP depth, ring width)
  are proposed. They're design content that wants a play-feel pass, not just
  config. Highest-leverage unknowns: `warrens` corridor width vs enemy body size;
  `halls` doorway width (1 vs 2 tiles) interacts with crate vault (§7.1.5).
- **Q2 — Key budget & scope (defers to §14.1, already open).** How many keys the
  generator budgets per Night and what they open (exit vs side vaults) is §14.1.
  Until resolved, §5.2 places keys only as locked-door set pieces (n ≥ 2), one
  per generated locked door, in the pre-door region.
- **Q4 — Fallback archetype identity.** §5.4's guaranteed-valid fallback is a
  plain `arena`. Confirm that's acceptable as a rare degenerate case, or specify
  a hand-authored "safe room" def as the fallback instead.
- **Q5 — `(proposed)` generator numbers (defers to §14.2).** Budget curve,
  intro schedule, dark probability, composition weights, footprint growth curve,
  `maxAttempts`, tier length — all live as `CFG` dials awaiting §14.2 sign-off.
  None block building the *mechanism*; they block tuning.

---

## 10. ADD source provenance (what was verified, where, disposition)

| GDD claim | ADD source checked | Finding / disposition |
| :--- | :--- | :--- |
| Loader is sole entry; ordered build | `src/level.js` `loadLevel` | REUSED; order (player-first) + transient-clear list confirmed; extended with tile-state, nav registration, ramp snapshot |
| `validateLevelDef` rules | `src/level.js` `validateLevelDef`; `test-loader.js` | REUSED (1 player, ≥1 exit, zone-role exists); extended with links/door/plate/script rules |
| Spawn-rule placement honors `avoid`, never solid | `src/level.js` `pickTile`/`runSpawnRule` | REUSED (400-try + fallback, unknown-type ignore); extended with plate/exit avoidance + new types |
| Zones: roles overlap, `any`=interior | `src/level.js` `zonesWithRole`/`randomTC`; generator | REUSED; role set `spawn/cover/combat/danger/any` confirmed |
| Grid field name | `src/level.js`, `src/world.js` `loadTileGrid` | **`tiles`** in all ADD code vs GDD's `grid` → D1 flag |
| Generator produces data only; returns `{tiles,zones,placements,spawnRules,…}` | `src/level.js` `generateLevelDef` | ADAPTED; drops `conveyors`, adds `props`/`links`, seeded `rng` |
| Content plan indexed by level counter | `src/state.js` `levelType`; `config.js` `LEVEL_PLAN` | ADAPTED into richer `CFG.PLAN` (introductions/budget/props) |
| Tile flags data-driven | `config.js` `TILES` | ADAPTED: drop `destructible`, add `blocksFlight`, add mutable door/plate |
| Loader derives dims from grid | `world.js` `loadTileGrid`; `test-loader.js` dims checks | REUSED; `cols/rows` in def are non-authoritative metadata |
| Resume rebuilds level; layout may differ | `src/level.js` `resumeFromSave`→`buildLevel`; GDD §12.3 | REUSED; resolves D2 — no persisted seed, content=fn(n) |
| No conveyor layer | `src/level.js` `loadLevel` `bakeConveyors` | Bake step **deleted** (§13.2), not stubbed |

---

*End SPEC-LEVEL — pairs with GDD §8 (and §6.3, §6.4, §7.3, §12.3, §13.2–6/17/24).
Next step (separate, after human review): generate phased Claude Code prompts
from this spec.*