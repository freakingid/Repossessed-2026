# PROMPTS-SPEC-PICKUPS — Phased Claude Code prompts for `src/pickups.js`

**Status:** generated in a conversational session for **human review**. Nothing here
has gone to Claude Code. Review, then paste one phase per Claude Code session, in
order, committing between phases (you run git; Claude Code never does).

**Authoritative spec:** `SPEC-PICKUPS.md` (committed at repo root). Build reality:
`STATUS.md`, entry **2026-07-06 — SPEC-PICKUPS signed off**. These prompts implement
that spec exactly; where a phase quotes a value or line, it was verified against live
`main` this session (see "Verified this session" below) — but each phase still tells
Claude Code to re-read the current file region before editing (str_replace discipline).

---

## Phase map (3 phases) & why this cut

Split on the spec's natural seams, one cohesive concern per phase, tests delivered
**with** each phase (CLAUDE.md: "deliver tests with the code, not after") — so there is
no trailing test-only phase.

1. **Phase 1 — Config + reset (pure data).** `CFG.PICKUP` / `CFG.FOOD` / `CFG.TREASURE`
   additive in `config.js`; the one `G.magnet = 0;` line in `level-loader.js`
   `clearTransient`. Different files from Phases 2–3, zero logic, the foundation both
   later phases read → its own low-risk phase and commit checkpoint.
2. **Phase 2 — `pickups.js` + the decoration factories.** Creates the new module and the
   module-load wrap-and-override for `food` / `treasure` / `powerup` (key stays the inert
   loader placeholder — no wrap). Ships the factory-decoration tests.
3. **Phase 3 — `updatePickups(dt)`.** The per-frame pass: magnet pull → gem age/despawn →
   contact collection routing + `pickup:collected` emit. Ships the behavior tests. The
   three sub-passes stay in **one** phase on purpose: the ordering **between** them is
   exactly risk R3, so splitting them across sessions would fragment the contract that is
   the risk.

Phases 2 and 3 both edit the one new file `pickups.js`; that's fine — Phase 3 appends to
what Phase 2 created, and you commit in between.

**Model (all three): Sonnet, normal effort, thinking OFF** — spec §9's call stands
(data tables + one ordered pass + factory wraps). Phase 3 carries a written R2/R3 callout
but still doesn't need Opus by default. **Escalation fallback:** if a Sonnet phase fails
once and a single correction doesn't fix it, re-run that phase on Opus (thinking on).

**Deferred (NOT in any phase below):** the boot `import "./pickups.js"` and wiring
`updatePickups(dt)` into the main loop — integration debt, same as `abilities.js` /
`barrels.js`. R1 (factory load order) is resolved there, not here.

---

## Verified this session (live `main`, codeload tarball — spot-checks the phases rely on)

- `registerEntityFactory(type,fn)` = `entityFactories.set` (last-wins); `getEntityFactory`
  = `.get` — `level-loader.js:61,66`.
- `food`/`treasure`/`key`/`powerup` registered as `mkPlaceholder(false)`
  (`level-loader.js:105–108`); placeholder emits `{type,x,y,tc,blocks}` + `kind` when
  present (`81–88`).
- `clearTransient`: `G.novas = [];` at **line 416**; `G.pickupTimer = 0;` at **418**
  (pre-existing, unrelated — the R4 collision); no `G.magnet` yet.
- Sinks (import-only, unmodified): `addGemEnergy(value)` `abilities.js:58`;
  `healPlayer(amount)` clamps to `G.overhealCap` `player.js:404–405`; `dropGems` pushes
  `{type:"gem",x,y,value:CFG.GEM.energy}` with **no** `life` field `enemies.js:514`.
- Squared-distance overlap precedent `rr=p.r+CFG.TILE/2; dx*dx+dy*dy<rr*rr`
  (`firstOverlappingCrate`, player.js); `p.r = CFG.PLAYER.r`.
- `CFG.TILE:32`, `CFG.GEM:{energy:5}`, `CFG.ABILITY` "tiles ×CFG.TILE at read" convention
  present; `CFG.PICKUP/FOOD/TREASURE` absent.
- Wrap-and-override live precedents (named-capture form): spawner `enemies.js:287–299`,
  barrel `barrels.js:50–62`.
- `emit`/`registerEntityFactory`/`getEntityFactory` import from `./level-loader.js`; tests
  capture emits via `registerEmit(...)`, stub `window`/`document`/`AudioContext`, and stub
  the nav sink via `registerBlockerSink(...)`.

---
---

# PHASE 1 — Config dials + the one transient reset

> **Paste to Claude Code as-is. Model: Sonnet, normal effort, thinking off** (pure
> additive data + one reset line — no logic).

You are implementing **SPEC-PICKUPS Phase 1** for Repossessed. Read `STATUS.md` (top
block + the **2026-07-06 SPEC-PICKUPS signed off** entry) first, then `SPEC-PICKUPS.md`
§2.3–2.5 and §11. Implementation only — if a genuine design gap surfaces, **stop and
surface it**; do not invent design. Do not commit, push, or branch. Prefer `str_replace`;
re-read each region before editing.

**This phase is pure additive data across two files. No `pickups.js` yet, no logic.**

**Known risks this phase owns:**
- **R4 — `G.magnet` vs `G.pickupTimer` collision.** The Magnet timer is the **new** field
  `G.magnet`. `G.pickupTimer` already exists in `clearTransient` (a spawn-cadence field) —
  **do not touch it, do not reuse it.**
- **D5 — grant dial placement.** The +75 power-up grant lives in
  `CFG.PICKUP.powerupShots`, **not** `CFG.SHOT` (`CFG.SHOT` stays about ballistics). Add it
  under the new `CFG.PICKUP` only.

**Work:**

1. **`src/config.js` — additive only.** Add three new top-level `CFG` blocks. Do **not**
   change any existing dial; **do not re-declare `CFG.GEM`** (`{energy:5}` is reused as-is).
   Match the existing `CFG.ABILITY` comment convention (spatial dials are in **tiles**,
   multiplied by `CFG.TILE` at read time):

   ```js
   // §3 Pickups (SPEC-PICKUPS §2.3–2.5). Spatial dials in TILES, ×CFG.TILE(32) at read.
   // CFG.GEM.energy(=5) above is reused unchanged as the per-gem credit.
   PICKUP: {
     grab:         0.5,   // tiles — contact grace: contact when hypot(player,pickup) < p.r + grab·TILE
     gemDespawn:   12,    // s — uncollected gems vanish (§3.5)
     powerupShots: 75,    // shots granted per weapon power-up (D5; ADD POWERUP_SHOTS, verified)
     magnet: {
       radius:    6,      // tiles — pull range (§3.2)
       pullSpeed: 10,     // tiles/s — pull speed (§3.2)
       duration:  10,     // s — grant/refresh amount, ADDITIVE (§3.2, D8)
     },
   },
   FOOD:     { candy: 5, feast: 10 },                              // HP; healPlayer clamps to overhealCap(30)
   TREASURE: { candyCorn: 100, silverSkull: 250, goldChest: 500 }, // points (§3.4)
   ```

2. **`src/level-loader.js` — one line in `clearTransient`.** Immediately after the existing
   `G.novas = [];` line (Nova rings, per-level transient), add the Magnet timer reset so it
   clears on every level load exactly like `G.novas`:

   ```js
   G.magnet = 0;   // SPEC-PICKUPS §11 (OQ-P1) — Magnet timer is transient, resets each level
   ```

   Leave `G.pickupTimer = 0;` untouched (R4). No `state.js` / `G`-shape edit — a transient
   timer is never serialized.

**Tests:** extend `test-config.js` with a few asserts that lock the new dials
(`CFG.PICKUP.powerupShots === 75`, `CFG.PICKUP.magnet.duration === 10`,
`CFG.FOOD.feast === 10`, `CFG.TREASURE.goldChest === 500`, `CFG.GEM.energy === 5`
unchanged). Run `node test-config.js` — green.

**Done when:** the three blocks exist, `G.magnet = 0;` sits beside `G.novas`,
`G.pickupTimer` is unchanged, and the config test passes. Update `STATUS.md` (end of
session) with the additive dials + the one transient reset line.

---
---

# PHASE 2 — `pickups.js` module + the decoration factories

> **Paste to Claude Code as-is. Model: Sonnet, normal effort, thinking off**
> (module-load factory wraps, mirroring two shipped precedents).

You are implementing **SPEC-PICKUPS Phase 2** for Repossessed. Read `STATUS.md` (top +
the 2026-07-06 SPEC-PICKUPS entry) first, then `SPEC-PICKUPS.md` §1 (D1, D2), §2.2, §3.
Phase 1 (config + `G.magnet` reset) is already committed. Implementation only — stop and
surface any genuine design gap. Do not commit/push/branch.

**Create the new leaf module `src/pickups.js` and register the module-load decoration
factories. No `updatePickups` yet — that is Phase 3.**

**Known risks this phase owns:**
- **R1 — factory override load order (resolve LATER, not here).** These overrides are
  correct only if boot imports `level-loader.js` **before** `pickups.js`. That boot wiring
  is the **deferred integration phase** — **do not add or edit any boot import here.** In
  this phase, implement the wrap as a pure last-wins re-register (`registerEntityFactory`
  is `Map.set`, verified) and **record the boot-order dependency in `STATUS.md`** for the
  integration pass. Tests call the factory directly after import, so they don't depend on
  boot order.
- **R7 — mis-kinded placement data.** A `food`/`treasure`/`powerup` placed without a valid
  `kind` decorates to an **`undefined`** value (`CFG.FOOD[undefined]` etc.). That is a
  placement-data bug, **not** a runtime crash: leave the value `undefined` (the collect
  sink in Phase 3 treats a missing value as a 0/no-op grant). Do not throw; do not
  substitute a default. A debug-build `console.warn` is acceptable but optional.

**Work — `src/pickups.js`:**

- **Imports (only what this phase uses):** `CFG` from `./config.js`;
  `getEntityFactory, registerEntityFactory` from `./level-loader.js`. (Sink imports come in
  Phase 3 — don't add dead imports now.)
- **Wrap-and-override for `food`, `treasure`, `powerup`** at module load, mirroring the
  shipped precedents `makeSpawner` (`enemies.js:287–299`) and `makeBarrel`
  (`barrels.js:50–62`) — capture the base, re-register a named wrapper that calls the base
  then attaches the one sink field keyed on `e.kind`:

  ```js
  const loaderFood = getEntityFactory("food");
  function makeFood(p) { const e = loaderFood(p); e.heal = CFG.FOOD[e.kind]; return e; }
  registerEntityFactory("food", makeFood);

  const loaderTreasure = getEntityFactory("treasure");
  function makeTreasure(p) { const e = loaderTreasure(p); e.points = CFG.TREASURE[e.kind]; return e; }
  registerEntityFactory("treasure", makeTreasure);

  const loaderPowerup = getEntityFactory("powerup");
  function makePowerup(p) { const e = loaderPowerup(p); e.power = e.kind; return e; }
  registerEntityFactory("powerup", makePowerup);
  ```

  - The base placeholder already computed `x/y/tc/kind/blocks` (`mkPlaceholder`), so the
    wrapper reuses `e.kind` — do **not** import `tileCenter` or recompute coords.
  - **`key` is NOT wrapped** — a key needs no value field (contact ⇒ `G.keys++` in Phase 3),
    so it stays the loader's inert placeholder (§3).
  - `power` is just `kind` surfaced under the name the Phase-3 collect branch reads.

**Tests — `test-pickups.js`** (headless, house style: stub `window`/`document`/
`AudioContext`, `registerBlockerSink({registerBlocker(){},markDirty(){}})`, dynamic-import
the REAL modules, `check(name,ok)` harness). Cover the spec §8 **factory-decoration**
bullet by importing `pickups.js` (so the wraps register), then calling the factories via
`getEntityFactory`:

- `food{kind:"candy"}` → `heal === 5`; `food{kind:"feast"}` → `heal === 10`.
- `treasure{kind:"goldChest"}` → `points === 500` (and one of the other two tiers).
- `powerup{kind:"fast"}` → `power === "fast"`; `powerup{kind:"magnet"}` →
  `power === "magnet"`.
- Override wins over the inert placeholder (the value field is present after wrap).
- Mis-kinded (R7): `food{kind:"bogus"}` → `heal === undefined`, **no throw**.

Run `node test-pickups.js` — green.

**Done when:** `src/pickups.js` exists with the three named wraps (key unwrapped),
`test-pickups.js` passes, no boot/main-loop edits were made. Update the CLAUDE.md code map
+ `STATUS.md`: new `pickups.js` leaf, the three decoration factories, and an explicit note
that R1 (boot import order: level-loader before pickups) is owed by the later integration
phase.

---
---

# PHASE 3 — `updatePickups(dt)`: magnet pull → gem age → contact collection

> **Paste to Claude Code as-is. Model: Sonnet, normal effort, thinking off** — but the
> intra-frame ordering (R3) and lazy-`life` seeding (R2) below are load-bearing; implement
> the pass in exactly the stated order. **Escalation fallback:** if the first pass
> mis-orders and one correction doesn't fix it, re-run this phase on Opus (thinking on).

You are implementing **SPEC-PICKUPS Phase 3** for Repossessed. Read `STATUS.md` (top + the
2026-07-06 SPEC-PICKUPS entry) first, then `SPEC-PICKUPS.md` §1 (D3–D10), §2.6, §4, §5.
Phases 1–2 are committed (`CFG.PICKUP/FOOD/TREASURE`, `G.magnet` reset, `pickups.js` with
the decoration factories). Implementation only — stop and surface any genuine design gap.
Do not commit/push/branch. Append to the existing `src/pickups.js`; do **not** edit
`enemies.js`, `player.js`, `abilities.js`, or `world.js` (sinks are imported, not modified).

**Known risks this phase owns:**
- **R3 — intra-frame ordering (load-bearing).** The pass MUST run **magnet pull →
  gem age/despawn → contact collection**, in a single reverse-iterating splice pass for the
  age/contact step. Reordering lets the 12 s despawn beat an active Magnet, or double-
  handles a gem. This ordering is the contract; don't "optimize" it.
- **R2 — lazy gem `life` contract.** Gems arrive with **no** `life` field (`dropGems` is
  fenced). Seed it lazily on first sight: `if (g.life == null) g.life = 0;` then age it.
  Keep the `== null` guard — it makes any future drop-time `life` a safe no-op double-init.
  Do not seed `life` at drop time; do not touch `dropGems`.
- **R4 — timer field is `G.magnet`** (not `G.pickupTimer`).
- **R5 — `powerup` kind branch precedes the +75 grant.** Branch on `power` FIRST:
  `magnet` is a `powerup` kind but sets the timer, **not** a shot counter. A structural
  branch, not a special-case skip — otherwise a Magnet pickup writes a phantom
  `G.powerups.magnet = 75` the fire hook never reads.
- **R6 — do NOT implement "bounced player bullets never hurt the player" here.** That's a
  shot-vs-player collision rule (projectiles.js), out of scope. This phase only **grants**
  the `bounce` counter.

**Work — append to `src/pickups.js`:**

- **Add sink imports:** `G` from `./state.js`; `emit` from `./level-loader.js`;
  `addGemEnergy` from `./abilities.js`; `healPlayer` from `./player.js`.
- **`export function updatePickups(dt)`** — guard `if (!G.pickups) return;` then, with
  `p = G.player`:

  1. **Magnet pull** (only if `G.magnet > 0`):
     - `G.magnet = Math.max(0, G.magnet - dt);`
     - `range = CFG.PICKUP.magnet.radius * CFG.TILE;`
       `step = CFG.PICKUP.magnet.pullSpeed * CFG.TILE * dt;`
     - For each `g` in `G.pickups` where `g.type === "gem"`: `dx=p.x-g.x`, `dy=p.y-g.y`,
       `d=Math.hypot(dx,dy)`. If `0 < d && d <= range`, move `g` toward `p` by
       `Math.min(step, d)` (normalize by `d`; **never overshoot**). Gems only — touch no
       other type (D7).

  2. **Contact + despawn** — single **reverse** iterate over `G.pickups` (reverse so
     splices don't skip):
     - If `g.type === "gem"`: `if (g.life == null) g.life = 0; g.life += dt;` then
       `if (g.life >= CFG.PICKUP.gemDespawn) { G.pickups.splice(i,1); continue; }`
       (expired: silent, **no** collect, **no** emit).
     - **Contact test** (squared distance, mirroring `firstOverlappingCrate`):
       `rr = p.r + CFG.PICKUP.grab * CFG.TILE; dx=p.x-g.x; dy=p.y-g.y;`
       `if (dx*dx + dy*dy < rr*rr)` → **collect**: route by `type`, emit, then
       `G.pickups.splice(i,1)`.
     - **No `p.loco` gate anywhere** (D9 — collect while CARRYING/STUNNED). No allocation in
       the loop beyond the emit payload.

- **Collect routing (D3, with the D4/R5 branch):**

  | `type` | effect |
  | :-- | :-- |
  | `gem` | `addGemEnergy(g.value)` |
  | `food` | `healPlayer(g.heal)` (the sink clamps to `G.overhealCap`; do not clamp here) |
  | `treasure` | `G.score += g.points` |
  | `key` | `G.keys++` |
  | `powerup` **& `g.power === "magnet"`** | `G.magnet += CFG.PICKUP.magnet.duration` (additive, D8) |
  | `powerup` (other) | `G.powerups[g.power] = (G.powerups[g.power] || 0) + CFG.PICKUP.powerupShots` |

  Branch the `powerup` `magnet` case **before** the +75 grant (R5). A missing value field
  (R7) routes to a 0/no-op grant, never a crash.

- **Emit exactly one event per collect** (none on despawn), snapshot payload (§2.6):
  `emit("pickup:collected", { type, kind: g.kind, x: g.x, y: g.y, amount })` where `amount`
  is the effect magnitude for that type (`value` / `heal` / `points` /
  `CFG.PICKUP.powerupShots` / `CFG.PICKUP.magnet.duration`).

**Tests** — extend `test-pickups.js` and add `test-pickups-magnet.js` (house style;
capture emits via `registerEmit`; seed `G` directly per spec §8). Cover the spec §8
checklist:

- **Contact routing, one per type:** gem → `addGemEnergy` credited by `value` (assert the
  Nova bar/charge moved); food → `healPlayer`; treasure → `G.score += points`; key →
  `G.keys++`; `powerup fast` → `G.powerups.fast === 75`, a second → `150`; `powerup magnet`
  → `G.magnet === duration` **and `G.powerups.magnet` untouched** (D4).
- **Food overheal clamp:** feast (+10) at `G.hp=28`, `overhealCap=30` → `hp === 30`.
- **Gem despawn:** uncollected gem aged `≥12 s` (looped `dt`) is spliced, credits nothing;
  a gem contacted before 12 s credits `addGemEnergy(value)`; a gem collected the same frame
  it would expire is collected, not double-handled.
- **Magnet pull (`test-pickups-magnet.js`):** gem at 4 tiles (≤6) moves toward player by
  `pullSpeed·TILE·dt`, no overshoot; gem at 8 tiles (>6) unmoved; a **food** at 3 tiles is
  **not** pulled; `G.magnet` ticks down by `dt`, floors at 0; an in-range gem pulled to
  within `grab` collects the **same frame** (pull-before-contact).
- **Magnet refresh:** a second magnet adds `+duration` (additive, D8).
- **Loco-agnostic:** set `p.loco = "CARRYING"` (and separately STUN) — a contacted pickup
  still collects (D9).
- **Emit:** each collect fires exactly one `pickup:collected` with the snapshot payload;
  despawn fires none.

Run `node test-pickups.js` and `node test-pickups-magnet.js` — green. Then run the full
suite to confirm additivity.

**Done when:** `updatePickups(dt)` is implemented in the stated order, both test files pass,
the full suite stays green, and **no** boot/main-loop wiring was added (that's the deferred
integration phase). Update `STATUS.md` (end of session): `updatePickups` built + tested
headlessly; restate that the boot `import "./pickups.js"` + main-loop wiring of
`updatePickups(dt)` is the still-owed integration debt (same as abilities.js/barrels.js).

---

## After Phase 3 — the integration debt (separate, later; noted here so it isn't lost)

Not a phase in this file. In the eventual integration pass: add `import "./pickups.js";` to
boot **after** `level-loader.js` (resolves R1), and call `updatePickups(dt)` in the main
loop each frame. Wire it alongside the identical still-owed wiring for `abilities.js` and
`barrels.js`.