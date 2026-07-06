# STATUS — Repossessed

**Last updated:** 2026-07-06 (SPEC-PICKUPS Phase 3 — **`updatePickups(dt)`
built + tested headlessly in `src/pickups.js`: the Magnet-pull → gem-age/
despawn → contact-collection ordered pass (§4), a single reverse-iterating
splice over `G.pickups` for the age/contact step (R3 — pull always runs
first, in its own separate forward pass, since it only moves gems and never
splices).** New sink imports: `G` (state.js), `emit` (level-loader.js),
`addGemEnergy` (abilities.js), `healPlayer` (player.js) — pickups.js remains
a DAG leaf (nothing imports it back). Collect routing per D3/R5: gem →
`addGemEnergy(value)`; food → `healPlayer(heal)` (sink owns the
`overhealCap` clamp); treasure → `G.score += points`; key → `G.keys++`;
`powerup` branches on `power` **before** the +75 grant (R5) — `magnet` sets
`G.magnet += CFG.PICKUP.magnet.duration` (additive refresh, D8) and leaves
`G.powerups.magnet` untouched; any other `power` does
`G.powerups[power] = (G.powerups[power]||0) + CFG.PICKUP.powerupShots`. Gem
`life` is lazy-seeded (`if (g.life == null) g.life = 0`) per R2 —
`dropGems` stays untouched. Contact test mirrors `firstOverlappingCrate`
(squared distance, `p.r + CFG.PICKUP.grab*CFG.TILE`); **no `p.loco` gate**
anywhere (D9 — collects while CARRYING/STUNNED). Exactly one
`pickup:collected` emit per collect (snapshot payload incl. `amount`); a
despawn emits nothing. Extended `test-pickups.js` (14→35 asserts) +new
`test-pickups-magnet.js` (9 asserts): contact routing per type, food overheal
clamp (28+10→30 not 38), magnet-kind D4 isolation, additive magnet refresh,
gem despawn (silent, credits nothing) vs. collect-before-despawn, the
despawn-vs-contact same-frame boundary (despawn wins — the per-item pass
checks age before contact, so a gem crossing the threshold this frame is
spliced silently even if in grab range, never double-handled), magnet pull
radius/no-overshoot/gems-only/tick-down-floors-at-0, and pull-then-collect
same-frame. Full suite reran green, **1025 total** (was 981, purely
additive). **Still owed (integration phase, unchanged from Phase 2): no
boot `import "./pickups.js"` wiring, and `updatePickups(dt)` is not yet
called from the main loop** — same deferred-integration debt already
carried for `abilities.js`/`barrels.js`.)
(SPEC-PICKUPS Phase 2 — **new leaf module
`src/pickups.js` created: the three factory-decoration wraps only, no
`updatePickups` yet.** Mirrors the shipped `makeSpawner` (enemies.js) /
`makeBarrel` (barrels.js) wrap-and-override precedent: captures each base
factory via `getEntityFactory`, re-registers a named wrapper that calls the
base then attaches the one sink field the type's collect branch will read
(D2) — `food` → `e.heal = CFG.FOOD[e.kind]`; `treasure` → `e.points =
CFG.TREASURE[e.kind]`; `powerup` → `e.power = e.kind`. **`key` is
intentionally left unwrapped** — a key needs no value field (contact ⇒
`G.keys++` is a Phase-3 concern), so it stays the loader's inert placeholder
per spec §3. No sink imports yet (`healPlayer`/`addGemEnergy` etc. are
Phase-3 imports) — this phase touches only `config.js` reads +
`level-loader.js` factory registration, nothing else. **R7 (mis-kinded
placement data) handled as spec'd:** an unrecognized `kind` decorates to
`undefined` (e.g. `CFG.FOOD["bogus"]`) rather than throwing; no substitution,
no `console.warn` added (optional per spec, skipped as unnecessary noise).
New `test-pickups.js` (14 asserts, green): each of the three wraps decorates
correctly across their kind tables (food candy/feast, treasure candyCorn/
silverSkull/goldChest, powerup fast/magnet), override-wins-over-placeholder,
key stays valueless, and the R7 mis-kinded case (`food{kind:"bogus"}` →
`heal===undefined`, no throw). Full suite reran green (all `test-*.js`
pass). **R1 (factory-override load order) is OWED, not resolved here** —
these overrides are correct only if the boot module imports
`level-loader.js` **before** `pickups.js` (last-wins `registerEntityFactory`,
verified `Map.set`); no boot/main-loop file was touched this phase (by
design — integration is a later, separate phase). This is the same
deferred-boot-wiring debt already carried for `abilities.js` and
`barrels.js`. Owed next: SPEC-PICKUPS Phase 3 — `updatePickups(dt)` (the
Magnet-pull → gem-age/despawn → contact collection ordered pass, R2/R3),
the `pickup:collected` emit, and the sink imports (`healPlayer`,
`addGemEnergy`) — still no boot `import "./pickups.js"` wiring.)
(SPEC-PICKUPS Phase 1 — **enabling edits only**
(`pickups.js` NOT built yet): three new additive `CFG` blocks added to
`config.js` verbatim per §2.3–2.5 (`CFG.PICKUP` — `grab`(0.5t)/`gemDespawn`(12s)/
`powerupShots`(75, D5)/`magnet{radius(6t), pullSpeed(10 t/s), duration(10s)}`;
`CFG.FOOD{candy:5, feast:10}`; `CFG.TREASURE{candyCorn:100, silverSkull:250,
goldChest:500}`; `CFG.GEM.energy`(5) reused unchanged, not re-declared); and one
line in `level-loader.js` `clearTransient` — `G.magnet = 0;` added immediately
beside `G.novas = []` (OQ-P1, the Magnet timer is a per-level transient, resets
on load exactly like Nova rings; `G.pickupTimer`, a pre-existing unrelated
spawn-cadence field, is untouched per R4/D10). No `pickups.js` yet, no
collection logic, no factory decoration — purely data + one reset line.
`test-config.js` extended with 12 new asserts locking the dials (`powerupShots
===75`, `magnet.duration===10`, `FOOD.feast===10`, `TREASURE.goldChest===500`,
`GEM.energy===5` unchanged, etc.); green. Full suite reran green, **981 total**
(was 969, purely additive). Owed next: SPEC-PICKUPS Phase 2+ — `pickups.js`
itself (the wrap-and-override decoration factories for food/treasure/powerup,
`updatePickups(dt)`'s Magnet-pull→gem-age→contact ordered pass, the
`pickup:collected` emit) — still no boot `import "./pickups.js"` wiring, same
integration debt already owed for `abilities.js`/`barrels.js`.)
(SPEC-BARRELS Phase 4 — **detonation, the shrapnel
species, chain reactions + attribution built; the barrels subsystem (#6) is now
COMPLETE** (B7/B8/B9, §5). **`barrels.js`:** `damageBarrel` hp≤0 no longer a TODO
— it now only *marks* (subtract hp + tag `_cause`; `fireStateOf === "explode"` is
the implicit flag); **detonation is COLLECTED + resolved by `updateBarrels`** via
the new `resolveDetonations()`, called AFTER the roll/impact driving pass (§5.1 —
never mid-iteration, so a cascade resolves over frames and the shrapnel a
detonation spawns is walked by the NEXT `updateShrapnel`, not the loop that
triggered it). `resolveDetonations` collects every hp≤0 barrel in `G.barrels`
**plus** the carried one (`carriedBarrel()`, spliced OUT of `G.barrels`, B5) into
one **wave**, then `detonateBarrel` each; a wave of ≥ `explosion.chainCallout`(3)
emits `chain:reaction {count, owner}` (§5.3, the sanctioned per-wave counter).
**`detonateBarrel(b)`:** owner = `_cause.startsWith("player-") ? "player" :
"enemy"` → `spawnShrapnel` (`shrapnel.count`(8) pieces radial ±`jitter` into
`G.shrapnel`, each `{x,y,vx,vy,r,dmg,health,life:0,owner}` §2.4; **shrapnel `r`
reuses `CFG.SHOT.r`(6)** — §2.3 has no dedicated dial, flagged for #7/tuning) →
`emit("barrel:exploded", {x,y,owner,hitStopFrames,shakeDur,shakeFullTiles,
shakeZeroTiles})` (snapshot FX for #10) → `dropBarrelLight` (mirrors enemies.js
`removeLight` — the persistent `{source:barrel}` emitter must not outlive the
barrel) → **markNavDirty + splice from `G.barrels`**, OR for **detonate-in-hand**
(B5, `b === carriedBarrel()`): centre the shrapnel on the **player** and call
`player.js notifyCarriedBarrelDestroyed()` (clears carry, loco→NORMAL, **NO
re-insert, NO markNavDirty** — it was never a blocker while held); post-hit
i-frames cap the self-damage when the centred burst strikes the player next
`updateShrapnel` (§2.1). **NO direct damage/force — detonation is shrapnel-only**
(B8, the OPPOSITE of ADD `detonate()`). **`updateShrapnel(dt)` (B7, the shrapnel
SPECIES — its own `G.shrapnel`, NOT the `Shot` shape):** per piece — `slideShrapnel`
(per-axis FREE reflect off walls[`isWall` centre-tile] + crates[`crateAt`, half-tile
radius], full retention, **no health cost**; a crate contact also gets **pushed
`shrapnel.cratePush`(16px=0.5t)** along the piece's incoming velocity — crates take
NO damage, have no `hp` field, §13.16) → `life += dt` → **damage-exchange** (−1
health per damaging hit, in order enemies→player→barrels→spawners, stop once spent):
enemy `hp -= dmg` + tag `player-shrapnel`/`enemy-shrapnel` on lethal; player
`applyDamageToPlayer(dmg, owner+"-shrapnel")` (self-gates on i-frames); barrel
`damageBarrel(b, dmg, tag)` → **chain** (the barrel ADOPTS the piece's owner via
`_cause`, so `"player-shrapnel".startsWith("player-")` propagates a player chain,
`"enemy-shrapnel"` correctly does not); spawner `hp -= dmg` + tag — destroy the
piece at `health ≤ 0` or `life ≥ lifespan`(1.2s); after the pass ONE
`sweepDeadEnemies()` + `sweepDeadSpawners()` (gated on a hit-bool, never per-hit).
**`updateShrapnel` NEVER spawns shrapnel** (detonation does, in `updateBarrels`) —
that structural split is what keeps a cascade frame-spaced. **`updateBarrels`** now
calls `resolveDetonations()` at its tail (after the existing roll-impact
`sweepDeadEnemies`). **New imports** (still one-way barrels→player, player never
imports barrels): `applyDamageToPlayer`, `carriedBarrel`, `notifyCarriedBarrelDestroyed`
from `player.js` (the §1-B1 sanctioned edge; `applyKnockbackToPlayer` NOT imported —
detonation applies no direct force). **Attribution tag contract (B9, the chain of
custody #9 scoring rides):** a barrel stores `_cause` (last-damager-wins via
`damageBarrel`); on detonation owner = `_cause.startsWith("player-")`; each shrapnel
piece carries `owner`; a shrapnel-killed victim is tagged `player-shrapnel`/
`enemy-shrapnel` and routed through the shared `sweepDeadEnemies`/`sweepDeadSpawners`
(whose `awardKill` scores `player-*`, zeroes the rest); a shrapnel-damaged barrel
adopts the piece's owner. Cause vocabulary introduced/flowing: `player-kick`,
`player-shrapnel`, `enemy-shrapnel` (+ existing `player-bullet`/`player-lightning`/
`wraith-aoe`/`enemy-lob`/`enemy-shot`). New `test-barrels-detonate.js` (47, green):
detonation (8 owner-tagged shrapnel, `barrel:exploded` w/ FX payload, markNavDirty,
splice, NO direct damage, light dropped), collect-not-mid-iteration (non-rolling
shot-killed barrels detonate), detonate-in-hand (centred/carry-cleared/loco NORMAL/
not-re-inserted/i-frame cap), owner derivation (player-*/enemy causes), scoring by
owner, chain propagation (player+enemy), chain:reaction (≥3 emits, 2 does not). New
`test-barrels-shrapnel.js` (35, green): motion + 1.2s lifespan, free wall+crate
bounce (no health cost), crate 0.5t push + no-hp, −1 health per hit vs enemy/player/
barrel/spawner, spent-piece destroy, enemy+spawner deaths route through the sweeps.
Full suite reran green, **969 total** (was 887, purely additive). **Subsystem #6
(Barrels) is COMPLETE** — entity/ladder/damage-intake, carry/kick/roll, detonation/
shrapnel/chains all built and tested headlessly. **Still owed downstream (NOT
barrels scope):** the boot `import "./barrels.js"` + wiring `updateBarrels`/
`updateShrapnel`/`shotsVsBarrels` into the main loop (integration phase, same debt
as `abilities.js`); **#7** rendering barrel fire/light from `fireStateOf` + the
`G.lights {source:barrel}` emitter; **#10** rendering the `barrel:exploded` /
`chain:reaction` FX; **SPEC-SCORING** replacing `awardKill` and inheriting the
attribution tags above unchanged.)
(SPEC-BARRELS Phase 3 — **carry/kick integration
+ roll physics built** (B3/B5/B6, §4). **`player.js`:** `tryPickup` now also
picks up barrels (a `firstOverlappingBarrel` companion to the crate check —
**crate-FIRST order preserved**; splice from `G.barrels`, `markNavDirty`,
`carry={type:"barrel",entity}`, loco CARRYING, `barrel:pickup` emit; NO plate
press — barrels aren't in the crate plate-weight system); `carryActions`
**skips `tryWallVault`** for a carried barrel (B6 — barrels never wall-vault);
`releaseCarry` branches on `carry.type` → new `releaseBarrel`: moving ⇒ **KICK**
(drop on the player's tile centre, then `barrelKickSink(barrel, aim)` — the
registered `barrels.js` `kickBarrel`), stationary ⇒ **PLACE** upright static via
new `placeBarrelAtTile` (crate-toss settle, never rolls, NO vault); **NO
carried-barrel pushback** — the §7.1.4 crate bumper stays crate-only
(`isCarryingCrate()` is false for a barrel, so `meleeExchange` runs the normal
exchange). Net-new exports `carriedBarrel()` (`p.carry?.type==="barrel" ? entity
: null`) and `notifyCarriedBarrelDestroyed()` (the Phase-4 detonate-in-hand sink:
clears carry + loco→NORMAL, **does NOT re-insert** — the ONE release path that
legitimately skips the re-insert). **`dropCarried` (STUN force-drop) now branches
on `carry.type`** — a barrel force-drop routes to `placeBarrelAtTile` (settles
STATIC into `G.barrels`), NOT `dropCrateAtTile` (which would misroute the barrel
into `G.crates` and leak it); this closes the splice-out-symmetry hole the spec's
phase-risk names — the stun path IS a release path, so handling it is in-scope
correctness, not new design. **`enemies.js`:** `meleeExchange` now ALSO chips a
carried barrel 1 HP on enemy contact (B5 — in the `!e.contact` exchange block,
guarded on `carriedBarrel()`, tagged `"enemy-<type>"`; the player still takes
normal melee) via the net-new **`registerBarrelDamage` seam** (barrels.js fills
it with `damageBarrel`); `carriedBarrel` added to the player import. **`barrels.js`:**
**`kickBarrel(barrel,aimX,aimY)`** (re-insert into `G.barrels` + `vx/vy=aim·
kick.speed` + `rolling=true`; defensive no-double-insert) and **`updateBarrels(dt)`**
— the roll integrator, **the SECOND sanctioned `moveBody` exception** after
`enemies-ai.js`'s `phantomMover` (ADD `dustbin.js slideStep` ported: per-axis
reflect `v=-v·bounce` off `barrelHitsSolid` = `isWall` ∪ `bodyHitsBlocker(e=>e!==
self)` [walls + crates + spawners + OTHER barrels], corner reflect-both/hold, then
`v*=exp(-friction·dt)`; settle `<stopSpeed` → static + tile-align + `markNavDirty`).
Rolling impact (`speed≥impactSpeed` 96 px/s): an overlapped enemy takes `impactDmg`
(1), the barrel loses `impactSelfHp` (1) via `damageBarrel(…,"player-kick")` +
`speed*=(1-impactSlow)` (−40%), and **passes through** (enemies are NOT bounce
blockers — distinct from the roll blocker set); ONE `sweepDeadEnemies()` after the
pass. Barrel-vs-barrel = **bounce, no damage** (OQ-B1); the player takes **NO roll
damage** (never referenced). **Detonation resolution stays a Phase-4 TODO** — a
kicked/carried barrel CAN reach hp≤0 here (`damageBarrel`) but does NOT yet spawn
shrapnel/splice. **Circular-import resolution (the phase's key architectural
call):** `player.js` cannot import `barrels.js` (B1: "nothing imports barrels.js")
and `enemies.js` cannot either (barrels.js imports enemies.js) — so the kick and
the melee-chip are **register-callback seams** (`registerBarrelKick` in player.js,
`registerBarrelDamage` in enemies.js), both filled by `barrels.js` at load, the
same idiom as `registerBarrelDetonation`/`registerAbility`. `barrels.js` now also
imports `player.js`'s `registerBarrelKick` (the sanctioned barrels→player edge,
B1); graph re-verified one-way — nothing imports `barrels.js` back. New
`test-barrels-carry.js` (61, green): pickup/splice, `carriedBarrel()` +
`notifyCarriedBarrelDestroyed` no-re-insert, place-static + kick-rolling (BOTH
re-insert into `G.barrels`), enemy-melee→player damaged AND barrel −1, exp
decel/one-step-decay, settle + nav-dirty, bounce off wall/crate/spawner/
other-barrel at 0.6, rolling impact (enemy −1 / barrel −1 / −40% / `player-kick`
tag), sub-threshold inert, no-player-roll-damage, no-wall-vault. Full suite reran
green, **887 total** (was 826, purely additive). Owed next: SPEC-BARRELS Phase 4
(detonation resolution + shrapnel species + chain reactions, B7–B9) —
`damageBarrel` hp≤0 is still a TODO and `notifyCarriedBarrelDestroyed` awaits its
detonate-in-hand caller.)
(SPEC-BARRELS Phase 2 — **`barrels.js` created**:
entity decoration, the fire ladder, damage intake, and the dual
detonation-seam fill (B1/B2/B4/B10). **NO roll/kick physics, NO
detonation/shrapnel resolution yet** — those are Phase 3/4. New `src/barrels.js`
decorates the loader's `barrel` placeholder via `getEntityFactory("barrel")`
(the #4 spawner-decoration pattern — call through, then augment) adding
`hp`(4)/`r`(14)/`vx`/`vy`(0)/`rolling`(false)/`_cause`(null) and pushing a
`{source: barrel}` light emitter into `G.lights` (§3.3, the Fire-Wraith glow
precedent — live entity reference, no per-frame re-sync); re-registered via
`registerEntityFactory`. `fireStateOf(barrel)` is a **pure function of hp**
(§2.5 ladder: 4/3/2/1/≤0 → intact/smolder/burning/raging/explode) — **never
stored**, so it can't desync; `lightRadiusOf` reads `CFG.BARREL.light[state]×TILE`
(0 for intact). `damageBarrel(barrel, amount, cause)` (§3.1) is the single
intake sink: subtracts hp, tags `_cause` (last-damager-wins), and at `hp≤0`
leaves a `// Phase 4: resolve detonation` marker — **no splice, no shrapnel,
barrel stays in `G.barrels` structurally intact otherwise** (this phase's
explicit scope fence). `detonateBarrelsInRadius(x, y, radius, cause, damage =
CFG.BARREL.LETHAL)` (§6/B10, all pixels) is the real seam fn — applies
`damage` to every barrel within `radius + b.r` — and is **registered into BOTH
`enemies.js` and `abilities.js`** at module load via aliased imports
(`registerBarrelDetonation as regEnemies` / `as regAbilities`), closing the two
dangling seams STATUS has carried since SPEC-ABILITIES Phase 2. `shotsVsBarrels()`
(§B4) is a self-contained pass over `G.shots`: an overlapping shot is
**removed (never bounced)** and damages the barrel, tagged `"player-bullet"`
or `"enemy-shot"` from `s.owner` — **note:** the spec's `§10` test-plan wording
says `"enemy-<kind>"`, but real `Shot` objects only ever carry `owner:
"player"|"enemy"` (no per-enemy-kind tag anywhere in `projectiles.js`/
`enemies.js`) — resolved as `"enemy-shot"`, a concrete cause string satisfying
the same `!startsWith("player-")` scoring contract (§9); flag if a future spec
wants shots to carry their minting enemy's kind. `initBarrels()` lazy-inits
`G.shrapnel ||= []` (Phase 4 will push into it). **Import graph verified
one-way:** `barrels.js` imports config/state/world (`bodyHitsBlocker`/`isWall`/
`tileCenter` — pinned per the spec's import list, `bodyHitsBlocker`/`isWall`
unused directly this phase, owed by the Phase-3 roll integrator)/level-loader
(`emit`/`markNavDirty`/`registerEntityFactory`/`getEntityFactory` — `emit` also
pinned, unused until Phase 4's detonation emit)/`enemies.js`
(`sweepDeadEnemies`/`sweepDeadSpawners`, unused directly this phase, owed by
Phase 4's death-sweep-after-detonation step)/`abilities.js`'s
`registerBarrelDetonation`; a repo-wide grep confirms nothing imports
`barrels.js` back. **Boot debt accumulates** (unchanged from Phase 1): the
eventual bootstrap must `import "./barrels.js"` so the factory decoration +
dual seam registration run before frame 1 — same debt already owed for
`abilities.js`. New `test-barrels.js` (44, green): decorate (hp/r/vx/vy/
rolling/_cause + the `G.lights` emitter), the full fire-ladder + light-radius
mapping (4→0 through ≤0→explode), `damageBarrel` (subtract/tag/last-damager-
wins/hp≤0 leaves the barrel structurally in place with `G.shrapnel` still
empty), `detonateBarrelsInRadius` (Wraith `explodeDmg`(4) detonates a 4-HP
barrel, Lobber's lob `dmg`(2) leaves it at 2/Burning, Lightning's lethal
default drives hp≤0, out-of-radius untouched, both registries route to the
same real fn), and `shotsVsBarrels` (player + enemy shot consume+damage+tag,
removed not bounced, non-overlap untouched). Full suite reran green, **826
total** (was 782, purely additive). Owed next: SPEC-BARRELS Phase 3 (kick/roll
physics reusing the ADD `slideStep` model, B3 — the second sanctioned
`moveBody` exception after `phantomMover`) and Phase 4 (detonation resolution +
shrapnel species + chain reactions, B5–B9); downstream, `player.js`'s barrel
carry-FSM branches (B5/B6) are **not yet touched** — `carriedBarrel()` doesn't
exist yet, correctly out of this phase's scope.)
(SPEC-BARRELS Phase 1 — **enabling edits only**
(`barrels.js` NOT built yet): `CFG.BARREL` block added to `config.js` verbatim
per §2.3 (hp 4, r 14, `kick`/`shrapnel`/`explosion`/`light` dial groups,
`LETHAL` 1e9 — sentinel-over-`Infinity`); `enemies.js` gained the public alias
`export { spawnerDeathSweep as sweepDeadSpawners }` (B9 — mirrors the existing
`sweepDeadEnemies` alias, body/callers untouched) so the coming `barrels.js`
routes spawner kills through the one shared drop/score/emit/nav sweep; the two
existing `detonateBarrelsInRadius` call sites (Fire-Wraith EXPLODE, Lobber lob
splat) now pass a 5th `damage` argument (B10 — Wraith passes `explodeDmg`(4),
Lobber passes its lob `dmg`(2)) — inert today since the registered seam is
still the Phase-3 no-op default and ignores the extra arg, but wires the call
sites so SPEC-BARRELS Phase 2's real `detonateBarrelsInRadius(x,y,radius,cause,
damage=LETHAL)` receives the right magnitude without a second edit. The
Lightning call site is untouched (rides the lethal default per B10, no edit
needed). New `test-barrels-seams.js` (40, green): CFG.BARREL spot-checks (all
groups + `LETHAL`), `sweepDeadSpawners` importable + sweeps an hp≤0 spawner
(drops gems, awards points, calls `markNavDirty`), and the Wraith EXPLODE call
site verified to pass `explodeDmg` as the 5th arg via a real `tickEnemies` run
(mirrors `test-enemies-wraith.js`'s EXPLODE case). Full suite reran green,
**782 total** (was 742, purely additive). Owed next: SPEC-BARRELS Phase 2 —
`barrels.js` itself (barrel entity, roll/kick physics, HP ladder, shrapnel,
the real `detonateBarrelsInRadius`, registration into both `enemies.js` and
`abilities.js`).)
(SPEC-ABILITIES Phase 4 — **Nova cast + ring pass
built; subsystem #5 COMPLETE.** `abilities.js` `onNova` (§4.1) + the per-frame
Nova ring pass in `updateAbilities` (§4.2) filled, replacing the Phase-2 TODO.
**`onNova`:** (1) cooldown gate (`return` if `novaCd>0`); (2) fuel branch (A5) —
`storedCharges≥1` → spend one charge, `health = ringMaxHp`(50), live bar
untouched; else `gemEnergy ≥ minBarToFire`(25) → `health = ringMaxHp ×
gemEnergy/barCap` (kept a **float**, no round), `gemEnergy = 0`; else a **rejected
no-op** (no ring, NO cooldown, NO spend); (3) push a ring (§2.2) at the player's
**frozen** centre with `r=prevR=0`, the resolved float `health`, an empty `hit`
Set, `kills=0`; (4) `novaCd = cooldown`(0.5). **No emit at cast** (Nova's total is
only known at dissipation). **Ring pass (`updateAbilities`, reverse-iterate
`G.novas` so removals don't skip):** per ring — `prevR=r`; `r += expandTilesPerSec
× TILE × dt` (=384 px/s); **ENEMY PASS** gathers `prevR < dist ≤ r` (centre-to-
centre, **no `e.r`** term — unlike Lightning's edge test) and not in `hit`, sorts
**ascending by dist** (A4 nearest-first), then per enemy adds to `hit` and either
`resist.nova` → `e.hp -= reaperDamage`(10)/`health -= reaperRingCost`(20)/survives,
or destroy → `cost = e.hp`, `e.hp = 0`, `e._cause = "player-nova"`, `kills++`,
`health -= cost`; **break AFTER the fatal victim is marked dead** once `health ≤ 0`
(A4 — enemies farther out this frame are neither struck nor added to `hit`, and the
ring dissipates on the same ≤0 threshold, so they are never missed on a later
frame); **PROJECTILE ERASE (A10, free, same band, health-independent so it runs on
the dying frame)** removes `G.shots` with `owner==="enemy"` + all `G.ebolts` (at
their current interpolated `b.x,b.y`) in `prevR<dist≤r`, **player shots KEPT**;
**DISSIPATE** at `health ≤ 0` OR `r ≥ radiusCapTiles × TILE`(448) →
`emit("ability:cast",{kind:"nova",killCount:ring.kills})` (OQ-A1 snapshot,
`killCount`=**destroys only**, resisted not counted) then splice the ring. After
ALL rings: **`sweepDeadEnemies()` once** (A1 — never per-hit; the shared
drop/score/emit/nav/light path; `player-nova` scores full points). `updateAbilities`
early-returns when `G.novas` is empty (still lazy-inits it) so the unconditional
per-frame sweep never touches non-Nova deaths. **Immunity by OMISSION** — the Nova
pass NEVER references `G.spawners`/`G.crates`/`G.barrels`, so spawner/crate/barrel
immunity (GDD §5.1) holds by construction; the barrel-detonation seam spy is never
called by Nova. Net-new `export { onNova as __onNova }` (house `__` test
affordance, mirrors `__onLightning`; player still casts only via `registerAbility`).
No new imports (graph unchanged; `emit`/`sweepDeadEnemies` were pinned in P2). New
`test-abilities-nova.js` (54) green — the full §9 Nova clusters: fuel branches
(charge/bar≥25/<25-no-op), cooldown gate, single-hit-per-ring (`hit` Set survives a
victim moving into a later band), destroy+ring-health-cost+shared-sweep,
weak-ring-kills-final-victim, the nearest-first margin (15-health ring kills the two
nearer 10-HP enemies but not the in-band third), Reaper nova-resist (10 dmg/ring −20/
survives/uncounted), projectile erase (enemy shots + ebolts removed, player shots
kept, erase on the dying frame), immunity (spawner/crate untouched, barrel spy never
called), and the dissipation emit (fires once on death, `killCount`=destroys only,
not at cast/per-hit). Suite **742 total** (was 688, purely additive). **Subsystem
#5 (Abilities) is now COMPLETE** — gem economy + Lightning + Nova all built and
tested headlessly. Still owed downstream (NOT #5 scope): the boot `import
"./abilities.js"` so `registerAbility`/`registerBarrelDetonation` run before frame 1
+ the wiring of `initAbilities()`/`updateAbilities(dt)` into the main loop
(integration phase), and **SPEC-BARRELS must register its real detonation fn into
BOTH `enemies.js` AND `abilities.js`** (Lightning's barrel clause is inert until
then; Nova never touches barrels).)
(SPEC-ABILITIES Phase 3 — **Lightning cast built**
(`abilities.js` `onLightning` body filled; **Nova stays a NO-OP stub**, owed P4).
Instantaneous per §5.1: (1) cooldown gate (`return` if `lightningCd>0`); (2)
`R = lightning.radiusTiles × CFG.TILE` (=160), `(px,py) = G.player` centre frozen
at cast; (3) **radius wipe** over `G.enemies` — squared-distance edge test
`(e.x-px)²+(e.y-py)² ≤ (R+e.r)²` (per-enemy reach, house AoE idiom): branch on the
**`e.resist?.lightning` MARKER** (A2, NOT boss/type) → resisted takes
`reaperDamage`(5) and SURVIVES (no `_cause`, not counted); else `e.hp=0`,
`e._cause="player-lightning"`, `killCount++`; (4) `sweepDeadEnemies()` **ONCE**
after the whole pass (A1 — never per-hit, would splice mid-iteration; the shared
`dropGems`/`awardKill`/`enemy:killed`/cleanup path — `player-*` cause scores full
points); (5) `detonateBarrelsInRadius(px,py,R,"player-lightning")` (A8 seam, no-op
until SPEC-BARRELS); (6) `applyStun(stunSeconds)` (A7, 3 s); (7) `lightningCd =
cooldown`(10); (8) `emit("ability:cast",{kind:"lightning",killCount})` — a
**snapshot** payload (no back-reference into G, one-way flow), `killCount` =
**destroys only** (a resisted Reaper chipped for 5 is NOT counted). Consumes **no**
gem energy (§5.2, structural null). **Spawners/crates immune by construction** —
neither `G.spawners` nor `G.crates` is referenced. **Net-new test-affordance
export:** `abilities.js` now `export { onLightning as __onLightning }` (the handler
is registered into `player.js` by reference and is otherwise module-local; the
`__`-prefixed alias lets headless tests drive a cast directly, mirroring
`enemies.js`'s `__deathSweep`/`__playerShotEnemyPass` — `player.js` still invokes it
only via the `registerAbility` registry; the STUNNED cast-lock is a player-side
`tryAbilities` gate, tested there, not re-tested here). No new imports (graph
unchanged; `emit`/`applyStun`/`sweepDeadEnemies` were already pinned in P2). New
`test-abilities-lightning.js` (22) green — radius wipe/attribution/sweep, just-
outside survives, resist chip+survive, free (`gemEnergy` unchanged), `p.stun==3`,
`lightningCd==10`, barrel spy called once with `(px,py,5×TILE,"player-lightning")`,
`ability:cast` emits once with `killCount`=destroys-only, plus the cooldown-gate
no-op/re-fire. Suite **688 total** (was 666, purely additive). Owed by P4: Nova
cast (`onNova`) + the Nova ring pass in `updateAbilities`; still owed downstream:
SPEC-BARRELS fill of `registerBarrelDetonation`, and the boot `import
"./abilities.js"`.)
(SPEC-ABILITIES Phase 2 — **`abilities.js`
foundation built** (no Nova/Lightning behaviour yet). New file `src/abilities.js`
imports config/state + one-way `level-loader` `emit` / `player` `registerAbility`
+`applyStun` / `enemies` `sweepDeadEnemies` (NONE import it back — graph
grep-clean; `emit`/`applyStun`/`sweepDeadEnemies` imported now to pin the one-way
graph, consumed by the Phase 3/4 handler bodies). Built: module-local
`novaCd`/`lightningCd`; `addGemEnergy(value)` (A6/§3 — bar-fill → whole-charge
banking to `chargeCap` → discard+clamp; **verbatim A6 algorithm**, `>` not `>=`,
pure fn of `G.gemEnergy`/`G.storedCharges`); `initAbilities()` (reset both
cooldowns + `G.novas=[]`); `updateAbilities(dt)` (**this phase only** ticks both
cooldowns down by dt floored at 0 + lazy-inits `G.novas ||= []`; the Phase-4
Nova-ring pass is a marked TODO); `onNova`/`onLightning` **NO-OP stubs**
registered BY REFERENCE at module load via `registerAbility` (import side-effect
— so the eventual **bootstrap must `import "./abilities.js"`** for the
registration to run before frame 1); `registerBarrelDetonation` seam (A8, no-op
default — **SPEC-BARRELS must register its real fn into BOTH `enemies.js` AND
`abilities.js`**; Nova never touches barrels); plus a read-only `getCooldowns()`
accessor (net-new — cooldowns are module-local per §2.4 with no observation hook,
so this mirrors `nav.js`'s `getNavVersion()` to make the tick testable now + feed
the HUD readiness icons the spec Scope says #5 maintains; see decision log).
`test-abilities.js` (18) green; suite **666 total** (was 648, purely additive).
Owed by later phases: Lightning cast (P3), Nova rings + the `updateAbilities`
ring pass (P4), and the boot `import "./abilities.js"`.)
(SPEC-ABILITIES Phase 1 — **subsystem #5 begun,
enabling seams only** (no `abilities.js` yet): four surgical edits — `CFG.ABILITY`
block (§2.3, nova/lightning dials, leaf data), `enemies.js` `sweepDeadEnemies`
ALIAS export of the private `deathSweep` (A1, body/callers untouched), `player.js`
`applyStun(seconds)` extends-not-shortens STUNNED producer beside `applyEntangle`
(A7, no iframe/loco gate, no new imports), and `G.novas = []` added to the loader's
transient-clear line (A9, per-level Nova-ring transient). `test-abilities-seams.js`
(29) green; suite **648 total** (was 619, purely additive). See the SPEC-ABILITIES
Phase 1 decision-log entry.)
(SPEC-ENEMIES Phase 9 — **Spawners added** (§6.3,
E4): the roster is now COMPLETE (all 9 types + spawners). `enemies.js`'s
`makeSpawner` factory **decorates** (does not replace) the loader's existing
spawner placeholder — `getEntityFactory("spawner")` (new level-loader.js
accessor, mirrors `registerEntityFactory`) reads back the loader's own
registration so the Plan-filtered `table`/ramped `interval`/`liveCap`
eligibility logic is reused rather than re-derived a second time (same
duplication hazard the `evalRampTable` decision log entry already flagged for
`level-generator.js`); the wrapper then adds the combat/emission fields:
`hp`(6)/`points`(300)/`gems`(3)/`r`(16) from `CFG.ENEMY.spawner`, a stable
`id` (the E4 live-cap tag source, same shape as the Reaper's minion tag), and
`emitT` seeded at `firstDelay`(2.0s). **Emission (E4, `spawnerTick`, new step 1
of `tickEnemies`, replacing the Phase-3 no-op hook):** first emit at 2s, then
every ramped `interval`; a weighted pick (`weightedPick`, new) draws ONLY from
the spawner's already Plan-filtered `table`; the emitted child is minted via a
`factoryByType` lookup table over the 8 loose-element factories (never
"reaper" — level-def-only) and tagged `originSpawner = spawner.id`, emerging
through the shared 0.5s `spawn>0` gate. **Live-cap is a SCAN, not a counter**
(`spawnerEmit` counts `G.enemies` for the matching `originSpawner` tag at each
emit decision) and **R5 is upheld by construction** — the scan has no `spawn`
filter, so a child mid-emergence still counts toward its spawner's cap.
**Spawner-as-target (§0.4, resolved IN-SCOPE per SPEC-ENEMIES §5's spawner CFG
block, which already carried hp/points/gems):** `playerShotEnemyPass` and
`meleeExchange` (steps 3/4) now ALSO test `G.spawners` — a player bullet or
melee hit reduces `sp.hp`, tagging `sp._cause`; spawners take no melee-to-
player (no `CFG.ENEMY.spawner.melee` — the null case is structural, not a
special-cased skip) and no crate-bumper knockback (they're immobile, nothing
to push away from). A new `spawnerDeathSweep` (mirrors `deathSweep`, run
immediately after it in step 5) drops gems/`awardKill`/emits `enemy:killed`
{type:"spawner",...} and calls the loader's `markNavDirty` on the vacated tile
(a destroyed spawner was a nav blocker; occupancy rebuilds lazily off
`G.spawners`, so the invalidation signal alone is correct — no rebuild call
needed here). Barrel/shrapnel destruction of spawners stays out of scope
(SPEC-BARRELS, post-#4, per the phase prompt). `test-enemies-spawner.js` (28)
green; suite **619 total**. **Subsystem #4 (Enemies + spawners) is now
COMPLETE** — full roster (Ghost/Skeleton/Spider/Bat/Zombie/Skeleton
Shooter/Fire Wraith/Lobber/Reaper) + spawners, nav consumer layer, and combat
spine all built and tested headlessly.)
(SPEC-ENEMIES Phase 8 — **The Reaper added** (§6.1.9,
E9): PHANTOM A\* mini-boss summoner. `updateReaper` (`enemies-ai.js`) registers as a
nav navigator with `NAV_MASK.PHANTOM` + a **bespoke phantom mover** — the ONE
navigator whose mover is NOT `world.moveBody` (a deliberate, documented exception to
"moveBody is the one mover"; §0.1/R4 — see decision log; `world.js` left untouched).
`phantomMover` slides per-axis against `bodyHitsBlocker(reaperBlockerFilter)` —
crates+barrels ONLY (`reaperBlockerFilter = e.type!=="spawner"`), **never**
`bodyHitsWall` and never spawners, so it follows a wall-crossing PHANTOM path without
wedging (nav.js routes PHANTOM through walls+spawners, blocked only by crates/barrels,
so the mover must match). Summon (every `G.ramp.reaperSummonInterval` 6→3.5 s) and
dark-blast (every 9 s FIXED) are minted via new `registerReaperSummon`/
`registerReaperBlast` seams (same register-callback shape, R6 — `enemies-ai.js` never
imports the factories/`projectiles`) filled in `enemies.js`: summon picks
`["ghost","ghost","skeleton"]` → 2 Ghosts or 1 Skeleton at the Reaper's tile, tagged
`originSpawner = reaper.id`, capped at `minionCap` 6 via a live `G.enemies` scan at the
emit decision (E4, no mutable counter) that counts emergence-window children (R5,
`spawn` = spawner.emerge 0.5 s); blast is `makeShot(owner:"enemy", dmg 3, speed 224
[=7 t/s], maxTravel blastRange=448px [14 t, the R7 dial], effect:"damage")` at the
player that rides `player.js updateShots` (crate-ricochet + non-bounce wall fizzle) and
whose damage the spine's step-7 `enemyShotPlayerPass` applies. #5 flags exposed:
`e.boss=true` (set generically by `makeEnemy` from `cfg.boss`) + `e.resist={nova:true,
lightning:true}` — a value-free MARKER #5 reads instead of a hardcoded type check; #5
applies the 10/20 (Nova) and 5 (Lightning) magnitudes. Reaper death emits `boss:killed`
FX (screen-shake+hit-stop, #7/#10) keyed on `e.boss`. Reaper knockback also routes
through `phantomMover` (new `nav==="phantom"` branch in `integrateEnemyKnockback`, so a
melee knockback can't wedge it on a wall it phases through). `test-enemies-reaper.js`
(24) green; suite **591 total**. Roster still owed: **spawners** only.)
(SPEC-ENEMIES Phase 7 — **Lobber added** (§6.1.4, cover-seek, ADAPTS ADD `updateSorter`) + the `G.ebolts`/`updateEbolts` arced-ordnance system it is the sole producer of. `updateLobber` (`enemies-ai.js`) is **NOT an A\* navigator** — cover-seek via `moveBody`+`groundBlockerFilter` only, no `addNavigator`/`steerNavigator`, throttled LOS (`losCheckEvery` 0.12s, ADD). Exposed (`canSee`): panic-flee AWAY at `fleeMul(0.95×)` with an ADD-verbatim wandering-jitter angle, hold fire. In cover (`!canSee`): advance at `0.40×`, lob every `lobEvery(2.5s)` within `lobRange(9t)`. The lob is minted via a registered `registerLobberFire` seam (same register-callback shape as the Spider web/Shooter arrow, R6 — `enemies-ai.js` never imports `G.ebolts`) filled in `enemies.js`: pushes a `kind:"arc"` entry into `G.ebolts` (NOT a `Shot`/`G.shots` — E1) with `owner:"enemy"`, landing at the player's fire-time position **perturbed by a uniform-disc random offset within `G.ramp.lobberErrorRadius`** (net-new vs ADD's exact-target `fireEnemyArc` — sampled via `angle=rand·2π, radius=√rand·errR` for uniform area coverage, not center-biased). `updateEbolts` (`enemies.js`, replacing the Phase-3 no-op hook in step 7) is ADD `updateArc` ported near-verbatim: interpolates ground pos launch→landing over `dur(airtime 1.0s)`, parabolic `height` for the renderer, wall-agnostic in flight (never collides in transit); at `t≥dur` splats + AoE-tests the player ONLY at `blast(1.25t)+player.r` → `applyDamageToPlayer(2,"enemy-lob")` + the registered `detonateBarrelsInRadius` seam, then removes the entry. Self-contained in step 7 (not moved by `player.js`'s `updateShots` — arced ordnance is a distinct timed kind from a `Shot`, E1), so no cross-file frame-ordering assumption applies to it, unlike the straight-shot passes. `test-enemies-lobber.js` (15) green; suite **567 total**. Roster still owed: the Reaper and spawners.)
**State in one line:** **Subsystems #1 (Level loader + generator), #2 (Player,
incl. crates §7.1), #3 (Pathfinding), #4 (Enemies + spawners), #5 (Abilities
— gem economy + Nova + Lightning), and #6 (Barrels + shrapnel §7.2 — entity/
ladder/carry/kick/roll/detonation/shrapnel/chains) are BUILT and tested
headlessly.**
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
- [x] §7 Interactive objects — **crates (§7.1) BUILT** (carry physics in `player.js`,
  crate-always ricochet in `projectiles.js`); **barrels (§7.2) + shrapnel (§7.2.4) —
  SPEC-BARRELS COMPLETE (Phases 1–4):** `CFG.BARREL` block in `config.js` (§2.3);
  `enemies.js` exports `sweepDeadSpawners` alias (B9) + the Wraith/Lobber
  `detonateBarrelsInRadius` call sites pass a 5th `damage` arg (B10). `src/barrels.js`
  (Phase 2): decorates the loader's `barrel` placeholder (`hp`/`r`/`vx`/`vy`/`rolling`/
  `_cause` + a `G.lights` emitter); `fireStateOf`/`lightRadiusOf` (pure fns of hp, §2.5);
  `damageBarrel` (§3.1, the single intake sink; hp≤0 is a marked Phase-4 TODO, no
  splice/shrapnel yet); the real `detonateBarrelsInRadius(x,y,radius,cause,damage=LETHAL)`
  **filled into both `enemies.js` and `abilities.js`** (B10); `shotsVsBarrels()` (B4);
  `initBarrels()` (lazy-inits `G.shrapnel`). **Phase 3:** `player.js` carry-FSM branches
  (B5/B6 — barrel pickup [crate-first], no wall-vault, `releaseBarrel` KICK-moving /
  PLACE-stationary, `carriedBarrel()` + `notifyCarriedBarrelDestroyed()`, `dropCarried`
  barrel branch); `enemies.js` `meleeExchange` carried-barrel chip (B5) via the new
  `registerBarrelDamage` seam; `barrels.js` `kickBarrel` + `updateBarrels(dt)` roll
  integrator (the 2nd sanctioned `moveBody` exception, ADD `slideStep` reflect model,
  B3) + the `registerBarrelKick` fill into `player.js`. **Phase 4 (detonation +
  shrapnel + chains, B7–B9):** `barrels.js` `resolveDetonations()` (collect-then-
  resolve in `updateBarrels`, never mid-iteration) + `detonateBarrel` (owner derive,
  `spawnShrapnel`, `barrel:exploded` FX emit, `dropBarrelLight`, markNavDirty+splice
  OR detonate-in-hand via `notifyCarriedBarrelDestroyed`) + `updateShrapnel(dt)` (the
  §7.2.4 species in `G.shrapnel`: free wall/crate bounce + crate push, −1 health per
  damaging hit vs enemy/player/barrel/spawner, chain adoption, sweeps) + `chain:reaction`
  callout. `damageBarrel` hp≤0 now only marks (no splice/shrapnel there). **Barrels
  subsystem COMPLETE.** Downstream (NOT barrels scope): boot `import "./barrels.js"` +
  wiring `updateBarrels`/`updateShrapnel`/`shotsVsBarrels` into the main loop; #7
  fire/light render; #10 `barrel:exploded`/`chain:reaction` FX; SPEC-SCORING inherits
  the attribution tags.
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
  knockback (§6.6), enemy-shot→player (§6.4), Ghost factory (§6.1.1). Tests:
  `test-enemies-combat.js` (66, green). **Phase 4 (direct-steer roster) BUILT**
  — Skeleton/Spider/Bat added to `enemies-ai.js` (updaters) + `enemies.js`
  (factories, dispatch table). Skeleton (§6.1.2): direct steer + a sticky
  ±90° wall-slide corner probe (see decision log — 1.0s commit, tuned up from
  the original single-frame nudge which oscillated at concave corners). Spider
  (§6.1.6): burst(1.5×)/pause FSM + blocked→retreat + LOS-gated web
  (`makeShot` owner:"enemy", dmg 0, effect:"entangle"); **has no base speed**
  (a design decision surfaced and resolved this phase — see decision log).
  Bat (§6.1.5, R8): SNAPSHOT→FLY→PAUSE, FLY is a **raw position add, never
  `moveBody`** (flies through walls by design). Shared blocked-ε (Q4, 10% of
  intended step) factored out as `isBlocked` in `enemies-ai.js`, used by both
  Skeleton and Spider. Tests: `test-enemies-steer.js` (24, green). **Phase 5
  (GROUND A\* roster) BUILT** — Skeleton Shooter (§6.1.3) and Zombie (§6.1.7)
  added to `enemies-ai.js` (`updateSkeletonShooter`/`updateZombie`) +
  `enemies.js` (`makeSkeletonShooter`/`makeZombie` factories, dispatch). Zombie
  is the minimal A\* consumer: `addNavigator`(GROUND)+`steerNavigator`, no FSM.
  Skeleton Shooter is FSM WANDER (ambient roam via `world.randomFloorTile`,
  throttled LOS-acquire)→HUNT (full GROUND A\*, `awareDecay` 8s, stationary
  halt→windup(0.4s)→fire→cooldown(1.5s) shoot sequence gated on
  `G.ramp.shooterStopToShoot`); arrow fire routed through a registered
  `registerShooterFire` seam (mirrors the Spider's web seam — `enemies-ai.js`
  still never imports `projectiles.js`, R6). **Fixed a real gap found this
  phase:** `deathSweep` never called `removeNavigator`, leaking A\*-registered
  navigators on death — now calls it when `e.nav` exists (see decision log).
  Tests: `test-enemies-ground.js` (15, green). **Phase 6 (Fire Wraith + barrel
  seam) BUILT** — `updateFireWraith` (§6.1.8) added to `enemies-ai.js`: FSM
  `APPROACH` (full GROUND A\*, `0.50×`) → `FLASH` (within `armDist` 1.5t;
  continues steering at `flashMul` 0.5× via a temporary `e.speed` scale/restore
  around one `steerNavigator` call) → sets a sticky `e.wraith.explode` flag
  when `flashDur`(0.8s) completes (it does NOT resolve the AoE itself — R2/E11
  keeps that in `enemies.js`, one layer down). `enemies.js` adds `fireWraithAI`
  (the step-6 dispatch entry: runs the updater, queues any newly-flagged
  explosions) + `explodeFireWraith` (resolved AFTER the whole step-6 AI loop,
  still before step 7): `explodeDmg`(4) to the player and every OTHER enemy in
  `explodeRadius`(2t) — friendly-fire deaths tagged `"wraith-aoe"` (0 score via
  the existing `awardKill` gate, gems still drop, Q3), the Wraith itself tagged
  to die in its own blast, the new `registerBarrelDetonation` seam called,
  crates untouched (the AoE never reads `G.crates`) — then ONE extra
  `deathSweep()` call resolves every resulting death through the existing
  gem/awardKill/emit/nav/light cleanup path (no duplicated death-handling
  code). **R2 defuse is structural, not new code:** a Wraith shot down
  mid-FLASH is removed by the ordinary step-5 sweep and `fireWraithAI` simply
  never runs for it that frame — the existing 7-step order already guarantees
  this. **Barrel-detonation seam:** `registerBarrelDetonation(fn)` in
  `enemies.js`, no-op default, mirrors the loader's sink pattern (barrels are
  SPEC-BARRELS, post-#4). **Light-emitter seam (§8.4):** `makeFireWraith`
  pushes `{source: e, radius: glowRadius×TILE}` into `G.lights` (the loader's
  previously-unused registry array); `deathSweep`'s new `removeLight(e)`
  (matched by `source ===`) cleans it up on death; `source` is a live entity
  reference so #7 reads the current position every frame, no re-sync needed.
  Tests: `test-enemies-wraith.js` (16, green). **Phase 7 (Lobber + arced
  ordnance) BUILT** — `updateLobber` (§6.1.4) added to `enemies-ai.js`: a
  direct port of ADD's `updateSorter` two-branch cover-seek FSM (exposed→flee
  with jitter+hold-fire; in-cover→advance+lob-on-cd), throttled LOS
  (`losCheckEvery` 0.12s). **Deliberately NOT registered with the Phase-2 nav
  layer** — cover-seek is `moveBody`+`groundBlockerFilter` only, no
  `addNavigator`/`steerNavigator` call anywhere in `updateLobber` (it is not
  one of the four A* classes). The lob is minted through a new
  `registerLobberFire` seam (same shape as the Spider web/Shooter arrow
  seams) filled in `enemies.js`: pushes a `kind:"arc"` `G.ebolts` entry
  (**not** a `Shot` — E1 keeps arced ordnance a distinct timed kind from
  `G.shots`) landing at the player's fire-time position perturbed by a
  uniform-disc random offset within `G.ramp.lobberErrorRadius` (the net-new
  accuracy-error mechanic vs ADD's exact-target `fireEnemyArc`, §12
  provenance). `enemies.js`'s `updateEbolts` (step 7, replacing the Phase-3
  no-op hook) is ADD `updateArc` ported near-verbatim: launch→landing
  interpolation over `dur`, wall-agnostic in flight, AoE vs the player ONLY
  at `blast+player.r` on landing, `applyDamageToPlayer(2,"enemy-lob")` + the
  `detonateBarrelsInRadius` seam. Tests: `test-enemies-lobber.js` (15,
  green). **Phase 8 (The Reaper) BUILT** — `updateReaper` (§6.1.9) added to
  `enemies-ai.js`: registers as a `NAV_MASK.PHANTOM` navigator with a **bespoke
  phantom mover** (`phantomMover` + `reaperBlockerFilter`, both exported) — the
  ONLY navigator not using `world.moveBody`, checking `bodyHitsBlocker`
  (crates+barrels only) and never `bodyHitsWall` (R4/§0.1, documented exception;
  `world.js` untouched). Rides the Phase-2 scheduler/steer machinery (PHANTOM
  waypoints cross walls). Summon on `G.ramp.reaperSummonInterval` + dark-blast
  every 9 s fixed via the `registerReaperSummon`/`registerReaperBlast` seams (R6)
  filled in `enemies.js` (pick 2 Ghosts/1 Skeleton tagged
  `originSpawner=reaper.id`, cap 6 via a scan counting emergence-window children
  [E4/R5]; blast = enemy `makeShot` dmg 3 / maxTravel 448 px [R7 dial] riding
  `updateShots`). `makeReaper` factory (overrides the loader's inert placeholder)
  sets `e.id`, `e.boss`, `e.resist` (the E9 flags for #5). `deathSweep` emits
  `boss:killed` FX (screen-shake/hit-stop, keyed on `e.boss`);
  `integrateEnemyKnockback` gained a `nav==="phantom"` branch (Reaper knockback
  uses `phantomMover`, not `groundMover`). Tests: `test-enemies-reaper.js` (24,
  green). **Phase 9 (Spawners) BUILT — roster + subsystem COMPLETE.**
  `makeSpawner` (`enemies.js`) **decorates** the loader's existing spawner
  placeholder via a new `getEntityFactory` accessor (`level-loader.js`) rather
  than re-deriving the Plan-filtered `table`/ramped `interval`/`liveCap`
  eligibility logic a second time; adds `hp`(6)/`points`(300)/`gems`(3)/`r`(16)
  from `CFG.ENEMY.spawner`, a stable `id` (E4 tag source), and `emitT` seeded
  at `firstDelay`(2.0s). `spawnerTick` (new step 1 of `tickEnemies`, replacing
  the Phase-3 no-op) emits via `weightedPick` over the spawner's own
  Plan-filtered `table`, minted through a `factoryByType` lookup over the 8
  loose-element factories, tagged `originSpawner`, emerging through the shared
  0.5s `spawn>0` gate. Live-cap is a **scan** of `G.enemies` for the matching
  tag at the emit decision (no mutable counter, E4) with **no `spawn` filter**
  on the scan — emergence-window children count toward the cap by construction
  (R5). **Spawner-as-target (§0.4):** `playerShotEnemyPass`/`meleeExchange`
  (steps 3/4) now also test `G.spawners` (bullet + melee damage; no
  melee-to-player, no crate-bumper knockback — spawners are immobile); a new
  `spawnerDeathSweep` (step 5, after `deathSweep`) drops gems/`awardKill`/emits
  `enemy:killed`+calls `markNavDirty` on the vacated tile. Barrel/shrapnel
  destruction of spawners stays out of scope (SPEC-BARRELS). Tests:
  `test-enemies-spawner.js` (28, green).
- [x] §5 Abilities — **BUILT (subsystem #5 COMPLETE).** Nova, Lightning, gem
  economy all done. **Phase 1 (enabling edits)
  done** — the four surgical ENABLING seams from SPEC-ABILITIES §1/§2.3 landed
  (no `abilities.js` yet): (1) `config.js` gained the `CFG.ABILITY` block (§2.3 —
  `nova{}` 10 dials + `lightning{}` 4 dials, data-only, leaf preserved); (2)
  `enemies.js` exports its private `deathSweep` under the public alias
  `sweepDeadEnemies` (A1 — one alias line, body/callers untouched) so #5's
  Nova/Lightning AoE kills route through the ONE shared drop/score/emit/cleanup
  sweep instead of a bespoke splice; (3) `player.js` gained
  `applyStun(seconds)` (A7 — the missing STUNNED producer, `p.stun =
  Math.max(p.stun, seconds)`, extends-not-shortens, no iframe/loco gate, no new
  imports) — Lightning's self-stun sink; (4) `level-loader.js` clears `G.novas =
  []` in the transient-clear line (A9 — Nova rings are a per-level transient;
  `abilities.js` will also lazy-init `G.novas ||= []`). Tests:
  `test-abilities-seams.js` (29, green). **Phase 2 (`abilities.js` foundation)
  done** — new `src/abilities.js`: `addGemEnergy` gem economy (A6/§3),
  module-local `novaCd`/`lightningCd` + `updateAbilities(dt)` cooldown tick (Nova
  ring pass is a Phase-4 TODO), `initAbilities()` reset, the `getCooldowns()`
  read-only accessor, the A8 `registerBarrelDetonation` seam (no-op default), and
  `onNova`/`onLightning` NO-OP stubs registered at load via `registerAbility`.
  Import graph one-way (config/state + `emit`/`registerAbility`+`applyStun`/
  `sweepDeadEnemies`, none import back). Tests: `test-abilities.js` (18, green).
  **Phase 3 (Lightning cast) done** — `abilities.js` `onLightning` body filled
  (§5.1, instantaneous): cooldown gate → radius wipe over `G.enemies` (squared-
  distance edge test `≤ R + e.r`, `R`=5 t=160 px; branch on the `e.resist?.
  lightning` MARKER — A2, not boss/type — resisted chips `reaperDamage`(5) &
  survives uncounted, else `hp=0`/`_cause="player-lightning"`/`killCount++`) →
  `sweepDeadEnemies()` **once** after the whole pass (A1, no per-hit splice) →
  `detonateBarrelsInRadius(px,py,R,"player-lightning")` (A8 seam, no-op) →
  `applyStun(3)` (A7) → `lightningCd=10` → `emit("ability:cast",{kind:"lightning",
  killCount})` (OQ-A1 snapshot, `killCount`=destroys only). Consumes **no** gem
  energy; spawners/crates immune by construction (never referenced). `onNova`
  still a NO-OP stub (owed P4). Net-new `export { onLightning as __onLightning }`
  test affordance (house `__` convention; player still casts only via the
  `registerAbility` registry). Tests: `test-abilities-lightning.js` (22, green).
  **Phase 4 (Nova cast + ring pass) done — subsystem #5 COMPLETE** —
  `abilities.js` `onNova` (§4.1) filled: cooldown gate → fuel branch (A5:
  charge → `health=ringMaxHp`(50)/bar untouched; else `gemEnergy≥minBarToFire`
  (25) → `health=ringMaxHp×gemEnergy/barCap` **float**/`gemEnergy=0`; else
  rejected no-op — no ring/cooldown/spend) → push a ring (frozen player centre,
  `r=prevR=0`, empty `hit` Set, `kills=0`) → `novaCd=cooldown`(0.5); **no emit at
  cast**. The Nova ring pass in `updateAbilities` (§4.2) replaces the Phase-2
  TODO: reverse-iterate `G.novas`; per ring `prevR=r`, `r+=384px·dt`; enemy pass
  over the **swept band** `prevR<dist≤r` (centre-to-centre, **no `e.r`** — the
  A3 geometry differs from Lightning's edge test), nearest-first (A4),
  `resist.nova`→10 dmg/ring −20/survives else destroy (`hp=0`,`_cause=
  "player-nova"`,`kills++`,ring −victim-HP), **break after the fatal victim once
  `health≤0`**; free projectile erase (A10 — enemy shots + all ebolts in-band,
  player shots kept, runs on the dying frame); dissipate at `health≤0` OR
  `r≥radiusCap`(448) → `emit("ability:cast",{kind:"nova",killCount:ring.kills})`
  (destroys only). One `sweepDeadEnemies()` after all rings (A1). Immunity by
  OMISSION (never references `G.spawners`/`G.crates`/`G.barrels`). Net-new
  `export { onNova as __onNova }`. Tests: `test-abilities-nova.js` (54, green).
  Still owed downstream (NOT #5 scope): SPEC-BARRELS fill of
  `registerBarrelDetonation` into **BOTH** `enemies.js` **and** `abilities.js`;
  the boot `import "./abilities.js"` so `registerAbility`/`registerBarrelDetonation`
  run before frame 1; and wiring `initAbilities()`/`updateAbilities(dt)` into the
  main loop (integration phase).
- [ ] §3 Power-ups & pickups — **Phase 1 (enabling edits) done** — `CFG.PICKUP`
  (grab/gemDespawn/powerupShots/magnet dials)/`CFG.FOOD`/`CFG.TREASURE` added to
  `config.js` (additive; `CFG.GEM.energy` reused unchanged); `level-loader.js`
  `clearTransient` gained `G.magnet = 0;` beside `G.novas` (OQ-P1, transient
  reset; `G.pickupTimer` untouched, D10). `test-config.js` +12 asserts, green.
  No `pickups.js` yet (Phase 2+): decoration factories, `updatePickups(dt)`,
  `pickup:collected` emit all still owed, per SPEC-PICKUPS.
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
w.r.t. gameplay). `enemies-ai.js` (nav consumer layer + full roster of steerers:
registry + repath scheduler + round-robin budget + dirty gate + waypoint
steering + direct-steer fallback + `updateGhost`/`updateSkeleton`/
`updateSpider`/`updateBat`/`updateZombie`/`updateSkeletonShooter`/
`updateFireWraith`/`updateLobber`/`updateReaper` + the shared blocked-ε
`isBlocked` helper + the bespoke `phantomMover`/`reaperBlockerFilter` (R4) +
`registerSpiderWebFire`/`registerShooterFire`/`registerLobberFire`/
`registerReaperSummon`/`registerReaperBlast` seams;
imports config/state/world/nav only, sole consumer of `consumeDirtyTiles`
[R1], never imported back [R6]; `updateLobber` is cover-seek only — it never
calls `addNavigator`/`steerNavigator`, so it stays outside the A*-registry
roster despite living in this file; `updateReaper` IS an A*-registry navigator
but supplies `phantomMover` as its mover — the sole navigator not using
`world.moveBody`). `enemies.js` (the combat spine + roster
factories: 7-step `tickEnemies` + player-shot/melee/death-sweep/`awardKill`/
knockback/enemy-shot passes + `makeGhost`/`makeSkeleton`/`makeSpider`/
`makeBat`/`makeZombie`/`makeSkeletonShooter`/`makeFireWraith`/`makeLobber`/
`makeReaper`/`makeSpawner`
factories + the Spider web-fire, Shooter arrow-fire, and
`fireWraithAI`/`explodeFireWraith` EXPLODE-resolution callbacks + the Lobber
lob-fire seam (mints a `G.ebolts` `kind:"arc"` entry, error-radius perturbed) +
the Reaper summon/blast seams (mint tagged minions capped at 6 / an enemy
`makeShot` dark-blast) + `spawnerTick`/`spawnerEmit`/`weightedPick`/
`factoryByType`/`spawnerDeathSweep` (Phase 9) (imports `projectiles.js`
`makeShot`); `updateEbolts`
(step 7) is the ADD
`updateArc` port — launch→landing interpolation, wall-agnostic flight,
player-only AoE on landing + barrel seam; `deathSweep` now calls
`removeNavigator` for any `e.nav`-bearing enemy (Phase 5 fix) AND
`removeLight` for any light-registered enemy (Phase 6, Wraith) AND emits
`boss:killed` FX for `e.boss` (Phase 8, Reaper); `integrateEnemyKnockback` routes
`nav==="phantom"` knockback through `phantomMover` (Phase 8);
`playerShotEnemyPass`/`meleeExchange` also test `G.spawners` (Phase 9, §0.4);
`meleeExchange` also chips a `carriedBarrel()` 1 HP via the `registerBarrelDamage`
seam (SPEC-BARRELS Phase 3, B5); the `registerBarrelDetonation` +
`registerBarrelDamage` seams are both **filled by `barrels.js` at load** (were
no-op defaults); imports config/state/world/player-sinks (+`carriedBarrel`)/
level-loader/projectiles/enemies-ai, never imported back [R6]). `level-loader.js` gained `getEntityFactory(type)` (Phase
9) — a read-back accessor so a later subsystem's factory can DECORATE the
current registration instead of re-deriving its logic (used by `makeSpawner`
to reuse the placeholder's eligibility-filtered `table`/ramped
`interval`/`liveCap` computation). `abilities.js` (**SPEC-ABILITIES #5,
COMPLETE**: `addGemEnergy` gem economy [A6/§3], module-local `novaCd`/
`lightningCd` + `updateAbilities(dt)` [cooldown tick + the **Nova ring pass**,
§4.2 — swept-band enemy hits/A3/A4/A2, free projectile erase/A10, dissipation
emit, one `sweepDeadEnemies()`; reverse-iterates `G.novas`], `initAbilities`,
read-only `getCooldowns()`, the A8 `registerBarrelDetonation` no-op seam;
`onLightning` FILLED [§5.1 instantaneous radius wipe: cooldown gate →
`resist?.lightning`-marker branch → `sweepDeadEnemies()` once → barrel seam →
`applyStun(3)` → `lightningCd=10` → `ability:cast` snapshot emit,
`killCount`=destroys only; costs no gem energy]; `onNova` FILLED [§4.1: cooldown
gate → fuel branch A5 → push ring at frozen player centre → `novaCd=cooldown`; no
emit at cast]; both registered at load via `registerAbility` + both exported as
`__onNova`/`__onLightning` for headless tests; Nova immunity is by OMISSION
[never references `G.spawners`/`G.crates`/`G.barrels`]; imports config/state +
one-way `emit`/`registerAbility`+`applyStun`/`sweepDeadEnemies`, never imported
back). `barrels.js` (**SPEC-BARRELS #6, COMPLETE (Phases 2–4)**: barrel entity
decoration [`getEntityFactory("barrel")` decorate-pattern], `fireStateOf`/
`lightRadiusOf` [pure fns of hp], `damageBarrel` [the single intake sink; hp≤0
now only marks — detonation resolved by `updateBarrels`], the real
`detonateBarrelsInRadius` [filled into BOTH `enemies.js`'s and `abilities.js`'s
`registerBarrelDetonation`], `shotsVsBarrels` [self-contained shot-consume pass],
`initBarrels`; **Phase 3:** `kickBarrel`
[re-insert + roll velocity, registered into `player.js` via `registerBarrelKick`]
+ `updateBarrels(dt)` [the bespoke roll integrator — the **2nd sanctioned
`moveBody` exception** after `phantomMover`: ADD `slideStep` reflect model,
`barrelHitsSolid` = `isWall` ∪ `bodyHitsBlocker(e=>e!==self)` bounce set, settle
`<stopSpeed`, rolling-impact enemy −1/barrel −1/−40% via `damageBarrel
"player-kick"` + ONE `sweepDeadEnemies`] + `damageBarrel` registered into
`enemies.js`'s `registerBarrelDamage` seam [the carried-barrel melee chip];
**Phase 4:** `resolveDetonations` [collect-then-resolve wave at `updateBarrels`
tail, never mid-iteration] + `detonateBarrel` [owner derive from `_cause`,
`spawnShrapnel`, `barrel:exploded` FX emit, `dropBarrelLight`, markNavDirty+splice
OR detonate-in-hand via `notifyCarriedBarrelDestroyed`] + `updateShrapnel(dt)` [the
§7.2.4 species in `G.shrapnel`: `slideShrapnel` free wall/crate bounce + crate
push, −1 health per damaging hit vs enemy/player/barrel/spawner w/ chain adoption,
sweeps] + `chain:reaction` callout; shrapnel `r` = `CFG.SHOT.r` [no §2.3 dial];
imports config/state/world/level-loader/`enemies.js`'s `sweepDeadEnemies`+
`sweepDeadSpawners`+`registerBarrelDamage`/`abilities.js`'s
`registerBarrelDetonation`/`player.js`'s `registerBarrelKick`+`applyDamageToPlayer`+
`carriedBarrel`+`notifyCarriedBarrelDestroyed` [the sanctioned barrels→player
edge], never imported back [R6]).
Tests:
`test-config.js` (19), `test-enemies-config.js` (18), `test-world.js` (35),
`test-level-loader.js` (40), `test-level-content.js` (79),
`test-level-generator.js` (20), `test-level-integration.js` (16),
`test-input.js` (19), `test-player.js` (108), `test-projectiles.js` (17),
`test-nav.js` (36), `test-enemies-nav.js` (24), `test-enemies-combat.js` (66),
`test-enemies-steer.js` (24), `test-enemies-ground.js` (15),
`test-enemies-wraith.js` (16), `test-enemies-lobber.js` (15),
`test-enemies-reaper.js` (24), `test-enemies-spawner.js` (28),
`test-abilities-seams.js` (29), `test-abilities.js` (18),
`test-abilities-lightning.js` (22), `test-abilities-nova.js` (54),
`test-barrels-seams.js` (40), `test-barrels.js` (44),
`test-barrels-carry.js` (61), `test-barrels-detonate.js` (47),
`test-barrels-shrapnel.js` (35) —
all green (**969 checks total**). Subsystems #1, #2, #3, #4 (Enemies +
spawners), #5 (Abilities), and #6 (Barrels) are all COMPLETE: nav consumer
layer, combat spine, all 9 roster types (Ghost/Skeleton/Spider/Bat/Zombie/
Skeleton Shooter/Fire Wraith/Lobber/Reaper), spawners (emission +
spawner-as-target), the gem economy + Nova + Lightning abilities, and the barrel
subsystem (entity/ladder/carry/kick/roll/detonation/shrapnel/chains) — all built
and tested headlessly. SPEC-BARRELS (#6) COMPLETE: Phase 1 (enabling edits) +
Phase 2 (`barrels.js` entity/ladder/damage-intake/seam-fill) + Phase 3 (carry/
kick + roll physics) + Phase 4 (detonation resolution / shrapnel species / chain
reactions) all done.

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

### 2026-07-05 — Direct-steer roster (Skeleton/Spider/Bat) — Phase 4 (SPEC-ENEMIES)
Three non-A* roster members added as per-type updaters in `enemies-ai.js` +
factories in `enemies.js` (§6.1.2, §6.1.5, §6.1.6, R8), riding the Phase-3
spine unchanged (added to `aiByType`). Load-bearing decisions:

- **Shared blocked-ε factored out (Q4).** `isBlocked(movedDist, intendedDist)`
  in `enemies-ai.js` is the one shared "≈ zero net progress despite intent"
  test used by both Skeleton (wall-slide) and Spider (retreat-trigger):
  `moved < intended × 0.10` (the prompt's proposed 10%, adopted as the tuned
  value — no counter-evidence surfaced during testing).
- **Skeleton (§6.1.2) — the ±90° probe needed a STICKY commit, not a
  single-frame nudge (found empirically, not spec-flagged).** A naive
  "probe once, nudge once" implementation stalls in a stable micro-oscillation
  at a convex corner: the direct-steer term pulls the enemy back toward the
  blocked position every frame it's not yet fully clear, exactly cancelling
  the prior frame's perpendicular nudge. Fixed by making the chosen lean side
  **sticky for 1.0 s** (`LEAN_STICKY_S`, `e.skeleton.{leanX,leanY,leanT}`,
  blended 45° with the direct vector, re-armed to the full duration on every
  fresh `isBlocked` hit) so the corner-round commits long enough to actually
  clear the corner before direct-steer regains full authority. Verified with a
  synthetic convex-corner map (`test-enemies-steer.js`) — 0.25s/0.35s sticky
  windows both still stalled; 1.0s clears it. This duration is Q4-adjacent
  tuning (not spec-given), flagged here for a play-feel sign-off glance.
  Deep concave pockets (both probe sides blocked) still wedge by design — the
  lean clears to zero and the direct term alone can't escape either.
- **Spider (§6.1.6) — SURFACED AND RESOLVED DESIGN GAP: no base speed.**
  Phase 3 (`config.js`/`test-enemies-config.js`) already established that
  `CFG.ENEMY.spider` has **no `speedMul`** field, on the reading that its
  speed is "fully described by the burst/pause FSM" — but neither the GDD nor
  SPEC-ENEMIES ever states what the FSM's `burstMul: 1.5` multiplies (GDD
  §6.1's speed-table column for Spider literally reads "1.5 burst / pause",
  the multiplier with no base named). This blocks any concrete `updateSpider`
  movement number, so per CLAUDE.md ("stop and surface, don't invent") this
  was raised to the user rather than guessed. **Resolved:** BURST moves at
  `burstMul(1.5) × CFG.PLAYER.speed` (168 px/s); **PAUSE is stationary** (0
  px/s — a full halt, not a slow crawl). RETREAT (triggered by a blocked BURST
  tick only — PAUSE never moves, so PAUSE can never trigger a retreat) uses
  the same `burstMul × CFG.PLAYER.speed` value, moving away from the player.
  `CFG.ENEMY.spider` still has no `speedMul` — `updateSpider` computes this
  number itself from `burstMul` and never reads `e.speed`; `enemies.js`'s
  shared `makeEnemy` factory now guards `cfg.speedMul != null` (was an
  unguarded multiply that would have produced `NaN` for the Spider's `e.speed`
  — dead data since nothing reads it, but corrected for sanity/future-proofing).
- **Bat (§6.1.5, R8) — raw integrate, never `moveBody`.** FLY is a straight
  position add toward the SNAPSHOT point at `speedMul(1.15) × CFG.PLAYER.speed`
  (effective, baked once at spawn like every other mover, E10) — deliberately
  never routed through `moveBody`/`groundBlockerFilter`, so it passes through
  walls/crates/barrels/spawners/enemies by design. Landing snaps exactly onto
  the recorded point (overshoot-guarded: if the frame's step would pass the
  target, jump to it exactly) rather than a fixed frame-count so it works at
  any `dt`/distance. PAUSE duration is drawn fresh from
  `[G.ramp.batPauseMin, batPauseMax]` each cycle (`Math.random`, not
  deterministic — matches the "hover" flavor; no test depends on a fixed seed).
- **Spider web-fire routed through a registered callback, not a direct
  import.** `enemies-ai.js` stays config/state/world/nav-only (never imports
  `projectiles.js` or reaches `G.shots` itself) — `updateSpider` calls a
  `spiderWebFire(e, ux, uy)` seam (`registerSpiderWebFire`, default no-op)
  that `enemies.js` fills at module-load time with the real `makeShot`/
  `G.shots.push`. This keeps the nav/steer layer's import set exactly as
  documented in its own file-header R6 comment; `enemies.js` already imports
  `player.js` sinks and now additionally imports `projectiles.js`'s `makeShot`
  (a new but R6-sanctioned edge — `enemies.js`'s own header already lists
  `projectiles.js` `makeShot` as an allowed import).
- **Test seam note:** `test-enemies-steer.js` (24 checks) exercises the real
  `enemies-ai.js`/`enemies.js` modules end-to-end (factories → updaters), no
  inlined copies. Covers: Skeleton rounding a convex corner + wedging in a
  deep concave pocket; Spider's burst(0.5s)/pause(0.6s) cadence, blocked→
  retreat(1.5s)-away, and web-hit → `applyEntangle(2.5)` at 0 dmg; Bat's
  SNAPSHOT-records-then-FLY-reaches-the-recorded-point-despite-player-movement,
  a mid-flight wall pass-through, and PAUSE duration bounds.

### 2026-07-05 — GROUND A* roster (Skeleton Shooter, Zombie) — Phase 5 (SPEC-ENEMIES)
The first two roster members that actually **register with and drive** the
Phase-2 nav consumer layer (`addNavigator(NAV_MASK.GROUND, groundMover)` +
`steerNavigator`), added as per-type updaters in `enemies-ai.js` + factories in
`enemies.js` (§6.1.3, §6.1.7), dispatched via `aiByType` unchanged. Load-bearing
decisions:

- **Zombie (§6.1.7) is the minimal proof-of-life for a real A\* consumer.**
  `updateZombie` lazily registers the entity on first call, then does nothing
  but `steerNavigator(e, player, dt)` — no FSM, no ranged attack; the melee/
  death/gems/score it needs are already the Phase-3 spine's job. This is
  deliberately the smallest possible body to prove the scheduler drives a live
  entity end-to-end (repath scheduling, round-robin budget, waypoint-follow,
  and the direct-steer fallback are all exercised by `test-enemies-ground.js`
  with the real `enemies-ai.js`/`enemies.js`, not synthetic navigators as in
  `test-enemies-nav.js`).
- **Skeleton Shooter (§6.1.3) FSM WANDER→HUNT, registered as a GROUND
  navigator in BOTH states** — WANDER's "occasionally pick a random reachable
  waypoint" (proposed policy, per the phase prompt's own Q6 flag) is
  implemented by handing `steerNavigator` a wander goal (`world.randomFloorTile`,
  re-picked every `WANDER_PICK_EVERY` 3.0s, a proposed ambient-roam pace — not
  spec-given, flagged here) instead of the player, so WANDER rides the exact
  same repath/waypoint/direct-steer machinery as HUNT rather than a separate
  ad hoc roam routine. Throttled LOS test (`LOS_CHECK_EVERY` 0.12s, the ADD
  convention already reused by the Lobber/Spider dials) gates the WANDER→HUNT
  transition; HUNT's independent throttled check both re-acquires (refreshing
  `awareT = awareDecay`) and lets `awareT` run down to 0 → revert to WANDER,
  clearing the wander goal so a fresh one is picked next tick.
- **Shoot sequence is STATIONARY THROUGHOUT by construction, not by a guard.**
  `updateSkeletonShooter` returns immediately (before any steering code) the
  entire time `shooter.shootPhase != null` (windup → cooldown) — there is no
  separate "don't move while shooting" branch to get wrong; the movement code
  is simply unreachable during the sequence. `windup`(0.4s) → mint the arrow
  (aimed at the player's position at fire time, per spec) → `cooldown`(1.5s) →
  clear back to null. The stop-to-shoot **roll** happens once per LOS-throttle
  tick (not every frame — "each decision tick" read as the throttle cadence,
  matching the Lobber's already-established `losCheckEvery`-gated decision
  pattern) using `G.ramp.shooterStopToShoot`.
- **Arrow fire is a registered seam, not a direct `projectiles.js` import**
  (`registerShooterFire`, same shape as the Spider's `registerSpiderWebFire`)
  — keeps `enemies-ai.js`'s import set exactly config/state/world/nav (R6,
  grep-verified in `test-enemies-nav.js`, still green). `enemies.js` fills it
  with `makeShot({owner:"enemy", dmg:2, speed 256, maxTravel 192,
  effect:"damage"})`, matching the spec's numbers exactly (`arrow.speedMul =
  8/3.5` × `CFG.PLAYER.speed(112)` = 256; `arrow.range(6)` × `CFG.TILE(32)` =
  192 — verified arithmetically, not just visually).
- **FOUND AND FIXED (not new design, a real gap): `deathSweep` never called
  `removeNavigator`.** Every enemy that dies was spliced out of `G.enemies`
  but, if it had been `addNavigator`-registered, stayed forever in
  `enemies-ai.js`'s `navList`/`recByEntity` — a slow leak (the round-robin
  budget would keep servicing dead entries) that simply had no A\*-registered
  enemy to expose it until this phase. Fixed with one line in `enemies.js`'s
  `deathSweep`: `if (e.nav) removeNavigator(e);` before the splice. This also
  silently pre-fixes the same hazard for the Fire Wraith/Reaper (both
  A\*-registered) before they're built. Flagged per CLAUDE.md "phases flag
  their own risks" — this was an unflagged cross-phase gap, not a Phase-5
  design decision.
- **Test seam note:** `test-enemies-ground.js` (15 checks) drives
  `scheduleRepaths` + the per-type updater together every frame (mirroring the
  real `tickEnemies` step-2-then-step-6 split), never just the updater alone —
  an early draft that called only `updateZombie`/`updateSkeletonShooter` per
  frame produced a permanent `null` path (repathing is the scheduler's job,
  steering is the updater's), which is exactly the bug class the real spine's
  ordering contract (E11) exists to prevent. Covers: WANDER→HUNT on LOS
  acquire; the full windup(0.4)→fire→cooldown(1.5) sequence with a
  stationary-throughout assertion and an exact arrow-shape check; awareDecay
  (8s) reversion to WANDER (using a sealed-off player so HUNT's own chase
  can't accidentally re-acquire LOS and reset the timer — an early draft's
  open-room setup did exactly that, invalidating the test); Zombie corridor
  advance, barricade re-route via `markNavDirty`, and `findPath→null` direct-
  steer degrade on a fully boxed goal.

### 2026-07-05 — Fire Wraith (walking bomb) + barrel-detonation/light seams — Phase 6 (SPEC-ENEMIES)
The Fire Wraith (§6.1.8) is the third GROUND A* roster member, and the first
whose AI-tick action (EXPLODE) must itself resolve combat (damage/death) —
every earlier A* type (Zombie, Skeleton Shooter) only moves or fires a shot in
step 6, leaving damage resolution to the shot-hit passes. Load-bearing
decisions:
- **The updater only sets a flag; `enemies.js` resolves the explosion.**
  `updateFireWraith` (enemies-ai.js) runs the `APPROACH→FLASH` FSM and, when
  `flashDur` completes, sets `e.wraith.explode = true` and returns — it never
  touches the player, other enemies, or barrels (that would need
  player-sinks/projectiles imports, breaking the nav/steer layer's R6 import
  discipline). `enemies.js`'s new `fireWraithAI` (the step-6 dispatch entry)
  calls the updater, then checks the flag and queues the entity into a
  module-level `pendingWraithExplosions` list; `explodeFireWraith` (the actual
  AoE) runs once, AFTER the whole step-6 `for` loop finishes — not inline
  mid-loop. This sidesteps mutating `G.enemies` (splicing dead entries) while
  a `for...of` over that same array is still in flight for other entities.
- **EXPLODE deaths (including the Wraith's own) are NOT spliced by
  `explodeFireWraith` itself — they're tagged (`hp=0`/`_cause`) and resolved by
  ONE extra call to the existing `deathSweep()` right after the queue drains.**
  This reuses the one gem-drop/awardKill/emit/`removeNavigator`/`removeLight`
  cleanup path instead of duplicating death-handling inline for the AoE case.
  Consequence worth knowing: an AoE death this way runs `deathSweep()` TWICE in
  one `tickEnemies` call on an explosion frame (once at step 5 for the normal
  shot/melee pass, once more after step 6's queue) — harmless (the sweep is
  idempotent over `hp<=0` entries) but worth remembering if a later phase
  profiles per-frame sweep cost.
- **R2/E11 defuse required NO new ordering code** — it falls out of the
  existing 7-step contract for free. A Wraith killed mid-FLASH by a bullet
  (step 3) or melee (step 4) is removed by the ordinary step-5 sweep; step 6's
  `fireWraithAI` simply never runs for an entity that's already gone from
  `G.enemies`. Verified concretely (not just structurally, unlike Phase 3's
  synthetic proof) in `test-enemies-wraith.js`: a lethal player shot sitting on
  a FLASHing Wraith produces no AoE and no barrel-seam call.
- **`flashMul` (0.5×, "movement continues" during FLASH) is applied as a
  temporary scale-then-restore of `e.speed`** around the one `steerNavigator`
  call in the FLASH branch, rather than adding a multiplier parameter to the
  shared nav/steer layer (`stepToward`/`steerNavigator` read `e.speed` directly
  with no per-call override hook, and no other roster member needs one yet).
  `e.speed` is restored to its baked EFFECTIVE value immediately after the call
  so nothing outside this one branch ever observes the scaled-down number.
- **Barrel-detonation seam**: `registerBarrelDetonation(fn)` in `enemies.js`,
  default no-op — mirrors the loader's `registerBlockerSink` pattern exactly
  (SPEC-ENEMIES §7's own prescribed shape). Barrels don't exist yet
  (SPEC-BARRELS, post-#4); `explodeFireWraith` calls it unconditionally with
  `(x, y, explodeRadius_px, "wraith-aoe")`.
- **Crate immunity is by omission, not a guard** — `explodeFireWraith` never
  reads `G.crates` at all, so "crates are immune to the Wraith's blast"
  (§13.16) requires no explicit skip-crates branch; there's simply no code
  path that could touch one.
- **Light-emitter seam (§8.4, self-glow) — first occupant of `G.lights`.**
  `G.lights` existed since the Phase-3 (SPEC-LEVEL) loader's transient-clear as
  a reserved-but-unused array; no shape convention existed yet, so this phase
  defines the minimal one: `{ source: e, radius: glowRadius × TILE }`. `source`
  is a live entity reference (not a copied `x,y`) so a future renderer (#7)
  reads the Wraith's current position every frame with no re-sync needed — an
  interpretation choice (not spec-given, GDD §8.4 only says "self-glows,
  constant"), flagged here for a sign-off glance when #7 lands. `deathSweep`'s
  new `removeLight(e)` (a plain `findIndex(l => l.source === e)` splice) is
  generic — it's a no-op for any type that never registered a light, so it
  costs nothing for the other 6 roster members and pre-handles the Reaper if
  it ever gets a light later.
- **Test seam note:** `test-enemies-wraith.js` (16 checks) drives the REAL
  `tickEnemies` spine end-to-end (not per-step `__`-prefixed calls) since the
  EXPLODE behavior spans steps 5/6/7 together. Covers: factory shape + light
  registration; the concrete R2 defuse (bullet kills a FLASHing Wraith → no
  AoE, no barrel call, no player damage); the concrete EXPLODE (4 dmg to
  player, friendly-fire kill on a bystander scored 0 but still drops gems, a
  crate in radius left intact, barrel seam called with the right radius/cause,
  light emitter removed on death); the natural FSM transition
  `APPROACH→FLASH` via the real GROUND A* layer (not a synthetic state
  assignment); and a dirty-repath re-route parity check mirroring the Zombie's
  existing test.

### 2026-07-05 — Lobber (cover-seek) + the `G.ebolts`/`updateEbolts` arced-ordnance system — Phase 7 (SPEC-ENEMIES)
The Lobber (§6.1.4) is the ninth-and-final roster AI and the sole producer of
the new arced-ordnance system it shares no code with the straight-shot
(`G.shots`) pipeline (E1). Load-bearing decisions:
- **Cover-seek, not A\* — deliberately excluded from the nav-consumer registry.**
  `updateLobber` (`enemies-ai.js`) never calls `addNavigator`/`steerNavigator`;
  it moves via plain `moveBody`+`groundBlockerFilter`, mirroring ADD's
  `updateSorter` (a straight-line advance/flee, not a pathfinder). Per the
  phase brief's own flag, this was checked against R1/R6 before writing code —
  it needed no dirty-gate/round-robin interaction because it's not in
  `navList` at all.
- **ADD `updateSorter` ported near-verbatim** (§11/§12 provenance table):
  `canSee` (throttled `losCheckEvery` 0.12s) → flee AWAY at `fleeMul(0.95×)`
  with the exact ADD wandering-jitter formula (`e.wander += (rand−.5)·jitter·
  dt·6`, `angle = away + sin(wander)·0.9`), hold fire; `!canSee` → advance at
  `speedMul(0.40×)`, lob every `lobEvery(2.5s)` once within `lobRange(9t)`.
  `fleeJitter` has no named spec dial (GDD/SPEC-ENEMIES give the *shape* of
  the jitter, not its magnitude) — a `LOBBER_FLEE_JITTER = 1.0` constant was
  added in `enemies-ai.js`, flagged inline as `(proposed)`, same posture as
  other un-dialed constants in this codebase (e.g. the Shooter's
  `WANDER_PICK_EVERY`). Not a build blocker.
- **Lob-fire routed through a registered seam (`registerLobberFire`), not a
  direct `G.ebolts` push from `enemies-ai.js`** — same shape as the Spider's
  web and the Shooter's arrow seams, keeping this layer's import set at
  config/state/world/nav only (R6, unchanged). `enemies.js` fills it: mints a
  `kind:"arc"`, `owner:"enemy"` `G.ebolts` entry (**not** a `Shot` — E1's
  explicit divergence: straight enemy shots fold into `G.shots` with an owner
  tag, but arced ordnance keeps ADD's separate-array model).
- **The accuracy-error perturbation (net-new vs ADD) samples uniformly over
  the error-radius DISC, not just a random angle at a fixed radius.** ADD's
  `fireEnemyArc` targets the exact position; the spec's net-new mechanic is a
  "random offset within `G.ramp.lobberErrorRadius`." A naive `radius = rand()
  × errR` biases samples toward the center (area ∝ r², so small radii are
  over-represented); `radius = √rand() × errR` (with a uniform angle) makes
  the sample uniform over the disc's *area* — a deliberate correctness choice
  for the "perturbed within" wording, not a play-feel tuning knob.
- **`updateEbolts` is ADD `updateArc` ported near-verbatim** — ground position
  interpolates launch→landing over `dur`, wall-agnostic for the entire flight
  (the loop never tests `isWall`/blockers mid-transit — only the landing splat
  runs an AoE check), parabolic `height` computed for a future renderer. AoE
  on landing tests the player ONLY at `blast + player.r` (§9 — arced ordnance,
  like straight enemy shots, never hits other enemies) and calls the
  `detonateBarrelsInRadius` seam (already registered by Phase 6, unconditional
  no-op today since barrels don't exist).
- **Self-contained in step 7 — no cross-file frame-ordering assumption, unlike
  the straight-shot passes.** `updateEbolts` both advances position AND
  resolves the AoE/removal in the same call (step 7), whereas the
  enemy-shot→player pass (also step 7) depends on `player.js`'s `updateShots`
  having already moved the shot earlier in the frame. Flagged in the phase
  brief and verified here: `G.ebolts` entries are never touched by
  `player.js`, so no such dependency exists for this system.
- **Test seam note:** `test-enemies-lobber.js` (15 checks) drives the REAL
  `tickEnemies` spine end-to-end. Covers: factory shape; exposed→flee (distance
  from the player grows, zero ebolts minted — hold-fire proven by absence, not
  a flag read); in-cover behind an intervening wall→advances + lobs at least
  once within a bounded frame budget; the lob's shape (`G.shots` stays empty —
  proves the E1 separation — one `G.ebolts` entry with the right `kind`/`dur`/
  `blast`/`dmg`) and its landing point within `lobberErrorRadius` of the
  player's fire-time position; `updateEbolts` mid-flight (no damage, entry
  still live) vs. post-landing (AoE damage lands THROUGH an intervening wall,
  entry removed, barrel seam called with the landing point/radius/cause).

### 2026-07-05 — SPEC-ABILITIES Phase 1 (four enabling seam edits; `abilities.js` NOT built) — subsystem #5 begun
Four surgical ENABLING edits landed across three files #5 does not own plus
`config.js` — data/seams only, no `abilities.js`, no behavior on existing code
paths (the suite went 619 → 648, all green; nothing pre-existing changed count).
Load-bearing decisions, all pinned by SPEC-ABILITIES §1/§2.3 (owner-approved A1/
A7/A9), not new design:
- **A1 — `sweepDeadEnemies` is an ALIAS export of the existing private
  `deathSweep`, not a rename.** Added one line — `export { deathSweep as
  sweepDeadEnemies };` — after the test-only `__`-export block in `enemies.js`.
  `deathSweep`'s body and its two internal callers (`explodeFireWraith`'s extra
  sweep, `tickEnemies` step 5) are untouched; the `deathSweep as __deathSweep`
  test alias is untouched. #5's Nova/Lightning AoEs set `e.hp`/`e._cause =
  "player-nova"|"player-lightning"` then self-run `sweepDeadEnemies()` so the ONE
  drop/score/emit/nav/light cleanup path handles the kill (order-tolerant — the
  ability step doesn't rely on a later `tickEnemies` sweep, same posture as
  `updateEbolts`). Spawners are Nova/Lightning-immune, so `spawnerDeathSweep`
  stays #5-untouched.
- **A7 — `applyStun(seconds)` is the missing STUNNED producer.** Added directly
  after `applyEntangle` in `player.js`: `p.stun = Math.max(p.stun, seconds)` —
  extends-not-shortens (parallel to `applyEntangle`), **no iframe, no loco gate,
  no new imports** (`G` already in scope). `player.js` already MODELED stun end-
  to-end (`p.stun` timer decrement, `tryAbilities` lock, `dropCarried("stun")`
  force-drop) but nothing set it; Lightning is the first producer. The carried-
  object force-drop follows for free on the next `updatePlayer` step-2 (one-frame
  lag, inside the existing STUNNED contract). Abilities call the sink, never
  reach `G.player.stun` directly (E7's ruling).
- **A9 — `G.novas` is a per-level transient.** Added `G.novas = [];` to
  `level-loader.js`'s `clearTransient` line, beside `G.shots`/…/`G.ebolts`, so a
  live Nova ring can't survive a level transition. `abilities.js` will also
  lazy-init `G.novas ||= []` on first push (the `G.pickups`/`G.ebolts`
  precedent), so ability tests need no loader. `gemEnergy`/`storedCharges` are
  run-state and persist (NOT cleared here); cooldowns reset on load.
- **§2.3 — `CFG.ABILITY` is leaf data only.** Added the `nova{}` (10 dials) +
  `lightning{}` (4 dials) block after `CFG.GEM` in `config.js`, verbatim from the
  spec (tiles are ×TILE at read time; `(proposed)` dials flagged in comments).
  `lightning` has **no** energy-cost field — the null case is structural (§5.2).
  `config.js` stays a leaf (no imports added; `test-config.js`'s import-discipline
  check still green). `GEM.energy(=5)` unchanged.
- **Test:** `test-abilities-seams.js` (29 checks) — CFG.ABILITY has exactly the
  spec'd nova/lightning keys+values (no stray keys); `applyStun` extends-not-
  shortens (stun 2 → applyStun(1) stays 2 → applyStun(3) → 3, no iframe/loco
  change) and throws with no player state; `sweepDeadEnemies` is a function and
  sweeps an hp≤0 enemy while keeping a live one; the loader clears `G.novas` to
  `[]`. Uses the house headless harness (`check`/`throws`, dynamic real-module
  import, a defensive `window`/`document`/`AudioContext` stub — not strictly
  needed since the graph touches `window` only inside uncalled `input.js` glue,
  but installed to survive a graph shift).

### 2026-07-06 — SPEC-ABILITIES Phase 2 (`abilities.js` foundation built) — subsystem #5
New file `src/abilities.js` — the gem-energy economy + cooldown/ring scaffolding,
NO Nova/Lightning behaviour yet. Decisions:
- **Import surface pins the one-way graph now.** `abilities.js` imports
  config/state + one-way `level-loader` (`emit`), `player` (`registerAbility`,
  `applyStun`), `enemies` (`sweepDeadEnemies`). `emit`/`applyStun`/
  `sweepDeadEnemies` are **imported but unused this phase** (the Phase 3/4 handler
  bodies consume them) — deliberately imported now so a future accidental cycle
  (player/enemies importing abilities back) fails at load; grep confirms none
  import it back. The **boot sequence must `import "./abilities.js"`** so the
  `registerAbility("nova"/"lightning", …)` side-effect runs before frame 1 — the
  standard register-callback load-order contract (owed by the later integration
  phase; noted in the code map).
- **`addGemEnergy` is the A6 algorithm verbatim** (`>` not `>=`, so exactly-100
  stays in the bar; overflow banks whole `barCap` chunks up to `chargeCap`, then
  clamps). Pure fn of `G.gemEnergy`/`G.storedCharges`; touches nothing else.
- **`updateAbilities(dt)` this phase ONLY ticks cooldowns** (`Math.max(0, cd-dt)`,
  floored) + lazy-inits `G.novas ||= []`; the Nova ring pass is a marked
  `// Phase 4:` TODO. No `Infinity` anywhere (sentinel rule; all state finite).
- **`registerBarrelDetonation` seam (A8)** — `let detonateBarrelsInRadius = () =>
  {}` + register fn, no-op default, same shape as `enemies.js`. **Cross-spec
  note: SPEC-BARRELS must register its real detonation fn into BOTH `enemies.js`
  AND `abilities.js`.** Nova deliberately never calls it (GDD §5.1).
- **NET-NEW: read-only `getCooldowns()` accessor.** §2.4 pins `novaCd`/
  `lightningCd` as module-local with no observation hook, and the phase's
  `onNova`/`onLightning` are no-op stubs that never set them — so a test could
  neither read nor drive the cooldowns, making the prompt's "test that
  `updateAbilities` decrements cooldowns to 0" un-assertable. Resolved with a
  read-only `{nova, lightning}` accessor mirroring `nav.js`'s `getNavVersion()`
  precedent (surface internal module state without moving storage into G); it
  also feeds the HUD ability-readiness icons the spec Scope says #5 "maintains
  the state [they] read" (#10). Non-behavioral, read-only. **Testability limit
  flagged:** the decrement-**from-nonzero** path is NOT exercisable until Phase
  3/4 handlers set a cooldown; Phase-2 tests assert only the floor-at-0 + init
  reset via the accessor. This is the one net-new interface beyond the phase
  prompt's build list — surfaced here per "phases flag their own risks."
- **Test:** `test-abilities.js` (18 checks) — `addGemEnergy` bar-fill/charge-
  banking/discard-clamp incl. exactly-at-cap and multi-charge credits and the
  "only two fuel fields mutated" purity check; `initAbilities` clears `G.novas`
  and zeroes both cooldowns (via `getCooldowns`); `updateAbilities` floors at 0
  across many ticks and lazy-inits `G.novas`. House headless harness, real-module
  import, defensive browser stubs. Suite 648 → 666, purely additive.

### 2026-07-06 — SPEC-ABILITIES Phase 3 (`onLightning` cast body) — subsystem #5
Filled `abilities.js` `onLightning` exactly per §5.1 (instantaneous ability, no
persistent entity). Nova stays a no-op stub (owed P4). Decisions:
- **Marker-branch, not type-branch (A2).** The per-enemy magnitude keys off
  `e.resist?.lightning` (the value-free E9 marker), never `boss`/type — resisted
  targets take `reaperDamage`(5) and survive; everything else is destroyed. Today
  only the Reaper carries the marker, but the branch is forward-compatible for
  future bosses with no #5 change.
- **`killCount` = destroys only.** A resisted target is chipped, gets **no**
  `_cause`, and is **not** counted — so the `ability:cast` payload's `killCount`
  (the NOVACLEAR!/THUNDERSTRUCK! + white-flash driver) excludes survivors. The
  emit payload is a **snapshot** `{kind:"lightning", killCount}` (one-way flow —
  subscribers must not reach back into G).
- **Sweep-after-pass, once (A1).** The enemy loop only sets `hp`/`_cause`; the
  single `sweepDeadEnemies()` runs AFTER the whole pass, never per-hit (a per-hit
  splice would corrupt the `for…of` iteration when a cast kills ≥2). Reuses the
  shared `dropGems`/`awardKill`/`enemy:killed`/nav/light cleanup — `player-lightning`
  starts with `player-` so `awardKill` scores full points.
- **Radius test = squared-distance edge test.** `(e.x-px)²+(e.y-py)² ≤ (R+e.r)²`
  with `R = radiusTiles×TILE` (=160) and a **per-enemy** `e.r` reach — the house
  AoE idiom (`meleeExchange`/Wraith-explode), avoids a `Math.hypot` per enemy.
  Spawners/crates are never referenced, so their §5.2 immunity holds by
  construction, not a special-cased skip. Origin `(px,py)` is `G.player` centre.
- **Ordering (§5.1):** cooldown gate → enemy pass → `sweepDeadEnemies()` →
  `detonateBarrelsInRadius(px,py,R,"player-lightning")` (A8 seam, inert until
  SPEC-BARRELS) → `applyStun(3)` (A7) → `lightningCd=10` → `ability:cast` emit.
  Costs **no** gem energy (§5.2, structural null — no fuel field touched).
- **NET-NEW test affordance: `export { onLightning as __onLightning }`.** The
  handler is registered into `player.js` by reference and is otherwise
  module-local, so a headless test cannot reach it. Exported under the house
  `__`-prefix (like `enemies.js`'s `__deathSweep`/`__playerShotEnemyPass`) so a
  cast can be driven directly; `player.js` still invokes it **only** via the
  `registerAbility` registry, so the seam contract is unchanged. The STUNNED
  cast-lock is a player-side `tryAbilities` gate (tested there, per §9's own
  note), not re-tested at the handler level — the handler gates only on
  `lightningCd` (§5.1 step 1). No new imports (graph unchanged from P2).
- **Test:** `test-abilities-lightning.js` (22 checks) — the full §9 Lightning +
  `ability:cast(Lightning)` clusters (radius wipe + attribution + sweep, just-
  outside `R+e.r` survives, resist chip-and-survive, `gemEnergy` untouched,
  `p.stun==3`, `lightningCd==10`, barrel spy called once with
  `(px,py,5×TILE,"player-lightning")`, `ability:cast` emits once with
  `killCount`=destroys-only) plus a cooldown-gate no-op/re-fire cluster. Real-
  module import, emit + barrel spies, defensive browser stubs. Suite 666 → 688.

### 2026-07-06 — SPEC-ABILITIES Phase 4 (`onNova` + the Nova ring pass) — subsystem #5 COMPLETE
Filled `abilities.js` `onNova` (§4.1) and the per-frame Nova ring pass inside
`updateAbilities` (§4.2), replacing the Phase-2 TODO. This completes #5 (gem
economy + Lightning + Nova). Load-bearing decisions and the flagged risks, all
resolved as the phase prompt prescribed:
- **A5 fuel branch — charge-first (OQ-A2), bar-second, else rejected no-op.**
  `storedCharges≥1` → `storedCharges--`, `health=ringMaxHp`(50), the live bar is
  **untouched** and keeps filling (banks fuel efficiency); else
  `gemEnergy≥minBarToFire`(25) → `health = ringMaxHp × gemEnergy/barCap`,
  `gemEnergy=0`; else **nothing happens** — no ring pushed, `novaCd` NOT armed, no
  spend. A cast blocked by `novaCd>0` returns before the fuel branch (no spend).
- **Ring health stays a FLOAT.** Bar-fire scaling is fractional (e.g. bar 25 →
  12.5, bar 30 → 15.0); never rounded — it only ever feeds the `≤0` comparison.
  Verified by the weak-ring (12.5 kills a 20-HP victim) and margin (15.0 → 5 → −5)
  tests.
- **A3 swept-band geometry, centre-to-centre, NO `e.r`.** The Nova hit test is
  `prevR < dist ≤ r` with `dist` centre-to-centre — deliberately **unlike**
  Lightning's `≤ R+e.r` edge test (A2/§5.1). `prevR` is initialised to **0** on a
  fresh ring (NOT `r`), so frame 1's band `(0, firstStep]` is non-empty and an
  enemy at `dist<firstStep` is not missed — the STATUS-flagged Opus-tier subtlety.
  `r += expandTilesPerSec×TILE×dt` (=384 px/s); `r` is monotonic so consecutive
  bands are contiguous and non-overlapping (`prevR_{k+1}=r_k`).
- **A4 nearest-first + break-after-the-fatal-victim.** This frame's crossings are
  gathered, sorted **ascending by dist**, then applied in order; the `health≤0`
  break happens **AFTER** the victim that drove it to ≤0 is marked dead (so a weak
  ring still kills its final victim). Enemies farther out this frame are **not**
  struck and **not** added to `hit` — but because the same `≤0` threshold also
  triggers dissipation on this frame, the ring is removed before a later frame
  could re-band them, so they are never silently missed. The margin test (15-health
  ring vs three in-band 10-HP enemies: kills the two nearer, leaves the third
  untouched, `killCount=2`) pins this.
- **A3 one-hit-per-ring via the `hit` Set.** Each struck enemy (destroyed OR
  resisted-and-surviving) is added to `ring.hit`; a resisted enemy that later moves
  into a subsequent frame's band is **not** struck again. Tested directly (a
  resisted Reaper chipped once, then relocated into the next band, takes no second
  hit).
- **A2 resist marker.** `e.resist?.nova` → `e.hp -= reaperDamage`(10),
  `ring.health -= reaperRingCost`(20), survives, **uncounted**; else destroy
  (`cost=e.hp`, `e.hp=0`, `e._cause="player-nova"`, `ring.kills++`,
  `ring.health -= cost`). Same value-free E9 marker Lightning reads.
- **A10 projectile erase is FREE and health-independent.** Same `prevR<dist≤r`
  band, no health cost, and it runs **before** the dissipate check so it still
  fires on the frame the ring dies. Removes `G.shots` with `owner==="enemy"` +
  **all** `G.ebolts` (tested at their current interpolated `b.x,b.y`); player shots
  are **never** touched. Erase is independent of the enemy pass (a dying ring still
  clears the screen it swept — the panic-button feel).
- **A1 sweep-after-all-rings, once.** The ring loop only sets `hp`/`_cause`; a
  single `sweepDeadEnemies()` runs after **all** rings are processed (never
  per-hit — that would splice `G.enemies` mid-iteration). `updateAbilities`
  **early-returns when `G.novas` is empty** (after the lazy-init) so this
  unconditional-looking sweep runs only on frames with live rings and never
  touches non-Nova deaths owned by `tickEnemies`. The ability step is thus
  order-tolerant (A1) — it does not depend on a later `tickEnemies` sweep.
- **Reverse-iterate `G.novas`.** Rings are both mutated and spliced in the same
  loop, so iteration is `for (let ri = rings.length-1; ri>=0; ri--)` — removals
  don't skip entries. Multiple rings coexist (rapid taps 0.5 s apart), each with
  its own `hit`/`health`/`kills`.
- **OQ-A1 emit contract (Nova half).** `emit("ability:cast",{kind:"nova",
  killCount})` fires **once, on dissipation** (health≤0 OR `r≥radiusCapTiles×TILE`
  =448) — NOT at cast, NOT per hit — with `killCount = ring.kills` (**destroys
  only**; a resisted Reaper chipped over the ring's life is excluded). This
  completes the OQ-A1 pair: **Lightning emits at cast, Nova emits on dissipation**,
  both a one-way snapshot payload (subscribers must not reach back into G). The
  #7 white-flash / #12.4 NOVACLEAR!/THUNDERSTRUCK! consumers build against it later.
- **Immunity by OMISSION.** The Nova pass **never references**
  `G.spawners`/`G.crates`/`G.barrels`, so their §5.1 immunity holds by
  construction (not a special-cased skip); the barrel-detonation seam spy is never
  called by Nova (asserted). Nova deliberately does not touch barrels (GDD §5.1) —
  only Lightning calls `detonateBarrelsInRadius`.
- **Cross-file seams recap (A1/A7/A9 — the three edits outside #5, all landed in
  Phase 1 and consumed now):** A1 = `enemies.js` exports `deathSweep` as
  `sweepDeadEnemies` (both abilities route AoE kills through it); A7 = `player.js`
  `applyStun(seconds)` (Lightning's self-stun producer); A9 = `level-loader.js`
  clears `G.novas` in the transient-clear line (Nova rings are a per-level
  transient; `abilities.js` also lazy-inits `G.novas ||= []`). `gemEnergy`/
  `storedCharges` persist across Nights; cooldowns reset via `initAbilities()`.
- **STILL OWED downstream (NOT #5 scope):** **SPEC-BARRELS must register its real
  detonation fn into BOTH `enemies.js` AND `abilities.js`** — two separate
  `registerBarrelDetonation` consumers, each with its own no-op default; Lightning's
  barrel clause is wired-but-inert until then (Nova never touches barrels). Also
  owed: the boot `import "./abilities.js"` (so `registerAbility` +
  `registerBarrelDetonation` run before frame 1) and wiring
  `initAbilities()`/`updateAbilities(dt)` into the main loop (integration phase).
- **NET-NEW test affordance: `export { onNova as __onNova }`** (mirrors
  `__onLightning`; player still casts only via the `registerAbility` registry).
- **Test:** `test-abilities-nova.js` (54 checks) — the full §9 Nova clusters
  (fuel branches, cooldown gate, single-hit-per-ring, destroy+ring-cost+shared
  sweep, weak-ring-kills-final-victim, nearest-first margin, Reaper resist,
  projectile erase incl. the dying-frame case, immunity, and the dissipation
  emit). Real-module import, emit + barrel spies, defensive browser stubs. Suite
  688 → **742**, purely additive (no existing test touched).

### 2026-07-06 — SPEC-BARRELS Phase 1 (enabling edits only; `barrels.js` NOT built)
Three surgical edits per SPEC-BARRELS §1 (B9, B10) and §2.3 — no barrel entity,
physics, or the real detonation fn yet:
- **`config.js` — `CFG.BARREL` block added verbatim** (§2.3, data-only, leaf
  preserved): `hp`(4), `r`(14), `kick{}` (roll/friction/bounce/impact dials,
  §7.2.2), `shrapnel{}` (§7.2.4), `explosion{}` (FX payload, §7.2.3), `light{}`
  (tiles, §8.4), `LETHAL`(1e9) — the seam's "detonate outright" sentinel
  (sentinel-over-`Infinity` rule; `1e9`, never `Infinity`).
- **`enemies.js` — `export { spawnerDeathSweep as sweepDeadSpawners }` (B9).**
  One alias line, mirroring the existing `sweepDeadEnemies` alias (SPEC-ABILITIES
  A1) — `spawnerDeathSweep`'s body and the existing `__spawnerDeathSweep` test
  alias are untouched. This is the seam the coming `barrels.js` will call so a
  shrapnel-killed spawner routes through the ONE shared gem/awardKill/emit/
  markNavDirty path instead of a bespoke splice (B9's chain-of-custody: a
  shrapnel kill tags `_cause = "player-shrapnel"`/`"enemy-shrapnel"` per the
  barrel's adopted owner, and `awardKill` already scores `player-*` only).
- **The two existing `detonateBarrelsInRadius` call sites gained a 5th `damage`
  argument (B10).** Fire-Wraith EXPLODE now passes `cfg.explodeDmg`(4); the
  Lobber lob-splat now passes the lob's own `b.dmg` (=`CFG.ENEMY.lobber.lobDmg`,
  2). Both are **inert today** — the registered seam is still the Phase-3 no-op
  default (`() => {}`) and simply drops the extra arg — but wiring them now means
  Phase 2's real `detonateBarrelsInRadius(x,y,radius,cause,damage=LETHAL)`
  receives the correct AoE magnitude (4-HP barrel: Wraith detonates it outright,
  Lobber's 2 dmg only drops it to Burning) without a second pass over these call
  sites. **The Lightning call site in `abilities.js` was deliberately NOT
  touched** — per B10 it keeps its existing 4-arg call and rides the `damage=
  LETHAL` default (§5.2 "lethal damage and detonate"), so `abilities.js` needs
  no edit this phase.
- **Test:** `test-barrels-seams.js` (40 checks) — `CFG.BARREL` spot-checks
  (every dial group + the `LETHAL` sentinel), `sweepDeadSpawners` importable +
  sweeps an hp≤0 spawner (drops gems, awards points, calls `markNavDirty`), and
  the Wraith EXPLODE call site verified (via a real `tickEnemies(1/60)` run,
  mirroring `test-enemies-wraith.js`'s EXPLODE case) to invoke the barrel seam
  with `damage === CFG.ENEMY.fireWraith.explodeDmg`. Full existing suite reran
  green with no changes needed — the 5th call-site arg is confirmed inert.
  Suite 742 → **782**, purely additive.
- **Owed next (SPEC-BARRELS Phase 2):** `barrels.js` itself — the barrel entity
  (roll/kick physics per `CFG.BARREL.kick`, HP ladder, shrapnel burst on death),
  the real `detonateBarrelsInRadius(x,y,radius,cause,damage=LETHAL)`, and its
  registration into **both** `enemies.js` and `abilities.js` via each module's
  `registerBarrelDetonation`.

### 2026-07-06 — SPEC-BARRELS Phase 3 (carry/kick integration + roll physics)
Built the carry/kick FSM branches (`player.js`, B5/B6), the carried-barrel melee
chip (`enemies.js`, B5), and the roll integrator (`barrels.js`, B3). Load-bearing
decisions:

- **The barrel roll integrator is the SECOND sanctioned `moveBody` exception**
  (after `enemies-ai.js`'s `phantomMover`, §0.1/R4). `world.moveBody` only
  *slides-and-stops* — it never *reflects* velocity — so a kicked barrel that must
  bounce off walls/solids cannot route through it. `barrels.js`'s `updateBarrels(dt)`
  ports ADD `dustbin.js slideStep` wholesale (verified in §12): per-axis reflect
  `v = -v·bounce` off a solid, a corner "reflect-both / hold position" case, then
  exponential friction `v *= exp(-friction·dt)`. The bounce set is
  `barrelHitsSolid` = `isWall` (tile test at the prospective centre, matching ADD)
  ∪ `bodyHitsBlocker(x,y,r, e => e !== self)` — walls + crates + spawners + OTHER
  barrels, self excluded by the filter (the rolling barrel is in `G.barrels`).
  Enemies are deliberately NOT in the bounce set: a barrel rolling ≥ `impactSpeed`
  (96 px/s) passes THROUGH an overlapped enemy, dealing `impactDmg`(1), losing
  `impactSelfHp`(1) via `damageBarrel(…,"player-kick")` and `speed×(1-impactSlow)`
  (−40%); ONE `sweepDeadEnemies()` runs after the whole pass (never per-hit).
  Barrel-vs-barrel is bounce-only, no damage (OQ-B1); the player takes NO roll
  damage (the pass never references the player). `world.js` is untouched (same
  ruling as `phantomMover`: a contained bespoke mover beats widening the shared leaf).

- **Circular-import resolution — two new register-callback seams.** B1 pins the
  import direction as `barrels.js → player.js` and `barrels.js → enemies.js`, and
  "nothing imports `barrels.js`". But `player.js`'s barrel-release must *call*
  `kickBarrel` (in `barrels.js`) and `enemies.js`'s `meleeExchange` must *call*
  `damageBarrel` (in `barrels.js`) — both would be back-imports, i.e. cycles. Per
  the CLAUDE.md rule (register a callback rather than import upward), `player.js`
  exposes `registerBarrelKick(fn)` and `enemies.js` exposes `registerBarrelDamage(fn)`,
  both no-op defaults, and `barrels.js` FILLS both at load (the same idiom as the
  existing `registerBarrelDetonation` / `registerAbility` seams). `barrels.js` now
  imports `player.js`'s `registerBarrelKick` — the sanctioned `barrels → player`
  edge B1 anticipated. Graph re-verified one-way: a repo-wide grep confirms nothing
  imports `barrels.js` back.

- **Splice-out SYMMETRY (the phase's named risk) — every release path re-inserts
  into `G.barrels`.** Pickup splices the barrel OUT (crate pattern) so it stops
  blocking/occupying; each release must put it back: KICK (moving) re-inserts
  rolling via `kickBarrel`, PLACE (stationary) re-inserts static via the new
  `placeBarrelAtTile`. **The STUN force-drop (`dropCarried`) was an unflagged
  fourth release path** — it routed unconditionally to `dropCrateAtTile`, which
  would have pushed a barrel into `G.crates` (wrong array → leak/duplicate). Fixed
  by branching `dropCarried` on `carry.type` → `placeBarrelAtTile` for barrels.
  This is in-scope correctness (the stun path IS a release path the splice-out
  invariant governs), not new design. The ONLY path that clears carry WITHOUT
  re-inserting is `notifyCarriedBarrelDestroyed()` (Phase-4 detonate-in-hand — the
  barrel is gone from the world), added as a sink but not yet called.

- **Detonation resolution stays a Phase-4 TODO.** A kicked/carried barrel CAN
  reach hp≤0 this phase (kick-impact self-damage, shot/melee/detonation intake),
  but `damageBarrel`'s hp≤0 branch is still the marked no-op — no shrapnel, no
  splice. Confirmed by the phase prompt's explicit fence.

- **Test:** `test-barrels-carry.js` (61 checks, green) — pickup/splice + crate-first
  order, `carriedBarrel()` + `notifyCarriedBarrelDestroyed` (no re-insert), place-static
  + kick-rolling (both re-insert), enemy-melee → player damaged AND barrel −1,
  exponential decel + one-step decay, settle + nav-dirty, bounce off wall/crate/
  spawner/other-barrel at 0.6, rolling impact (enemy −1 / barrel −1 / −40% /
  `player-kick`), sub-threshold inert, no-player-roll-damage, no-wall-vault. Suite
  826 → **887**, purely additive.

- **Owed next (SPEC-BARRELS Phase 4):** detonation resolution (owner derive →
  shrapnel burst → `barrel:exploded` emit → `markNavDirty` → drop light emitter →
  splice), the shrapnel species (`G.shrapnel` + `updateShrapnel`, B7), chain
  reactions (B8/B9), and the detonate-in-hand caller for `notifyCarriedBarrelDestroyed`.

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

### 2026-07-05 — SPEC-ENEMIES Phase 5 (GROUND A* roster: Skeleton Shooter + Zombie)

Added `updateSkeletonShooter`/`updateZombie` to `enemies-ai.js` +
`makeSkeletonShooter`/`makeZombie` factories to `enemies.js` (dispatched via
`aiByType`, registered via `registerEntityFactory`) + `test-enemies-ground.js`
(15 checks green; full suite **536**). These are the first roster members to
actually register with (`addNavigator`) and drive (`steerNavigator`) the
Phase-2 nav consumer layer built in Phase 2 but only exercised there with
synthetic navigators — this phase proves it end-to-end with real entities.

Implements (SPEC-ENEMIES §6.1.3, §6.1.7): Zombie as the minimal A* consumer
(register once, steer every frame, no FSM — melee/death/gems/score already
handled by the Phase-3 spine); Skeleton Shooter's FSM WANDER (ambient roam via
`world.randomFloorTile` waypoints, ridden through the SAME steerNavigator
machinery as HUNT rather than a separate roam routine; throttled LOS-acquire)
→HUNT (full GROUND A* toward the player, `awareDecay` 8s, stop-to-shoot roll
on `G.ramp.shooterStopToShoot` gating a STATIONARY halt→windup(0.4s)→fire→
cooldown(1.5s) sequence — stationary by construction, since the movement code
is unreachable while `shootPhase != null`, not guarded separately). Arrow fire
is a `registerShooterFire` seam (mirrors the Spider's web seam), keeping
`enemies-ai.js`'s import set at exactly config/state/world/nav (R6, still
grep-verified green in `test-enemies-nav.js`).

**Real bug found and fixed, not new design:** `enemies.js`'s `deathSweep`
never called `removeNavigator` — any A*-registered enemy that died would leak
in `enemies-ai.js`'s registry forever (no enemy had actually registered before
this phase, so nothing exposed it). Fixed with `if (e.nav) removeNavigator(e);`
before the splice; pre-fixes the same hazard for the still-unbuilt Fire Wraith
and Reaper. Full decision-log writeup above (Decision log section) covers the
WANDER/HUNT wander-goal design, the stationary-sequence construction, and the
config-number verification (arrow speed 256 = 8/3.5 × 112, maxTravel 192 =
6 × 32 — both checked arithmetically against SPEC-ENEMIES §2's numbers).

**No design gaps requiring a stop-and-surface.** All the config fields needed
(`CFG.ENEMY.skeletonShooter.{los,arrow,windup,cooldown,awareDecay}`,
`CFG.ENEMY.zombie.{hp,speedMul,melee}`, `G.ramp.shooterStopToShoot`) already
existed from earlier phases (Phase 1/3 of this spec) — this phase only wired
behavior, no new tuning dials invented. Two implementation choices are flagged
in the decision log as proposed-not-spec-given (both low-stakes, tuning-only):
the WANDER re-pick cadence (`WANDER_PICK_EVERY` 3.0s) and reading "each
decision tick" as the LOS-throttle cadence rather than every frame (consistent
with the Lobber's already-established `losCheckEvery` pattern). Owed by later
phases: Lobber, Fire Wraith, the Reaper (PHANTOM, R4), spawners (E4), arced
ordnance (`updateEbolts`, E1). No git.

### 2026-07-05 — Phase 6 (`enemies.js`/`enemies-ai.js` — Fire Wraith + barrel/light seams)

Built the Fire Wraith (§6.1.8) — `updateFireWraith` FSM `APPROACH→FLASH` in
`enemies-ai.js` (the third GROUND A* consumer, riding the same
`addNavigator`/`steerNavigator` machinery as the Zombie/Skeleton Shooter) +
`fireWraithAI`/`explodeFireWraith` in `enemies.js` (the EXPLODE resolution,
deferred to AFTER the whole step-6 AI loop so it never mutates `G.enemies`
mid-iteration). Added the `registerBarrelDetonation` seam (no-op default,
SPEC-BARRELS owed) and the `G.lights` light-emitter seam (§8.4, live entity
reference, cleaned up by `deathSweep`'s new `removeLight`). Full writeup in
the Decision log section above. `test-enemies-wraith.js` (16 checks, green);
full suite 552. No git.

### 2026-07-05 — Phase 7 (`enemies.js`/`enemies-ai.js` — Lobber + arced ordnance)

Built the Lobber (§6.1.4, the ninth and final roster AI) and the
`G.ebolts`/`updateEbolts` arced-ordnance system it is the sole producer of.
`updateLobber` (`enemies-ai.js`) ports ADD's `updateSorter` two-branch
cover-seek FSM near-verbatim (exposed→flee-with-jitter+hold-fire; in-cover→
advance+lob-on-cd) — deliberately NOT registered with the Phase-2 nav
consumer layer (no `addNavigator`/`steerNavigator` call; cover-seek is plain
`moveBody`+`groundBlockerFilter`). The lob is minted through a new
`registerLobberFire` seam (same register-callback shape as the Spider
web/Shooter arrow seams, R6 upheld) filled in `enemies.js`: a `kind:"arc"`,
`owner:"enemy"` `G.ebolts` entry — NOT a `Shot` (E1) — landing at the
player's fire-time position perturbed by a uniform-disc random offset within
`G.ramp.lobberErrorRadius` (the net-new accuracy-error mechanic vs ADD's
exact-target `fireEnemyArc`; sampled via `radius=√rand×errR` for true
disc-area uniformity, not a naive linear-radius sample that would bias
toward the center). `updateEbolts` (replacing the Phase-3 no-op hook in step
7) is ADD's `updateArc` ported near-verbatim: launch→landing interpolation
over `dur`, wall-agnostic in flight, player-only AoE on landing + the
barrel-detonation seam. Full writeup in the Decision log section above.

**No design gaps requiring a stop-and-surface.** All config fields needed
(`CFG.ENEMY.lobber.*`, `G.ramp.lobberErrorRadius`) already existed from
earlier phases (Phase 1/3 of this spec). One implementation choice is
flagged as proposed-not-spec-given (low-stakes, tuning-only): the flee-jitter
magnitude constant (`LOBBER_FLEE_JITTER = 1.0`) — the GDD/spec describe the
jitter's *shape* (ADD's formula) but never name its magnitude dial.

`test-enemies-lobber.js` (15 checks, green); full suite **567 checks total**,
all green. Roster (§6.1) is now 8 of 9 built — only the Reaper (§6.1.9,
PHANTOM mini-boss summoner, R4) remains, plus spawners (E4). No git.

### 2026-07-05 — Phase 8 (`enemies.js`/`enemies-ai.js` — The Reaper + the bespoke PHANTOM mover)

Built the Reaper (§6.1.9, E9), the ninth and final roster AI — a PHANTOM A\*
mini-boss summoner placed by level defs only (`makeReaper` overrides the loader's
inert `blocks:false` placeholder). Load-bearing decisions:

- **§0.1 / R4 — the bespoke PHANTOM mover is a DELIBERATE, DOCUMENTED EXCEPTION
  to "moveBody is the one mover."** `updateReaper` registers as a `NAV_MASK.PHANTOM`
  navigator on the Phase-2 layer (so it rides the shared scheduler / round-robin
  budget / waypoint steering), but supplies `phantomMover` — NOT `world.moveBody` —
  as its per-navigator mover. The reasoning (per the phase brief): `world.moveBody`
  ALWAYS calls `bodyHitsWall` (the blocker filter never governs walls), so it would
  wedge a wall-crossing PHANTOM path at the first wall `findPath` told the Reaper to
  enter. `phantomMover` (in `enemies-ai.js`, next to `updateReaper`) slides per-axis
  against `bodyHitsBlocker(reaperBlockerFilter)` ONLY — crates+barrels
  (`reaperBlockerFilter = e.type !== "spawner"`), never `bodyHitsWall`, never
  spawners. This matches `nav.js`'s occupancy (spawners are in `occGround` only, so
  `findPath(..., PHANTOM)` routes THROUGH walls+spawners, blocked only by
  crates/barrels — the mover filter must match the mask or the Reaper desyncs from
  its own path). The four A\* filters are NOT interchangeable; this is the sole
  crates+barrels-only one. **`world.js` is left completely untouched by this phase**
  (the §0.1 ruling: a contained per-navigator mover is preferable to widening the
  shared leaf for the one PHANTOM mover). Regression-guarded by
  `test-enemies-reaper.js`: `phantomMover` crosses a full wall column without
  wedging, is blocked by a crate, passes through a spawner; and a behavioral test
  drives the Reaper across a full-height wall column to reach a player a GROUND
  enemy could never touch.
- **R4 also applies to knockback.** `integrateEnemyKnockback` (`enemies.js`) gained a
  `cfg.nav === "phantom"` branch that routes the Reaper's melee knockback through
  `phantomMover`, not `groundMover` — otherwise a melee knockback could wedge the
  Reaper on a wall it phases through. (flight → raw add; phantom → `phantomMover`;
  else → `groundMover`.)
- **Summon (E4/R5) + blast (R3/R7) via register-callback seams (R6).** `updateReaper`
  owns only the timers; the mints go through new `registerReaperSummon`/
  `registerReaperBlast` seams filled in `enemies.js` (so `enemies-ai.js` never imports
  the loose-enemy factories or `projectiles`/`G.shots`). Summon (every
  `G.ramp.reaperSummonInterval`, 6→3.5 s ramp) picks `["ghost","ghost","skeleton"]` →
  2 Ghosts or 1 Skeleton at the Reaper's tile, each tagged `originSpawner = reaper.id`
  and given `spawn = spawner.emerge` (0.5 s emergence gate). The `minionCap` (6) is a
  **live scan of `G.enemies` for the tag at the emit decision** (E4 — no mutable
  counter), and the running count includes freshly-added minions so a single summon
  can't overshoot; the scan is `spawn`-state-agnostic, so it counts emergence-window
  children (R5). Blast (every 9 s FIXED, independent of the ramped summon) is a
  straight `makeShot(owner:"enemy", dmg 3, speed 224 [=7 t/s], maxTravel
  blastRange=448 px [14 t — the R7 dial, already in config], effect:"damage")` aimed
  at the player; it's LOS-irrelevant to fire but the shot rides `player.js`'s
  `updateShots` (crate-ricochet + non-bounce wall fizzle) and its damage is applied by
  the spine's step-7 `enemyShotPlayerPass`. The Reaper needed a stable `e.id`
  (monotonic counter in `enemies.js`) as the tag source — the first entity to carry
  one (spawners, E4, will need the same when built).
- **#5 flags exposed (E9), values deferred.** `e.boss = true` (set generically by
  `makeEnemy` from `cfg.boss`) + `e.resist = {nova:true, lightning:true}` — a
  value-free MARKER #5 reads instead of a hardcoded `type === "reaper"` check. This
  phase ONLY exposes the flag; #5 applies the 10/20 (Nova dmg/ring) and 5 (Lightning)
  magnitudes. Death emits a new `boss:killed` FX event (screen-shake + hit-stop,
  #7/#10) from `deathSweep`, keyed on `e.boss` (not a type check) so any future boss
  gets the FX.

**No design gaps requiring a stop-and-surface.** Every config field needed
(`CFG.ENEMY.reaper.*` including the `blastRange: 448` R7 dial and `summon.pick`/
`minionCap`, `G.ramp.reaperSummonInterval`) already existed from Phase 1/3. The
`boss:killed` event name is the one net-new string (the spec names the FX but not
the event key; chosen to match the `noun:verb` convention and keyed on `e.boss`).

`test-enemies-reaper.js` (24 checks, green); full suite **591 checks total**, all
green. Roster (§6.1) is now COMPLETE — 9 of 9 built; only spawners (E4) remain in
subsystem #4. No git.

### 2026-07-05 — Spawners (§6.3, E4) + §0.4 spawner-as-target resolved IN-SCOPE — Phase 9 (SPEC-ENEMIES)
Subsystem #4 (Enemies + spawners) is now **fully complete**. Two mechanical
decisions worth recording (neither is new design — both are seam-filling per
the phase prompt):

- **`level-loader.js` gained `getEntityFactory(type)` (new export).** The
  loader's spawner placeholder (`mkPlaceholder(true, ...)`, registered at
  module load) already computes the Plan-filtered `table` and the ramped
  `interval`/`liveCap` — nontrivial eligibility logic. Rather than have
  `enemies.js`'s `makeSpawner` re-derive that a second time (the exact
  duplication hazard the `evalRampTable` decision log entry above already
  flagged and rejected for `level-generator.js`), `getEntityFactory` reads back
  the loader's CURRENT registration so `makeSpawner` can call through it and
  then decorate the result with combat/emission fields. This is the same
  "decorate, don't duplicate" instinct as the reaper/ghost/etc. factories that
  *replace* trivial placeholders — spawners just need to *wrap* instead,
  because their placeholder isn't trivial.
- **§0.4 (spawner-as-target) resolved IN-SCOPE.** The phase prompt flagged this
  for a confirm-before-building check, but SPEC-ENEMIES §5's `CFG.ENEMY.spawner`
  block already ships concrete `hp:6, points:300, gems:3, r:16` — data that
  only makes sense if spawners take damage and die through the ordinary
  gems/awardKill/`enemy:killed` path. Built as specified: `playerShotEnemyPass`/
  `meleeExchange` (steps 3/4) test `G.spawners` alongside `G.enemies`, and a new
  `spawnerDeathSweep` (step 5, immediately after `deathSweep`) mirrors the enemy
  death sweep and additionally calls `markNavDirty` on the vacated tile (a
  destroyed spawner was a nav blocker — occupancy rebuilds lazily off
  `G.spawners`, so the invalidation signal is sufficient, no manual rebuild).
  Spawners have no `melee` stat (never deal damage to the player) and are
  excluded from the crate-bumper knockback (nothing to push — they're
  immobile), both structural (absence of a stat / a static `r`-only check),
  not special-cased skips. Barrel/shrapnel destruction of spawners is
  confirmed out of scope (SPEC-BARRELS, post-#4), matching the prompt.

`test-enemies-spawner.js` (28 checks, green); full suite **619 checks total**,
all green. **Subsystem #4 (Enemies + spawners) is now fully COMPLETE.** No git.

### 2026-07-06 — SPEC-PICKUPS signed off (OQ-P1 transient, OQ-P2 deferred)
Collection-side spec for GDD §3 (power-ups & pickups) authored + committed at repo
root as `SPEC-PICKUPS.md`. Owns contact collection for everything in `G.pickups`
(gems, food, treasure, keys, weapon power-ups, Magnet), the Magnet pull/duration/
refresh, the gem despawn clock, placeholder→value decoration, and the new `CFG`
value tables. Placement/routing (#1), the key-spend/door side, and Nova/Lightning
are NOT touched — only `addGemEnergy` is called into.

- **OQ-P1 — Magnet persistence: RULED TRANSIENT.** `G.magnet` (seconds remaining)
  resets on every level load — one line `G.magnet = 0;` in `level-loader.js`
  `clearTransient`, beside the existing `G.novas = []`. It's a ticking clock (like
  Nova/Lightning cooldowns) and its target set (gems in `G.pickups`) is itself
  cleared on load; a surviving timer would burn over a gem-less level opening. No
  `state.js`/`G`-shape edit; never serialized. (SPEC-PICKUPS §11, §1, §2.1)
- **OQ-P2 — gem scatter (§3.5): RULED DEFERRED.** Gems land at the death point as
  `dropGems` already produces them; despawn + Magnet work regardless. Scatter
  revisited later as a one-line `dropGems` touch (enemies.js) or render-side jitter
  (#7). `dropGems` stays untouched. (SPEC-PICKUPS §5, §11)
- **Edit surface for the build (sign-off-first):** NEW `src/pickups.js` (the whole
  module); `config.js` additive only — `CFG.PICKUP` (`grab 0.5t`, `gemDespawn 12s`,
  `powerupShots 75`, `magnet {radius 6t, pullSpeed 10t/s, duration 10s}`),
  `CFG.FOOD {candy 5, feast 10}`, `CFG.TREASURE {candyCorn 100, silverSkull 250,
  goldChest 500}`; one `clearTransient` line (`G.magnet = 0`). **No edit to
  enemies.js / player.js / abilities.js / world.js** — sinks are imported, not
  modified. Clean DAG leaf (nothing imports pickups.js); no circular-import hazard.
  (SPEC-PICKUPS §1, §2)
- **The one previously-unbuilt sink: weapon-power-up GRANT.** The fire hook already
  CONSUMES `G.powerups.{triple,big,fast,bounce}`; nothing granted them. Collect adds
  `+CFG.PICKUP.powerupShots` (=75); the `powerup` kind branches so `magnet` sets the
  timer instead of a phantom shot counter. All other sinks pre-exist:
  `addGemEnergy(value)` (gem), `healPlayer(heal)` clamped to `overhealCap 30` (food),
  `G.score += points` (treasure), `G.keys++` (key). (SPEC-PICKUPS §1 D3–D5)
- **Gem despawn lazy-seeded collection-side** so `dropGems` stays byte-for-byte
  untouched: `updatePickups` inits `gem.life=0` on first sight, ages it, splices at
  `≥12s` — the SPEC-BARRELS §5.2 shrapnel life/lifespan pattern, seeded lazily
  instead of at creation. Only gems despawn; placed pickups persist until collected.
  (SPEC-PICKUPS §4, §5)
- **ADD provenance verified against live add2026 source** (codeload `main`): §3.1 —
  `config.js POWERUP_SHOTS:75` + the `3+3·Rapid+3·Triple` formula REUSED verbatim
  (Fast←Rapid); **Big Shot DIVERGED — Repossessed-original, no ADD equivalent** (ADD
  ships only Rapid/Triple/Bounce); Fast ADAPTED (Rapid renamed, 4/s base vs ADD).
  §3.3 — `vending.js` small+5/large+10 values REUSED verbatim; overheal-to-30
  DIVERGED (ADD vending caps at maxHp; Repossessed food overheals via `healPlayer`'s
  clamp — the sink owns it). (SPEC-PICKUPS §10)
- **Integration debt (NOT pickups scope):** boot `import "./pickups.js"` + wiring
  `updatePickups(dt)` into the main loop — same debt owed for `abilities.js`/
  `barrels.js`. Phased prompts build + headless-test the module; loop wiring is the
  later integration pass.

Next: fresh conversational session generates the phased `pickups.js` Claude Code
prompts from the spec. No implementation this session.