# SPEC-PICKUPS — Contact Collection, the Magnet, Gem Despawn & the Pickup Value Tables (`pickups.js`)

**Implementation-detail layer for GDD §3 (Power-ups & Pickups): §3.1 weapon
power-ups, §3.2 Magnet, §3.3 Food, §3.4 Treasure, §3.5 Gems, §3.6 Keys — reading
§2.1 (health & the 30-HP overheal cap), §5.1 (the Nova gem-energy bar this feeds),
§6.2/§6.3 (the enemy gem-drop table, already built), §8.2 (locked doors, the
key-spend side already built), §9 (scoring).** Design intent lives in GDD §3; build
reality in `STATUS.md`. This is the post-#6 (barrels) collection-side spec: it turns
the entities that already land in `G.pickups` — placed food/treasure/key/power-up
placeholders **and** enemy-dropped gems — into felt effects on contact, adds the one
duration-based power-up (Magnet), and gives gems their 12 s despawn clock.

**Scope boundary (pinned):** this spec owns the **collection / contact-detection**
pass for everything in `G.pickups` (gems, food, treasure, keys, weapon power-ups,
Magnet), the Magnet's pull-radius / duration / refresh mechanics, the gem despawn
timer, the placeholder→value **decoration** of placed pickups (via the sanctioned
wrap-and-override factory seam), and the new `CFG` value tables. It routes each
collected pickup into an **already-existing sink** — it reinvents none of them.

**Out of scope (do not spec or touch here):**

- **Placement / routing** — where pickups are placed and which `G` array they land
  on (loader/generator + `ENTITY_ARRAY`, already built, subsystem #1). This spec
  decorates the placeholder's *field shape*; it never changes *where* or *whether*
  one is placed.
- **`dropGems` (enemies.js, §6.3)** — the gem *source* is built and correct
  (`{type:"gem", x, y, value: CFG.GEM.energy}` ×`e.gems` on every enemy/spawner
  death). Untouched. The gem despawn clock is seeded **collection-side** precisely so
  this file stays byte-for-byte the same (§3 R2).
- **The key-spend / door-unlock side** — `moveWithKeySpend` / `trySpendKeyForDoor` /
  `G.keys--` / `door:unlocked` (player.js, §8.2) is fully built. This spec only
  *increments* `G.keys` on key contact; it never spends.
- **Nova / Lightning mechanics** — built (subsystem #5). This spec calls exactly one
  entry point, `addGemEnergy(value)` (abilities.js A6), as the gem sink. Nothing
  else in abilities.js is read or written.
- **The bounce-shot / big-shot / triple / fast *ballistics*** — built in the
  player.js fire hook + projectiles.js. This spec *grants* the shot counters the fire
  hook already consumes; it does not change how a granted shot flies. In particular
  the §3.1 *(proposed)* "bounced player bullets never damage the player" rule is a
  **shot-vs-player collision** concern (projectiles.js / the shot pass), **not
  collection** — explicitly not resolved here.
- **Rendering / audio / FX** — this spec *emits* `pickup:collected` (snapshot
  payload); #7/#10/#11.3 draw sprites, play the collect blip, and animate the Magnet
  aura. No canvas, no sprite, no sound synthesis here.
- **The boot `import "./pickups.js"` + wiring `updatePickups(dt)` into the main
  loop** — integration debt, exactly as still owed for `abilities.js` and
  `barrels.js` (STATUS). This spec delivers the module + headless tests; the loop
  wiring is the downstream integration phase.

---

## 1. Resolved decisions (forks the GDD/architecture leave that code cannot skip)

Pickups are the *least* cross-cutting subsystem since barrels: every sink already
exists, `G.pickups` is already unified, and placement is already done. The whole
subsystem is one new leaf module plus data.

**Cross-file edits this subsystem makes (the sign-off-first list):**

- **NEW `src/pickups.js`** — the entire module: the value tables' *consumers*, the
  four decoration factory overrides, `updatePickups(dt)` (Magnet pull → gem age →
  contact collection), and test-facing helper exports.
- **`config.js`** — additive data only: new `CFG.PICKUP` (Magnet + grab radius + gem
  despawn + the power-up grant amount), new `CFG.FOOD`, new `CFG.TREASURE`. No
  existing dial changes. `CFG.GEM.energy` (=5) is **reused unchanged** and **not**
  re-declared.
- **Exactly one reset line — `level-loader.js` `clearTransient`.** The Magnet timer
  `G.magnet` is **transient** (ruled §11): add `G.magnet = 0;` beside the adjacent
  `G.novas = []` in `clearTransient`, so it clears on every level load exactly like the
  Nova ring list. No `state.js` / `G`-shape edit — a transient timer is never serialized
  and never carried across nights.

**No edit to `enemies.js`, `player.js`, `abilities.js`, or `world.js`.** `pickups.js`
*imports* `healPlayer` (player.js) and `addGemEnergy` (abilities.js) as sinks; it does
not modify them. Import graph is a clean DAG leaf — nothing imports `pickups.js`
(verified), so no circular-import hazard exists (contrast barrels' register-callback
gymnastics; none needed here).

**D1 — Decorate by wrapping the loader's placeholder, not replacing it.** Placed
food/treasure/key/power-up arrive as inert `mkPlaceholder(false)` →
`{type, x, y, tc, blocks:false, kind?}`. `pickups.js`, at module load, captures the
base factory (`getEntityFactory(type)`) and re-registers a wrapper that runs the base
then attaches the value/tier field from the new `CFG` table keyed on `e.kind`. This
is the **SPEC-ENEMIES §0.4 wrap-and-override** pattern (the same one the spawner
factory uses), so the placeholder's already-computed `x/y/tc/kind` are reused, not
recomputed — `pickups.js` need not even import `tileCenter`. `registerEntityFactory`
is `Map.set` (last-wins, verified), so the wrapper wins **provided the boot module
imports `level-loader.js` before `pickups.js`** (R1).

**D2 — Each pickup carries exactly the one field its sink consumes.** Decoration
attaches: food → `heal`; treasure → `points`; power-up → `power` (the kind, a collect
discriminator); key → nothing (contact ⇒ `G.keys++`); gem → already carries `value`
(from `dropGems`, untouched). No pickup carries a field its sink doesn't read.

**D3 — Collection routes to existing sinks, one branch per `type`:**

| `type` | field read | sink (already built) | net effect |
| :---- | :---- | :---- | :---- |
| `gem` | `value` (=5) | `addGemEnergy(value)` (abilities.js A6) | fills Nova bar / banks charges |
| `food` | `heal` (5/10) | `healPlayer(heal)` (player.js) | HP up, **clamped to `G.overhealCap`=30** by the sink |
| `treasure` | `points` (100/250/500) | `G.score += points` | mirrors `awardKill`'s `G.score += e.points`; no helper needed |
| `key` | — | `G.keys++` | the collect side; spend side (§8.2) untouched |
| `powerup` (`power`∈{triple,big,fast,bounce}) | `power` | `G.powerups[power] = (G.powerups[power]∣∣0) + CFG.PICKUP.powerupShots` | +75 shots to that counter the fire hook already decrements |
| `powerup` (`power`==`magnet`) | `power` | `G.magnet += CFG.PICKUP.magnet.duration` | starts/extends the Magnet timer (§3.2) |

**D4 — The `powerup` entity spans five kinds; branch on `power` BEFORE the +75
grant.** `magnet` is a `powerup` placement kind but is **not** a shot-count grant.
The collect handler must branch first, or a Magnet pickup would write a phantom
`G.powerups.magnet = 75` the fire hook never reads (harmless but wrong). Structural
branch, not a special-case skip (R5).

**D5 — The +75 grant amount is net-new config; it lives in `CFG.PICKUP.powerupShots`,
not `CFG.SHOT`.** No grant dial exists today (verified: the fire hook only *consumes*
`G.powerups`, nothing grants). `CFG.SHOT` stays about ballistics (rate, spread, Big
multipliers); all pickup-economy dials sit together in the net-new `CFG.PICKUP`.
Value = **75**, ADD's shipped `POWERUP_SHOTS` (§12, verified).

**D6 — Gem despawn clock is lazy-seeded collection-side; `dropGems` stays untouched.**
Gems arrive without a `life` field (dropGems is fenced). `updatePickups` lazy-inits
`gem.life` to `0` on first sight (`if (gem.life == null) gem.life = 0`), then ages it
`+= dt`, splicing at `life >= CFG.PICKUP.gemDespawn` (12 s). This is the SPEC-BARRELS
§5.2 shrapnel `life`/`lifespan` despawn pattern, seeded lazily (at first update)
instead of at creation (barrels seed at `spawnShrapnel`) — the only adaptation, forced
by the dropGems fence. Despawn applies to **gems only**; placed pickups
(food/treasure/key/power-up) never despawn — they persist until collected (§3.1–3.4,
3.6 name no despawn).

**D7 — Magnet targets gems only; pull runs before contact within a frame.** §3.2:
"Affects gems only — not food, treasure, keys, or weapon power-ups." The pull pass
moves in-range gems toward the player *before* the contact pass, so a gem pulled into
grab range collects the same frame (R3).

**D8 — Magnet refresh is additive (+duration), inherited from GDD.** §3.2: "Duplicate
pickups refresh/extend the timer by +10 s." So `G.magnet += duration` (stacking), not
`G.magnet = duration`. Not an open question — GDD is explicit. (No cap stated; left
uncapped. A cap is a trivial later tune if wanted.)

**D9 — Collection is loco-agnostic.** §3: "All pickups are collected automatically on
contact." No player-state gate — you collect food while CARRYING a crate, while
STUNNED, etc. (Contrast the fire hook, which gates on `NORMAL`.) The contact pass reads
only positions, never `p.loco`.

**D10 — `G.magnet` is the timer field name (not `G.pickupTimer`).** `G.pickupTimer`
already exists (a spawn-cadence field cleared in `clearTransient`) and is unrelated;
reusing it would clobber it. The Magnet timer is a distinct new field, `G.magnet`
(seconds remaining, a plain number; `0`/absent ⇒ inactive).

---

## 2. Data shapes

### 2.1 `G` arrays / fields

- `G.pickups` — **already exists**, unified, transient (created/cleared by the loader
  in `clearTransient`). Holds every pickup: placed (food/treasure/key/powerup) and
  dropped (gem). This spec reads/splices it; it does not create or clear it.
- `G.magnet` — **new, transient** (ruled §11). Seconds of Magnet remaining; `0`/absent
  ⇒ inactive. Cleared on every level load in `clearTransient` (beside `G.novas`); not
  on the persistent `G` shape, never serialized. No other new `G` field — power-up
  counters (`G.powerups`), keys (`G.keys`), score (`G.score`), gem energy (via
  `addGemEnergy`) all exist.

### 2.2 Pickup entities (placeholder + `pickups.js` decoration)

```
// gem  — from dropGems (enemies.js), UNTOUCHED; life seeded lazily by updatePickups
{ type:"gem",      x, y, value: 5,  life?:<seeded 0 on first update> }

// after pickups.js factory wrap of the loader's inert placeholder:
{ type:"food",     x, y, tc, blocks:false, kind:"candy"|"feast",                         heal:   5|10 }
{ type:"treasure", x, y, tc, blocks:false, kind:"candyCorn"|"silverSkull"|"goldChest",   points: 100|250|500 }
{ type:"powerup",  x, y, tc, blocks:false, kind:"triple"|"big"|"fast"|"bounce"|"magnet", power:  <=kind> }
{ type:"key",      x, y, tc, blocks:false }                                              // no value field
```

Decoration reads `e.kind` (already copied from `p.kind` by the base placeholder) and
attaches the sink field. `power` is just `kind` surfaced under the name the collect
branch reads.

### 2.3 `CFG.PICKUP` (new; spatial dials in **tiles**, `×CFG.TILE`=32 at read — matching the `CFG.ABILITY` convention)

```
PICKUP: {
  grab:         0.5,   // tiles — contact grace; contact when hypot(player,pickup) < player.r + grab·TILE
  gemDespawn:   12,    // s — uncollected gems vanish (§3.5)
  powerupShots: 75,    // shots granted per weapon power-up (§3.1; ADD POWERUP_SHOTS, verified) (D5)
  magnet: {
    radius:    6,      // tiles — pull range (§3.2 proposed)
    pullSpeed: 10,     // tiles/s — pull speed (§3.2 proposed)
    duration:  10,     // s — grant/refresh amount, additive (§3.2 proposed, D8)
  },
},
```

### 2.4 `CFG.FOOD` (new; HP, §3.3 — values mirror ADD vending, verified §12)

```
FOOD: { candy: 5, feast: 10 },     // heal amounts; healPlayer clamps to overhealCap(30)
```

### 2.5 `CFG.TREASURE` (new; points, §3.4 *proposed tiering*)

```
TREASURE: { candyCorn: 100, silverSkull: 250, goldChest: 500 },
```

`CFG.GEM = { energy: 5 }` **already exists — reused, not re-declared.**

### 2.6 Emitted event

```
emit("pickup:collected", { type, kind?, x, y, amount })
// amount = value | heal | points | powerupShots | magnet.duration, per type — a
// snapshot for the audio leaf (#11) + collect FX (#10). One event, kind-discriminated
// (noun:verb, matching door:unlocked / barrel:exploded / enemy:killed). Gems are
// high-frequency; a single throttleable event is intended. Despawn is silent (no
// event) — see §5 (a pickup:expired fade event is an optional #10 add, not spec'd here).
```

---

## 3. The decoration factories (`pickups.js`, module load)

Mirror the spawner wrap (SPEC-ENEMIES §0.4). At module load, for each of
`food`/`treasure`/`powerup` (and optionally a thin `key` wrap — a no-op, so it may be
left as the loader's placeholder):

```
const baseFood = getEntityFactory("food");
registerEntityFactory("food", (p) => { const e = baseFood(p); e.heal = CFG.FOOD[e.kind]; return e; });
// treasure → e.points = CFG.TREASURE[e.kind]
// powerup  → e.power  = e.kind
```

**Contract:** these overrides must be registered **after** `level-loader.js` has
registered its inert placeholders — guaranteed by boot import order (R1). Wrapping
(not replacing) means the loader keeps ownership of coord/`tc`/`kind`/`blocks`; this
file only bolts on the value field. Unknown/absent `kind` ⇒ `CFG.FOOD[undefined]` is
`undefined`; a decorated pickup with an undefined value is a placement-data bug, not a
runtime crash — assert/log-worthy in a debug build, but the collect sink treats a
missing value as a no-op grant (defensive; a `heal` of `undefined` → `healPlayer` is
guarded by the value table being authoritative, so mis-kinded data simply grants 0).

---

## 4. `updatePickups(dt)` — the per-frame collection pass

Runs once per frame (wired downstream, §Out-of-scope). Order is load-bearing (R3):

1. **Magnet pass** (only if `G.magnet > 0`):
   - `G.magnet = Math.max(0, G.magnet - dt)`.
   - `range = CFG.PICKUP.magnet.radius · CFG.TILE`; `step = CFG.PICKUP.magnet.pullSpeed · CFG.TILE · dt`.
   - For each `g` in `G.pickups` with `g.type === "gem"`: let `dx = p.x - g.x`,
     `dy = p.y - g.y`, `d = hypot(dx,dy)`. If `0 < d ≤ range`, move `g` toward the
     player by `min(step, d)` (normalize by `d`). Never overshoot. Gems only — no
     other type is touched.

2. **Contact + despawn pass** — single reverse iterate over `G.pickups` (reverse so
   splices don't skip):
   - If `g.type === "gem"`: lazy-init `if (g.life == null) g.life = 0`; then
     `g.life += dt`. If `g.life >= CFG.PICKUP.gemDespawn` → `splice(i,1)` (expired,
     **no** collect, silent) and continue.
   - **Contact test** (squared-distance, matching `firstOverlappingCrate`):
     `rr = p.r + CFG.PICKUP.grab · CFG.TILE`; if `dx*dx + dy*dy < rr*rr` → **collect**:
     route by `type` (D3, with the D4 `power` branch), `emit("pickup:collected", …)`,
     then `splice(i,1)`.

No `p.loco` gate anywhere (D9). No allocation in the hot loop beyond the event
payload. If `G.pickups` is empty/absent, the pass is a no-op (guard `if (!G.pickups)
return`).

**Why pull-before-contact-before-despawn:** a gem pulled into grab range this frame is
collected this frame (satisfies §3.5's "Magnet is the intended counter to the despawn
timer" — the Magnet must win the race against the 12 s clock); and a gem is never both
collected and expired in one frame (collect splices it; the expiry check ran first but
only splices when *not* about to be collected — since expiry `continue`s, an expired
gem is simply gone before the contact test, and a live gem falls through to contact).

---

## 5. Gem despawn & the scatter question

The 12 s despawn is **in scope and built** (D6, §4). The §3.5 clause that gems
"**scatter with a small impulse**" is **deferred** (ruled, §11 OQ-P2). As shipped by
`dropGems`, all `e.gems` gems land stacked at the exact death point with no velocity,
and `dropGems` is fenced out of this spec. Scatter is revisited later as either a
one-line `dropGems` touch (enemies.js) or a render-side jitter (#7); it changes nothing
about collection, despawn, or Magnet, so its absence blocks nothing here.

---

## 6. Seams to later systems (interfaces only)

- **#7 (render) / #10 (FX) / #11 (audio):** consume `pickup:collected` (snapshot
  payload, §2.6). #10 owns the Magnet aura + collect burst; #11 owns the blip
  (throttle gems). None reach back into `G.pickups` — the payload is self-contained
  (one-way flow / snapshot-into-payload).
- **HUD (#10):** reads `G.magnet` (seconds remaining, for an aura/countdown),
  `G.keys` (icon+count), `G.powerups` (per-power remaining-shots), `G.gemEnergy` /
  `G.storedCharges` (the Nova bar) — all already-live fields; this spec adds only
  `G.magnet` to that set.
- **SPEC-SCORING:** treasure adds to `G.score` directly here (mirroring the interim
  `awardKill` convention); if scoring is later centralized, the treasure branch swaps
  to the new sink — a one-line change, isolated.

---

## 7. Known implementation risks (flag before building)

- **R1 — Factory-override load order.** `pickups.js`'s `registerEntityFactory`
  overrides for food/treasure/powerup must run *after* `level-loader.js` registers the
  inert placeholders. `registerEntityFactory` is last-wins (`Map.set`, verified), so
  correctness hinges purely on the boot module importing `level-loader.js` before
  `pickups.js` — the same load-order contract as the enemy/ability/barrel factory
  overrides. Flag in the integration phase.
- **R2 — Gem `life` lazy-init contract.** Gems arrive without `life` because
  `dropGems` is fenced. `updatePickups` seeds it. If a future change adds `life`
  (or scatter) at drop time, the lazy `if (g.life == null)` guard makes double-init a
  no-op — but that guard is the contract; don't remove it.
- **R3 — Intra-frame ordering.** Magnet pull → gem age/expiry → contact, in that
  order, single reverse splice pass (§4). Reordering (e.g. despawn before pull, or
  contact before pull) either lets the 12 s clock beat an active Magnet or double-
  handles a gem. Order-sensitive; note it.
- **R4 — `G.magnet` vs `G.pickupTimer` collision.** Use `G.magnet`; `G.pickupTimer`
  is a pre-existing, unrelated spawn-cadence field (D10).
- **R5 — `powerup` kind branch precedes the +75 grant.** Branch on `power` first;
  `magnet` is a `powerup` kind but not a shot grant (D4). Correctness, not polish.
- **R6 — Do not implement bounce-never-hurts-player here.** It's a shot-vs-player
  collision rule (projectiles.js), out of scope; this file only grants the `bounce`
  counter.
- **R7 — Mis-kinded placement data.** A food/treasure/powerup placed without a valid
  `kind` decorates to an `undefined` value; the value table is authoritative and a
  missing value grants 0 (defensive no-op) rather than crashing. Loud in a debug
  build is fine; a crash is not.

---

## 8. Headless smoke tests (pure logic, no canvas — house `test-*.js` style)

Seed `G` directly; call the decoration factories and `updatePickups(dt)`; assert on
`G` and captured `emit`s. Suggested `test-pickups.js` (+ a `test-pickups-magnet.js`
split if it grows):

- **Contact routing, one per type:** gem → `addGemEnergy` credited by `value`
  (Nova bar rises / banks a charge at the boundary); food → `healPlayer` (see clamp
  below); treasure → `G.score += points`; key → `G.keys++`; powerup `fast` →
  `G.powerups.fast === 75`; a second `fast` → `150` (additive stack); powerup `magnet`
  → `G.magnet === duration` and `G.powerups.magnet` **untouched** (D4).
- **Food overheal clamp:** feast (+10) at `G.hp = 28`, `overhealCap = 30` → `hp === 30`
  (not 38) — the `healPlayer` sink owns the clamp; food overheals past base 20.
- **Gem despawn:** an uncollected gem aged `≥ 12 s` (looped `dt`) is spliced and
  credits nothing; a gem contacted before 12 s credits `addGemEnergy(value)` and does
  not linger; a gem collected the same frame it would expire is collected, not double-
  handled.
- **Magnet pull:** gem at 4 tiles (≤6) moves toward the player by `pullSpeed·TILE·dt`
  and does not overshoot; gem at 8 tiles (>6) is unmoved; a **food** at 3 tiles is
  **not** pulled (gems only); `G.magnet` ticks down by `dt` and floors at 0; an
  in-range gem pulled to within `grab` collects the same frame (pull-before-contact).
- **Magnet refresh:** collecting a second magnet adds `+duration` (additive, D8).
- **Factory decoration:** placed `food{kind:"candy"}` → `heal === 5`;
  `food{kind:"feast"}` → `10`; `treasure{kind:"goldChest"}` → `points === 500`;
  `powerup{kind:"fast"}` → `power === "fast"`; `powerup{kind:"magnet"}` →
  `power === "magnet"`; override wins over the inert placeholder (value field present).
- **Loco-agnostic collect:** set `p.loco = "CARRYING"` (or STUN) and confirm a
  contacted pickup still collects (D9).
- **Emit:** each collect fires exactly one `pickup:collected` with the snapshot
  payload; despawn fires none.

---

## 9. Model / effort recommendation (for the phased-prompt session, later)

Not part of this spec's sign-off — recorded so the prompt-generation session inherits
it. The whole subsystem is mechanical (data tables + one ordered update pass + factory
wraps), so **Sonnet, normal effort, thinking off** is the default across phases. The
**one** phase worth flagging up: the `updatePickups` intra-frame ordering (R3) + the
lazy-`life` seeding (R2) is subtle enough that **Sonnet with a written R3/R2 callout in
the prompt** should suffice — escalate to Opus only on the escalation-fallback rule if
the first pass mis-orders. No phase needs Opus by default.

---

## 10. ADD source provenance (what was verified, where, disposition)

Both §3 ADD-reuse claims were verified against **real `add2026` source** this session
(codeload tarball of `main`), not re-derived from memory:

- **§3.1 "ADD §3 pattern reused verbatim" (weapon power-ups).**
  - *Verified:* `add2026` GDD §3 — power-ups are shot-count based, **75 shots per
    pickup**, fully stackable, each tracks its remaining count independently; max-on-
    screen formula **`3 + 3·(Rapid) + 3·(Triple)`**, volley-gated. `add2026`
    `src/config.js` ships `POWERUP_SHOTS: 75` (a real constant, not merely
    "suggested").
  - *Disposition:* **REUSED verbatim** — the shot-count accounting model, the 75-per-
    pickup grant, independent stacking, and the on-screen formula (Repossessed uses
    `3 + 3·(Fast) + 3·(Triple)`, **Fast substituting for Rapid** — accurate). Big is
    correctly absent from the formula (Repossessed §3.1: "no on-screen count change";
    the fire hook's `cap = baseMax + (fast?3:0) + (tri?3:0)` confirms).
  - *DIVERGED (record it):* **Big Shot is a Repossessed-original power-up with no ADD
    equivalent** — ADD ships only three (Rapid / Triple / Bounce). Repossessed has
    four. The "verbatim" claim is true of the *mechanism*, not the *roster*.
  - *ADAPTED:* **Fast = ADD's Rapid, renamed**, and Repossessed's base fire rate is
    4/s (`CFG.SHOT.cooldown 0.25`), not ADD's — so Fast's ×2 lands at 8/s off a
    different base.

- **§3.3 "food values mirror ADD's small/large vending" (food).**
  - *Verified:* `add2026` `src/vending.js` — two variants, **small +5 / large +10**.
  - *Disposition:* **values REUSED verbatim** — Candy +5 / Feast +10 mirror exactly,
    on the proven healing scale; only the *delivery* changed (pickups vs. machines).
  - *DIVERGED (record it):* ADD vending **caps at `maxHp` and skips at full HP**
    (`vending.js`: `Math.min(maxHp, …)`, `continue` when `hp >= maxHp`). Repossessed
    food **overheals to the 30-HP cap** via `healPlayer`'s `overhealCap` clamp. Values
    reused; the overheal-past-max behavior diverges — and the `healPlayer` sink already
    owns that clamp, so it costs this spec nothing.

Gems, keys, treasure, and Magnet claim no ADD lineage in §3, so nothing to verify
there beyond the Repossessed-source spot-checks (all confirmed against live
`Repossessed-2026` `main` this session: unified `G.pickups`, inert placeholders,
`p.kind→e.kind`, `dropGems`, `addGemEnergy`, `healPlayer`/`overhealCap`, the fire-hook
consume side with no grant site, `CFG.GEM`, the shrapnel despawn precedent, the
key-spend side, and `registerEntityFactory` last-wins).

---

## 11. Design-question rulings (signed off 2026-07-06)

**OQ-P1 — Magnet persistence: RULED TRANSIENT.** The Magnet timer resets on every
level load, like ability cooldowns / `G.novas`. Rationale on record: it is a ticking
clock (STATUS establishes ticking clocks as transient), and its target set — gems in
`G.pickups` — is itself cleared on load, so a surviving timer would burn seconds over a
gem-less level opening. *Implementation:* `G.magnet` is a transient field; the **only**
edit this ruling adds is one line `G.magnet = 0;` in `level-loader.js` `clearTransient`
(beside the existing `G.novas = []`). No `state.js` / `G`-shape edit; a transient timer
is never serialized and never carried across nights (§1, §2.1, §4).

**OQ-P2 — Gem scatter impulse (§3.5): RULED DEFERRED.** Gems appear at the death point
(as `dropGems` already produces them); despawn and Magnet both work regardless. Scatter
is cosmetic-only and revisited later either as a one-line `dropGems` touch (enemies.js,
out of this spec) or a render-side jitter (#7). `dropGems` stays untouched; nothing in
this spec depends on scatter (§5).

*Inherited from GDD/architecture (not open; recorded so they're explicit — flag if you
ever want them changed): the +10 s Magnet refresh is additive per §3.2 (D8); the
*(proposed)* Magnet 10 s / 6 tiles / 10 tiles-per-s (§3.2), treasure tiering
100/250/500 (§3.4), and key cross-level persistence (§3.6, already true — `G.keys` is
run-state) are inherited as-is into `CFG`; `grab = 0.5` tiles is a new tunable contact
grace.*

---

**Human-review checkpoint — spec complete and signed off (both rulings baked in).** No
Claude Code prompts generated in this session. Next: commit this file at repo root,
then generate the phased `pickups.js` prompts in a fresh conversational session.