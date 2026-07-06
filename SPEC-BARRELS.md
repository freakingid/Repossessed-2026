# SPEC-BARRELS — Barrels, the Kick, Detonation, Shrapnel & the Chain-of-Custody Tag (`barrels.js`)

**Implementation-detail layer for GDD §7.2 (barrels) + §7.2.4 (shrapnel), reading
§7.1 (crates, the carry system barrels reuse), §5.1–5.2 (Nova/Lightning barrel
clauses), §8.4 (dark-level light from barrel fire), §9 (attribution), §2.1 (i-frames),
§13.8 (Dustbin kick-physics lineage), §13.16 (crate indestructibility).** Design
intent lives in GDD §7.2; build reality in `STATUS.md`. This is the post-#5 spec
STATUS names as owed: it closes the two dangling `registerBarrelDetonation` seams
(`enemies.js` + `abilities.js`) and builds the whole chaos-currency subsystem.

**Scope boundary (pinned):** barrels are the game's damageable/explosive movable.
This spec owns the barrel entity + HP/fire-state ladder, the carry/kick reuse of the
existing crate carry FSM, roll physics, rolling impacts, the carried-barrel-as-live-
target rule, detonation → shrapnel, the shrapnel projectile *species*, chain
reactions, the attribution *tag*, and the two detonation-seam fills. It exposes fire
intensity + light radii as *data* (and registers the `G.lights` emitter) but does not
render; it *emits* the FX events but does not draw them; it *tags* kill ownership but
leaves scoring resolution to SPEC-SCORING.

**Out of scope (do not spec here):** the actual lighting overlay + fire/barrel
sprites (#7 — barrels expose `fireState` + light radius and register the emitter;
#7 draws); screen-shake / hit-stop / scorch-decal / "CHAIN REACTION!" callout
*rendering* (#10 — barrels emit `barrel:exploded` / `chain:reaction`); the §9 scoring
*resolution* (SPEC-SCORING — barrels tag `owner`/`_cause`; the current
`awardKill` `startsWith("player-")` rule scores the tags correctly in the interim);
HUD; the boot `import "./barrels.js"` + wiring the update passes into the main loop
(integration phase, exactly as owed for `abilities.js`); the §14 boss block (tabled).

---

## 1. Resolved decisions (forks the GDD/architecture leave that code cannot skip)

Barrels are the most cross-cutting subsystem yet — they touch the carry FSM, the
projectile layer, the enemy combat spine, nav, lighting, FX, and scoring. **Cross-file
edits this subsystem makes (the sign-off-first list):**

- **`player.js`** — carry FSM admits barrels (B6): pickup, kick/place release, no
  vault/wall-vault/pushback; plus a `carriedBarrel()` accessor and detonate-on-player
  (B5).
- **`enemies.js`** — `meleeExchange` also deals 1 HP to a carried barrel on enemy
  contact (B5); the two `detonateBarrelsInRadius` call sites gain a `damage` argument
  (B10); export `sweepDeadSpawners` alongside the existing `sweepDeadEnemies` so
  shrapnel can kill spawners (B9).
- **`abilities.js`** — **no edit**: Lightning's existing 4-arg call rides the seam's
  defaulted lethal `damage` (B10). Only the seam *fill* runs (via `registerBarrelDetonation`).
- **`config.js`** — new `CFG.BARREL` block (§2.3).
- **`nav.js` / `world.js`** — **no edit**: the crate splice-out pattern (B5) keeps a
  carried barrel out of the blocker/occupancy arrays, so neither needs a carried-skip.

**Summary of rulings:** B1 → a new `barrels.js` owns the subsystem end-to-end. B2 →
the barrel entity decorates the loader placeholder via `getEntityFactory("barrel")`
(the #4 spawner pattern). B3 → the kick reuses ADD `slideStep` (exponential friction +
per-axis wall bounce), **not** the "4 t/s² linear" phrasing — a bespoke integrator
(documented `moveBody` exception). B4 → shot→barrel is CONSUME via a self-contained
`shotsVsBarrels()` pass, tested after enemies. B5 → a carried barrel stays in
`p.carry.entity` (spliced out, crate pattern) + a `carriedBarrel()` accessor; it is a
live target and detonates in-hand. B6 → barrel carry/release diverges from crates
(kick/place, no vault). B7 → shrapnel is its own species in `G.shrapnel`, not the
`Shot` shape. B8 → detonation is shrapnel-only (no direct damage), not a port of ADD
`detonate()`. B9 → attribution: barrels tag `_cause`/`owner`; shrapnel carries it;
chains propagate; kills route through the shared sweeps. B10 → fill the seam into
**both** consumers with an added `damage` arg (default lethal).

---

**B1 — A new module `barrels.js` owns the barrel subsystem end-to-end.** Entity
decoration, the HP/fire-state ladder, kick-roll physics, rolling impacts, detonation,
the shrapnel species, chain reactions, and barrel damage-intake all live here — one
cohesive concern (file-split discipline). Imports (all one-way; nothing imports
`barrels.js`): `config`; `state`; `world` (`bodyHitsBlocker`, `isWall`, `tileCenter`);
`level-loader` (`emit`, `markNavDirty`, `registerEntityFactory`, `getEntityFactory`);
`player` (`applyDamageToPlayer`, `applyKnockbackToPlayer`, and the new `carriedBarrel`
accessor); `enemies` (`sweepDeadEnemies`, the new `sweepDeadSpawners`, and both
modules' `registerBarrelDetonation`). `barrels.js` registers the real detonation fn
INTO `enemies.js` and `abilities.js` at load (B10); it must be imported at boot so
that registration + the barrel factory decoration run before frame 1 (same boot debt
as `abilities.js`). Update the CLAUDE.md code map (add `barrels.js`; move shrapnel
here — B7).

**B2 — The barrel entity decorates the loader's placeholder via
`getEntityFactory("barrel")`.** The loader already registers
`registerEntityFactory("barrel", mkPlaceholder(true))` → `{ type, x, y, tc,
blocks:true }` routed to `G.barrels`. `barrels.js` reads that back and wraps it (the
exact pattern #4 used to decorate the spawner), adding the combat/fire/roll fields
(§2.2). No splice-replace — call through the placeholder, then augment. A placed
barrel is therefore a live blocking entity from load; this spec makes it damageable
and mobile.

**B3 — Kick physics: reuse ADD `slideStep` (exponential friction + per-axis wall
bounce + corner reflect), NOT "4 t/s² linear."** GDD §7.2.2 is internally
contradictory — it says the kick "decelerat[es] at 4 tiles/s² (linear damping)" **and**
that it reuses "the ADD Dustbin's shipped slide/friction/bounce physics … wholesale
(§13.8)." Verified against real `add2026/src/dustbin.js`: the reused model is
`v *= Math.exp(-friction·dt)` (exponential) with per-axis wall reflection
(`v = -v·bounce`) and a corner "reflect-both, hold position" case. **Ruling: reuse the
exponential model** (honours §13.8 "wholesale" and the bounce-shot lineage already in
`projectiles.js`); the "4 t/s²/linear" wording is **superseded** — treat it as the
intended *feel*, used only to pick the friction constant. Barrel-specific dials retune
ADD's constants: initial speed **7 t/s** (=224 px/s), wall-bounce retention **0.6**
(GDD's 60%), `friction` a proposed constant, `stopSpeed` a small settle threshold.
The rolling barrel is a **bespoke integrator** — a deliberate, documented exception to
"`moveBody` is the one mover" (precedent: the Reaper's `phantomMover`), because
`moveBody` slides-and-stops, it does not *reflect* velocity.
- **Roll blocker set:** a rolling barrel **bounces** off walls + crates + spawners +
  other barrels (immobile/solid). Enemies are **not** bounce-blockers — a barrel
  rolling ≥ **3 t/s** applies a rolling impact (1 contact dmg to the enemy; the barrel
  loses **1 HP** and **40% speed** per enemy hit) and continues through. Below 3 t/s it
  is inert cover.
- **Rolling barrel vs. static barrel = bounce, no damage** (GDD lists barrel *blasts*
  and *rolling-enemy* impacts as damage sources, not roll-on-barrel contact); barrels
  chain only via shrapnel/blasts, not roll taps. **Confirmed (owner sign-off).**
- **The player takes no rolling damage** (they kicked it away; §7.2.2 names only
  enemies as rolling-impact victims).

**B4 — Shot → barrel is CONSUME (damage-exchange), not ricochet, via a self-contained
`shotsVsBarrels()` pass in `barrels.js`.** `projectiles.js` `updateShots` only
crate-ricochets (it consults `G.crates` only, and its header already states barrels
do not ricochet) — leave it untouched. Instead `barrels.js` runs its own pass over
`G.shots` (both owners): a shot overlapping a barrel is **removed** (no bounce —
projectiles never bounce off barrels, §7.2.1) and deals its `dmg` to the barrel via
`damageBarrel` (§3), tagging `_cause` from the shot's `owner` (`"player-bullet"` /
`"enemy-<kind>"`). Precedent: the ebolt pass is likewise self-contained (E1).
- **Precedence:** run `shotsVsBarrels()` **after** the enemy/player-shot damage passes
  — a bullet that already struck an enemy is gone; survivors then test barrels. This
  is a per-frame-overlap approximation (no swept ray, matching the existing shot
  passes); *flag if you want barrels to win contested overlaps instead.*

**B5 — A carried barrel is a live target: spliced into `p.carry.entity` (crate
pattern) + a `carriedBarrel()` accessor.** On pickup the barrel is spliced from
`G.barrels` (exactly like a crate leaves `G.crates`) so it stops blocking/occupying —
**no `nav.js`/`world.js` edits** (this is why splice-out beats a keep-in-array flag).
Its effective hit position is the player centre. `player.js` exposes
`carriedBarrel()` (returns `p.carry?.type === "barrel" ? p.carry.entity : null`);
`barrels.js`'s `shotsVsBarrels`/shrapnel passes and `enemies.js`'s `meleeExchange`
test it in addition to `G.barrels`:
- enemy **projectile** → strikes the carried barrel, not the player (consume + damage);
- enemy **melee contact** → normal damage to the player **and** 1 HP to the barrel
  (a small `meleeExchange` addition, guarded by `carriedBarrel()`);
- **bounced** shot of any origin (including the player's own off a crate) → damages it.
At **0 HP it detonates in-hand**: shrapnel burst centred on the player (post-hit
i-frames cap self-damage, §2.1), `p.carry` cleared, `loco` → NORMAL, owner from the
killing blow (§9). Intentional risk, not an edge case to prevent.

**B6 — Barrel carry/release diverges from crates in `player.js`.** Reuse the CARRYING
state (auto pickup on contact hands-free, move ×0.85, cannot fire) but branch on
`carry.type`:
- **Pickup:** `tryPickup` also picks up a barrel (a `firstOverlappingBarrel`
  companion to the crate check); `carry = { type:"barrel", entity }`.
- **Moving release = the KICK:** drop → roll (B3), **no vault**.
- **Stationary release = place upright** (static, solid), settled on the first free
  tile like a crate toss but it never rolls after settling.
- **No wall-vault, no carried-pushback** — `carryActions` skips `tryWallVault` when
  `carry.type === "barrel"`; the §7.1.4 crate bumper does not apply. (These are
  crate-exclusive utilities; barrels are the volatile sibling.)

**B7 — Shrapnel is its own species in `G.shrapnel`, not the `Shot` shape.** `G.shrapnel`
is already reserved (the loader clears it). Shrapnel carries **health (2)**, exchanges
damage with **enemies / player / barrels / spawners**, **bounces free** off walls +
crates (no health cost), and **pushes crates** 0.5 t — a contract the plain
owner-tagged `Shot` does not model. Own update pass `updateShrapnel(dt)`. This
**diverges** from the `projectiles.js` header note ("shrapnel join later behind the
same … Shot shape") and the code-map's tentative placement of shrapnel in
`projectiles.js` — precedent for the divergence is `G.ebolts` (E1: a distinct kind
gets its own array). Shrapnel lives in `barrels.js` (cohesive with detonation);
update the code map.

**B8 — Detonation is shrapnel-only (no direct damage/force); NOT a port of ADD
`detonate()`.** Verified: ADD's `detonate()` is an instant AoE that HP-damages robots
directly — the structural *opposite* of the Repossessed barrel, whose explosion
"deals no direct damage and applies no direct force" and delivers everything through
shrapnel (§7.2.3). Barrel death (hp ≤ 0) routes: derive `owner` from `_cause` →
spawn the shrapnel burst (owner-tagged) → `emit("barrel:exploded", …)` (hit-stop 4 f,
shake 0.25 s prox-scaled, scorch) → `markNavDirty` (a destroyed barrel was a blocker;
occupancy rebuilds lazily off `G.barrels`, so the signal alone suffices — the spawner
precedent) → drop the light emitter → splice from `G.barrels`. No ADD analog to
verify for shrapnel — it is NEW (§12).

**B9 — Attribution: barrels tag, shrapnel carries, chains propagate; kills route
through the shared sweeps.** Per §9's chain-of-custody: a barrel stores `_cause` (its
last damager's cause string) and, on detonation, derives `owner = _cause.startsWith
("player-") ? "player" : "enemy"`. Each shrapnel piece carries `owner`. A shrapnel
kill tags the victim `_cause = owner === "player" ? "player-shrapnel" : "enemy-
shrapnel"`; enemy victims route through `sweepDeadEnemies()`, spawner victims through
the newly-exported `sweepDeadSpawners()` — both already drop gems + call `awardKill`
(which scores `player-*` and zeroes the rest). A barrel damaged by shrapnel **adopts**
that shrapnel's owner into its own `_cause`, so a player-started cascade scores every
kill and an enemy-started one scores none — the single bookkeeping the scoring system
hangs on. SPEC-SCORING later replaces `awardKill` and inherits these exact tags.

**B10 — Fill `registerBarrelDetonation` into BOTH `enemies.js` and `abilities.js`,
adding a `damage` argument (default lethal).** The real fn:
`detonateBarrelsInRadius(x, y, radius, cause, damage = LETHAL)` — all in **pixels**
(verified: Wraith, Lobber, and Lightning callers already pass pixel centre + pixel
radius). It applies `damage` to every barrel whose body is within `radius`, tagging
`_cause`. The two `enemies.js` call sites gain their AoE magnitude so the fire ladder
is respected: **Wraith** passes `explodeDmg` (4 → detonates a 4-HP barrel);
**Lobber** passes its lob damage (2 → 4-HP barrel drops to Burning, survives).
**Lightning** keeps its existing 4-arg call and rides the **lethal default**
(§5.2 "lethal damage and detonate") — so **`abilities.js` needs no edit**. `LETHAL`
is a large finite constant (sentinel-over-`Infinity` rule), e.g. `1e9`.

---

*(proposed) GDD dials, adopted-and-flagged (ride the §14.2 tuning sign-off, not
blockers):* barrel HP 4; kick `friction` constant + `stopSpeed`; rolling-impact
threshold 3 t/s / 1 dmg / −1 HP / −40% speed; shrapnel count 8 / ±12° jitter / dmg 1 /
health 2 / speed 8 t/s / lifespan 1.2 s; crate-push 0.5 t; chain callout ≥3; explosion
hit-stop 4 f, shake 0.25 s, scorch fade 8 s; fire-ladder light radii 2.0 / 3.0 / 4.5
/ 8 t. All in `CFG.BARREL` (§2.3).

---

## 2. Data shapes

### 2.1 `G` arrays
| Field | Kind | Owner | Notes |
| :-- | :-- | :-- | :-- |
| `G.barrels` | transient | loader (exists) | Placed + decorated barrels; carried one is spliced out (B5). |
| `G.shrapnel` | transient | loader (exists) | Shrapnel pieces; lazy-init `G.shrapnel ||= []` in `barrels.js`. |
| `G.lights` | transient | loader (exists) | `barrels.js` pushes a `{ source: barrel }` emitter (§3.3); #7 reads. |

No new array is introduced — both barrel arrays are already cleared on load.

### 2.2 Barrel entity (placeholder + `barrels.js` decoration)
```
{ type:"barrel", x, y, tc, blocks:true,   // from mkPlaceholder(true)
  hp,            // starts CFG.BARREL.hp (4); the fire-ladder driver
  r,             // body radius (CFG.BARREL.r)
  vx, vy,        // roll velocity (px/s); 0 when static
  rolling,       // bool — true while kicked & above stopSpeed (drives the roll integrator + rolling-impact)
  _cause,        // last-damager cause string (attribution; null until first hit)
}
// fireState is DERIVED from hp on read (§3.2), not stored — single source of truth.
```

### 2.3 `CFG.BARREL` (new; tiles ×`CFG.TILE`=32 at read)
```
BARREL: {
  hp: 4,                    // (proposed) HP ladder depth (§7.2.1)
  r: 14,                    // body radius (proposed; between crate footprint and spawner 16)
  kick: {                   // §7.2.2 — ADD slideStep model, barrel dials (B3)
    speed: 224,             // 7 t/s initial roll (px/s)
    friction: 2.0,          // (proposed) exponential decay rate; supersedes "4 t/s² linear"
    bounce: 0.6,            // wall/solid bounce retention (GDD 60%)
    stopSpeed: 30,          // settle threshold (px/s) → rolling=false, static
    impactSpeed: 96,        // 3 t/s — min roll speed to damage an enemy (px/s)
    impactDmg: 1,           // contact dmg to the enemy
    impactSelfHp: 1,        // HP the barrel loses per enemy hit
    impactSlow: 0.40,       // fraction of speed lost per enemy hit
  },
  shrapnel: {               // §7.2.4 (all proposed counts/dials)
    count: 8, jitter: 0.2094,   // ±12° in rad
    dmg: 1, health: 2, speed: 256 /* 8 t/s */, lifespan: 1.2,
    cratePush: 16,          // 0.5 t pushback impulse applied to a crate on hit (px)
  },
  explosion: {              // §7.2.3 — FX payload (rendered by #10)
    hitStopFrames: 4, shakeDur: 0.25, shakeFullTiles: 3, shakeZeroTiles: 12,
    scorchFade: 8, chainCallout: 3,
  },
  light: { smolder: 2.0, burning: 3.0, raging: 4.5, flash: 8.0 },  // tiles; #7 reads (§8.4)
  LETHAL: 1e9,              // seam "detonate outright" damage (B10; finite, not Infinity)
}
```

### 2.4 Shrapnel entry (`G.shrapnel[i]`)
```
{ x, y, vx, vy, r, dmg, health, life, owner }
// owner: "player" | "enemy" (inherited from the detonating barrel; drives §9 scoring)
// bounces free off walls+crates (no health cost); loses 1 health per DAMAGING hit;
// dies at health ≤ 0 or life ≥ lifespan.
```

### 2.5 Fire-state ladder (derived; §7.2.1)
| hp | fireState | light (tiles) |
| :-- | :-- | :-- |
| 4 | `intact` | — |
| 3 | `smolder` | 2.0 |
| 2 | `burning` | 3.0 |
| 1 | `raging` | 4.5 |
| 0 | `explode` | 8.0 flash (transient FX, not a persistent emitter) |

---

## 3. Barrel entity, damage intake & the fire ladder

### 3.1 `damageBarrel(barrel, amount, cause)` — the single intake sink
Subtract `amount` from `hp`, set `_cause = cause` (last damager wins — the tag the
chain-of-custody rides). If `hp ≤ 0`, mark for detonation (§5). Every damage source
funnels through here: `shotsVsBarrels` (B4), the detonation seam (B10), shrapnel
(§5.2), rolling impacts (B3), and the carried-barrel melee hook (B5). The fire-state
transition is implicit (fireState is derived, §3.2) — the only side effect is the
light radius changing, which #7 reads live.

### 3.2 `fireStateOf(barrel)` / light
`fireState` is a pure function of `hp` (§2.5) — never stored, so it can never
desync. The light radius is `CFG.BARREL.light[fireState]` (or none for `intact`).

### 3.3 Light emitter (seam to #7, §8.4)
On decoration, push `{ source: barrel }` into `G.lights` (the Fire-Wraith glow
precedent — a live entity reference, so #7 reads the current position each frame).
Unlike the Wraith's fixed radius, #7 computes the radius from `source.hp` →
`CFG.BARREL.light[fireStateOf(source)]`, so a barrel brightens as it burns with no
per-frame re-sync here. The emitter is dropped on detonation (mirrors `removeLight`).

---

## 4. Carry, kick & roll (player.js integration + barrels.js physics)

### 4.1 Carry (player.js, B6)
Barrels enter the existing CARRYING FSM. `tryPickup` gains a barrel branch (splice
from `G.barrels`, `markNavDirty` its tile, `carry = {type:"barrel", entity}`); a
carrying player's `carryActions` **skips `tryWallVault`** for barrels. `releaseCarry`
branches on `carry.type`: barrel + moving → `kickBarrel` (§4.2); barrel + stationary
→ place upright static (crate-toss settle, no vault). `carriedBarrel()` accessor added.

### 4.2 Kick + roll (barrels.js, B3)
`kickBarrel` re-inserts the barrel into `G.barrels` at the drop tile with
`vx,vy = aim · CFG.BARREL.kick.speed`, `rolling=true`. `updateBarrels(dt)` integrates
every `rolling` barrel with the ADD `slideStep` model: per-axis step; on a
`bodyHitsBlocker`(walls via `isWall` + crates/spawners/other-barrels) reflect
`v = -v·bounce`; corner reflect-both/hold; then `v *= exp(-friction·dt)`. When
`hypot(vx,vy) < stopSpeed` → `rolling=false`, `vx=vy=0`, settle tile-aligned,
`markNavDirty` (it is a blocker again). Rolling impact: while `rolling` and speed ≥
`impactSpeed`, an overlapped enemy takes `impactDmg` (→ `sweepDeadEnemies` after),
the barrel loses `impactSelfHp` via `damageBarrel(…, "player-kick")` and speed ×
`(1-impactSlow)`.

*Owner note:* a kicked barrel that later detonates from kick-impact self-damage is
tagged `"player-kick"` → player-attributed (the player kicked it). A kick is a
player-attributed cause per §9.

---

## 5. Detonation & shrapnel

### 5.1 Detonation sequence (barrels.js, B8) — when `damageBarrel` drives hp ≤ 0
1. `owner = _cause.startsWith("player-") ? "player" : "enemy"`.
2. Spawn `CFG.BARREL.shrapnel.count` pieces, radial + `±jitter`, each `{dmg, health,
   speed, life:0, owner}` into `G.shrapnel`.
3. `emit("barrel:exploded", { x, y, owner, hitStopFrames, shakeDur, shakeFullTiles,
   shakeZeroTiles })` — #10 renders hit-stop/shake/scorch (a snapshot payload; no
   reach-back).
4. `markNavDirty(tile)`; drop the light emitter; splice from `G.barrels`.
*No direct damage or force* — everything is delivered by the shrapnel (§7.2.3).

Detonations are collected and resolved after the driving pass (not mid-iteration),
then one `sweepDeadEnemies()` / `sweepDeadSpawners()` runs — the Wraith-EXPLODE
precedent (set-hp-then-sweep-once).

### 5.2 Shrapnel (barrels.js, B7) — `updateShrapnel(dt)`
Per piece: integrate; `life += dt`. **Bounce free** off walls + crates (per-axis
reflect, no health cost). **Damage-exchange** (loses 1 health per damaging hit) with:
enemies (`hp -= dmg`, tag `player-shrapnel`/`enemy-shrapnel`), the player
(`applyDamageToPlayer(dmg, owner+"-shrapnel")` — i-frames cap point-blank at ~2 hits,
§2.1), other barrels (`damageBarrel(b, dmg, owner+"-shrapnel")` → **chain**, the barrel
adopts `owner`), and spawners (`hp -= dmg`, tag). **Push crates:** a crate hit gets a
`cratePush` impulse (the only non-carry way a crate moves; crates take **no damage** —
§13.16 indestructibility). Destroy the piece at `health ≤ 0` or `life ≥ lifespan`.
After the pass: `sweepDeadEnemies()` + `sweepDeadSpawners()` once.

### 5.3 Chain reactions (§7.2.3/§7.2.4)
Chains are emergent — shrapnel from barrel A damages barrel B via `damageBarrel`; B
detonates next resolution and adopts A's `owner`, spawning owner-tagged shrapnel that
can reach barrel C. Track a per-cascade kill/​barrel count; when a linked cascade
detonates ≥ `chainCallout` (3) barrels, `emit("chain:reaction", { count, owner })`
for the #10 callout + #12.4 achievement. *(The cascade-grouping is a bookkeeping
detail, not a design fork — a simple "barrels detonated within this resolution wave"
counter suffices.)*

---

## 6. The detonation seam (B10) — both consumers

`barrels.js` defines `detonateBarrelsInRadius(x, y, radius, cause, damage = LETHAL)`
(pixels) and registers it into **both** `enemies.js` and `abilities.js` at load
(import each module's `registerBarrelDetonation`). It calls `damageBarrel(b, damage,
cause)` for every barrel with `dist(b, (x,y)) ≤ radius + b.r`. Callers today:

| Caller | Coords | radius | cause | damage |
| :-- | :-- | :-- | :-- | :-- |
| Fire-Wraith EXPLODE | `wraith.x,y` | `explodeRadius·TILE` | `"wraith-aoe"` | `explodeDmg` (4) — **new arg** |
| Lobber lob splat | `b.tx,b.ty` (px) | `b.blast` (px) | `"enemy-lob"` | lob dmg (2) — **new arg** |
| Lightning | `player.x,y` | `radiusTiles·TILE` | `"player-lightning"` | default `LETHAL` — **no edit** |

Nova never calls the seam (GDD §5.1, closed) — a deliberate contrast with Lightning.

---

## 7. Attribution (§9) — barrels tag; SPEC-SCORING resolves

Barrels do the *tagging* only (B9): `_cause` on every hit, `owner` derived on
detonation, shrapnel carries `owner`, chained barrels adopt it. Kills route through
the shared `sweepDeadEnemies`/`sweepDeadSpawners`, whose `awardKill` scores
`player-*` causes and zeroes the rest — so a one-bullet cellar scores the whole
firework show and a Lobber-lit one scores nothing, today, with no scoring code of our
own. SPEC-SCORING replaces `awardKill` and inherits these tags unchanged. Cause
vocabulary this spec introduces: `player-bullet` (already used), `player-kick`,
`player-shrapnel`, `enemy-shrapnel` (+ the existing `wraith-aoe` / `enemy-lob` /
`player-lightning` flowing through the seam).

---

## 8. Seams to later systems (interfaces only)

| Seam | Direction | Filled by | Until then |
| :-- | :-- | :-- | :-- |
| `registerBarrelDetonation(fn)` ×2 | barrels → enemies + abilities | **barrels.js fills both** at load | no-op (Lightning/Wraith/lob barrel clauses inert) |
| `sweepDeadSpawners()` | enemies → barrels | **enemies.js (B9 export, alias)** | n/a (new export) |
| `carriedBarrel()` | player → barrels/enemies | **player.js (B5)** | n/a (new) |
| `emit("barrel:exploded" / "chain:reaction")` | barrels → #7/#10/#12.4 | FX + achievements consume | events fire; no renderer yet |
| `G.lights` `{source:barrel}` | barrels → #7 | #7 renders dark-level light | data present, unrendered |
| `updateBarrels` / `updateShrapnel` / `shotsVsBarrels` | barrels → main loop | integration phase wires them | tests call directly |
| boot `import "./barrels.js"` | barrels → boot | integration phase | tests import directly |

**Recommended tick slot (for the integration phase):** `shotsVsBarrels` after the
enemy/player shot damage passes (B4); `updateBarrels` (roll + detonation resolve) and
`updateShrapnel` in the ordnance region alongside `updateEbolts`; each self-contained
(its own sweep), so order-tolerant like the ebolt pass.

---

## 9. Known implementation risks (flag before building)

- **Cross-file edits (§1 list).** `player.js` carry branches, `enemies.js`
  meleeExchange hook + 2 seam call-site args + `sweepDeadSpawners` export, `config.js`
  block. All surgical; re-read each region, change nothing else. `abilities.js`,
  `nav.js`, `world.js` are **untouched** — if a phase reaches for them, stop.
- **The one mover exception.** The roll integrator is bespoke (reflects velocity);
  document it in STATUS as the second sanctioned `moveBody` exception after
  `phantomMover`. Do not route the roll through `moveBody` (it slides, never bounces).
- **Carried-barrel splice-out symmetry.** Pickup splices from `G.barrels` (like a
  crate) AND on any release path it must be re-inserted (kick re-inserts moving;
  place re-inserts static; detonate-in-hand never re-inserts). A splice with no
  matching re-insert leaks the barrel out of the world.
- **Detonation ordering.** Collect hp ≤ 0 barrels and resolve detonations AFTER the
  driving pass, then sweep once — never splice/detonate mid-iteration (the shrapnel
  a detonation spawns must not be walked by the same `updateShrapnel` loop that
  triggered it, or a cascade resolves in one frame instead of over time).
- **Chain owner propagation.** A barrel adopts the shrapnel's `owner` into `_cause`
  via `damageBarrel` — verify the adopted cause still satisfies `startsWith("player-")`
  for a player chain (`"player-shrapnel"` does; `"enemy-shrapnel"` correctly does not).
- **Shot consume vs. crate bounce.** `shotsVsBarrels` removes the shot; ensure it runs
  as its own pass and does not fight `updateShots`'s crate-ricochet (a shot between a
  crate and a barrel: the crate bounce happens in `updateShots` motion, the barrel
  consume in this pass — deterministic, but note the seam).
- **Crate indestructibility (§13.16).** Shrapnel/roll/detonation may **push** a crate
  (0.5 t, shrapnel only) but must never reduce crate HP — crates have no `hp` field;
  never add one.
- **`LETHAL` finite.** Use `1e9`, never `Infinity` (save/load rule).
- **Import direction / boot.** `barrels.js` imports enemies + player + abilities'
  registrar one-way; none import it. It must be imported at boot so factory decoration
  + dual seam registration run before frame 1.

---

## 10. Headless smoke tests (pure logic, no canvas — house `test-*.js` style)

Stub browser globals, dynamic-import the real modules, `check`/`throws` harness. Set
`G` directly; push synthetic barrels/enemies/spawners/crates/shots.

**Decorate & ladder:** placeholder → decorated barrel (`hp` 4, `blocks` true, `r`,
`rolling` false); `fireStateOf` maps 4/3/2/1/0 → intact/smolder/burning/raging/explode;
light radius mapping; the `G.lights` emitter registered on decoration and dropped on
detonation.

**damageBarrel:** subtracts hp, tags `_cause`, transitions fireState; at 0 flags
detonation.

**Kick/roll (B3):** kicked barrel rolls, decays exponentially, bounces off a wall at
0.6 retention and off a crate/spawner/other-barrel; settles < `stopSpeed` → static +
nav-dirty; rolls through an enemy at ≥ 3 t/s → enemy −1, barrel −1 HP & −40% speed;
below 3 t/s no impact; player takes no roll damage; barrel-vs-barrel = bounce, no dmg.

**Shot → barrel (B4):** player bullet consumed + barrel −dmg + `"player-bullet"`;
enemy shot consumed + barrel −dmg + `"enemy-*"`; the shot is **removed, not bounced**;
barrel pass runs after the enemy pass (a bullet that hit an enemy is already gone).

**Carried barrel (B5/B6):** pickup → `carry.type` "barrel", spliced from `G.barrels`;
enemy shot hits the carried barrel not the player; enemy melee → player dmg **and**
barrel −1; carried barrel to 0 → detonates on the player (shrapnel centred, CARRYING
ends), i-frames present; no vault / wall-vault / pushback for a carried barrel;
release re-inserts (kick moving / place static).

**Detonation (B8):** hp 0 → `count` shrapnel spawned owner-tagged, `barrel:exploded`
emitted with the FX payload, `markNavDirty` called, barrel spliced; no direct damage
applied.

**Shrapnel (B7):** motion + lifespan expiry (1.2 s); free bounce off wall + crate (no
health loss); exchange −1 health per damaging hit with enemy/player/barrel/spawner;
crate gets a 0.5 t push and **no** hp change; enemy/spawner deaths route through the
sweeps (gems + score by owner).

**Attribution (§9):** player-started chain (`player-lightning`/`player-bullet`/
`player-kick`) → shrapnel kills score; enemy-started (`wraith-aoe`/`enemy-lob`) → 0;
a barrel killed by player-owned shrapnel detonates as player-owned (chain propagation).

**Chain reaction:** a ≥3-barrel cascade emits `chain:reaction` with `count` and `owner`.

**Detonation seam (B10):** registered into **both** `enemies.js` and `abilities.js`;
Wraith call (damage 4) detonates a 4-HP barrel; lob call (damage 2) drops 4→2 without
detonating; Lightning's existing 4-arg call detonates via the lethal default; radius
test uses pixels (`radius + b.r`).

---

## 11. Open design questions

- **OQ-B1 — Rolling barrel vs. static barrel (B3): bounce, no damage. CONFIRMED**
  (owner sign-off) — barrels chain via shrapnel/blasts, not roll taps.
- **OQ-B2 — Shot/enemy overlap precedence (B4): enemies win a contested overlap.
  CONFIRMED** (owner sign-off) — enemy-pass-first, barrels catch survivors.
- **OQ-B3 — All `(proposed)` §7.2 dials** (barrel HP, kick friction, shrapnel
  count/stats, thresholds, timings, light radii) ride the §14.2 tuning sign-off, as
  adopted in §2.3. Not build blockers.

No blocking open questions. The §14 boss block stays tabled and does not gate barrels.

---

## 12. ADD source provenance (what was verified, where, disposition)

Verified against real `add2026` source (codeload tarball) before drafting.

- **`src/dustbin.js` `slideStep` — the kick physics: VERIFIED, REUSED (model), RETUNED
  (dials).** The real slide is exponential friction (`v *= Math.exp(-friction·dt)`) +
  per-axis wall bounce (`v = -v·bounce`) + a corner reflect-both/hold case — reused
  wholesale as the barrel roll. **This resolved a real contradiction in GDD §7.2.2**
  ("4 t/s² linear" vs "reused wholesale"): the reused model is exponential, so §7.2.2's
  linear phrasing is superseded (B3). Barrel dials retune ADD's constants (7 t/s vs
  460 px/s throwSpeed; 0.6 vs 0.7 bounce) — the *algorithm* is reused, not the numbers.
- **`src/dustbin.js` `detonate()` — NOT reused; the OPPOSITE model.** ADD detonate is
  an instant HP-damage AoE routed through `killEnemy`; the Repossessed barrel deals
  **no** direct damage and delivers everything via shrapnel (§7.2.3). The barrel
  detonation is therefore not a port of `detonate()` (B8). The attract/vortex is dead
  (already retired with the Dustbin, §13.8).
- **Shrapnel — NEW, no ADD analog.** A grep of `add2026/src` found no shrapnel /
  explosion / particle *system* (only an achievements mention). §7.2.4 shrapnel — its
  health, multi-target exchange, free crate-bounce, and crate-push — is net-new; the
  closest Repossessed precedent is the `G.ebolts` distinct-array pattern (E1), which is
  why shrapnel gets its own species/array (B7), not the `Shot` shape.
- **Net:** barrels reuse exactly one ADD organ — the `slideStep` kick physics
  (VERIFIED) — inherited via the same lineage the bounce-shot already uses. Everything
  else (HP/fire ladder, shrapnel, chain-of-custody, carried-barrel-as-target) is
  Repossessed-native.