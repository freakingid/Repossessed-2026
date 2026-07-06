# SPEC-ABILITIES — Nova, Lightning & the Gem-Energy Economy (`abilities.js`)

**Implementation-detail layer for GDD §5, reading GDD §3.5 (gem source), §2.5
(STUNNED), §9 (attribution), §10.2 (the HUD that reads this state).** Design
intent lives in GDD §5; build reality in `STATUS.md`. This spec is subsystem
**#5**. It owns the two active abilities (Nova expanding ring, Lightning radius
wipe) and the **gem-energy accounting** (gems → live bar → stored charges,
thresholds, caps) that fuels Nova. It fills the `registerAbility("nova"|
"lightning", fn)` seam `player.js` already exposes and reads the value-free
`resist`/`boss` markers `enemies.js` already exposes (E9).

**Scope boundary (pinned per the session brief — not re-derived):** abilities are
specced **standalone**. Gem/charge *input* arrives via a stubbed seam and is
exercised in tests by setting `G.gemEnergy`/`G.storedCharges` directly (or calling
`addGemEnergy` directly). The **gem-economy accounting** (gems→charges, thresholds,
caps) is **in scope here**. Pickup **granting** (contact collection) and the
**Magnet** are **deferred to SPEC-PICKUPS** — this spec exposes `addGemEnergy(value)`
as the credit entry point that SPEC-PICKUPS will call; it never decides that a gem
was collected.

**Out of scope (do not spec here):** pickup collection + Magnet (SPEC-PICKUPS);
barrels + shrapnel + kicked-barrel physics (SPEC-BARRELS — this spec leaves only
the Lightning→barrel-detonation *seam*, the same seam SPEC-ENEMIES already
anticipated for "Wraith/Nova/Lightning"); the §9 attribution chain-of-custody
refinement (SPEC-SCORING — this spec only emits the `player-nova`/`player-lightning`
cause strings the existing `awardKill` seam already honours); rendering, the
gem-energy bar / charge counter / ability-readiness icons, screen-shake / hit-stop
/ the Lightning white flash (#7/#10 — this spec maintains the `G` state they read
and emits the events they consume); §14 boss / Corruptor / Angelic-Spirit block
(tabled in GDD v1.1).

---

## 1. Resolved decisions (forks the GDD/architecture leave that code cannot skip)

Each is a fork requiring an owner sign-off glance, in the SPEC-ENEMIES/SPEC-PLAYER
§1 style. **Sign-off status: A1, A7, A9 and OQ-A1 are approved by the owner
(2026-07-05); the remaining rulings are internal or adopt already-`(proposed)` GDD
dials.** **Three touch files this subsystem does not own** — call these out first,
they are the ones that most need your nod: **A1** exports `enemies.js`'s death
sweep; **A7** adds an `applyStun` sink to `player.js`; **A9** adds `G.novas` to the
loader's transient-clear line. Everything else is internal to `abilities.js` or is
a `(proposed)` GDD dial adopted-and-flagged per the standing config posture.

**Summary of rulings:** A1 → ability kills set `hp`/`_cause` then route through the
**shared** enemy death sweep (export it), never a bespoke splice. A2 → the
ability→enemy magnitude keys off the `resist` **marker**, not `boss`/type. A3 →
Nova hit geometry is a **swept-wavefront** test (`prevR < dist ≤ R`), one hit per
enemy per ring. A4 → same-frame multi-crossings resolve **nearest-first**; the ring
stops once its health hits ≤0 (the enemy that drops it to ≤0 is still killed). A5 →
a Nova tap that cannot pay is a **rejected no-op** (no ring, no cooldown, no spend).
A6 → `addGemEnergy` (bar cap 100 → overflow fills 100-energy charges → charge cap 2
→ discard beyond) is #5's owned accounting; the caller is deferred. A7 → Lightning
self-stun needs a new `applyStun` player sink (missing today), exactly parallel to
E7's `applyEntangle`. A8 → Lightning barrel detonation via a #5-owned, later-filled
`registerBarrelDetonation` seam. A9 → Nova rings are a per-level transient
`G.novas`, cleared on load; `gemEnergy`/`storedCharges` **persist** (run-state),
cooldowns reset on load. A10 → Nova projectile erasure is **free** and targets
`owner:"enemy"` shots + all `ebolts` in the wavefront; player shots never touched.

---

**A1 — Ability kills route through the shared enemy death sweep; never a bespoke
splice.** An ability sets `e.hp` (subtract, or `= 0` for a destroy) and, on any hp≤0,
`e._cause = "player-nova"` / `"player-lightning"`, then calls the **one** cleanup
path — `dropGems` (always) → `awardKill(cause)` → `emit("enemy:killed", …)` →
`emit("boss:killed", …)` if `e.boss` → `clearMeleePair`/`removeNavigator`/
`removeLight` as applicable → splice. Re-implementing that inline is the duplication
hazard STATUS flags repeatedly. The Fire-Wraith EXPLODE already sets `hp`/`_cause`
on an AoE's victims and then calls the shared `deathSweep()`; Nova and Lightning are
structurally identical AoEs and reuse the same shape. **Enemies.js edit owned here:**
export its existing private `deathSweep` as **`sweepDeadEnemies()`** (a one-line
`export`, no logic change). Spawners are Nova/Lightning-immune (§5.1/§5.2), so
`spawnerDeathSweep` is never invoked by #5.
- *Why self-run the sweep instead of leaning on the frame's `tickEnemies`:* the main
  loop's ability-update slot is not built yet, so relying on a later `tickEnemies`
  sweep to clean up ability kills would bake in a cross-file frame-ordering
  assumption (a dead enemy could still AI for a frame). The ability step calls the
  sweep itself and is thereby **order-tolerant** — the same posture as the
  self-contained `updateEbolts` step.
- *Attribution:* `awardKill` today awards `e.points` when `cause.startsWith("player-")`,
  so `player-nova`/`player-lightning` already score full points (GDD §9). SPEC-SCORING
  will replace that seam and receives the same cause strings — no change needed here.

**A2 — The ability→enemy magnitude keys off the `resist` marker, not `boss` or
type.** Read `e.resist?.nova` / `e.resist?.lightning`, the value-free marker E9 put
on the Reaper precisely so #5 avoids a hardcoded type check. Nova: no marker →
**destroy** and the ring loses the enemy's **current** HP; `resist.nova` → deal
**10** and the ring loses **20**, enemy survives. Lightning: no marker → **destroy**;
`resist.lightning` → deal **5**, enemy survives. The `boss` flag is *not* the resist
key — it drives FX only (the `boss:killed` emit fires from the shared sweep when a
resisted boss is eventually finished off by other means). Today only the Reaper
carries either flag, so "non-boss" in the GDD prose ≡ "no lightning-resist"; the
marker is the forward-compatible key for future bosses.

**A3 — Nova hit geometry: a swept-wavefront test, one hit per enemy per ring.** A
target is crossed this frame iff `ring.prevR < dist ≤ ring.r`, where `dist` is
centre-to-centre and `ring.prevR` is last frame's radius (one scalar per ring).
This is skip-proof at any framerate (the whole band swept between frames is tested,
not a thin instantaneous annulus) **and** does not over-erase (a projectile spawned
inside an already-large ring on a later frame was not "swept over" and is left
alone). Each ring carries a `hit` Set of already-struck enemy references so an enemy
lingering in the band across frames is struck **once**. The GDD's ~0.6-tile stroke
is **cosmetic** (renderer, #7) — it plays no part in the hit test.

**A4 — Same-frame multi-crossings resolve nearest-first; the ring stops at health
≤0.** Collect this frame's crossed enemies, sort **ascending by `dist`** (the
wavefront physically reaches the nearer enemy first), then apply hits in order,
subtracting each victim's cost from ring health. Stop as soon as ring health ≤0 —
but the enemy whose cost drove it to ≤0 **is** destroyed ("even a weak ring kills
its final victim as it dies," GDD §5.1); enemies further out that were also in this
frame's band are **not** struck, and the ring dissipates at end of frame. Ordering
only matters at the margin (a near-empty ring meeting several enemies in one frame,
rare at 12 t/s), but pinning it makes the outcome deterministic and testable.

**A5 — A Nova tap that cannot pay is a rejected no-op.** Firing priority: **if
`storedCharges ≥ 1`** → consume **one** charge, ring health = `ringMaxHp` (50), the
live bar is untouched and keeps filling. **Else if `gemEnergy ≥ minBarToFire`** (25)
→ consume the **entire** live bar, ring health = `ringMaxHp × (gemEnergy / barCap)`
(= `50 × energy/100`), then `gemEnergy = 0`. **Else** (bar < 25 **and** 0 charges) →
**nothing happens**: no ring spawns, the 0.5 s cooldown does **not** start, and no
energy is spent. Both firing branches share the 0.5 s cooldown, which exists only to
swallow accidental double-taps.

**A6 — `addGemEnergy(value)` is #5's owned accounting; the caller is deferred.**
`gemEnergy` fills 0→`barCap` (100); overflow banks into `storedCharges` in whole
`barCap`-sized chunks up to `chargeCap` (2); anything past a full bar **and** 2
charges is discarded (GDD's "max 300 total banked"). Algorithm:
```
gemEnergy += value
while (gemEnergy > barCap && storedCharges < chargeCap) { gemEnergy -= barCap; storedCharges++ }
if (gemEnergy > barCap) gemEnergy = barCap        // fully banked → clamp the bar
```
This function is the credit entry point; **SPEC-PICKUPS** calls it once per gem
collected (value = `CFG.GEM.energy` = 5) and owns the Magnet/despawn (§3.2/§3.5).
Tests here call `addGemEnergy` directly or set `G.gemEnergy`/`G.storedCharges`.

**A7 — Lightning self-stun needs a new `applyStun(seconds)` player sink (missing
today), exactly parallel to E7.** `player.js` already *models* STUNNED end-to-end
(`p.stun` timer, `tickTimers` decrement, `tryAbilities` lock, `dropCarried("stun")`
force-drop) but has **no producer** — nothing sets `p.stun`. Lightning is the first.
Add `export function applyStun(seconds)` beside `applyEntangle`, extends-not-shortens
(`p.stun = Math.max(p.stun, seconds)`), no iframe, no loco gate. Rationale mirrors
E7's ruling that the Spider web "calls INTO player rather than reaching `G.player`
directly": abilities call the sink, not the field. *This is a `player.js` edit owned
by this spec's implementation pass.* (The carried-object force-drop follows for free:
next frame's `updatePlayer` step 2 sees `p.stun > 0` and runs `dropCarried("stun")`.
The one-frame lag is inside the existing STUNNED contract and is harmless; barrels
are deferred anyway.)

**A8 — Lightning barrel detonation via a #5-owned seam, filled later by
SPEC-BARRELS.** `abilities.js` declares its own `let detonateBarrelsInRadius = () =>
{}` + `export function registerBarrelDetonation(fn)` (same shape as the one in
`enemies.js`). Lightning calls `detonateBarrelsInRadius(px, py, radius, "player-
lightning")`. Until SPEC-BARRELS exists the seam is a **no-op**, so Lightning's
barrel clause is wired but inert — consistent with the deferred-barrel boundary and
with SPEC-ENEMIES already listing "Wraith/**Nova/Lightning** → barrel-detonation
seam." **Cross-spec note for STATUS:** SPEC-BARRELS must register its real
detonation fn into **both** consumers (`enemies.js` *and* `abilities.js`). Nova, by
contrast, deliberately does **not** touch barrels (GDD §5.1, closed decision).

**A9 — Nova rings are a per-level transient `G.novas`, cleared on load; fuel/charges
persist.** A live ring must not survive a level transition, so `G.novas` joins the
loader's transient-clear line (`G.shots = []; … G.ebolts = [];`) — a one-line
`level-loader.js` edit owned here, matching how every other per-level array is
cleared. (`abilities.js` also lazy-inits `G.novas ||= []` on first push, the
`enemies.js` `G.pickups`/`G.ebolts` precedent, so tests need no loader.) By contrast
`gemEnergy` and `storedCharges` are **persistent run-state** (already in `G` and
`resetRunState`, preserved across Nights per SPEC-LEVEL §4.2) and are **not**
touched on level load. The Nova/Lightning **cooldowns** are transient and reset on
load via `initAbilities()`.

**A10 — Nova projectile erasure is free and wavefront-scoped.** Using the same
`prevR < dist ≤ R` band (A3, no health cost — erasing has no price), a ring removes:
every `G.shots` entry with `owner === "enemy"` (arrows + webs + Reaper dark-blasts —
all three are `owner:"enemy"` in `G.shots`) and every `G.ebolts` entry (arced lobs,
tested at their current interpolated ground position). Player shots (`owner ===
"player"`) are **never** touched. Erasure runs even on the frame the ring's health
hits ≤0 (a dying ring still clears the screen it swept — the panic-button feel).

---

*(proposed) GDD dials, adopted-and-flagged.* Per the standing config posture ("every
`(proposed)` dial is flagged for the later §14.2 tuning sign-off — not a build
blocker"), these are transcribed into `CFG.ABILITY` as-is and are **not** forks
needing resolution now: Nova `minBarToFire` 25, `radiusCap` 14 t, Reaper 10 dmg /
20 ring-cost; Lightning `radius` 5 t, Reaper 5 dmg. Source-doc-fixed values (not
"proposed") carried straight over: bar cap 100, charge cap 2, ring max 50, expand
12 t/s, Nova cooldown 0.5 s, Lightning cooldown 10 s, Lightning stun 3 s, `GEM.energy`
5. All live in §2.3.

---

## 2. Data shapes

### 2.1 `G` additions
| Field | Kind | Owner | Notes |
| :-- | :-- | :-- | :-- |
| `G.gemEnergy` | persistent | already present | 0–`barCap`. Fuel bar. Persists across Nights; reset only by `resetRunState`. |
| `G.storedCharges` | persistent | already present | 0–`chargeCap`. Banked full charges. Same persistence. |
| `G.novas` | transient | **new (A9)** | Live Nova rings. Cleared on level load (loader) + lazy-init in `abilities.js`. |

No new **persistent** field is introduced — the fuel already existed (state.js). The
only new array is the transient ring list.

### 2.2 Nova ring entry (`G.novas[i]`)
```
{
  x, y,          // fixed origin = player centre at cast (px); the ring does not follow the player
  r,             // current radius (px); starts 0
  prevR,         // radius last frame (px); starts 0 — the A3 swept-band lower bound
  health,        // remaining ring health (A5); ≤0 ⇒ dissipate at end of this frame
  hit,           // Set<enemyRef> already struck by THIS ring (A3, one-hit-per-enemy)
  kills,         // count of enemies this ring DESTROYED (not resisted); the OQ-A1 emit payload, sent on dissipation
}
```
Rings expand outward only; `r` is monotonic, so `prevR < dist ≤ r` is a clean
"crossed this frame" predicate and `dist ≤ r` is equivalently "interior." Ring
removed when `health ≤ 0` (after the frame's hits resolve) **or** `r ≥ radiusCap`
(the empty-ring hard stop, GDD §5.1).

### 2.3 `CFG.ABILITY` (new config block; tiles are ×`CFG.TILE`=32 at read time)
```
ABILITY: {
  nova: {
    barCap: 100,          // gem-energy bar capacity (§5.1, source-fixed)
    chargeCap: 2,         // max banked full charges (§5.1, source-fixed)
    minBarToFire: 25,     // (proposed) min live-bar energy to fire from the bar (§5.1)
    ringMaxHp: 50,        // charge-fire ring health; bar-fire scales this by energy/barCap (§5.1)
    expandTilesPerSec: 12,// ring expansion (§5.1) → 384 px/s
    strokeTiles: 0.6,     // COSMETIC only — renderer (#7); not in the hit test (A3)
    radiusCapTiles: 14,   // (proposed) hard radius stop (§5.1) → 448 px
    cooldown: 0.5,        // s, anti-double-tap (§5.1)
    reaperDamage: 10,     // (proposed) dmg to a nova-resist target (§5.1)
    reaperRingCost: 20,   // (proposed) ring-health cost of hitting a nova-resist target (§5.1)
  },
  lightning: {
    radiusTiles: 5,       // (proposed) wipe radius (§5.2) → 160 px
    reaperDamage: 5,      // (proposed) dmg to a lightning-resist target (§5.2)
    cooldown: 10,         // s (§5.2)
    stunSeconds: 3,       // self-stun on cast (§5.2 / §2.5 STUNNED = 3.0 s)
    // costs no gem energy — no field, the null case is structural (§5.2)
  },
}
// GEM.energy (=5) already exists and is unchanged — the per-gem credit A6 consumes.
```

### 2.4 Module-local state (`abilities.js`, reset by `initAbilities`)
`novaCd` (s), `lightningCd` (s) — cooldown timers ticked down in `updateAbilities`.
No edge-detect state lives here: `player.js` already owns `prevNova`/`prevLightning`
edge detection and calls the registered handler only on the rising edge (§10). This
module's handlers are therefore "cast now" entry points, not held-input pollers.

---

## 3. Gem-energy economy (`addGemEnergy`) — GDD §3.5, §5.1

`abilities.js` owns `export function addGemEnergy(value)` per **A6**. It is the single
credit path into the fuel economy; it never reads pickups, positions, or the Magnet.
Caps and overflow are as A6. It is a pure function of `(value, G.gemEnergy,
G.storedCharges)` → mutated `G` state, fully headless-testable.

Consumption is owned by Nova firing (§4.1): the charge branch does `storedCharges--`;
the bar branch does `gemEnergy = 0`. Lightning consumes **nothing** (§5.2). Nothing
else in #5 writes the fuel fields.

**Boundary with SPEC-PICKUPS:** that spec decides a gem entity was collected (contact
or Magnet pull), removes it from `G.pickups`, and calls `addGemEnergy(pickup.value)`.
The despawn timer (12 s) and Magnet (10 s / 6 t / 10 t·s⁻¹) are entirely its
concern. #5's tests stub this by calling `addGemEnergy` or setting the fields.

---

## 4. Nova (GDD §5.1)

### 4.1 Cast — `abilityHandlers.nova` (registered via `registerAbility("nova", …)`)
`player.js` calls this on the rising edge of the Nova input, and only when the player
is **not** STUNNED (the `tryAbilities` gate already enforces both — §10). The handler:
1. If `novaCd > 0` → return (cooldown gate).
2. Resolve the fuel branch (**A5**): charge → `health = ringMaxHp`, `storedCharges--`;
   else bar≥`minBarToFire` → `health = ringMaxHp × gemEnergy/barCap`, `gemEnergy = 0`;
   else → **return** (rejected no-op: no ring, no cooldown, no spend).
3. Push a ring (§2.2) at the player's current centre with `r=prevR=0`, the resolved
   `health`, an empty `hit` Set, and `kills=0`.
4. `novaCd = CFG.ABILITY.nova.cooldown`.

*(No emit at cast — Nova's per-ring kill count is only known at dissipation, so the
`ability:cast{kind:"nova"}` emit fires there, §4.2. The ring VFX is drawn by #7
straight from `G.novas`, so no cast-time signal is needed.)*

The ring's origin is **frozen** at cast (it does not track the player) — Nova is
"aimable by positioning" (GDD §5.3): you place yourself, then fire.

### 4.2 Per-frame ring update — `updateAbilities(dt)` (this module's frame step)
Tick `novaCd`/`lightningCd` down by `dt` (floored at 0). Then, for each ring
(iterate a copy or reverse-index so removal is safe):
1. `prevR = r`; `r += expandTilesPerSec × CFG.TILE × dt`.
2. **Enemy pass (A3/A4/A2/A1):** gather enemies with `prevR < dist ≤ r` **and** not
   in `hit`; sort ascending by `dist`; for each, add to `hit`, then:
   - `resist.nova` → `e.hp -= reaperDamage` (10); `health -= reaperRingCost` (20);
     the target survives (do **not** null `_cause`; it is not destroyed here).
   - else → record `cost = e.hp` (current HP), `e.hp = 0`, `e._cause = "player-nova"`,
     `ring.kills++`; `health -= cost`.
   - After each hit, if `health ≤ 0` → **break** (A4; the just-hit enemy stays
     destroyed).
3. **Projectile erase (A10):** remove `G.shots` entries with `owner==="enemy"` and
   `prevR < dist ≤ r`; remove `G.ebolts` entries whose current ground position is in
   the same band. No health cost.
4. **Dissipate check:** if `health ≤ 0` **or** `r ≥ radiusCapTiles × CFG.TILE` →
   `emit("ability:cast", { kind:"nova", killCount: ring.kills })` (OQ-A1), then
   remove the ring (after this frame's hits + erases have applied).
5. After all rings are processed, **`sweepDeadEnemies()`** once (A1) so every
   ring-killed enemy drops gems, scores, and emits through the shared path.

*Barrels/crates/spawners are never referenced in the Nova pass* — that is how
"unaffected" (GDD §5.1) is upheld by construction, not by a special-cased skip.

### 4.3 Notes on the ring model
- **Weak-ring-kills-final-victim** falls out of step 2's order: the subtraction and
  the `health ≤ 0` break happen *after* the victim is marked dead.
- **Reaper cost accounting:** a full 50-health ring hitting a lone Reaper deals 10
  and ends at 30 health — "a chunk of a Reaper, not a delete button" (GDD §5.1). A
  ring hits any given Reaper at most once (the `hit` Set).
- **One ring ≠ one frame:** at 12 t/s a 14 t ring lives ~1.17 s; multiple rings can
  coexist (rapid taps 0.5 s apart), each with its own `hit`/`health`.

---

## 5. Lightning (GDD §5.2)

Lightning is **instantaneous** — resolved entirely in the cast handler; there is no
persistent Lightning entity to tick.

### 5.1 Cast — `abilityHandlers.lightning` (registered via `registerAbility`)
Called on the rising edge, not while STUNNED (§10 gate). The handler:
1. If `lightningCd > 0` → return.
2. `R = radiusTiles × CFG.TILE`; `(px,py) = player centre`.
3. **Enemy pass (A2/A1):** for each `e` in `G.enemies` with `dist(e,player) ≤ R + e.r`:
   `resist.lightning` → `e.hp -= reaperDamage` (5), survives; else `e.hp = 0`,
   `e._cause = "player-lightning"`. (Spawners/crates untouched — never referenced.)
4. **`sweepDeadEnemies()`** once (A1) — the shared drop/score/emit/cleanup path.
5. **Barrels (A8):** `detonateBarrelsInRadius(px, py, R, "player-lightning")` — the
   #5-owned seam, no-op until SPEC-BARRELS. Shrapnel cascades it spawns are
   player-attributed downstream and erupt during the stun window (that is the price).
6. **Self-stun (A7):** `applyStun(CFG.ABILITY.lightning.stunSeconds)` (3 s). Consumes
   **no** energy.
7. `lightningCd = CFG.ABILITY.lightning.cooldown` (10 s).
8. `emit("ability:cast", { kind:"lightning", killCount })` (OQ-A1) — `killCount` =
   the number **destroyed** in step 3 (a resisted Reaper that only took 5 is not a
   kill). Instantaneous, so the count is known at cast; this drives the white flash
   (§10.3) and the "THUNDERSTRUCK!" check (§12.4).

### 5.2 Interaction notes
- **Abilities lock during the stun:** for the next 3 s `tryAbilities` returns early
  (`p.stun > 0`), so neither Nova nor Lightning can be cast — the vulnerability
  window, intended (GDD §5.2/§5.3).
- **Carried object:** the stun force-drops it via the existing `dropCarried("stun")`
  on the next frame's step 2 (A7). Casting with a (future) barrel in hand detonates
  it point-blank because step 5 hits `R` around the player, where the carried object
  sits (GDD §5.2). Inert until barrels exist.
- **`boss:killed` FX:** Lightning does not kill the Reaper (it only chips 5), so it
  never itself triggers the boss-kill FX; that fires from the shared sweep whenever
  the Reaper is eventually finished.

---

## 6. Attribution & the shared-kill contract (GDD §9)

Both abilities are **player-attributed** (GDD §9 lists "Nova, Lightning" among
player causes). They express this solely through the `_cause` string they stamp
(`player-nova` / `player-lightning`) before the shared sweep runs; the existing
`awardKill` (`cause.startsWith("player-")` ⇒ award `e.points`) does the rest. **#5
adds no scoring logic** — it feeds the convention SPEC-SCORING will inherit. Gems
drop regardless of cause (position loot, `dropGems` in the sweep), so a resisted
Reaper chipped by Nova/Lightning and later finished by any means still drops its 10.

The single dependency #5 places on `enemies.js` is the **A1 export** of the death
sweep; everything else it needs (`G.enemies`, `resist`, `boss`, `hp`, `points`,
`gems`) is plain state already on the entities.

---

## 7. Seams to later systems (interfaces only — no behaviour here)

| Seam | Direction | Filled by | Until then |
| :-- | :-- | :-- | :-- |
| `registerAbility("nova"\|"lightning", fn)` | #5 → player | **#5 fills it** at module load | player default no-op |
| `applyStun(seconds)` | #5 → player | **player.js (A7, #5's edit)** | n/a (new) |
| `sweepDeadEnemies()` | enemies → #5 | **enemies.js (A1, export)** | n/a (new export) |
| `addGemEnergy(value)` | #5 → callers | SPEC-PICKUPS calls it | tests call it directly |
| `registerBarrelDetonation(fn)` (in `abilities.js`) | SPEC-BARRELS → #5 | **SPEC-BARRELS** | no-op (Lightning barrel clause inert) |
| `G.novas` transient-clear | #5 → loader | **level-loader.js (A9, #5's edit)** | lazy-init fallback |
| `initAbilities()` | #5 → boot/loader | orchestrator (#later) calls on boot + load | cooldowns default 0 |
| `emit("ability:cast", {kind, killCount})` | #5 → #7/#10/#12.4 | FX + achievements consume | **decided: emit now (OQ-A1)** |

**On the `ability:cast` emit (OQ-A1 — decided: emit now):** ADD's shipped
`dustbin.js` emits `dustbin:detonated { killCount }` for exactly this purpose, and
GDD §9 names the "NOVACLEAR!" (≥6 kills in one ring) and "THUNDERSTRUCK!" (≥8 in one
Lightning) achievements plus the Lightning white flash (§10.3) — all of which want a
per-activation kill count. **Lightning** emits at cast (§5.1 step 8; count = step-3
destroys). **Nova** emits on **dissipation** (§4.2 step 4; count = `ring.kills`
accumulated over the ring's life), since a ring's total is only known when it ends.
Consumers are downstream (#7/#10/#12.4); #5 only fires the event with a snapshot
payload (no back-reference into state — the one-way-flow rule).

---

## 8. Known implementation risks (flag before building)

- **Cross-file edits (A1/A7/A9).** Three files outside #5 change: `enemies.js`
  (export `deathSweep` as `sweepDeadEnemies`), `player.js` (add `applyStun`),
  `level-loader.js` (clear `G.novas`). All are additive one-liners with no behaviour
  change to existing code; still, each is an edit-collision surface — prefer targeted
  `str_replace` and re-read the exact insertion point (next to `applyEntangle`; next
  to the other `G.* = []` clears; at `deathSweep`'s declaration).
- **Import direction / no cycle.** `abilities.js` imports `config`, `state`, and —
  one-way — `player.js` (`registerAbility`, `applyStun`) and `enemies.js`
  (`sweepDeadEnemies`). Neither `player.js` nor `enemies.js` imports `abilities.js`
  (player forbids it explicitly; enemies imports only config/state/world/loader/
  projectiles/enemies-ai). Register the handlers *at module load*; the boot sequence
  must `import "./abilities.js"` so `registerAbility` runs before the first frame —
  the same load-order contract every register-callback seam relies on.
- **Sweep-after-hits ordering.** Run `sweepDeadEnemies()` **after** the full enemy
  pass, not per-hit — otherwise a ring that kills two enemies in one frame splices
  mid-iteration. (The Nova pass gathers/sorts first, then applies; keep the sweep at
  the very end of `updateAbilities`, once, after all rings.)
- **Ring removal during iteration.** `updateAbilities` both mutates ring health and
  removes dead/expanded rings; iterate `G.novas` in reverse (or over a snapshot) so
  removals don't skip entries.
- **`prevR` initialisation.** A new ring must start `prevR = 0` (not `r`), or its
  first frame's band is empty and an enemy already at `dist < firstStep` is missed.
- **Bar-fire rounding.** `ringMaxHp × gemEnergy/barCap` is fractional (e.g. 30
  energy → 15.0 health). Keep ring `health` a float; do not round — it only feeds
  the ≤0 comparison.
- **Sentinel discipline (project rule).** No `Infinity` anywhere in ring/cooldown
  state — all are finite. (No "permanent" state exists in #5, so the `1e9` sentinel
  is not needed here; just don't introduce `Infinity`.)
- **Stun-lock re-entrancy.** Confirm the Lightning handler does not itself re-check
  and cast again within the same frame; it is edge-triggered by player, single call
  per rising edge, and `tryAbilities` won't call it again while `p.stun > 0`.

---

## 9. Headless smoke tests (pure logic, no canvas — `test-*.js` house style)

All set `G` state directly (`G.gemEnergy`, `G.storedCharges`, synthetic `G.enemies`/
`G.shots`/`G.ebolts`) and register a **spy** for the barrel-detonation seam. No
rendering, no input glue, no loader required (lazy-init `G.novas`).

**Gem economy (A6):** credit below cap fills the bar; a credit crossing 100 banks one
charge and leaves the remainder in the bar; credits past full bar + 2 charges are
discarded (bar clamps to 100, charges stay 2).

**Nova fuel branch (A5):** with a charge → fire consumes one charge, bar untouched,
ring health = 50; with 0 charges and bar = 40 → fire consumes bar (→0), ring health =
20; with 0 charges and bar = 20 → fire is a no-op (no ring, `novaCd` still 0, bar
unchanged); cooldown gate blocks a second fire within 0.5 s.

**Nova ring hits (A3/A4/A2/A1):** a ring expanded past a lone 4-HP enemy destroys it
once (`hit` prevents a second strike next frame), ring health drops by 4, enemy
gone after the sweep with a gem in `G.pickups` and `score += points`; a 15-health
ring meeting two 10-HP enemies in one frame kills the nearer, then the farther as
the final victim (health −5), and does **not** kill a third at greater distance;
a nova-resist enemy takes 10, ring −20, survives.

**Nova projectile erase (A10):** an `owner:"enemy"` shot inside the band is removed;
an `owner:"player"` shot at the same distance is **kept**; a `G.ebolts` entry in the
band is removed; erasure still occurs on the frame the ring's health reaches ≤0.

**Nova immunity:** spawners/crates in-band are untouched; barrels untouched (seam
spy never called by Nova).

**Lightning (A2/A7/A8/A1):** non-resist enemies within 5 t are destroyed and swept
(gems + score + `enemy:killed`); one just outside `R + e.r` survives; a
lightning-resist enemy takes 5, survives; `gemEnergy` unchanged (free); `p.stun`
== 3 after cast; `lightningCd` == 10; the barrel seam spy is called once with
`(px, py, 5×TILE, "player-lightning")`.

**`ability:cast` emit (OQ-A1):** subscribe a spy to the event bus. Lightning that
destroys 3 enemies emits once at cast with `{kind:"lightning", killCount:3}` (a
resisted Reaper in-radius does **not** raise the count). A Nova ring that destroys 2
enemies over its life emits `{kind:"nova", killCount:2}` **once, on dissipation** —
not at cast, and not per hit.

**Lock/edge:** casting Lightning then attempting Nova the same/next frame while
`p.stun > 0` casts nothing (the `tryAbilities` gate — a player-side test, referenced
here for the integration point).

**Cooldown tick:** `updateAbilities(dt)` decrements both cooldowns and re-enables
firing once they reach 0.

---

## 10. Open design questions

- **OQ-A1 — `ability:cast` emit (see §7). RESOLVED (owner sign-off): emit now.**
  Lightning at cast, Nova on dissipation, both carrying `killCount` (§4.2/§5.1/§7).
  Consumers (#7 flash, #12.4 NOVACLEAR!/THUNDERSTRUCK!) build against it later.
- **OQ-A2 — Nova charge-fire vs a nearly-full bar.** GDD prioritises spending a
  stored charge whenever one exists (A5), even if the live bar is also full. Confirm
  that is desired (it banks fuel efficiency for the player by preserving the bar) vs
  a "spend the bar first" alternative. *Recommendation: keep GDD's charge-first
  order.* Non-blocking; A5 implements charge-first.
- **OQ-A3 — All `(proposed)` §5 dials** (Nova min-25 / cap-14 t / 10 / 20;
  Lightning 5 t / 5) ride to the §14.2 tuning sign-off with every other proposed
  dial — **not** a build blocker; adopted as in §2.3.

No **blocking** open questions. The §14 boss/Corruptor block stays tabled and does
not gate #5 (the Reaper is the only resist-marked entity today, and #5 reads the
marker generically, so a future boss needs no #5 change beyond carrying `resist`).

---

## 11. ADD source provenance (what was verified, where, disposition)

Verified against real `add2026` source (`raw`/codeload) before drafting, per the
workflow's "verify any reused pattern against the actual ADD source."

- **`src/dustbin.js` `detonate()` — the kill-via-shared-path pattern: VERIFIED,
  ADOPTED (architecture).** ADD's real detonate does `e.hp -= blastDmg; if (e.hp<=0)
  killEnemy(i, {killerKind:'dustbin'})` — it routes AoE kills through the shared
  `killEnemy` (which awards normal points), never a bespoke splice. #5's A1
  (`hp`/`_cause` → `sweepDeadEnemies`, `player-nova`/`player-lightning` attribution)
  is the Repossessed spelling of that same pattern, and matches Repossessed's own
  Wraith-EXPLODE precedent. Lightning's instantaneous radius wipe is the closest
  structural cousin to `detonate()`; Nova (a persistent expanding ring with per-hit
  health depletion) is **not** a port of it.
- **Dustbin throw physics (`slideStep`: exp friction + per-axis wall bounce) —
  VERIFIED, OUT OF #5 SCOPE.** GDD §13.8 says this is the one Dustbin "organ
  transplant," reused by the **kicked barrel** (SPEC-BARRELS). Confirmed in source;
  no bearing on abilities.
- **Attract/`vortexHold` vortex — VERIFIED DEAD (GDD §13.8), not reused.** Nothing
  in Repossessed pulls enemies; #5 has no vortex.
- **`dustbin:detonated { killCount }` emit — precedent for the `ability:cast` emit
  (OQ-A1, now decided).** ADD emits a per-cast kill count for FX; #5's emit mirrors
  it (Lightning at cast, Nova on dissipation).
- **Net:** abilities are **REPLACED/NEW** per §13.8 — the gem-energy bar, stored
  charges, the expanding-ring health model, and the free-but-stunning Lightning have
  **no ADD analog** to reconcile. The only ADD pattern #5 genuinely reuses is
  architectural (AoE kills through the shared attributed death path), and it is
  confirmed against shipped source.