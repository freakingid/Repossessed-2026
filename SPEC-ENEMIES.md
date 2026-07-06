# SPEC-ENEMIES — The Roster, Spawners, the Nav Consumer Layer & Enemy-Side Combat (`enemies.js`)

**Implementation-detail layer for GDD §6 (= `GDD-ENEMIES.md`), reading GDD §9 /
§5.1–5.2 / §2.5 / §8.6.** Design intent lives in `GDD-ENEMIES.md`; build reality
in `STATUS.md`. This spec is subsystem **#4**. It owns the enemy roster, spawners,
the nav *consumer* layer over the pure `nav.js` service (SPEC-PATHFINDING), and —
per the locked scope decision — **enemy-side combat resolution** (enemy HP, taking
player-shot damage → death → gem drop → score). The cross-cutting §9 attribution
plumbing is left as a thin `awardKill` seam / small follow-on **SPEC-SCORING**
(which must also serve barrels + abilities); this spec implements only the direct
player-attributed and enemy-attributed-zero paths (§6.5, §8).

**Out of scope (do not spec here):** §14 boss / Corruptor / Angelic-Spirit block
(tabled in GDD v1.1 — not a blocking question); barrels + shrapnel + the kicked-
barrel physics (`SPEC-BARRELS`, post-#4 — this spec only leaves the Wraith/Nova/
Lightning → barrel-detonation *seam*); ability internals (Nova/Lightning ring math
is #5 — this spec exposes the `resist`/`boss` flag they read); pickup *collection*
and the gem→energy credit (#3/#5 — this spec only *drops* gems); rendering,
lighting, HUD floats, screen-shake/hit-stop (#7/#10 — this spec emits the events).

---

## 1. Resolved decisions (forks the GDD/architecture leave that code cannot skip)

Each is a fork requiring an owner sign-off glance, in the SPEC-LEVEL/SPEC-PLAYER §1
style. **Summary of rulings:** E1 → straight enemy projectiles reuse the owner-
tagged `Shot` shape + `updateShots` (needs a per-shot `maxTravel` + `effect`);
lobbed/proximity ordnance is a distinct timed kind. E2 → the repath scheduler /
round-robin / waypoint-follow / direct-steer fallback live **here** (Shape-1, Q1),
`nav.js` stays pure. E3 → nav-dirty repath keys off `getNavVersion()` +
`consumeDirtyTiles()`, single-consumer. E4 → spawner live-cap via an origin tag.
E5 → `enemies.js` registers real factories for all 9 types; the loader's
`ENTITY_ARRAY` must gain the 8 loose types. E6 → the melee exchange loop is here;
player exposes sinks. E7 → player needs a new `applyEntangle` sink (missing today).
E8 → death splits: gems always drop, **score** is attribution-gated. E9 → Reaper
uses PHANTOM A*, exposes a `boss` flag for #5. E10 → `enemySpeedMult` scales all
movers at read time; HP/damage never ramp. E11 → the load-bearing per-frame order
(the Wraith-defuse dependency).

**E1 — Enemy projectiles: straight kinds reuse the `Shot` shape; lobbed/proximity
kinds do not.** `projectiles.js` already commits to this: its header says "enemy
arrows + shrapnel join later behind the same owner-tagged `Shot` shape," and
`player.js` `tryFire` already scopes the on-screen cap to `owner === "player"`
(comment: "Enemy arrows share `G.shots` later and must not consume the player's
cap"). So **arrows, webs, and the Reaper dark-blast are `makeShot(...)` with
`owner:"enemy"`** and ride the existing `updateShots` loop (per-axis crate
ricochet, non-bounce wall-fizzle — both correct for enemy straight shots per §9
"even after a crate ricochet" and §6.1.9 "collides with terrain and crates
normally"). Two amendments to `projectiles.js` are **owned by this spec**:
- `makeShot` gains **`maxTravel`** (default `CFG.SHOT.range`) and **`effect`**
  (`"damage"` default | `"entangle"`); `updateShots` expiry reads
  `s.maxTravel ?? CFG.SHOT.range`. Arrow range = 6 t ≠ player 7 t; web = 7 t;
  dark-blast range is a generous dial (§7). *`updateShots` stays owner-agnostic
  motion — it never applies damage; the hit-tests are this spec's combat pass
  (§6).*
- The **lobbed explosive** (Lobber) and the **Wraith proximity blast** are **not**
  straight shots. The lob is an **arced, wall-ignoring, timer-resolved** kind in a
  new `G.ebolts` array (ADD's name/pattern, `updateArc` verbatim, §12); the Wraith
  blast is not a projectile at all — it is an instantaneous AoE fired at the
  Wraith's own position on EXPLODE (§6.1.8). *Adopt the split; do not force lobs
  through `updateShots`.*

**E2 — The nav consumer layer lives here (Shape-1 baseline, Q1 sign-off).**
`nav.js` is a pure service: `findPath(sx,sy,gx,gy,mask)` (pixels in; waypoints
`{tx,ty,x,y}` start-exclusive/goal-inclusive; `[]` iff same tile; `null` iff goal
blocked/unreachable), `isNavBlocked`, `getNavVersion`, `consumeDirtyTiles`,
`installNav`. STATUS confirms "**Owed by #4:** repath scheduler / round-robin /
waypoint steering / direct-steer fallback." This spec builds all four (§3). The
four A* classes are **Skeleton Shooter, Zombie, Fire Wraith** (`GROUND`) and **the
Reaper** (`PHANTOM`); the other five never call `findPath` (§6.4). *Adopt — do not
add scheduling to `nav.js`.*

**E3 — Nav-dirty → repath: `getNavVersion()` is the coarse gate,
`consumeDirtyTiles()` the precise selector; this spec is the SOLE consumer.**
`consumeDirtyTiles()` **clears on read** (it drains a `Set`), so exactly one system
may call it per frame or dirty tiles are silently lost. This spec's scheduler is
that system. Each frame: if `getNavVersion()` changed since last frame, drain
`consumeDirtyTiles()` once and intersect the dirtied tiles against each A*
navigator's cached path-tile set (`{tx,ty}` per waypoint — this is exactly why the
waypoint carries tile identity, STATUS §nav); any navigator whose path crosses a
dirtied tile is force-repathed next scheduler slot. This is what makes a **crate
barricade** re-route Zombies (GDD §6.4). *Adopt; flag single-consumer as a hard
contract (R1).*

**E4 — Spawner live-cap via an origin tag (chain-of-custody style).** Each spawned
enemy carries **`originSpawner`** (a stable spawner id). A spawner may emit only
while its live tagged children `< e.liveCap`; the count is a scan of `G.enemies`
for the matching tag at each emit decision (O(enemies)·spawners, cheap at arcade
counts — no counter to desync on death). First emit **2 s** after level start,
then every **`e.interval`** (both ramped, already snapshotted onto the placeholder
by the loader); a spawned enemy appears with a **0.5 s emergence telegraph**,
reusing ADD's `e.spawn` grow-in gate (spawned enemy exists but does not act or
collide until `spawn ≤ 0`). Enemy type is a weighted pick from the Plan-filtered
`e.table` already on the placeholder. *Adopt the tag; do not maintain a mutable
per-spawner counter.*

**E5 — `enemies.js` registers all 9 factories; the loader's `ENTITY_ARRAY` must
gain the 8 loose types.** STATUS ("loose enemies as forward-compatible
placements") records that early-Night rosters emit `{type:"ghost"|"skeleton"|…}`
placements that `placeEntity` currently **drops** (no factory → `null`, silently
ignored; solvability still flood-checks their tiles). This spec's `enemies.js`
registers real factories via the loader's `registerEntityFactory(type, fn)` seam
for **all nine** element names — and here is the gap that will silently swallow
them otherwise: **`level-loader.js`'s `ENTITY_ARRAY` maps only `reaper → "enemies"`.**
The eight loose types (`ghost`, `skeleton`, `skeletonShooter`, `lobber`, `bat`,
`spider`, `zombie`, `fireWraith`) are unmapped, so even with a factory registered,
`placeEntity` builds the entity and then **does not push it onto any `G` array**
(`const arr = ENTITY_ARRAY[p.type]; if (arr && G[arr]) …`). **Owned loader edit:**
add the eight element names → `"enemies"` in `ENTITY_ARRAY`. Element keys are
**camelCase and must match `CFG.PLAN.introductions` exactly** (`skeletonShooter`,
`fireWraith` — not `skeleton_shooter`/`fire_wraith`), or placements vanish. *Adopt
the `ENTITY_ARRAY` extension; keep the factory type-keys identical to the Plan
element names.*

**E6 — The melee exchange loop is owned here; the player exposes sinks only.**
STATUS §import-discipline: "**enemies (#4) — they call INTO player, player never
imports them.** The melee overlap loop is #4's; it calls the player's exported
sinks (`applyDamageToPlayer`/`applyKnockbackToPlayer`) and reads
`G.player.loco === "CARRYING"` … `meleeState` is reserved on `G.player` for #4's
pair-lockout wiring." So: on player↔enemy body overlap, player deals **2** to the
enemy (GDD §2.2, ADD mop value), enemy deals **its §6.2 melee** to the player via
`applyDamageToPlayer(dmg, e.type)`; **both** are knocked back (player via
`applyKnockbackToPlayer`; enemy-side via the shared knockback machinery, §6.6). The
**re-trigger lockout** (a given enemy↔player pair cannot re-exchange until contact
breaks and re-enters, GDD §2.1) is tracked by a **per-enemy `contact` flag** plus
`G.player.meleeState` — a pair is locked while overlapping and cleared on
separation. **Carried-crate pushback** (GDD §7.1.4, §6.4): if `isCarryingCrate()`,
on contact push the enemy back **1.5 t** and **skip the damage exchange** entirely
— **except Bats**, which fly over and are exempt from all ground-object
interaction. *Adopt; player-side sinks already exist, enemy-side is here.*

**E7 — The player is missing an entangle sink; this spec adds `applyEntangle`.**
`player.js` fully processes `p.entangle` (timer decrement in `tickPlayer`,
`entangleMult` in `effectiveMoveSpeed`, the ≥60° struggle-shave in
`applyEntangleShave`) but **exposes no setter** — the Spider web has nothing to
call. The established discipline is "enemies call INTO player via exported sinks,"
so writing `G.player.entangle` directly from `enemies.js` is **rejected** (it
reaches past the sink boundary the codebase enforces). **Owned player.js
amendment:** add `export function applyEntangle(seconds)` that sets
`p.entangle = Math.max(p.entangle, seconds)` and resets `p.entangleAngle = null`;
it does **not** trip iframe (the web is 0 damage) and does not gate on `loco`
(entangle stacks with locomotion per §2.5). *Adopt the sink; do not reach around
it.*

**E8 — Death splits: gems always drop; only score is attribution-gated.** On any
enemy death, drop **`e.gems`** gem pickups (§6.2 Gems column) into `G.pickups` as
`{type:"gem", x, y, value: CFG.GEM.energy}` regardless of who killed it — gems are
**position-based loot, not a score award**, and the gem economy shouldn't punish
the player when a Wraith clears a pack near them. **Score** is attribution-gated
per §9: a **player-attributed** kill (bullet, melee, Nova, Lightning, kicked
barrel, player-started shrapnel) awards `e.points`; an **enemy-attributed** kill
(Wraith friendly-fire AoE; enemy-started shrapnel) awards **0**. This spec routes
every death through a thin **`awardKill(e, cause)`** seam and implements only the
**direct** causes it can see (its own `"player-bullet"` / `"player-melee"` paths,
and `"wraith-aoe"` → 0); the **chain-of-custody** logic (barrel ownership tags,
shrapnel adoption) is **SPEC-SCORING** (Nova/Lightning attribution is #5 calling
the same seam). Whether a friendly-fire kill should drop gems at all is Q3 (§11) —
proposed **yes**. *Adopt the split + the `awardKill` seam.*

**E9 — The Reaper: PHANTOM A*, and it exposes a `boss`/`resist` flag for #5.** The
Reaper's inverted mask (floats through walls/terrain, **blocked only by movable
objects**) is exactly `NAV_MASK.PHANTOM` (STATUS: PHANTOM "terrain tiles all
passable; only movable objects block"). It A*-routes over PHANTOM. It is placed by
level defs only (never spawner-emitted; `reaper → "enemies"` already routes it),
and the loader ships it today as an **inert `blocks:false` placeholder** this spec
overrides. Nova/Lightning **resist** (Nova: 10 dmg + ring loses 20; Lightning:
5 dmg — GDD §5.1/§5.2) is the abilities' math, but the enemy must **expose a flag**
(`e.boss = true` / `e.resist = {...}`) that #5 reads instead of hardcoding a type
check. *Adopt PHANTOM + the exposed flag; the resist *values* are #5's to apply.*

**E10 — `enemySpeedMult` scales every mover at read time; HP/damage never ramp.**
GDD §8.6 is explicit that ramping is behavioral, not statistical: enemy **HP and
damage never change**. `G.ramp.enemySpeedMult` (snapshotted at load, clamp
1.00→1.25) multiplies **every** enemy's effective move speed (`speed ×
G.ramp.enemySpeedMult`, applied where the mover reads speed — mirrors ADD's
`buffSpd(e)`). The other per-type ramp dials (`shooterStopToShoot`,
`lobberErrorRadius`, `batPauseMin/Max`, `spiderWebCooldown`, `reaperSummonInterval`,
`spawnerInterval`, `spawnerLiveCap`) are likewise read from `G.ramp`, already
snapshotted — never re-read mid-level. *Adopt; never mutate HP/damage per tier.*

**E11 — The load-bearing per-frame order (the Wraith-defuse dependency).** Getting
the Wraith's "shot down before FLASH completes → no explosion" (GDD §6.1.8,
proposed) correct forces a specific order: **damage/death must resolve before the
AI's EXPLODE decision.** The subsystem tick (§3.5) is therefore:
`(1) spawner emit → (2) nav scheduler → (3) player-shot→enemy damage pass →
(4) melee exchange → (5) death sweep [a mid-FLASH Wraith removed here = defused,
no AoE] → (6) enemy AI tick [survivors move/steer/fire; a surviving Wraith whose
FLASH completes EXPLODEs now] → (7) enemy ordnance update (arced lobs; straight
shots ride player.js's `updateShots`)`. *Adopt this order explicitly; it is the
bug-class the ordering prevents, exactly like `player.js`'s step order.*

---

## 2. Data shapes

**`G.enemies`** — array of enemy entities. One **base shape** (every enemy) plus a
**per-type overlay** (only the fields that type's AI reads). All positions are
**pixels** (the reconciled coordinate space, SPEC-PLAYER Phase 6); tile identity is
derived `(x/TILE)|0`. Base:

```
{
  type,                 // "ghost"|"skeleton"|"skeletonShooter"|"lobber"|"bat"|
                        //   "spider"|"zombie"|"fireWraith"|"reaper" (= CFG.PLAN keys)
  x, y, r,              // pixel center + collision radius (CFG.ENEMY[type].r)
  hp,                   // current; init from CFG.ENEMY[type].hp (units = base player bullets)
  speed,                // px/s BASE (pre-ramp); effective = speed × G.ramp.enemySpeedMult
  face,                 // heading radians (render + facing-row resolve, GDD §11.2)
  kvx, kvy,             // knockback velocity (decays; shared ADD model, §6.6)
  contact,              // bool — melee pair-lockout with the player (E6)
  spawn,                // s remaining of emergence telegraph (0 = active); 0 for placed
  originSpawner,        // spawner id | null (loose/placed) — live-cap tag (E4)
  boss,                 // true only for reaper (E9); read by #5, HUD
}
```

Per-type overlay (nav + FSM state only; stats live in `CFG.ENEMY`, not on the
entity):

| type | navClass | tracking | overlay fields |
| :-- | :-- | :-- | :-- |
| ghost | — (direct) | omniscient | — |
| skeleton | — (wall-slide) | omniscient | — |
| skeletonShooter | `GROUND` A* | LOS-acquire | `state`("WANDER"\|"HUNT"), `awareT`, `losT`, `shootPhase`(null\|"windup"\|"cooldown"), `shootT`, `nav`{} |
| lobber | — (cover-seek) | LOS | `canSee`, `losT`, `fireCd`, `wander` |
| bat | flight (no collision) | snapshot | `state`("SNAPSHOT"\|"FLY"\|"PAUSE"), `snap`{x,y}, `pauseT` |
| spider | — (direct+retreat) | omniscient | `burstState`("BURST"\|"PAUSE"), `burstT`, `retreatT`, `webCd` |
| zombie | `GROUND` A* | omniscient | `nav`{} |
| fireWraith | `GROUND` A* | omniscient | `state`("APPROACH"\|"FLASH"), `flashT`, `nav`{} |
| reaper | `PHANTOM` A* | omniscient | `summonCd`, `blastCd`, `nav`{} |

**`nav` sub-block** (only on the four A* classes) — the per-navigator scheduler
state (§3):

```
nav: {
  path,          // Array<{tx,ty,x,y}> | [] | null — last findPath result
  wpIndex,       // index of the current target waypoint in path
  wpTimer,       // s until the stuck-timeout fires (ADD wpTimeout convention)
  repathTimer,   // s until this navigator is eligible to repath (>= repathMinInterval)
  goalTile,      // {tx,ty} the current path was cut to (repath on target-tile change)
  pathTiles,     // Set<packed tx,ty> for the dirty-intersection test (E3)
}
```

**Enemy straight projectile** — a `Shot` (E1), `owner:"enemy"`, with the two new
fields:

```
makeShot({ x, y, vx, vy, r, dmg, owner:"enemy", maxTravel, effect })
//   arrow:      dmg 2, speed 256 (8 t/s), maxTravel 192 (6 t), effect "damage"
//   web:        dmg 0, speed 352 (11 t/s), maxTravel 224 (7 t), effect "entangle"
//   darkBlast:  dmg 3, speed 224 (7 t/s), maxTravel <dial> (7), effect "damage"
```

**Arced ordnance** — `G.ebolts` (new; add to loader `clearTransient`), the Lobber
lob (ADD `updateArc` shape):

```
{ kind:"arc", x0,y0, tx,ty,   // launch + (error-perturbed) landing, fixed at fire
  x,y, height,                // interpolated ground pos + parabolic draw height
  t, dur,                     // airtime accumulator + 1.0 s total
  dmg, blast,                 // 2, 40 px (1.25 t)
  owner:"enemy" }             // AoE at landing hits the player only (§6.4)
```

**Gem pickup** — dropped into `G.pickups` (collection is #3): `{type:"gem", x, y,
value: CFG.GEM.energy}`. Forward-compatible with the loader's placeholder pickup
shape; #3 owns the magnet/auto-collect + energy credit.

---

## 3. The nav consumer layer (owned — Shape-1, Q1)

`nav.js` gives paths; this layer schedules, budgets, follows, and degrades. Only
the four A* classes (§6.4) participate; the other five steer directly and never
enter the registry.

### 3.1 Repath scheduling (per navigator)

A navigator repaths when **any** of these holds and its `repathTimer ≤ 0`
(`CFG.ENEMY.repathMinInterval`, from `CFG.NAV.repathMinInterval = 0.5 s`):
- its **goal tile changed** (the player moved to a new tile) — the common case;
- the **nav grid dirtied a tile on its path** (E3 — crate placed/removed, barrel
  destroyed, door opened);
- it has **no live path** (`null`/`[]` last frame, or just finished one).

On repath: call `findPath(e.x, e.y, player.x, player.y, mask)` (mask =
`NAV_MASK.GROUND` for Shooter/Zombie/Wraith, `NAV_MASK.PHANTOM` for the Reaper),
store the result in `e.nav.path`, reset `wpIndex = 0`, `wpTimer = wpTimeout`,
rebuild `pathTiles`, and set `repathTimer = repathMinInterval`.

### 3.2 Round-robin budget (frame-stagger)

To keep a Zombie horde from spiking a frame (GDD §6.4 "Budget rule"), at most
**`CFG.ENEMY.repathBudgetPerFrame`** navigators actually call `findPath` per frame.
Maintain a rotating cursor over the A* registry; each frame, walk from the cursor
and repath up to the budget among those *eligible* (§3.1); advance the cursor past
the last serviced navigator. An eligible-but-unserviced navigator keeps following
its **existing** path this frame (steering never stalls waiting for a repath) and
is first in line next frame. `repathMinInterval` is the per-navigator floor; the
budget is the per-frame ceiling.

### 3.3 Waypoint-follow steering (ADD `arriveDist`/`wpTimeout` — VERIFIED reuse)

Follow `e.nav.path` toward `path[wpIndex]` using `moveBody` (per-axis slide vs
walls + the movable set, the caller passes a `GROUND`/`PHANTOM`-appropriate blocker
filter). Reuse ADD's arrival convention (verified in `add2026`
`enemies-ai.js updateCleaner`, `config.js` `arriveDist:9`, `wpTimeout:5`): advance
to the next waypoint when **`dist ≤ CFG.ENEMY.arriveDist` OR `wpTimer ≤ 0`** (the
stuck-timeout is the anti-wedge fallback), resetting `wpTimer = wpTimeout` on
advance. On reaching the final waypoint, the path is exhausted → repath next
eligible slot. `face = atan2(dy, dx)` toward the current waypoint.

### 3.4 Direct-steer fallback (`findPath → null`, Q4)

`findPath` returns **`null`** when the goal tile is blocked or unreachable, and
**`[]`** when the navigator already stands on the goal tile. Neither is a path to
follow:
- **`null`** → **direct-steer**: aim straight at the player and `moveBody` (the A*
  class degrades to Ghost-grade steering rather than freezing — a Zombie whose only
  route just got barricaded still presses toward the player). Retry `findPath` on
  the normal cadence; it recovers the instant a route reopens.
- **`[]`** → the goal is the current tile; steer directly to the player's pixel
  position (sub-tile approach, no waypoints).

This is the sole reason a `null` return is a *fallback* and not a bug: `nav.js`
deliberately returns `null` for `#4` to direct-steer (its `findPath` comment says
so).

### 3.5 Frame order (E11 — restated as the contract)

```
tickEnemies(dt):
  1. spawners emit (may append to G.enemies; new ones start with spawn>0)
  2. nav scheduler: drain consumeDirtyTiles() ONCE if getNavVersion() changed (E3);
       select + repath up to repathBudgetPerFrame eligible navigators (§3.1–3.2)
  3. player-shot → enemy damage pass (§6.1)   // marks hp; queues deaths
  4. melee exchange (player ↔ enemy contact) (§6.2)
  5. death sweep (§6.3): hp≤0 → gems + awardKill + remove
       // a Wraith in APPROACH/FLASH removed here is DEFUSED — no AoE
  6. enemy AI tick over survivors (§6):
       emergence gate (spawn>0 ⇒ decrement, skip) → move/steer (§3.3/§3.4) →
       per-type attack (spawn straight shots / lobs / summon / dark-blast) →
       Wraith FLASH→EXPLODE fires its AoE HERE (survived step 5) (§6.1.8)
  7. ordnance update: updateEbolts(dt) (arced lobs, §6.4);
       straight enemy shots already advanced by player.js's updateShots
```

Note the two attack-resolution homes: **straight** enemy shots are spawned in
step 6 and *moved* by `player.js`'s existing `updateShots` (which "always runs");
their **damage to the player** is applied in step 3-analogue for enemy shots — see
§6.4 (the enemy-shot→player test runs alongside the arced-ordnance update in
step 7, after motion, so a shot that reached the player this frame connects).

---

## 4. Nav classes & masks (GDD §6.4 — restated per type)

| Class | Types | Mask / motion | Blocker filter for `moveBody` |
| :-- | :-- | :-- | :-- |
| `GROUND` A* | skeletonShooter, zombie, fireWraith | `NAV_MASK.GROUND`; walls+doors+static crates/barrels block | crates+barrels+spawners (all movable + spawner-as-static) |
| `PHANTOM` A* | reaper | `NAV_MASK.PHANTOM`; terrain passable, **only movable objects block** | crates+barrels **only** (spawners are GROUND-only in occupancy — Reaper passes them; STATUS/nav §Q2) |
| direct steer | ghost, skeleton, spider | no A*; `moveBody` vs walls+movables; per-type block reaction | crates+barrels+spawners |
| cover-seek | lobber | no A*; LOS-driven approach/flee, `moveBody` | crates+barrels+spawners |
| flight | bat | **no collision at all** — raw integrate over walls/crates/barrels/spawners/enemies | none (ignores all) |

Reaper `PHANTOM` note: `nav.js`'s occupancy adds spawners to `occGround` **only**
(not `occPhantom`), so `findPath(..., PHANTOM)` already routes the Reaper *through*
spawners and walls, blocked only by crates/barrels. The Reaper's own `moveBody`
filter must match (crates+barrels only) or it would collide with a wall the
pathfinder told it to cross. **Bat** does not use `moveBody` — it integrates its
position directly (flies over everything, §6.1.5), and is exempt from carried-crate
pushback (E6).

---

## 5. `CFG.ENEMY` — the canonical stat block (new data)

`config.js` has no `CFG.ENEMY` block yet (only `PLAN`/`RAMP`/`SPAWNER`/`SHOT`/
`NAV`/`GEN`/`PLAYER`/`KEYS`). This spec adds one — pure leaf data, no imports.
**All px/s values are GDD tile values × `TILE(32)`; speeds are `×player 112 px/s`;
every point/gem value is a `(proposed)` tuning dial flagged for the later §14.2
sign-off (same posture as SPEC-LEVEL/PLAYER), not a build blocker.** HP/damage are
GDD-fixed (never ramp, E10). Shape (values transcribed from GDD §6.2 + §6.1):

```
CFG.ENEMY = {
  // shared nav-consumer dials (E2/E3)
  repathMinInterval: CFG.NAV.repathMinInterval,   // 0.5 s per-navigator floor
  repathBudgetPerFrame: 4,     // (proposed) round-robin ceiling
  arriveDist: 9,               // px — ADD value (VERIFIED)
  wpTimeout: 5,                // s  — ADD value (VERIFIED)

  ghost:           { hp:2, points:50,  gems:1, r:12, speedMul:0.45, melee:1, nav:"direct" },
  skeleton:        { hp:4, points:100, gems:1, r:12, speedMul:0.50, melee:1, nav:"wallslide" },
  skeletonShooter: { hp:4, points:150, gems:2, r:12, speedMul:0.65, melee:1, nav:"ground",
                     los:6, arrow:{dmg:2, speedMul:8/3.5, range:6}, windup:0.4, cooldown:1.5,
                     awareDecay:8, /* stopToShoot from G.ramp.shooterStopToShoot */ },
  lobber:          { hp:2, points:100, gems:1, r:12, speedMul:0.40, fleeMul:0.95, melee:1,
                     nav:"cover", lobRange:9, lobEvery:2.5, airtime:1.0, blast:1.25, lobDmg:2,
                     losCheckEvery:0.12 /* ADD */, /* errorRadius from G.ramp.lobberErrorRadius */ },
  bat:             { hp:2, points:150, gems:1, r:12, speedMul:1.15, melee:2, nav:"flight",
                     /* pauseMin/Max from G.ramp.batPauseMin/Max */ },
  spider:          { hp:4, points:200, gems:2, r:12, melee:2, nav:"direct-retreat",
                     burstMul:1.5, burstDur:0.5, pauseDur:0.6, retreatDur:1.5,
                     web:{dmg:0, speedMul:11/3.5, range:7, entangle:2.5}
                     /* webCooldown from G.ramp.spiderWebCooldown */ },
  zombie:          { hp:8, points:200, gems:3, r:12, speedMul:0.28, melee:3, nav:"ground" },
  fireWraith:      { hp:2, points:150, gems:2, r:12, speedMul:0.50, nav:"ground",
                     armDist:1.5, flashDur:0.8, flashMul:0.5, explodeRadius:2, explodeDmg:4,
                     glowRadius:1.5 /* §8.4 dark levels */ },
  reaper:          { hp:20, points:750, gems:10, r:14, speedMul:0.40, melee:3, nav:"phantom",
                     boss:true, blastDmg:3, blastSpeedMul:7/3.5, blastRange:<dial>,
                     summon:{pick:["ghost","ghost","skeleton"] /* 2:1 → 50/50 per GDD */,
                             minionCap:6}
                     /* summonInterval from G.ramp.reaperSummonInterval; blastEvery 9 s fixed */ },
  spawner:         { hp:6, points:300, gems:3, r:16 /* tile-aligned static */, emerge:0.5,
                     firstDelay:2.0 /* interval/liveCap come ramped off the placeholder */ },
}
CFG.GEM = { energy: 5 }   // §3.5 — each dropped gem = 5 energy (feeds #5's Nova bar)
```

*Speeds stored as `speedMul` and resolved `speedMul × 112 × G.ramp.enemySpeedMult`
at read time — one place to apply the ramp (E10). The Reaper `summon.pick` array
`["ghost","ghost","skeleton"]` yields the GDD 50/50 "2 Ghosts **or** 1 Skeleton"
by picking one entry and, if "ghost", spawning two — see §6.1.9.*

---

## 6. Per-type AI + combat resolution (owned)

Movement uses §3.3/§3.4 for A* classes and the per-type reactions below for the
rest. Every mover multiplies its base speed by `G.ramp.enemySpeedMult`.

### 6.1 The roster

**6.1.1 Ghost (direct, omniscient).** Steer straight at the player;
`moveBody(e, vx·dt, vy·dt, groundFilter)`. **No avoidance** — per-axis slide is the
*only* thing keeping it moving along a wall, and it wedges in concave corners by
design (GDD §6.1.1). No FSM.

**6.1.2 Skeleton (wall-slide, omniscient).** Direct vector, but when a frame yields
**≈ zero net progress** (moved distance < ε despite intent — `moveBody` reverted an
axis), rotate the steer vector toward the **freer perpendicular** (probe both ±90°
one step via `bodyHitsWall`/`bodyHitsBlocker`; steer to the open side) so it rounds
convex corners and "finds the doorway" — but a deep concave pocket still defeats it
(GDD §6.1.2). This is the only difference from a Ghost.

**6.1.3 Skeleton Shooter (`GROUND` A*, LOS-acquire).** FSM `WANDER → HUNT`:
- **WANDER** (unaware): slow ambient roam (pick a random reachable waypoint
  occasionally); each `losT` tick (throttled, ADD `losCheckEvery`) test
  `hasLineOfSight(e→player)`; on **acquire** → HUNT.
- **HUNT**: full A* toward the player (§3). Stay aware `awareDecay = 8 s` after
  losing LOS *(proposed)*, then revert to WANDER. Within `los = 6 t` **and** LOS,
  each decision tick **stop-to-shoot** with prob `G.ramp.shooterStopToShoot`
  (base 0.50, ramps to 0.90); else keep closing. Shoot sequence (stationary
  throughout, GDD §6.1.3): **halt → 0.4 s windup telegraph → fire arrow → 1.5 s
  cooldown**. Arrow = `makeShot(owner:"enemy", dmg:2, speed 256, maxTravel 192,
  effect:"damage")` aimed at the player at fire time.

**6.1.4 Lobber (cover-seek — ADAPTS ADD Sorter, VERIFIED).** Direct port of
`add2026 updateSorter` (verified §12) plus the accuracy-error mechanic. Throttled
LOS (`losCheckEvery` 0.12 s, ADD):
- **Exposed** (`canSee`): panic — flee **away** at `fleeMul 0.95×` with a
  wandering jitter (ADD `e.wander += (rand−.5)·jitter·dt·6`; angle = away +
  `sin(wander)·0.9`); **hold fire**; the flee naturally seeks LOS-breaking tiles.
- **In cover** (`!canSee`): advance at `0.40×`; within `lobRange = 9 t`, lob every
  `lobEvery = 2.5 s`. The **lob** is an arced `G.ebolts` entry (E1/§6.4), **not** a
  straight shot: arcs over all walls/crates (source: explosives ignore crates),
  airtime `1.0 s`, lands at the player's position **perturbed by a random offset
  within `G.ramp.lobberErrorRadius`** (base 1.5 t, ramps to 0.25 t) — this is the
  net-new bit vs ADD's exact-target `fireEnemyArc`. Detonation: 1.25-t radius,
  2 dmg, telegraphed by the fixed ground shadow for the full airtime (ADD
  telegraph, VERIFIED §12).

**6.1.5 Bat (flight, snapshot).** FSM `SNAPSHOT → FLY → PAUSE`:
- **SNAPSHOT**: record the player's current position into `snap`.
- **FLY**: integrate straight toward `snap` at `1.15×` — **no collision** (flies
  over walls/crates/barrels/spawners/enemies; raw position add, not `moveBody`).
- **PAUSE**: hover a random `[G.ramp.batPauseMin, batPauseMax]` s (base 0.4–1.2,
  shrinks per tier) → back to SNAPSHOT. It attacks **where you were**: melee 2 on
  contact, exempt from carried-crate pushback (E6). Baitable into a bad hover spot
  (e.g. over an imminent barrel blast, GDD §6.1.5).

**6.1.6 Spider (direct + retreat; web).** Omniscient, **no wall navigation**
(Ghost-grade). Burst FSM: **BURST** `1.5×` for `0.5 s` → **PAUSE** `0.6 s` → repeat.
**Blocked rule** (distinct from Ghost/Skeleton): on ≈ zero net progress, enter
**RETREAT** — move *away* from the player for `retreatDur 1.5 s`, then re-engage;
it never wall-hugs. **Web**: needs LOS + range ≤ `7 t`; a straight `makeShot(
owner:"enemy", dmg:0, speed 352, maxTravel 224, effect:"entangle")`; cooldown
`G.ramp.spiderWebCooldown` (base 4 s → 2 s). On hit → `applyEntangle(2.5)` (E7).

**6.1.7 Zombie (`GROUND` A*, omniscient).** Full A* (§3), never stops, never loses
interest, walks around anything. `0.28×`, melee 3, HP 8. Pure area-denial; no FSM,
no ranged.

**6.1.8 Fire Wraith (`GROUND` A*, walking bomb).** FSM `APPROACH → FLASH`:
- **APPROACH**: full A* toward the player at `0.50×`.
- Within `armDist = 1.5 t` → **FLASH**: `flashDur 0.8 s` accelerating strobe,
  movement continues at `flashMul 0.5×`.
- **EXPLODE** (FLASH timer completes, fired in step 6 **only if it survived step 5**
  — E11): AoE radius `2 t`, **4 dmg** to the player, **damages all enemies in
  radius** (friendly-fire; those kills → `awardKill(_, "wraith-aoe")` = 0 score,
  E8), **triggers barrels in radius** (seam to SPEC-BARRELS, §7). **Does NOT damage
  crates** (§13.16 crate indestructibility wins). The Wraith dies in its own blast.
- **Killed before FLASH completes → no explosion** (proposed): the death sweep
  (step 5) removes an APPROACH/FLASH Wraith with no AoE — detonation is proximity-
  armed, so shooting it at range defuses it. Self-glows in dark levels
  (`glowRadius 1.5 t`, §8.4 — a light-emitter registration, seam to #7).

**6.1.9 The Reaper (`PHANTOM` A*, mini-boss summoner).** `e.boss = true` (E9),
HP 20, placed by level defs only. PHANTOM A* over the object grid (floats through
walls, blocked by crates/barrels, §4). Attacks:
- **Summon** every `G.ramp.reaperSummonInterval` (base 6 s → 3.5 s): pick one of
  `["ghost","ghost","skeleton"]` — "ghost" → spawn **2 Ghosts**, "skeleton" →
  spawn **1 Skeleton** (the 50/50 of GDD §6.1.9) at its position, tagged
  `originSpawner = <this reaper's id>` and capped at `minionCap = 6` live minions.
- **Dark blast** every **9 s** (fixed): straight `makeShot(owner:"enemy", dmg:3,
  speed 224, maxTravel <dial>, effect:"damage")` at the player. LOS-irrelevant
  (the Reaper ignores walls) but the **blast** collides with terrain/crates
  normally (rides `updateShots`: crate-ricochet + non-bounce wall-fizzle).
- Nova/Lightning **resist** via the exposed `resist`/`boss` flag (#5 applies 10/20
  and 5, §5.1/§5.2). Death → screen-shake + hit-stop (event to #7/#10, §7).

### 6.2 Melee exchange (E6)

Each frame, for every enemy overlapping the player (`dist ≤ e.r + player.r`):
- If **`isCarryingCrate()` and `e.type !== "bat"`** → push the enemy back **1.5 t**
  (set `kv` away from the player) and **skip** the damage exchange (crate bumper).
- Else if the pair is **not** locked (`!e.contact`): player deals **2** to `e.hp`;
  `applyDamageToPlayer(CFG.ENEMY[e.type].melee, e.type)`; knock **both** back
  (player `applyKnockbackToPlayer(dir, playerImpulse)`, enemy `kv` opposite, §6.6);
  set `e.contact = true` and mark the pair in `G.player.meleeState`.
- On separation (no overlap) → clear `e.contact` and the pair's `meleeState` entry.
Bats still deal melee 2 on contact (they just ignore the crate bumper). A dead
enemy from the player's melee-2 routes through the death sweep (step 5) as
`"player-melee"`.

### 6.3 Death sweep + `awardKill` seam (E8)

For each `e.hp ≤ 0`: drop `e.gems` gems into `G.pickups` (always), call
`awardKill(e, cause)`, emit `enemy:killed`{type, x, y, points, cause} (HUD floats +
callouts are #10, §9 GDD), and splice it out. If `e` is a Reaper, also emit the
death FX event (screen-shake/hit-stop, #7/#10). `awardKill(e, cause)` (this spec's
thin implementation): `player-*` causes → `G.score += e.points`; `wraith-aoe` /
`enemy-*` → 0. **SPEC-SCORING** replaces this with the full chain-of-custody
(barrel tags, shrapnel adoption) and #5's Nova/Lightning attribution — this spec
just hands it the `cause` string.

### 6.4 Enemy ordnance → player

- **Straight shots** (`owner:"enemy"` in `G.shots`): moved by `player.js`
  `updateShots` (step 7). This spec's enemy-shot→player test (step 7, after
  motion) — for each enemy shot overlapping the player: if `effect === "entangle"`
  → `applyEntangle(spider.web.entangle)` and remove the shot (0 dmg, no iframe);
  else `applyDamageToPlayer(s.dmg, "enemy-shot")` and remove. **Enemy shots never
  hit enemies** (§9 — they pass through; the test is player-only). They ricochet
  off crates and fizzle on walls via the shared loop.
- **Arced lobs** (`G.ebolts`): `updateEbolts(dt)` interpolates ground pos over
  `dur`, draws the parabolic height, and at `t ≥ dur` splats + checks
  `hypot(player − landing) ≤ blast + player.r` → `applyDamageToPlayer(2,
  "enemy-lob")` + barrel-trigger seam. Wall-agnostic (never collides in flight).
- **Nova erases enemy ordnance** it sweeps (arrows, lobs mid-arc, webs, dark
  blasts — GDD §5.1): #5 clears the matching `G.shots`/`G.ebolts` entries; this
  spec just keeps them in those two arrays so #5 can find them.

### 6.5 Player-shot → enemy damage pass (step 3)

For each `s` in `G.shots` with `s.owner === "player"`, test against every enemy
(circle vs circle, `s.r + e.r`): on hit, `e.hp -= s.dmg`, remove the shot unless
`s.bounce` policy says otherwise (a non-bounce shot is consumed on the first enemy
it hits; Bounce shots pass through? — **Q2, §11**: proposed *consume on enemy hit
regardless of Bounce* — Bounce is a *wall* ricochet power-up, not a pierce). Queue
`e` for the death sweep if `e.hp ≤ 0` with `cause = "player-bullet"`. Big shot's
`dmg 2` and hitbox `r×1.6` already ride on the shot fields (§6.1 SPEC-PLAYER).

### 6.6 Enemy knockback (shared machinery)

Enemy-side knockback reuses the player's velocity+friction model (SPEC-PLAYER P4 /
§13.12 — "the displacement machinery is shared"): set `e.kv = unit(dir)·impulse`,
decay by friction each frame, integrate through `moveBody` (so a knocked enemy
still can't tunnel a wall). Melee target ≈ 0.5 t, carried-crate push ≈ 1.5 t —
tuned impulse dials (`CFG.ENEMY.knockback*`, proposed, Q-tuning). Bats/flight take
knockback as a raw position nudge (no `moveBody`).

---

## 7. Seams to later systems (interfaces only — no behavior here)

- **#3 pickups (gem collection).** This spec **drops** `{type:"gem", x, y, value}`
  into `G.pickups`; #3 owns auto-collect/magnet and crediting `G.gemEnergy`
  (feeds #5's Nova bar). No collection logic here.
- **#5 abilities (Nova/Lightning).** Read `e.boss`/`e.resist` for the Reaper
  (10/20, 5); iterate `G.enemies` to destroy/damage; **erase enemy ordnance** in
  `G.shots`/`G.ebolts` (§6.4); call `awardKill(e, "nova"|"lightning")`. This spec
  guarantees the flag + the two ordnance arrays exist.
- **SPEC-BARRELS (post-#4).** The Wraith EXPLODE and the Lobber lob **trigger
  barrels in radius**; barrels don't exist yet, so this spec calls a registered
  `detonateBarrelsInRadius(x, y, r, cause)` seam (no-op default), mirroring the
  loader's sink pattern. Shrapnel→enemy damage + its chain-of-custody scoring are
  SPEC-BARRELS + SPEC-SCORING.
- **SPEC-SCORING.** `awardKill(e, cause)` is the seam; this spec ships the direct
  implementation, SPEC-SCORING replaces it with chain-of-custody attribution.
- **#7 render/lighting.** `enemy:killed` / reaper-death FX events (screen-shake,
  hit-stop, floats — §10.3); the Wraith `glowRadius` light-emitter registration
  (dark levels §8.4). No draw code here.
- **#10 HUD.** Callouts ("NOVA!" ≥5, "THUNDERSTRUCK!" ≥8, floating +N) consume
  `enemy:killed`; this spec only emits.
- **`level-loader.js` (owned edits).** (a) `ENTITY_ARRAY` += the 8 loose-enemy
  types → `"enemies"` (E5); (b) `clearTransient` += `G.ebolts = []` (E1). Both are
  small, additive, and inside the loader's already-shipped seams.
- **`player.js` (owned edit).** `export applyEntangle(seconds)` (E7).
- **`projectiles.js` (owned edits).** `makeShot` += `maxTravel`/`effect`;
  `updateShots` expiry reads `s.maxTravel ?? CFG.SHOT.range` (E1).

---

## 8. Known implementation risks (flag before building — do not discover mid-impl)

- **R1 — `consumeDirtyTiles()` is single-consumer (clears on read).** Only the nav
  scheduler (§3.5 step 2) may call it, exactly once per frame, gated on a
  `getNavVersion()` change. If any other system (a future renderer, a debug
  overlay) also drains it, dirtied tiles are lost and crate barricades stop
  re-routing intermittently. Make this an explicit ownership comment in
  `enemies.js`.
- **R2 — Wraith-defuse ordering (E11).** EXPLODE **must** fire in step 6, *after*
  the death sweep (step 5). If the AI tick moves before damage resolves, a Wraith
  shot down the same frame its FLASH completes will wrongly detonate. The
  `test-enemies` order test must assert "bullet lands on a FLASHing Wraith → no
  AoE."
- **R3 — Enemy-shot owner tag vs the player cap.** Every enemy straight shot **must**
  set `owner:"enemy"`; the player's on-screen cap already filters by owner, but a
  mistagged `"player"` enemy shot would both starve the player's cap **and** be
  hit-tested against enemies in step 3. Grep-guard: no `owner:"player"` outside
  `player.js spawnVolley`.
- **R4 — PHANTOM `moveBody` filter must match the PHANTOM mask.** The Reaper's
  path crosses walls; if its `moveBody` blocker filter includes walls (or omits the
  crate/barrel-only rule), it collides with a tile `findPath` told it to enter and
  wedges. Filter = crates+barrels only, **no** `bodyHitsWall` for the Reaper. (The
  four A* filters are not interchangeable.)
- **R5 — Emergence + live-cap race.** A spawner counts live children including ones
  still in their `spawn > 0` emergence window; otherwise it over-spawns in the
  first 0.5 s. Count tagged children regardless of `spawn` state.
- **R6 — Circular import (`enemies` ↔ `player`/`projectiles`).** `enemies.js` may
  import `player.js` **sinks** (`applyDamageToPlayer`/`applyKnockbackToPlayer`/
  `applyEntangle`/`isCarryingCrate`) and `projectiles.js` (`makeShot`), plus
  `config`/`state`/`world`/`nav`/`level-loader`(`emit`, `registerEntityFactory`).
  It must **never** be imported *by* those — the one-way flow is
  `enemies → {player-sinks, projectiles, nav}`, never back. Factory registration
  is a callback (loader→enemies via `registerEntityFactory`), not an import of
  `enemies` by the loader (STATUS §"never imports player/enemies"). Record this in
  STATUS.md at build time.
- **R7 — Dark-blast `maxTravel` is undialed.** GDD §6.1.9 gives the Reaper blast a
  speed (7 t/s) but no range; a straight shot with no range would cross the whole
  level. Pick a `blastRange` dial (proposed ~14 t, mirroring the Nova cap) — Q5.
- **R8 — Bat integrates without `moveBody`.** Because it ignores collision, a naive
  reuse of the shared mover would clamp it at walls. Bat movement is a distinct
  raw-integrate path; don't route it through the `moveBody` filter table.
- **R9 — `arriveDist` in pixels, not tiles.** ADD's `arriveDist:9` and `wpTimeout:5`
  are px/s already; do not re-multiply by `TILE`. (The waypoint `x,y` is a pixel
  tile-center, so distance is naturally in px.)

---

## 9. Headless smoke tests (`test-enemies.js` — pure logic, no canvas/render)

Pure-state assertions, `test-player.js`/`test-nav.js` style — set fields directly,
tick, assert; never import render/canvas. Drivers (input, RAF) stubbed.

- **Nav consumer:** a `GROUND` navigator on a straight corridor produces monotonic
  waypoint advance (`wpIndex` increments as `dist ≤ arriveDist`); `wpTimeout`
  advances a wedged navigator; `findPath → null` (goal boxed by crates) → direct-
  steer reduces player distance; `findPath → []` (same tile) → steers to pixel goal.
- **Round-robin budget:** with N > `repathBudgetPerFrame` eligible navigators, at
  most budget `findPath` calls fire per frame (spy/count), and the cursor advances
  so all are serviced within ⌈N/budget⌉ frames; unserviced navigators keep their
  prior path.
- **Dirty repath (E3):** dirtying a tile on a navigator's `pathTiles` (simulate a
  crate drop → `markDirty` → `getNavVersion` bump) forces exactly that navigator to
  repath next slot; a navigator whose path doesn't cross the dirtied tile does not.
- **Single-consumer (R1):** two calls to the scheduler in one frame drain
  `consumeDirtyTiles` once (second sees empty).
- **Melee exchange (E6):** contact deals 2 to enemy + `melee` to player once, sets
  the pair lockout, no re-exchange until separation; `isCarryingCrate()` true →
  enemy pushed 1.5 t, **no** damage either way; **bat** ignores the crate bumper
  (still deals 2).
- **Death (E8):** `hp ≤ 0` drops `gems` pickups always; `awardKill("player-bullet")`
  adds `points`; `awardKill("wraith-aoe")` adds 0 but **still** dropped gems.
- **Shooter FSM:** WANDER→HUNT on LOS acquire; stop-to-shoot windup 0.4 → fire → 1.5
  cooldown, stationary throughout; awareness decays to WANDER after 8 s no-LOS.
- **Lobber (ADD parity):** `canSee` → flee at 0.95× holding fire; `!canSee` within 9 t
  → lobs every 2.5 s; lob lands within `G.ramp.lobberErrorRadius` of the player;
  AoE at landing hits player at ≤ 1.25 t, ignores an intervening wall.
- **Bat:** SNAPSHOT records player pos; FLY reaches the *recorded* point even if the
  player moved; PAUSE duration in `[batPauseMin, batPauseMax]`; passes through a
  wall tile mid-FLY.
- **Spider:** BURST 1.5× 0.5 s / PAUSE 0.6 s cadence; blocked → RETREAT 1.5 s away;
  web hit → `p.entangle == 2.5` via `applyEntangle`; web deals 0 dmg (no iframe
  trip).
- **Wraith defuse (R2/E11):** kill during FLASH → no AoE, no barrel-seam call;
  survive FLASH → EXPLODE deals 4 to player, damages enemies in radius (0 score),
  calls the barrel seam, leaves crates intact, kills itself.
- **Reaper:** PHANTOM path crosses a wall but not a crate; summon picks 2 ghosts or
  1 skeleton, caps at 6 live tagged minions; dark blast every 9 s rides
  `updateShots` (fizzles on a wall); `e.boss` true; Nova seam sees the resist flag.
- **Spawner (E4):** first emit at 2 s, then every `interval`; ≤ `liveCap` live tagged
  children (counting emergence-window ones, R5); 0.5 s emergence gate blocks
  action; weighted pick only from Plan-filtered `table`.
- **Config sanity:** `CFG.ENEMY` has all 9 types + spawner; every `speedMul` present;
  no `Infinity` (sentinel discipline); element keys == `CFG.PLAN` keys (E5 guard).

---

## 10. Open design questions

- **Q1 (nav shape) — RESOLVED (baselined):** Shape-1 — scheduler/round-robin/
  steering/direct-steer live in #4; `nav.js` stays pure. Carried here per the
  locked scope; final owner glance on `repathBudgetPerFrame`/`arriveDist`/
  `wpTimeout` values (proposed) is Q5-style tuning, not a blocker.
- **Q2 — Bounce power-up vs enemies:** does a Bounce player-shot **pierce** an enemy
  (continue after the hit) or consume on first enemy contact? Proposed **consume on
  enemy hit** (Bounce is a *wall* ricochet, not a pierce). Non-blocking; affects
  §6.5 only.
- **Q3 — Do friendly-fire (Wraith-AoE) kills drop gems?** Proposed **yes** (gems
  are position-loot, not a score award; E8). If **no**, the death sweep must gate
  the gem drop on `cause` too. Non-blocking; a one-line branch either way.
- **Q4 — Skeleton/Spider "blocked" detection threshold (ε):** the ≈-zero-net-
  progress test that triggers wall-slide (Skeleton) / retreat (Spider) needs a
  tuned ε (proposed: moved < 10% of intended step). Q5-tuning.
- **Q5 — Points / gems / `errorRadius` limits / `repathBudget` / dark-blast range
  (R7):** all the `(proposed)` `CFG.ENEMY` dials, deferred to the §14.2 tuning
  sign-off (same posture as SPEC-LEVEL/PLAYER). Not build blockers.
- **Q6 — Awareness decay (Shooter 8 s) & the WANDER roam pattern:** proposed
  values; the roam waypoint policy (random reachable vs a small patrol) is
  unspecified in GDD — proposed random-reachable. Non-blocking.

*(GDD §14 boss/Corruptor/Spirit block remains out of scope — tabled in v1.1, not
reopened here.)*

---

## 11. ADD source provenance (what was verified, where, disposition)

| GDD / spec claim | ADD source checked (`add2026`) | Finding / disposition |
| :-- | :-- | :-- |
| Lobber ≈ ADD Sorter two-branch state machine (§6.1.4, §13.14) | `src/enemies-ai.js` `updateSorter` | **VERIFIED — ADAPTED.** `canSee`→flee-with-jitter+hold-fire; `!canSee`→advance + lob-within-range-on-cd; throttled LOS (`losCheck`/`losCheckEvery`). Reused verbatim; **net-new:** the accuracy `errorRadius` perturbation (ADD `fireEnemyArc` targets exact pos) |
| Lob = arced, wall-ignoring, timer-resolved w/ ground-shadow telegraph (§6.1.4, §13.13) | `src/projectiles.js` `fireEnemyArc`/`updateArc`; `fireEnemyDrop` shadow | **VERIFIED — REUSED.** Ground pos interpolates launch→landing over `dur`, parabolic draw height, AoE checked at `k≥1` vs `blast + dan.r`; fixed landing IS the telegraph. Adopt as `G.ebolts`/`updateArc` |
| Waypoint arrival = `arriveDist` OR stuck-`wpTimeout` (§3.3, §6.4) | `src/enemies-ai.js` `updateCleaner`; `config.js` `arriveDist:9`,`wpTimeout:5`,`losCheckEvery` | **VERIFIED — REUSED.** `dist ≤ arriveDist || wpTimer ≤ 0` → advance + reset `wpTimer`. Values adopted as px/s dials (R9) |
| `moveBody` per-axis slide, LOS sampling | `add2026 src/enemies.js`/`world.js` `moveBody`(2-arg), `hasLineOfSight` | **REUSED pattern; SIGNATURE DIVERGES.** Repossessed `world.js moveBody` is 4-arg (`+blockerFilter`, extended in SPEC-PLAYER); enemies pass a class-appropriate filter (§4). `hasLineOfSight(x0,y0,x1,y1)` matches |
| Emergence grow-in before an enemy acts (§6.3, §6.1) | `src/enemies.js` `e.spawn:0.4`; `updateEnemies` `if (e.spawn>0){…continue;}` | **REUSED.** Repossessed uses **0.5 s** (`emerge`) as the spawner emergence telegraph gate |
| Spawner = typed Dispatch-Terminal generator (§6.3) | `src/enemies.js` `spawnEnemy(type,pos)` factory + per-type init; ADD Dispatch pattern | **ADAPTED.** Typed variants via `CFG.SPAWNER` (weighted table + skin + interval/cap), Plan-filtered on the placeholder; live-cap via origin tag (E4) rather than ADD's global spawn logic |
| Enemy straight projectiles share one owner-tagged shape | `add2026` separates `G.ebolts` (enemy) from player shots | **DIVERGES (adopted from Repossessed code intent).** Repossessed folds **straight** enemy shots into `G.shots`/`makeShot` (`owner:"enemy"`, owner-scoped cap already in `player.js`); only **arced** ordnance keeps ADD's separate-array model (`G.ebolts`) |
| Speeds/ranges as tile→px | `add2026 config.js` enemy speeds | **OVERRIDDEN by GDD tile values × 32** (E10/P7); ADD constants are a pattern reference, not a value source |

---

*End SPEC-ENEMIES — pairs with `GDD-ENEMIES.md` (= GDD §6) and GDD §9 / §5.1–5.2 /
§2.5 / §8.6. Builds `enemies.js` on the pure `nav.js` service (SPEC-PATHFINDING).
Owned edits to shipped files: `level-loader.js` (`ENTITY_ARRAY` +8 types,
`clearTransient` +`G.ebolts`), `player.js` (`applyEntangle` sink), `projectiles.js`
(`Shot.maxTravel`/`effect`). Leaves seams to #3 (gem collection), #5 (abilities +
ordnance-erase + resist flag), SPEC-BARRELS (detonation), SPEC-SCORING (`awardKill`
chain-of-custody), #7/#10 (FX/HUD). §14 boss/Corruptor/Spirit out of scope. Next
step (separate session, after human review): generate phased Claude Code prompts
from this spec.*