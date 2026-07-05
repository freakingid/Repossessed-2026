# SPEC-PLAYER — Player, Input, Ranged Fire & the Crate-Carry System

**Layer:** SPEC (implementation detail between GDD and code). This document does
**not** restate design intent — it pins the data shapes, contracts, state
machines, algorithms, and seams needed to build **GDD §2 (Player)**, **§4
(Controls)**, and **§7.1 (Crates)**. Where the GDD gives intent, this fixes
mechanism.

**Owns (this spec):** the input layer (`input.js` — device read, mode lock,
normalized snapshot); player locomotion + collision against the two collision
sources (§13.3); the player state machine (NORMAL / CARRYING / VAULTING / DEAD +
status overlays); health / overheal / damage-intake sinks; ranged fire (cadence,
volley gate, the four independent power-ups, per-volley decrement); **player
shots** (motion, range, wall + crate ricochet) as the first occupant of
`projectiles.js`; and the **crate** half of the carry system (pickup, drop/toss,
drop-vault, wall-vault, pushback rule, plate-press + key-spend world hooks).

**Does not own (later specs / seams only here):** enemies and the melee *overlap
loop* (#4); the pickup **collection/granting** system — weapon power-ups, food,
treasure, gems, magnet, key collection (#3 / GDD §3); abilities Nova/Lightning
(#5 / GDD §5); pathfinding + the real nav blocker sink (#3 / GDD §6.4); HUD
(#... / GDD §10); rendering + dark lighting (#7); audio resolution (leaf).
**Barrels (GDD §7.2) are deferred** — see the scope note below. This spec
defines the interfaces those systems consume or fill; it implements none of
their behavior.

**Source verification.** Every "reused/adapted from ADD" claim below was checked
against the real `add2026` source on GitHub `main` (`src/player.js`,
`src/world.js`, `src/config.js`, `src/dustbin.js`). Provenance table in §14.
Where ADD's shipped code and the Repossessed GDD disagree (units, the big/triple
split), the disagreement is surfaced in §1, not silently resolved.

**Out of scope by workflow.** No Claude Code prompts, no phased build steps, no
task breakdown — those are generated *from* this spec in a separate step after
the human-review checkpoint.

**Scope split — barrels deferred (decision, surfaced not silent).** GDD §7 is
"Interactive objects & the carry system" = crates **and** barrels. Barrels
(§7.2) are excluded from this spec because they are combat machinery wearing a
carry-object costume: a barrel's HP ladder, explosion, and **shrapnel** exchange
damage with *enemy projectiles, enemy melee, spawners, and other barrels* (§7.2.1,
§7.2.3–4), and their attribution rides the **chain-of-custody ledger** (§9) — all
of which depend on enemies (#4), a projectile-damage layer, and a scoring/
attribution system that do not yet exist. Building barrel *carry/kick* now while
stubbing HP/explosion/shrapnel would ship a half-feature (a barrel that can be
carried but never detonates) and would force inventing combat scope early
(against CLAUDE.md's "surface, don't invent design"). Note also that ADD keeps
the kicked-object slide/bounce physics in a **separate module** (`dustbin.js`,
the §13.8 "organ transplant"), which is precedent for splitting carry-object
physics from player locomotion. **Barrels go to a later spec (working name
`SPEC-BARRELS`), authored once #4 (enemies) + a projectile-damage/attribution
layer land.** The crate toss in §7.1.3 is a simple settle, **not** the dustbin
slide physics, so no barrel dependency leaks into crates.

---

## 1. Resolved decisions (forks the GDD leaves open that code cannot skip)

Each is a fork requiring an owner sign-off glance, in the SPEC-LEVEL §1 style.
**Summary of rulings:** P1 → four independent power-up flags; P2 → per-axis
slide vs two sources, player radius a `CFG` dial; P3 → multiplicative speed
stacking; P4 → ADD velocity+friction knockback, tile distances as tuned dials;
P5 → release-branch keyed on move-input, direction = aim; P6 → mouse-mandatory
keyboard, fire is a held boolean, mode lock reused; P7 → units are px in `CFG`,
tiles in GDD, `TILE=32` the bridge.

**P1 — Four independent weapon power-ups (DIVERGES from ADD).**
ADD's `fireBubble(angle, big, bounce)` passes `triple` into the `big` slot — in
ADD a Triple shot *is* the big visual; ADD has three flags (rapid, triple,
bounce). Repossessed §2.4/§3.1 defines **four independent** power-ups that stack
simultaneously: **Triple** (3-bolt ±12° fan, +3 on-screen), **Big** (damage ×2,
hitbox ×1.6, no on-screen change), **Fast** (fire rate ×2, +3 on-screen),
**Bounce** (wall/obstacle ricochet). Each tracks its own remaining shot count in
`G.powerups`; a trigger decrements every *active* counter by 1 (§3.1). *Adopt the
four-flag model; do not port ADD's big≡triple conflation.*

**P2 — Player collision: per-axis slide against two sources; radius is a dial.**
ADD `moveBody` (per-axis: apply `dx`, revert the whole step if `bodyHitsWall`;
then `dy` likewise) is **reused as the slide pattern** but Phase 2 *deleted*
`moveBody` from `world.js` (STATUS.md — "not in §3.1's reuse list"). It must be
**re-added** (§4.2 amendment) and **extended**: player collision consults the
static grid (`bodyHitsWall`, which already includes closed doors via the tile
resolver) **and** the dynamic movable-entity set (§13.3's second source). Player
**radius `CFG.PLAYER.r`** (proposed **12 px**, under `TILE/2=16` so a player fits
1-tile gaps — halls doorways, warrens corridors) is a dial, not a GDD constant.

**P3 — Speed modifiers stack multiplicatively.** CARRYING (×0.85, §2.5),
ENTANGLED (×0.35, §6.1.6/§2.5), STUNNED (×0.7 on the random vector, §2.5) can
co-occur. Effective speed = `base × Π(active modifiers)`. Carry-while-entangled =
`3.5 × 0.85 × 0.35` t/s (a crawl — intended). *Adopt multiplicative.*

**P4 — Knockback: ADD's velocity+friction model, tile distances as tuned dials.**
§2.2 states knockback as *displacement* (player 0.75 t, enemy 0.5 t); ADD ships
it as *initial velocity + exponential friction* (`KNOCKBACK_SPEED`,
`KNOCKBACK_FRICTION`, §13.12). Reuse the ADD velocity/decay model; the GDD tile
distances are the **design targets** the initial-impulse magnitude is tuned to
hit, and live as `CFG.PLAYER.knockbackImpulse` / friction dials (proposed;
Q-tuning). Player-side knockback is owned here; enemy-side is #4's (the
displacement *machinery* is shared, §13.12).

**P5 — Drop/throw: release trigger = aim/fire input; branch keyed on move-input;
direction = aim.** While CARRYING, the fire input (LMB held / right-stick beyond
deadzone) is repurposed as the **release** command (§2.3). On release: if the
player has **nonzero move input this frame** → *moving release* → drop-in-place +
auto-VAULT (§7.1.3); else → *stationary release* → short toss up to 1.5 t **in
the aim direction**, settling on the first free tile. "Moving" = move-input
nonzero (not measured velocity), matching "drop while running."

**P6 — Input: mouse-mandatory keyboard, fire is a held boolean, mode lock reused.**
Repossessed drops ADD's OPKL keyboard-only fire (§13.10) and aims 360° in both
modes (§4.2/§13.11). So the ADD `getFireAngle()`-returns-null-when-idle shape is
replaced by a snapshot with **separate** `aim` (always present: cursor or stick)
and `fireHeld` (boolean). ADD's title-screen **mode lock** (`G.inputMode`,
session lock, per-mode prompts, reset by `newGame()`) is reused unchanged.

**P7 — Units: `CFG` in pixels, GDD in tiles, `TILE=32` the bridge.** All GDD
tile/sec values are authored into `CFG` as px, documented with the tile source:
player **3.5 t/s → 112 px/s** (note: *not* ADD's 185); shot **9 t/s → 288 px/s**
(not ADD's 470); range **7 t → 224 px** (not ADD's 360); cooldown **0.25 s**
(4/s; not ADD's 0.16); spread **±12° → ±0.2094 rad**; vault hop **2.0 t → 64 px**;
knockback targets **0.75 t → 24 px** / **0.5 t → 16 px**. ADD's constants are a
*pattern* reference, not a value source — Repossessed's GDD values win.

---

## 2. Data shapes

**`G.player`** (the player entity; ADD calls it `G.dan`). Live per-frame state on
top of the persistent run-state already in `state.js` (`hp/maxHp/overhealCap/
gemEnergy/storedCharges/keys/powerups/score/night`, SPEC-LEVEL §4.2 — *not*
redeclared here). Set by `loadLevel` step 5 to `{x,y,tx,ty}`; this spec extends
it:

```
G.player = {
  x, y,              // px world position (tileCenter at load)
  r,                 // CFG.PLAYER.r (12)
  angle,             // facing (radians); = aim while not firing, = fire dir while firing
  vx, vy,            // reserved (0 in normal move; used only by knockback)
  kvx, kvy,          // knockback velocity (decays; ADD pattern)
  loco,              // "NORMAL" | "CARRYING" | "VAULTING" | "DEAD"
  carry,             // null | { type:"crate", entity }   (barrels deferred)
  iframe,            // s remaining of post-hit invuln (0.4 on hit)
  vault,             // null | { t, dur, from:{x,y}, to:{x,y} }  (VAULTING only)
  entangle,          // s remaining (0 = not) ; entangleAngle for the ≥60° check
  stun,              // s remaining ; stunVec + stunReroll timer
  meleeState,        // reserved for #4's pair-lockout wiring (see §6.4)
  cooldown,          // s until next volley allowed
}
```

**Shot** (player bullet; first occupant of `projectiles.js`). Owner-tagged and
shaped so enemy arrows / shrapnel fit the same array later (forward-compat, like
the loader's unknown-type-ignore):

```
Shot = {
  x, y, vx, vy,      // px
  r,                 // CFG.SHOT.r × (big ? 1.6 : 1)
  dmg,               // 1 × (big ? 2 : 1)
  traveled,          // px accumulated; expires at CFG.SHOT.range
  owner: "player",   // attribution tag (§9); enemy shots will read "enemy"
  bounce,            // bool (Bounce power-up): ricochets off walls/obstacles
  bounceCount,       // tally (for future achievements)
}
```

**Input snapshot** (produced by `input.js`, consumed by `player.js`; pure data so
`player.js` is headless-testable by feeding synthetic snapshots):

```
InputSnapshot = {
  move:  { x, y },   // normalized: magnitude 0 or 1 (8-way kbd / 360° stick)
  aim:   { x, y },   // unit vector toward cursor (kbd) or stick dir (pad); always present
  fireHeld: bool,    // LMB held / right-stick beyond 0.2 deadzone
  nova: bool, lightning: bool,   // edge-triggered by player.js (see §10 abilities seam)
  pause: bool, confirm: bool, back: bool, mute: bool,
  mode: "keyboard" | "gamepad",  // = G.inputMode
}
```

**Carried crate reference:** the crate entity (from `G.crates`, placed by the
loader) is removed from collision/nav while carried and re-inserted on release
(§9). Its schema is the loader's placeholder `{type,x,y,tc,blocks}` extended by
this spec with nothing new — carry state lives on `G.player.carry`, not the crate.

---

## 3. Input layer (`input.js`)

**Owns:** raw device read, the mode-lock FSM, and the pure snapshot derivation.
Imports **only** `config` (keybind defaults + deadzone) and `state` (`G.inputMode`).
Never imports `player`/gameplay (one-way flow).

- **Default keybinds** (§4.1) live in `CFG.KEYS` (new): move WASD, Nova `N`,
  Lightning `L`, pause `Space`/`Esc`, confirm `Enter`, back `Esc`, mute `M`;
  gamepad indices per §4.1. **Remappable** — `input.js` reads `CFG.KEYS` (or a
  runtime override map); the Options remap **UI is #6**, which writes the map.
  Seam only: `setKeybinds(map)`.
- **Mode lock** (§4.2, reused): title screen — `Space` → `keyboard` session,
  `A/Start` → `gamepad`; the opposing device is ignored until return to title;
  `newGame()` clears `G.inputMode`. Kept for prompt clarity (both modes aim 360°).
- **Snapshot derivation is pure and testable:** device events set an internal
  raw-state; `deriveSnapshot(rawState, mode) → InputSnapshot` is a pure function
  (normalizes move to mag 0/1, resolves aim from cursor+camera or stick, applies
  the 0.2 deadzone). The device-listener glue is the one browser-coupled,
  minimally-tested part; the FSM and `deriveSnapshot` are fully headless-testable.
- Keyboard **diagonals** are the two-adjacent-key combination normalized to unit
  length (ADD §4.1 rule). Gamepad move is full speed beyond deadzone regardless
  of stick depth (ADD §4.6).

---

## 4. Movement & collision

### 4.1 Move step

`base = CFG.PLAYER.speed (112 px/s)`. Effective speed = `base × Π(P3 modifiers)`.
Per frame: `step = move (unit) × effectiveSpeed × dt`, applied through the
two-source per-axis slide resolver (§4.2). Facing (`angle`): equals `aim` when not
firing; equals fire direction while firing (ADD precedence). Knockback velocity
`kv` is integrated **separately** and decays by `exp(-friction·dt)` (ADD pattern),
zeroed under a small threshold.

### 4.2 Collision resolver (amends `world.js` + consults the dynamic set)

**Amendment to `world.js` (re-add, extended):** restore `moveBody`'s per-axis
slide, but the blocked-test is `bodyHitsWall(x,y,r) || bodyHitsBlocker(x,y,r)`.
`bodyHitsWall` (kept, unchanged) covers static terrain **and closed doors** (via
the Phase-2 tile-state resolver). `bodyHitsBlocker` is **new** and scans the
dynamic movable set.

**The two collision sources (§13.3 / SPEC-LEVEL §4.5).** Static grid via
`world`; dynamic movable entities via the `G` arrays the loader populates
(`G.crates`, `G.barrels`, `G.spawners`). SPEC-LEVEL §4.5 envisioned "one blockers
set"; the loader instead pushed movable entities to those typed arrays *and*
called `navSink.registerBlocker` (a no-op today). **For collision, consult the
typed arrays directly** (small counts; a unified blocker set / spatial index is a
future perf refactor, flagged §11). A blocker occupies one tile footprint
(radius ≈ `TILE/2`); overlap test is circle-vs-circle at tile centers.

**Crate/barrel solidity depends on carry-eligibility (P2 consequence):**
- **Hands-free** player: crates and barrels are **pickup triggers, not walls**
  (contact → CARRYING, §9). Spawners are always solid.
- **Carrying** player: **all** movable blockers (crates, barrels, spawners) are
  solid — no swap on contact (§7.1.2).
- **VAULTING** player: no collision at all (§5).

### 4.3 World interactions triggered by position (this spec owns; uses loader seams)

- **Pressure-plate press by weight (§7.1.6).** While the player overlaps a `_`
  plate tile, that plate is held pressed; on leaving, released. A **dropped
  crate** resting on a plate holds it pressed. Both call the loader's plate seam.
  **Loader amendment (surfaced):** the loader exposes `setPlatePressed(id,bool)`
  keyed by **id**, but presser code works in **coordinates**. Add a coord-keyed
  path — `setPlatePressedAt(tx,ty,bool)` (or `plateIdAt(tx,ty)`) — to
  `level-loader.js`; this spec calls it. (Interface refinement of the seam
  SPEC-LEVEL delegated to #2; not new design.)
- **Key-spend on a locked door (§3.6).** If movement is blocked by a **closed
  `D`** tile and `G.keys ≥ 1`: decrement `G.keys`, call the loader's
  `openLockedDoor(tx,ty)` (exists), then allow the move (the tile is now
  passable; nav is dirtied by the loader). The presser reads `world.map` to
  confirm the blocking tile is a `D`. Key **collection** (adding to `G.keys`) is
  #3; **spending** is this spec.

---

## 5. Player state machine (GDD §2.5)

Locomotion is an **exclusive** state; status effects are a **non-exclusive
overlay**. Both drive movement/action rules; keep them orthogonal.

### 5.1 Locomotion (exclusive: `G.player.loco`)

| State | Entry | Exit | Rules while active |
| :-- | :-- | :-- | :-- |
| **NORMAL** | default | — | full move / aim / fire / abilities / pickup |
| **CARRYING** | hands-free contact with a free crate (§9) | drop / toss / vault / STUN-forced-drop / death | move ×0.85; **cannot fire**; fire input = release (P5); pushback active (§9); crate rendered overhead |
| **VAULTING** | moving-release drop, or wall-vault (§9) | auto after `CFG.PLAYER.vaultDur` (0.35 s) | scripted 64 px hop; **no collision** with entities/projectiles/terrain; cannot act; **invulnerable** |
| **DEAD** | `hp ≤ 0` | run ends | §2.6 death → GAME OVER (meta #6) |

**VAULTING kinematics.** On entry, record `{from, to, t:0, dur:0.35}`; `to` = the
validated landing (drop-vault: `from + 2.0 t` along move dir; wall-vault:
far-side tile past the 1-thick wall, §9). Position is a lerp `from→to` over
`dur`; collision + input processing are **skipped**; `iframe` treated as active.
On `t ≥ dur`, snap to `to`, return to NORMAL. **Landing validated at entry** — if
`to`'s tile is not walkable, the moving-release **degrades to a stationary toss**
(no vault) rather than entering VAULTING. VAULTING **cannot** be entered while
ENTANGLED or STUNNED (§2.5).

### 5.2 Status overlays (non-exclusive; stack with locomotion and each other)

| Effect | Source (deferred driver) | Duration | Rules |
| :-- | :-- | :-- | :-- |
| **ENTANGLED** | Spider web (#4) | 2.5 s | move ×0.35; each input-dir change ≥ 60° subtracts 0.3 s from remaining |
| **STUNNED** | Lightning aftermath (#5) | 3.0 s | move input replaced by a random unit vector re-rolled every 0.3 s at ×0.7; **firing still allowed**; abilities + pickup locked; **forces immediate drop** of any carried object |
| **POST-HIT INVULN** | any damage taken (this spec) | 0.4 s | no damage accepted; (render flicker is #7) |

**Drivers are deferred but the overlay logic is built now** and testable by
setting `entangle`/`stun`/`iframe` directly. STUN forcing a drop, the ≥60°
entangle-shave, and the stun random-walk are owned here; *what applies* entangle
(spider) and stun (lightning) is #4/#5. ENTANGLED + STUNNED may co-exist (rare,
legal). VAULTING blocks both entries.

---

## 6. Health, overheal, damage intake (GDD §2.1, §2.6)

### 6.1 The damage sink (owned; drivers deferred)

`applyDamageToPlayer(amount, sourceTag)` is the single entry point every damage
source calls (enemy melee/#4, enemy projectiles/#4, shrapnel/barrels-deferred,
Fire Wraith AoE/#4):
1. If `iframe > 0` **or** `loco === "VAULTING"` → **no-op** (invuln).
2. `hp -= amount` (integer). Overheal is just current `hp` above 20; damage
   subtracts from whatever band the player is in. No overheal decay (§2.1,
   adopted).
3. Set `iframe = CFG.PLAYER.iframe` (0.4 s).
4. If `hp ≤ 0` → `loco = "DEAD"`, emit `player:died` (death anim + GAME OVER are
   #6/#7). Death is **final** — single-life run (§2.6); continues are via load
   (#6), which this spec does not touch.

**Overheal cap** applies on the *healing* side (food, #3): `hp = min(hp + food,
overhealCap=30)`. This spec exposes `healPlayer(amount)` used by #3; the cap
lives here so the invariant is one place.

### 6.2 Knockback receive

`applyKnockbackToPlayer(dirX, dirY, impulse)` sets `kv` to `dir × impulse` (P4);
decay is integrated in §4.1. Tuned so displacement ≈ 0.75 t (dial).

### 6.3 Melee — player contributions + sinks only (exchange loop is #4)

§2.2 melee is a two-body exchange needing enemies, so the **overlap loop is #4's**
(it iterates enemies against the player). This spec defines what the *player*
contributes and receives, which #4's loop calls:
- Player deals **2 HP** to the contacted enemy (ADD mop value, reused).
- Enemy deals its §6.2 contact damage → `applyDamageToPlayer`.
- **Both** knocked back (§13.12): player via `applyKnockbackToPlayer`, enemy via
  its own knockback (enemy-side, #4).
- **Pair re-trigger lockout** (§2.1): a given enemy↔player pair cannot re-exchange
  until contact breaks and re-enters. This is naturally **enemy-side flag** state
  (`enemy._meleeLockout`) set/cleared by #4's loop — flagged here so #4 wires it;
  the player exposes only the sinks above (`meleeState` reserved, §2).

### 6.4 Carried-crate pushback rule (§7.1.4; wired by #4)

While the player is **CARRYING a crate**, #4's melee loop must, on player↔enemy
contact: push the enemy back **1.5 t** and **skip** the damage exchange — the
crate is a bumper. **Exception: bats** (they fly over; normal exchange). This spec
exposes `G.player.loco === "CARRYING" && carry.type === "crate"` for that loop to
read; the enemy pushback + bat exemption execute in #4.

---

## 7. Ranged fire (GDD §2.3, §2.4, §3.1) — owned

Fire runs only in NORMAL (CARRYING repurposes the input; VAULTING/DEAD can't act;
STUNNED *allows* firing per §2.5 but cannot be CARRYING since stun force-drops).

**Per-trigger flags** read from `G.powerups` (populated by #3; empty `{}` ⇒ base):
`tri = triple>0`, `big = big>0`, `fast = fast>0`, `bn = bounce>0` (P1).

**Cap (max on screen)** = `CFG.SHOT.baseMax(3) + (fast?3:0) + (tri?3:0)` (§3.1;
Fast substitutes for ADD's Rapid). **Cooldown** = `CFG.SHOT.cooldown(0.25) /
(fast ? 2 : 1)`. **Volley size** = `tri ? 3 : 1`.

**Volley gate (ADD-verified):** fire iff `fireHeld && cooldown ≤ 0 &&
playerShotCount + volley ≤ cap`, where `playerShotCount` counts `owner==="player"`
shots on screen. On fire: spawn the volley, set `cooldown`, and **decrement each
active counter by 1** (`if(tri)triple--; if(big)big--; if(fast)fast--;
if(bn)bounce--;`) — one trigger = one shot off each active power-up (§3.1).

**Volley spawn:** muzzle at `player + aimUnit × (r + CFG.SHOT.muzzle)`. Triple =
three shots at `angle-Δ, angle, angle+Δ` (Δ = 0.2094 rad); else one. Each Shot:
`vx,vy = aimUnit × CFG.SHOT.speed(288)`; `r = CFG.SHOT.r × (big?1.6:1)`;
`dmg = 1 × (big?2:1)`; `owner="player"`; `bounce=bn`. (Audio `sfx.shoot()` one
bloop per trigger — audio is a leaf seam, §10.)

---

## 8. Player shots — `projectiles.js` (motion & ricochet owned; damage deferred)

First occupant of `projectiles.js`; enemy arrows + shrapnel join later behind the
same `owner`-tagged shape. **Per frame, per shot:**
- Integrate `x += vx·dt; y += vy·dt`; `traveled += |step|`.
- **Expire** at `traveled ≥ CFG.SHOT.range(224)`; a **non-bounce** shot also
  expires on first wall/obstacle contact.
- **Ricochet (two sources, §7.1.1):**
  - **Crates always ricochet all straight projectiles** — even without the Bounce
    power-up (§7.1.1, §3.1, §13.23). A player shot hitting a crate reflects
    (per-axis, ADD pattern) and **retains `owner` + `dmg`**.
  - **Bounce power-up** additionally ricochets off **walls, tombstones, pillars,
    and closed doors** (§3.1). Reflection is ADD's per-axis method (reflect `vx`
    on an x-blocked step, `vy` on a y-blocked step, both in the corner case);
    range is **not** reset by a bounce (ADD rule); `bounceCount++`.
  - **Bounced player bullets never damage the player** (§3.1, proposed) — relevant
    once the damage layer lands.
- **Damage exchange with targets is DEFERRED** — enemies/barrels/spawners don't
  exist for the player bullet to hit. When #4/combat lands, the shot→target hit
  test + `dmg` application + attribution (§9) attach here, reading `owner`.
  Motion, expiry, and ricochet are complete and testable now (against walls +
  fixture crates).

---

## 9. Crates — the carry system (GDD §7.1) — owned

**Pickup (§7.1.2).** Automatic on contact while hands-free (no button). On
hands-free player overlap with a free crate: enter CARRYING, set
`G.player.carry = {type:"crate", entity}`, **remove the crate from the collision/
nav sources** (splice from `G.crates`; `markNavDirty` its old tile via the loader
seam) so it stops blocking while held. If already carrying, contact does nothing
(no swap) — and the crate is solid (§4.2).

**Drop / toss (§7.1.3, P5).** On release (fire input while CARRYING):
- **Stationary release → short toss.** Raycast up to **1.5 t** along `aim` from
  the player; the crate settles static on the **first free tile** (stopping early
  at any wall/blocker/plate-legal tile). Minimum range = a 1-tile placement. It
  **never rolls** (§7.1.6). Re-insert the crate into `G.crates` + nav at the
  settle tile; if that tile is a `_` plate, press it (§4.3). Return to NORMAL.
- **Moving release → drop + auto-vault.** Drop the crate on the player's current
  tile (re-insert into `G.crates`+nav; press plate if `_`), then enter **VAULTING**
  toward `from + 2.0 t` along `move`. Landing validated at entry (§5.1); if the
  landing tile is not walkable, **degrade to a stationary toss** instead.

**Wall-vault (§7.1.5).** While CARRYING and movement is blocked by a **wall
exactly one tile thick along the move axis** whose **far-side tile is walkable**:
auto-drop the crate against the near face (re-insert + press-plate as above) and
enter VAULTING to the far side (path = 2 t + wall). **Detection raycast** from the
player tile along `move`: `ahead1` solid (the wall) **and** `ahead2` walkable ⇒
1-thick ⇒ vault; if `ahead2` is also solid ⇒ ≥2-thick ⇒ **no vault, just a bump**
(§7.1.5, explicit — the hop can't clear two tiles). Crate-only (barrels excluded,
§7.2.2).

**Carried-crate pushback (§7.1.4).** The rule is defined in §6.4; it is a
CARRYING-state modifier that #4's melee loop reads.

**Static properties this spec relies on (§7.1.1).** A resting crate is solid to
ground entities, **blocks enemy LOS**, and **ricochets all straight projectiles**
(§8). It is **indestructible** — nothing here or later destroys it (§13.16). Bats
fly over; the Reaper is blocked (both #4 concerns). Lobbed arcs ignore crates
(#4). No pits/gaps exist in the design (§7.1.6) — traversal utility is the vault
family, not gap-filling.

**Object placement (§7.3).** Crates enter via loader **placements** and
**spawn-rules** (already built, SPEC-LEVEL §4.4) — this spec consumes crate
entities the loader produced; it does not place them.

**Barrels (§7.2): DEFERRED** — see scope note. `G.player.carry.type` is
`"crate"`-only in this spec; the field is shaped to admit `"barrel"` later
without a rework.

---

## 10. Seams to later systems (interfaces only — no behavior here)

- **Abilities (#5, §5).** `input.nova`/`input.lightning` are edge-triggered here
  and routed to a registered handler: `registerAbility("nova"|"lightning", fn)`,
  default no-op (register-callbacks; `player.js` never imports `abilities.js`).
  Gem economy / Nova fuel is #5/#3.
- **Enemy melee overlap loop + pushback + pair-lockout (#4).** Consumes §6.3/§6.4
  player contributions and sinks; owns the enemy side.
- **Damage drivers (#4 / barrels-deferred).** All call `applyDamageToPlayer`.
- **Pickup collection & granting (#3, §3).** Weapon power-ups (write `G.powerups`),
  food (`healPlayer`), treasure/score, gems, magnet, **key collection** (write
  `G.keys`). This spec only *reads* `G.powerups` and *spends* `G.keys`.
- **Nav blocker sink (#3).** Carry/drop dirties nav via the loader's
  `markNavDirty` seam (already present); the real sink is #3.
- **HUD (§10) / render + dark (#7) / audio (leaf).** This spec emits events /
  calls `sfx.*` behind seams; no rendering or HUD here. Health-bar, shot visuals
  (§2.4), overhead-crate render are #7.
- **Events.** `player:died`, `player:fired`, `crate:pickup/dropped`,
  `door:unlocked` emitted through the loader's `emit` seam (snapshot payloads,
  one-way).

---

## 11. Known implementation risks (flag before building)

- **`moveBody` was deleted (Phase 2) — re-add + extend (§4.2).** Player movement
  needs it back, now testing **two** sources. Update `world.js` and STATUS.md's
  code map; add `bodyHitsBlocker`.
- **Loader amendment for coord-keyed plate press (§4.3).** `setPlatePressed` is
  id-keyed; the presser works in coordinates. Add `setPlatePressedAt(tx,ty,bool)`
  (or `plateIdAt`) to `level-loader.js`. Small, but it touches shipped Phase-3
  code — review it as an amendment, not a fresh file.
- **Circular imports.** `player ↔ enemies`, `player ↔ combat`, `player ↔
  abilities`: resolve with **register-callbacks** (abilities handler registry;
  enemies/#4 own the melee loop and call *into* player sinks, player never imports
  them). `input ↔ player`: one-way — `player` imports `input`'s snapshot getter;
  `input` imports only config/state. `player ↔ projectiles`: player imports a shot
  **factory** from `projectiles`; `projectiles` imports config/state/world only,
  never player (owner is a string tag, not a back-reference). Record each in
  STATUS.md when built.
- **Frame update ordering (load-bearing).** Within the player subsystem:
  `snapshot → status timers (iframe/entangle/stun/cooldown) → status-forced
  effects (stun drop) → move+collision (+plate/key) → carry actions (pickup/
  release/vault) → fire → shots update`. Vault must short-circuit move+carry+fire
  (can't act). Getting stun-drop *after* fire, or fire *before* the carry check,
  produces "fired while carrying" bugs. Flagged so it's not discovered mid-impl.
- **Testability boundary.** Keep `player.js` a pure function of *(snapshot, dt,
  world/G state)* so headless tests drive it with synthetic snapshots — no device
  or canvas import reaches `player.js`. Device glue stays in `input.js`.
- **Two-collision-source consult is O(n) per move** — fine at current entity
  counts; a unified blocker set / spatial index is a future perf refactor, not
  now (SPEC-LEVEL §4.5's "one set" ideal deferred).
- **Sentinel-over-`Infinity`:** N/A here (no "permanent" serialized numeric — HP,
  timers, counts are all finite/transient). Flagged only to confirm considered.
- **Big×hitbox vs Big×damage** are independent multipliers (1.6 radius, 2×
  damage) — don't collapse them into one "big" scalar (P1).

---

## 12. Headless smoke tests (pure logic, no canvas — ADD `test-loader.js` style)

Stub browser globals, dynamically import the **real** modules, tiny `check`/
`throws` harness. Deliver with the code. Minimum assertions:

1. **Snapshot derivation.** `deriveSnapshot` normalizes 2-key diagonals to unit
   length; resolves aim from cursor+camera (kbd) and stick (pad); applies the 0.2
   deadzone; mode lock ignores the opposing device.
2. **Movement + slide.** A move into a wall slides along it (per-axis revert); a
   move into a spawner is blocked; a move into a **free crate while hands-free**
   is *not* blocked (triggers pickup); the same crate blocks a **carrying** player.
3. **Speed stacking (P3).** Effective speed = base × Π(carry/entangle/stun); a
   carry-while-entangled case equals `112 × 0.85 × 0.35 px/s`.
4. **Fire gate + power-ups.** Base fire respects cooldown and `count+volley ≤ cap`;
   Triple spawns 3 at ±12°; Fast halves cooldown and +3 cap; Big sets dmg 2 /
   r×1.6; each trigger decrements every active counter by exactly 1; cannot fire
   while CARRYING; can fire while STUNNED.
5. **Shot motion + ricochet.** A shot expires at 224 px; a non-bounce shot dies on
   first wall; a **bounce** shot reflects off a wall (per-axis) and off a fixture
   **crate**, retaining `owner`/`dmg`, range not reset; a **non-bounce** shot also
   ricochets off a crate (crate-always rule) but not off a wall.
6. **Damage intake.** `applyDamageToPlayer` subtracts HP, sets 0.4 s iframe, is a
   no-op during iframe and during VAULTING; overheal band subtracts correctly;
   `healPlayer` clamps at 30; `hp ≤ 0` → DEAD + `player:died`.
7. **State machine.** CARRYING entry on hands-free crate contact; stationary
   release tosses ≤ 1.5 t to first free tile and presses a `_` under it; moving
   release enters VAULTING to +2 t and is invulnerable + non-colliding for 0.35 s;
   moving release onto a non-walkable landing **degrades to a toss**; STUN
   force-drops a carried crate; VAULTING cannot start while ENTANGLED/STUNNED.
8. **Wall-vault.** 1-thick wall with walkable far side ⇒ auto-drop + vault to far
   side; 2-thick wall ⇒ no vault (bump), crate still carried.
9. **World hooks.** Standing on a `_` presses its linked door open (through the
   loader), leaving releases it; a dropped crate on a `_` holds it; bumping a
   closed `D` with `keys ≥ 1` spends one key and opens it (door tile becomes
   passable), with `keys = 0` it just blocks.
10. **Entangle shave.** A ≥ 60° input-direction change subtracts 0.3 s from
    remaining entangle; sub-threshold changes do not.

---

## 13. Open design questions

**Deferred, not open:** barrels (§7.2) → `SPEC-BARRELS`, post-#4; the melee
overlap loop, enemy knockback/pushback, pair-lockout wiring → #4; ability triggers
→ #5; pickup collection → #3. These have defined seams above.

Still open (tuning / play-feel — none block building the mechanism):
- **Q-P1 — Player radius & knockback impulse.** `CFG.PLAYER.r` (12 px) and the
  `knockbackImpulse`/friction that realize the 0.75 t / 0.5 t targets (P2/P4) want
  a movement-feel pass (gap-fit through 1-tile doorways vs. body size). Dials.
- **Q-P2 — Shot radius & muzzle offset.** `CFG.SHOT.r` (proposed 6 px, ADD value)
  and `muzzle` are cosmetic-ish but affect crate-ricochet feel. Dials.
- **Q-P3 — "Moving" threshold for release (P5).** Adopted as move-input-nonzero;
  confirm that feels right vs. a small velocity threshold (a player tapping a
  direction at release could get an unwanted vault). Play-feel.
- **Q-P4 — Vault mid-air landing contention.** Landing is validated at entry, but
  an enemy could occupy the landing tile during the 0.35 s hop. Adopted: land
  anyway (vault is invulnerable + non-colliding, §2.5), resolve overlap next frame
  as normal melee. Confirm that's acceptable vs. a re-check on land.
- **Q-P5 — OPKL keyboard-only fallback (§13.10).** Dropped for now (mouse
  mandatory). If keyboard-without-mouse matters, a fallback fire scheme is a later
  add — flagged, not designed.

---

## 14. ADD source provenance (what was verified, where, disposition)

| GDD / spec claim | ADD source checked | Finding / disposition |
| :-- | :-- | :-- |
| Volley gate `count + volley ≤ cap`; per-trigger counter decrement | `src/player.js` `updateDan` | REUSED verbatim (gate + decrement); cap formula adapted (Fast↔Rapid, Big split out) |
| Cap = base + 3·rapid + 3·triple | `src/player.js`; `config.js` `SHOT_MAX_ON_SCREEN` | ADAPTED: base 3 + 3·Fast + 3·Triple (§3.1) |
| Big ≡ Triple visual (one flag) | `src/player.js` `fireBubble(angle, big=triple, …)` | **DIVERGED (P1):** four independent flags in Repossessed |
| Per-axis slide collision | `src/world.js` `moveBody` / `bodyHitsWall` | REUSED pattern; **`moveBody` was deleted in Phase 2 → re-add + extend to 2 sources (§4.2)** |
| Knockback = initial velocity + exp friction | `src/player.js`; `config.js` `KNOCKBACK_*` | REUSED model; GDD tile distances become tuned impulse dials (P4) |
| Bounce = per-axis wall reflection, range not reset | `src/player.js` `updateShots` | REUSED; **extended** to crates (2nd source) + crate-always ricochet (§8) |
| Muzzle offset `r + n`; one sfx per trigger | `src/player.js` `fireBubble`/`fireVolley` | REUSED (muzzle `r + CFG.SHOT.muzzle`; audio a leaf seam) |
| Player speed / shot speed / range / cooldown | `config.js` `DAN_SPEED 185`, `SHOT_SPEED 470`, `SHOT_RANGE 360`, `SHOT_COOLDOWN 0.16` | **OVERRIDDEN by GDD tile values (P7):** 112 / 288 / 224 px, 0.25 s |
| Input mode lock (`G.inputMode`, session lock, reset by `newGame`) | ADD input model (§4.2 / §13.11) | REUSED unchanged; OPKL keyboard-fire DROPPED (§13.10), aim 360° both modes |
| Kicked-object slide/friction/bounce physics | `src/dustbin.js` `slideStep`/`detonate` | **NOT USED here** — that's the deferred **barrel** kick (§13.8); crate toss is a simple settle (§9) |

---

*End SPEC-PLAYER — pairs with GDD §2, §4, §7.1 (and §3.1/§3.6 read-only, §9
attribution deferred). Amends `world.js` (re-add `moveBody`, add `bodyHitsBlocker`)
and `level-loader.js` (coord-keyed plate press). Barrels (§7.2) deferred to
`SPEC-BARRELS`. Next step (separate, after human review): generate phased Claude
Code prompts from this spec.*