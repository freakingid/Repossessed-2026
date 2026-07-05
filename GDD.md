# Repossessed — Game Design Document v1.1

Canonical design intent. This is "what the game should be." When implementation
begins, a STATUS.md will track what is actually built and the decisions made along
the way, and a CLAUDE.md will hold cross-cutting rules — mirroring the Atomic
Dustbin Dan (ADD) project convention. **Section numbers here are stable** — future
STATUS.md entries and implementation specs will reference them.

**Revision v1.1:** ten design decisions closed (endless-procgen reversal, pit
removal, Spirit/boss content deferred, placeholder-first asset pipeline, and
more), and §12 reconciled against ADD's now-provided real Pause/Save and
Achievements specs. Exact per-section deltas: `Repossessed-GDD-v1.1-CHANGELOG.md`.

**Sources & supersessions:**
- `Repossessed-GDD.md` (3/5/2025, with 3/27/2025 barrel addendum) — the authored
  design. Its Godot 4.3 target is **superseded**: Repossessed is built on the same
  platform and engineering conventions as ADD (browser, HTML5 Canvas + JavaScript,
  data-driven `config.js` dials, module-per-system files).
- `GDD.md` + `GDD-ENEMIES.md` (Atomic Dustbin Dan) — the pattern library. Where a
  Repossessed system is compatible with a shipped ADD system, this document adapts
  the ADD pattern rather than reinventing it. Every place the fit is **not** clean
  is catalogued in **§13 (ADD Compatibility Report)**. Genuinely unresolved design
  questions are in **§14**.
- `pause-save-spec.md` + `ACHIEVEMENTS.md` (Atomic Dustbin Dan) — the **real**
  ADD Pause/Save and achievement specs, provided for v1.1. §12.1, §12.3, and
  §12.4 are reconciled against them directly (§13.21–§13.22 closed).

**Extraction convention:** §6 (Enemies) is written to be extractable into a
standalone `GDD-ENEMIES.md` for token efficiency once the roster stabilizes, exactly
as ADD did. Until then it lives inline.

**Numeric values:** All numbers in this document are **initial dial values** destined
for `config.js` (`CFG.PLAYER`, `CFG.ENEMY`, `CFG.OBJECTS`, `CFG.ABILITIES`,
`CFG.RAMP`, `CFG.PLAN`, `CFG.TILES`, `CFG.SPAWNER`), per the ADD convention that feel dials live
in config, not in behavior code. Distances are in **tiles**, speeds in **tiles/sec**,
and enemy speeds are expressed as **multiples of player base speed** so a single
player-speed dial rescales the whole game. Values marked *(proposed)* were invented
to fill gaps in the source doc and are safe defaults awaiting sign-off; values
without the marker come directly from the source material.

---

### Build status index

**Nothing is built. This is a greenfield design.** Index below maps sections to the
systems an implementation pass will stand up.

- **NOT built:** §2 Player (movement, health/overheal, melee, ranged, status
  effects, carry/vault states)
- **NOT built:** §3 Power-ups & pickups (shot-count power-ups, Magnet, food,
  treasure, gems, keys)
- **NOT built:** §4 Controls (keyboard+mouse, gamepad, input-mode select, remapping)
- **NOT built:** §5 Abilities (Nova ring, Lightning, gem-energy economy)
- **NOT built:** §6 Enemies (9 types + themed spawners + pathfinding infrastructure)
- **NOT built:** §7 Interactive objects (crates, barrels, shrapnel, carrying physics)
- **NOT built:** §8 Level structure (Level Definition v2 format, loader +
  generator, tile set incl. doors/plates, dark-level lighting, endless Night
  escalation)
- **NOT built:** §9 Scoring & attribution
- **NOT built:** §10 HUD & game feel (on-player health bar, gem bar, shake/hit-stop)
- **NOT built:** §11 Visual & audio (sprite pipeline, synth SFX, music playback)
- **NOT built:** §12 Meta systems (menu flow, pause sub-screens, options,
  5-slot save/load, weekly+lifetime achievements, global high score)

---

## 1. OVERVIEW

- **Title:** Repossessed
- **Genre:** Top-down twin-stick arcade shooter
- **Platform:** Browser (HTML5 Canvas + JavaScript) — *supersedes the source doc's
  Godot 4.3 target; see §13.1*
- **Perspective:** Top-down, tile-based
- **Theme:** Halloween / monster-inspired — *spooky fun*, not grimdark. Tone target:
  between *Binding of Isaac*, *Enter the Gungeon*, and a Saturday-morning-cartoon
  *Castlevania*.
- **Player Count:** Single player
- **Goal:** Score as high as possible.
- **Win Condition:** None. Levels are **procedurally generated** and play as an
  endless sequence of "Nights," with enemy composition and behavior parameters
  escalating continuously by level index (§8.3, §8.6). Hand-authored levels are
  a planned future addition the format already supports (§13.24).
- **Level End Condition:** Dan-style single trigger — the player exits whenever they
  reach the level exit door (§8.5). Locked exits require a key (§3.6, §8.2).
- **Core loop:** Enter level → fight enemies from spawners → collect gems (Nova
  fuel), food, treasure, power-ups, keys → manipulate crates and barrels
  strategically → reach the exit whenever ready → next Night.

---

## 2. PLAYER CHARACTER

**Name / premise:** an unnamed monster-hunter (working name: **the Repossessor**)
reclaiming haunted grounds one level at a time. Premise is deliberately thin —
arcade pacing, no cutscenes.

### 2.1 Health & Overheal

- Base maximum: **20 HP** (rendered as **100%** on the on-player health bar, §10.1).
  Integer hit-based damage, same scale as ADD (enemy hits deal 1–4 HP).
- **Overheal:** food pickups can push HP **above** the 20 base, up to a hard cap of
  **30 HP (150%)** *(proposed cap)*. Overheal does not decay *(proposed)*; it is
  simply spent as damage is taken.
- **No vending machines.** Healing comes from **food pickups** (§3.3) placed by
  level definitions and spawn rules. This replaces ADD's vending machine system —
  see §13.7.
- **Post-hit invulnerability:** after taking damage from any source, the player is
  invulnerable for **0.4 s** (sprite flicker). This is new relative to ADD and
  exists specifically because Repossessed has burst multi-hit sources (8-piece
  shrapnel fans, §7.2.4) that would otherwise instantly delete the health pool.
  Melee contact additionally follows the ADD re-trigger rule: a given
  enemy↔player pair cannot exchange melee damage again until contact is broken and
  re-entered.
- Health **carries over between levels** (ADD §2.1 pattern). Death handling: §2.6.

### 2.2 Melee (automatic, bidirectional)

- **Trigger:** automatic on player↔enemy body collision. No button.
- Player deals **2 HP** to the enemy per contact event (ADD's mop value, reused).
- Enemy deals its per-type contact damage to the player (§6.2 table).
- **Knockback:** both parties are knocked back — player **0.75 tiles**, enemy
  **0.5 tiles** *(proposed)* — and the pair enters the re-trigger lockout (§2.1).
  Enemy-side knockback is an extension of ADD (which only knocked Dan back); it is
  required anyway for the carried-crate pushback mechanic (§7.1.4).

### 2.3 Ranged Attack (automatic fire)

- **Weapon:** monster-hunting blaster (visual: glowing bolt; sprite set to be drawn
  from the owner's existing pixel-art assets, §11).
- **Ammo:** unlimited. No resource management.
- **Base stats:** damage **1** per bullet · speed **9 tiles/s** · range **7 tiles**
  (distance-based lifespan; self-destructs like ADD projectiles) · fire rate
  **4 shots/s** · **max 3 player shots on screen** (volley-gated, ADD §3.2
  convention).
- **Firing model:**
  - *Gamepad:* right stick beyond deadzone (0.2) = aim **and** continuous auto-fire
    at the fire-rate cadence. Identical to ADD's shipped gamepad model (§4.2).
  - *Keyboard+mouse:* cursor aims (player always faces cursor); **holding LMB**
    auto-fires at the fire-rate cadence. The source doc says "aim & fire
    automatically," which is well-defined for a stick but not for a mouse;
    hold-to-fire is the **confirmed final** interpretation — the gun never
    fires without LMB held (decision closed).
- **While carrying an object, the player cannot fire** — the aim input is
  repurposed as the drop/throw command (§7.1.3). This is a deliberate tension:
  carrying trades firepower for utility.

### 2.4 Visual Progression of Shots (cosmetic + stated exceptions)

| State | Visual | Gameplay delta |
| :---- | :---- | :---- |
| Base | Small glowing bolt | — |
| Big Shot active | Larger, brighter projectile | damage ×2, hitbox ×1.6 (§3.1) |
| Triple Shot active | 3-bolt fan | ±12° spread |
| Fast Shot active | Streaking trail | fire rate ×2, +3 max on screen |
| Bounce active | Sparks at ricochet points | ricochets off walls/obstacles |

### 2.5 Player State Machine

Locomotion is an exclusive state; status effects are a non-exclusive overlay.

**Locomotion states:**

| State | Entry | Exit | Rules while active |
| :---- | :---- | :---- | :---- |
| NORMAL | default | — | full movement, aim, fire, abilities |
| CARRYING | contact with free crate/barrel (§7.1.2) | drop/throw/vault/stun | move ×0.85; cannot fire; aim input = drop/throw; carried-crate pushback active |
| VAULTING | drop-while-moving or wall-vault (§7.1.5) | auto after 0.35 s | scripted 2.0-tile forward hop; no collision with entities/projectiles; cannot act; invulnerable |
| DEAD | HP ≤ 0 | run ends | §2.6 |

**Status effects (stack with locomotion states):**

| Effect | Source | Duration | Rules |
| :---- | :---- | :---- | :---- |
| ENTANGLED | Spider web (§6.1.6) | 2.5 s base | move speed ×0.35; each input-direction change of ≥60° shaves **0.3 s** off remaining duration ("struggle out faster by rapidly changing direction") |
| STUNNED | Lightning aftermath (§5.2) | 3.0 s | movement input replaced by a random unit vector re-rolled every 0.3 s at ×0.7 speed; firing still allowed; abilities and pickup locked; forces immediate drop of any carried object |
| POST-HIT INVULN | any damage taken | 0.4 s | no damage accepted; sprite flicker |

VAULTING cannot be entered while ENTANGLED or STUNNED. ENTANGLED and STUNNED can
coexist (miserable, rare, legal).

### 2.6 Death & Game Over

**Final.** Single-life arcade run: HP ≤ 0 → death animation → GAME OVER screen
showing final score, Night reached, and high-score check (§12.5) → return to
title. There are no lives and no arcade-credit limits. Continuing happens
through the save system instead: the player may **load a saved slot without
limit** (§12.3) — a save made via SAVE & QUIT restarts its Night fresh with the
saved score/HP/power-up state, as many times as they like. Death does not
touch save slots.

---

## 3. POWER-UPS & PICKUPS

All pickups are collected **automatically on contact** (source doc §2). Two
families: **weapon power-ups** (shot-count based, stackable — ADD §3 pattern reused
verbatim) and **consumable pickups** (instant effect).

### 3.1 Weapon Power-ups (shot-count based, fully stackable)

Each pickup grants **75 shots** of its effect *(ADD's value, reused; source doc
says only "a certain number of shots")*. Each power-up tracks its remaining shot
count **independently**. Collecting a duplicate adds **+75** to that counter.
A "shot" is **one trigger/volley event** — a Triple Shot volley of 3 bullets
decrements each active counter by exactly 1.

| Power-up | Effect | Notes |
| :---- | :---- | :---- |
| **Triple Shot** | 3-bullet fan per volley, ±12° spread | +3 max shots on screen |
| **Big Shot** | bullet damage ×2 (→ 2), hitbox radius ×1.6 | no on-screen count change |
| **Fast Shot** | fire rate ×2 (→ 8/s) | +3 max shots on screen ("double bullets on screen") |
| **Bounce Shot** | bullets ricochet off walls and static obstacles until range expires | no count change; see crate interaction below |

**Max shots on screen** = `3 + 3·(Fast) + 3·(Triple)`, volley-gated — the ADD §3.2
formula with Fast substituting for ADD's Rapid Fire. All four stack simultaneously
(the source doc's explicit "all 4 powers at the same time" case): 9 on-screen,
3-bullet fans, double rate, double damage, bouncing.

**Bounce vs. crates:** crates ricochet **all** player bullets **always**, power-up
or not (§7.1.4). Bounce Shot extends ricochet to walls, tombstones, pillars, and
closed doors. Bullet range is not reset by a bounce (ADD rule). Bounced player
bullets never damage the player *(proposed)*.

### 3.2 Magnet (timed)

The one **duration-based** power-up: for **10 s** *(proposed)*, gems within
**6 tiles** are pulled toward the player at **10 tiles/s**. Duplicate pickups
refresh/extend the timer by +10 s. Affects gems only — not food, treasure, keys,
or weapon power-ups.

### 3.3 Food (health, instant)

| Item | HP | Notes |
| :---- | :---- | :---- |
| Candy | **+5** | common |
| Feast (pie/roast) | **+10** | uncommon |

Food can push HP past the 20 base up to the 30-HP overheal cap (§2.1). Values
mirror ADD's small/large vending amounts so the healing economy stays on the
proven scale — the *delivery* changed (pickups vs. machines), not the numbers.

### 3.4 Treasure (score, instant)

| Item | Points |
| :---- | :---- |
| Candy corn | 100 |
| Silver skull | 250 |
| Gold chest | 500 |

*(proposed tiering)* Treasure is the intended payoff behind locked doors and
plate puzzles (§8.2) — high-value placements should sit behind effort.

### 3.5 Gems (Nova fuel)

- **Small gem = 5 energy.** The gem-energy bar holds **100** (§5.1).
- **Source — final: destroyed enemies ONLY.** Every enemy drops gems on death
  per the §6.2 table (1–3 small gems by tier; Reaper 10; a destroyed spawner
  counts as an enemy for this purpose and drops 3). There are **no placed gem
  caches and no other gem source** — the entire Nova economy is combat-fed.
- Dropped gems scatter with a small impulse and **despawn after 12 s** if
  uncollected — collect-or-lose pressure keeps the player moving toward their
  kills. **Magnet (§3.2) is the intended counter to the despawn timer**, which
  is exactly what earns it a pickup slot.

### 3.6 Keys

*(Adopted resolution — see §13.9 and §14.1 for the alternative.)* Keys are
**inventory pickups**, not carried objects: auto-collected on contact into a key
counter (HUD icon, §10.2). Touching a **locked door** tile (§8.2) with ≥1 key
consumes one and opens the door permanently (tile becomes floor). Keys do not
occupy the carry slot and do not interact with the throw system. Keys persist
across levels within a run *(proposed)*.

---

## 4. CONTROLS

All keyboard bindings are **remappable via the Options screen** (§12.2) — a hard
requirement from the source doc, and an upgrade over ADD (which defined
`CFG.KEYS` for future remapping but shipped no UI). Defaults below.

### 4.1 Action Map

| Action | Keyboard + Mouse | Gamepad |
| :---- | :---- | :---- |
| Move | WASD (8-way: diagonals from adjacent pairs, ADD §4.1 rule) | Left stick, full 360°, normalized beyond 0.2 deadzone |
| Aim | Mouse cursor (player faces cursor) | Right stick direction |
| Fire | **Hold LMB** → auto-fire at cadence | Right stick beyond 0.2 deadzone → auto-fire |
| Drop / Throw carried object | LMB (throw toward cursor) / release-context per §7.1.3 | Right-stick deflection (throw in stick direction) |
| Nova | **N** | **LB (4)** or **LT (6)** |
| Lightning | **L** | **RB (5)** or **RT (7)** |
| Pause | **Space** or **Esc** | **Start (9)** |
| Menu confirm | **Enter** | **A (0)** |
| Menu back | **Esc** | **B (1)** |
| Mute | **M** (ADD convention) | — |

Button indices per standard XInput / Browser Gamepad API mapping (ADD §4.8
convention). Splitting ADD's "any bumper/trigger = special" across left = Nova /
right = Lightning preserves the ADD muscle memory of "shoulders = special."

### 4.2 Input Mode Selection

ADD's title-screen mode lock is **retained**: Space → keyboard+mouse session;
A/Start → gamepad session; opposing device disabled until return to title; all
prompt text reflects the active mode ("SPACE to continue" vs "A / START to
continue"); `G.inputMode` reset by `newGame()`.

Note the rationale has shifted: in ADD the lock existed because keyboard aim was
8-way and gamepad was 360°. In Repossessed **both modes aim in full 360°** (mouse
or stick), so the lock is now purely about prompt clarity and avoiding
device-detection ambiguity. Kept because it is proven and cheap. Consequence:
**ADD's keyboard-only OPKL directional-fire scheme is dropped** — Repossessed's
keyboard mode requires a mouse. Flagged in §13.10.

### 4.3 Movement Feel

Player base speed: **3.5 tiles/s** (the master dial all enemy speed multipliers
reference). Keyboard diagonals normalized. Gamepad movement normalized beyond
deadzone (full speed regardless of stick depth — ADD §4.6 rule).

---

## 5. ABILITIES

Two active abilities replace ADD's consumable Atomic Dustbin. Both are always
available (not pickups); Nova is fueled by the gem economy, Lightning by a
cooldown-plus-drawback. See §13.8 for what survived from the Dustbin.

### 5.1 Nova (gem-powered expanding ring)

**Fuel — the gem-energy bar:**
- Capacity **100 energy**. Small gem = 5 (§3.5).
- Overflow past 100 banks into **stored charges**: up to **2 full charges** may be
  held in addition to the live bar (max 300 total banked). Stored charges display
  as a number over the bar (source doc HUD spec, §10.2).

**Firing (N / LB / LT):**
- If ≥1 stored charge: consume **one full charge** → ring spawns with **50 health**
  ("maximum power"). The live bar is untouched and keeps filling.
- Else: consume the **entire live bar**, which must hold at least **25 energy**
  *(proposed minimum — prevents wasting a tap on a trivial ring)* → ring health =
  `50 × (energy / 100)`.
- **Cooldown 0.5 s** — exists purely to prevent accidental double-taps (source doc).

**Ring behavior:**
- Expands outward from the player at **12 tiles/s**, ring stroke ~0.6 tiles.
- **Passes through walls and all terrain** (source doc: "goes through walls").
- Each enemy is hit **once**: the enemy is **destroyed outright** and the ring
  **loses health equal to that enemy's current HP**. When ring health ≤ 0, the
  ring finishes its current frame and dissipates. (This is the source doc's model
  verbatim: even a weak ring kills its final victim as it dies.)
- Hard radius cap **14 tiles** *(proposed — prevents an unspent ring crossing an
  empty level forever)*.
- **Exceptions (final):** spawners, **barrels**, and crates are **unaffected** —
  Nova touches enemies only (decision closed: Nova does *not* detonate barrels;
  it is the clean wave-clear, deliberately contrasted with Lightning, §5.2/§5.3).
  The **Reaper** resists: the ring deals **10 damage** instead of destroying it, and loses **20**
  health for the privilege — a full-power Nova is a chunk of a Reaper, not a
  delete button.
- Nova **erases enemy projectiles** (arrows, lobbed explosives mid-arc, webs, dark
  blasts) it sweeps over *(proposed — cements its panic-button role)*.
- Kills score full points (player-attributed, §9).

### 5.2 Lightning (radius wipe with a price)

- **Effect:** instantly destroys **all non-boss enemies** within **5 tiles**
  *(radius proposed; source says "a set radius")*. The Reaper instead takes
  **5 damage** *(proposed)*. **Barrels within the radius take lethal damage and
  detonate (final)** — their shrapnel cascades are player-attributed (§9) and
  erupt while the caster is stunned, which is part of Lightning's price. Since
  abilities remain usable while CARRYING (§2.5), casting with a barrel in hand
  detonates it point-blank. Spawners and crates are unaffected.
- **Costs nothing** — does not consume gem energy (source doc, explicit).
- **Cooldown: 10 s** (radial sweep indicator on HUD, §10.2).
- **Drawback:** on activation the player is **STUNNED for 3 s** with erratic
  movement (§2.5 status table: input replaced by a re-rolled random vector every
  0.3 s at ×0.7 speed; firing allowed; abilities/pickup locked; carried object
  force-dropped). The wipe is free; the vulnerability window is the payment.
- **Visuals:** multiple lightning bolts strike down on affected enemies; 2-frame
  full-screen white flash (§10.3). Kills score full points (§9).

### 5.3 Ability Design Intent

Nova is the **earned, aimable-by-positioning** wave-clear: it rewards gem greed and
can be banked for emergencies, and because it pierces walls it is the answer to
Lobbers bombarding from cover. Lightning is the **oh-no button**: always loaded,
instant, but it trades the next three seconds of control away — firing it while
surrounded by a Zombie pack you just *didn't* kill (they're outside the radius) is
how it punishes panic — and in a barrel cellar it is a demolition charge you set
off while staggering. The two should feel opposite: one deliberate and clean,
one desperate and messy.

---

## 6. ENEMIES

> Written for future extraction to `GDD-ENEMIES.md` per the ADD convention. §6.2 is
> the **canonical stat reference**; §6.1 carries per-enemy behavioral detail; §6.3
> covers spawners; §6.4 defines the pathfinding infrastructure the roster requires
> (new relative to ADD — see §13.4).

The player has **20 HP base / 30 overheal** — read damage values against that.
Speeds are multiples of player base speed (3.5 tiles/s). Point values and gem
drops are *(proposed)* — the source doc defines HP/damage/behavior but no scoring
or drop economy; values below follow ADD's 50–500 arcade curve.

### 6.1 Enemy Roster

**6.1.1 👻 GHOST — basic chaser / cannon fodder.** HP 2, 50 pts, speed 0.45×,
melee 1. **Omniscient tracking** (always knows the player's position, even through
walls) but **zero navigation**: steers directly at the player and simply presses
into any wall in the way — no avoidance, no pathfinding, gets stuck on geometry by
design. Easy to kite solo; dangerous in swarms and in open rooms. Primary spawner
fodder.

**6.1.2 💀 SKELETON — wall-sliding chaser.** HP 4, 100 pts, speed 0.50×, melee 1.
Omniscient tracking plus **simple obstacle avoidance** (not full pathfinding):
when its direct vector is blocked, it slides along the obstruction toward the open
side — steering-level avoidance that handles convex geometry but can still be
defeated by deep concave pockets. The "same idea as a Ghost, but it finds the
doorway" tier.

**6.1.3 🏹 SKELETON SHOOTER — pathfinding ranged.** HP 4, 150 pts, speed 0.65×,
melee 1. **Arrow:** straight-line projectile, **2 dmg**, 8 tiles/s, fired from up
to **6 tiles**.
- **State machine:** `WANDER` (slow ambient roaming, unaware) → on **line-of-sight
  acquisition** of the player → `HUNT` (full A* pathfinding toward the player;
  stays aware for 8 s after losing LOS, then reverts to WANDER *(awareness decay
  proposed)*).
- In HUNT and within range with LOS, each decision tick it **stops to shoot** with
  probability **`stopToShootChance` = 0.50 base** — an explicit
  **difficulty-ramping parameter** (§8.6) — otherwise it keeps closing distance.
- Shooting sequence: halt → 0.4 s windup (telegraph) → fire → 1.5 s cooldown.
  **Stationary while shooting** (source doc).

**6.1.4 💣 LOBBER — cover-loving explosive thrower.** HP 2, 100 pts, melee 1.
Direct adaptation of ADD's Sorter Bot state machine (§13.14) with an added
accuracy-error mechanic:
- **Exposed (player has LOS to it):** panics — flees fast (**0.95×**) in an
  erratic, jittery scatter, holds fire, seeks any tile that breaks LOS.
- **In cover (no LOS):** advances toward the player at **0.40×** and, within
  **9 tiles**, lobs an explosive every **2.5 s**.
- **Lobbed explosive:** arcs **over all walls, obstacles, and crates** (source
  doc: explosives ignore crates); airtime **1.0 s**; lands at the player's
  position **± a random error radius, base 1.5 tiles** — an explicit
  **difficulty-ramping parameter** (§8.6; tiers shrink the error). Detonation:
  **1.25-tile radius AoE, 2 dmg**. The landing point is telegraphed by a **ground
  shadow** for the full airtime — the ADD Sorter/Drone telegraph convention,
  reused (§13.13).
- Design role identical to the Sorter: a wall usually separates you, straight
  shots can't answer back, and the counterplay is Bounce Shot, Nova-through-walls,
  or hunting it down to flip it into panic mode.

**6.1.5 🦇 BAT — flying snapshot attacker.** HP 2, 150 pts, flight 1.15×,
melee 2. **Flies over everything** — walls, crates, barrels, spawners,
enemies — and ignores all ground-object interactions, including **carried-crate
pushback (explicit source-doc exemption)**.
- **State machine:** `SNAPSHOT` (record the player's current position) → `FLY`
  (straight line to that recorded point at 1.15×) → `PAUSE` (hover **0.4–1.2 s
  random**; both bounds are **difficulty-ramping parameters** that shrink per
  tier, §8.6) → repeat.
- It attacks *where you were*, not where you are: constant motion makes it
  harmless; stopping to loot or aim is when it connects. "Can be baited into
  attacking a bad location" — e.g., over a burning barrel's imminent blast.

**6.1.6 🕷️ SPIDER — burst-mover, web shooter.** HP 4, 200 pts, melee 2.
Omniscient tracking, **no wall navigation** (Ghost-grade steering).
- **Movement:** bursts of **1.5× for 0.5 s**, then **0.6 s pause**, repeating.
  Hard to outrun in the open.
- **Blocked rule:** if an obstacle blocks its direct vector, it **retreats away
  for 1.5 s**, then re-engages — it never wall-hugs like a Ghost.
- **Web:** requires LOS and range ≤ **7 tiles**; fast projectile (**11 tiles/s**),
  **0 damage**, cooldown **4 s**. On hit: **ENTANGLED** 2.5 s, move ×0.35,
  struggle-out via direction changes (§2.5). The web makes it dangerous at range;
  the bursts make it dangerous up close.

**6.1.7 🧟 ZOMBIE — super-slow juggernaut.** HP 8, 200 pts, speed **0.28×**,
melee **3**. Omniscient tracking + **full A\* pathfinding**; never stops, never
loses interest, walks around anything. Trivial to avoid, expensive to kill (8
bullets), brutal to touch. Design role: area denial and a tax on standing still;
deadly when paired with speed (Bats, Spiders) or webs.

**6.1.8 🔥 FIRE WRAITH — walking bomb.** HP 2, 150 pts, speed 0.50× float, **no
melee** — proximity detonation instead.
- **State machine:** `APPROACH` (full A* pathfinding toward player) → within
  **1.5 tiles** → `FLASH` (0.8 s accelerating strobe warning, movement continues
  at half speed) → `EXPLODE`.
- **Explosion:** radius **2 tiles**, **4 dmg** to the player, **damages all
  enemies in radius** (friendly-fire AoE; such kills score nothing, §9), and
  **detonation-triggers barrels** in radius. **Does NOT damage crates** — the
  source doc's "can destroy obstacles (crates, barrels)" line conflicts with
  crates' "cannot be destroyed by anything"; resolved in favor of crate
  indestructibility (§13.16). The Wraith dies in its own blast.
- **Killed before FLASH completes → no explosion** *(proposed reading of "flashes
  as a warning, then explodes when near": detonation is proximity-armed, so
  shooting it down at range fully defuses it)*. In dark levels the Wraith
  self-glows (light radius 1.5 tiles, §8.4) — you always see the bomb coming.

**6.1.9 🪓 THE REAPER — mini-boss, summoner.** HP **20**, **750 pts**, speed
0.40×, melee **3**.
- **Traversal (unique inverted mask):** floats **through wall/terrain tiles** but
  is **blocked by movable objects** — crates and barrels — and uses full A\* *over
  the object-occupancy grid only* to route around them (§6.4). Walls are not
  cover against a Reaper; a crate barricade is.
- **Summons:** every **6 s** *(base; ramps §8.6)*, spawns **2 Ghosts or 1
  Skeleton** (50/50) at its position, capped at **6 live minions** per Reaper.
- **Dark energy blast:** every **9 s**, fires a straight projectile at the player
  — **3 dmg**, 7 tiles/s. (LOS is irrelevant to a thing that ignores walls; the
  blast itself still collides with terrain and crates normally.)
- Never spawned by spawners; placed explicitly by level definitions (§8.1) as a
  set-piece or gauntlet anchor. Resists Nova and Lightning (§5.1, §5.2).

### 6.2 Enemy Summary Table (canonical stat reference)

| Enemy | HP | Points | Speed (×player) | Melee dmg | Ranged attack | Ranged dmg | Gems | Navigation |
| :---- | :--- | :--- | :--- | :--- | :---- | :--- | :--- | :---- |
| Ghost | 2 | 50 | 0.45 | 1 | — | — | 1 | none (direct, omniscient) |
| Skeleton | 4 | 100 | 0.50 | 1 | — | — | 1 | wall-slide avoidance |
| Skeleton Shooter | 4 | 150 | 0.65 | 1 | Arrow | 2 | 2 | full A* (after LOS acquire) |
| Lobber | 2 | 100 | 0.40 / 0.95 flee | 1 | Lobbed explosive (AoE) | 2 | 1 | cover-seek / flee |
| Bat | 2 | 150 | 1.15 (flight) | 2 | — | — | 1 | flies over everything |
| Spider | 4 | 200 | 1.5 burst / pause | 2 | Web | 0 + entangle | 2 | direct, retreat-when-blocked |
| Zombie | 8 | 200 | 0.28 | 3 | — | — | 3 | full A* |
| Fire Wraith | 2 | 150 | 0.50 | — | Proximity explosion | 4 AoE | 2 | full A* |
| The Reaper | 20 | 750 | 0.40 | 3 | Dark blast / summons | 3 | 10 | A* over objects; ignores walls |
| Spawner (any theme) | 6 | 300 | static | — | — | — | 3 | — |

**Gems column — checked as the sole gem source (§3.5, final).** At 5 energy per
gem, an average kill yields 5–15 energy, so a minimum Nova (25) costs ≈2–5
kills, a full bar (100) ≈7–20 depending on the Night's tier mix, a Reaper pays
half a bar, and a spawner 15. That cadence — Nova every handful of engagements,
banked charges as a reward for sustained aggression — is the intended economy;
the column's values stand unchanged with caches removed.

### 6.3 Spawners (themed generators)

The Gauntlet-generator role, reused from ADD's Dispatch Terminal but **typed**:
each spawner is bound to an enemy table and skinned to match (source doc: "bone
piles for skeletons").

- **Stats:** HP 6 · 300 pts · stationary · no attack · destroyed by player
  bullets, melee, kicked barrels, and shrapnel (shrapnel damages spawners —
  explicit in the barrel addendum). Unaffected by Nova and Lightning (final —
  abilities touch enemies plus, for Lightning only, barrels; §5).
- **Spawn logic:** first spawn 2 s after level start; then every **5 s base**
  (interval and live-cap are **difficulty-ramping parameters**, §8.6); each
  spawner maintains at most **4 live spawns** of its own; spawn point is the
  spawner's tile with a 0.5 s emergence telegraph.
- **Themed variants** (data-driven `CFG.SPAWNER` table — a skin + weighted enemy
  list + optional interval/cap overrides):

| Variant | Skin | Spawns |
| :---- | :---- | :---- |
| Bone Pile | heaped bones | Skeleton 70% / Skeleton Shooter 30% |
| Grave Mound | disturbed earth | Ghost 80% / Zombie 20% |
| Egg Sac | webbed cocoon | Spider 100% |
| Belfry Roost | hanging shapes | Bat 100% |
| Ember Pit | smoldering brazier | Fire Wraith 100% |
| Cauldron | bubbling pot | Lobber 100% |

Levels mix variants to compose encounters (§8.1 spawn rules place them; §7.1 of
the source doc's "randomizing enemy spawner locations" is delivered by zone-based
spawn rules rather than fixed coordinates).

### 6.4 Pathfinding & Navigation Infrastructure (new system)

ADD shipped its entire roster on LOS checks + direct steering; Repossessed's
roster explicitly requires **grid A\*** (Skeleton Shooter, Zombie, Fire Wraith,
Reaper — "uses full pathfinding" is verbatim source text). This is the largest
piece of net-new engine infrastructure (§13.4). Design constraints:

- **Grid A\*** over the tile grid, 8-directional with corner-cut prevention.
- **Traversal masks per navigator class:**
  - `GROUND` (Shooter, Zombie, Wraith): solid terrain + closed doors +
    static crates/barrels are blocked.
  - `PHANTOM` (Reaper): terrain tiles all passable; **only movable objects
    (crates, barrels) block** its float.
  - Ghosts/Skeletons/Spiders/Lobbers/Bats do **not** use A\* (steering-only or
    flight), keeping the per-frame budget on the four classes that need it.
- **Repath cadence:** every 0.5 s or on target-tile change, whichever is later;
  paths followed via waypoint steering. Movable objects changing (crate placed,
  barrel destroyed, door opened) dirty the nav grid and force a repath for
  affected navigators — this is what makes crate barricades *work* as a tactic.
- **Budget rule:** stagger repaths across frames (round-robin) so a Zombie horde
  never spikes a frame.

---

## 7. INTERACTIVE OBJECTS & THE CARRY SYSTEM

Crates and barrels are **entities, not tiles** — they move, so they live outside
the tile grid (see §13.3 for why this diverges from ADD, where all obstacles were
grid tiles). Both occupy exactly one tile footprint when static, are solid to
ground entities, and register as blockers in the nav grid (§6.4).

### 7.1 Crates

**Identity:** indestructible, movable, one-tile cover blocks. Nothing in the game
destroys a crate — not barrels, not the Fire Wraith, not abilities (§13.16).

**7.1.1 Static properties**
- Solid to ground entities; **blocks enemy line-of-sight** (it is "blocking
  cover" per the source doc).
- **Ricochets ALL straight projectiles** — player bullets **and** enemy arrows /
  dark blasts / webs bounce off crates (source doc, explicit for both sides).
  Projectiles retain owner and damage after the bounce; a crate-deflected arrow is
  still an enemy arrow. Enemy projectiles never damage enemies (§9), so a bounced
  arrow only ever threatens the player. Lobbed explosives **ignore crates** (they
  arc over). Shrapnel bounces off crates (§7.2.4).
- Bats fly over crates; the Reaper is blocked by them (its only blocker).

**7.1.2 Pickup**
- Automatic on contact while hands are free (no button — source doc). If already
  carrying, contact does nothing (no swap).
- While carried: player enters CARRYING state (§2.5) — move ×0.85, **cannot
  fire**, crate rendered held overhead.

**7.1.3 Drop / Throw (aim input while carrying)**
The aim/fire input is repurposed as the release command. Exactly two branches,
keyed on player movement *(unified interpretation of the source doc's "drop or
throw in that direction")*:
- **Stationary release = short toss:** the crate travels up to **1.5 tiles** in
  the aim direction and settles static on the first free tile (stopping early
  at any obstruction). At minimum range
  this is a gentle 1-tile placement; it never rolls (crates "do not move unless
  carried"). No vault.
- **Moving release ("drop while running"):** crate drops on the spot and the
  player **automatically vaults over it** — a scripted VAULT (§2.5): 0.35 s,
  2.0-tile forward hop, no collisions, lands beyond the crate. Requires the
  landing tile to be walkable; otherwise it degrades to a stationary-style toss.

**7.1.4 Carried-crate pushback**
While CARRYING a crate, any enemy colliding with the player is **pushed back 1.5
tiles** and takes **no melee exchange** — the crate is a bumper, not a weapon.
**Exception: Bats** (explicit source-doc exemption — they fly over the crate and
hit *you*). Carrying a crate is therefore a legitimate "walk through the ghost
swarm" tool that trades away your gun.

**7.1.5 Wall-vault**
If the player is CARRYING and runs into a **wall exactly one tile thick** (along
the movement axis) whose far-side tile is walkable: the crate is **auto-dropped
against the wall** and the player **vaults over both crate and wall**, landing on
the far side (same VAULT state, path length 2 tiles + wall). If the wall is **≥2
tiles thick**, nothing happens — no auto-drop, just a bump (source doc, explicit:
the jump can't clear two tiles). This is the game's signature traversal trick and
the reason VAULTING exists as a state (§13.5).

**7.1.6 Puzzle interactions**
- **Pressure plates (§8.2):** a crate resting on a plate holds it pressed
  (player weight also presses). Plates drive linked doors (§8.1 `links`).
  Parking a crate on a plate to hold a door open is the canonical crate puzzle.
- There are **no pits or gaps** in this design (decision closed) — crates'
  traversal utility is the vault family (§7.1.3, §7.1.5), not gap-filling.

### 7.2 Barrels

**Identity:** movable, carriable, **damageable**, explosive. The game's chaos
currency.

**7.2.1 Health & fire state ladder**
Barrel HP: **4** *(proposed — source gives behavior, not the number)*. Damage
sources: player bullets, enemy projectiles (both "exchange damage" with barrels
and are consumed — **projectiles never bounce off barrels**), melee, shrapnel,
Fire Wraith explosions, other barrel blasts, rolling-barrel enemy impacts.

| HP | State | Visual | Light radius (dark levels, §8.4) |
| :--- | :---- | :---- | :---- |
| 4 | Intact | plain barrel | — |
| 3 | Smolder | small flame licks | 2.0 tiles |
| 2 | Burning | steady fire | 3.0 tiles |
| 1 | Raging | violent flame, sparks | 4.5 tiles |
| 0 | **EXPLODE** | §7.2.3 | 8-tile flash, 0.3 s |

Fire intensity **is** the warning system and the light source: "the more damaged
a barrel is, the brighter the fire grows." A raging barrel is one hit from
detonation — carrying one is a choice.

**7.2.2 Carrying & kicking**
- Carried and dropped like crates (§7.1.2–7.1.3), same CARRYING rules.
- **Moving release = the kick:** the barrel is punted forward, **rolling on its
  side** at initial **7 tiles/s**, decelerating at 4 tiles/s² (linear damping),
  **bouncing off walls** retaining 60% speed — the ADD Atomic Dustbin's shipped
  slide/friction/bounce physics, reused wholesale (§13.8).
- **Rolling impacts:** an enemy struck by a barrel rolling ≥3 tiles/s takes
  **1 contact dmg**; the barrel loses **1 HP** and 40% speed per enemy hit
  *(proposed — implements "losing energy to melee collisions with enemies")*. A
  kicked barrel is thus a bowling ball that arms itself as it scores.
- **Carried barrels are live targets — final.** A carried barrel keeps its HP
  pool and its hitbox while overhead. It takes damage from **enemy projectiles**
  (they strike the barrel, not you), from **enemy melee contact** (a contact
  event deals its normal damage to you *and* 1 HP to the barrel), and from
  **bounced projectiles of any origin** — including your own bullet coming back
  off a crate. At 0 HP it **detonates in your hands**: full shrapnel burst
  centered on you (post-hit i-frames cap the self-damage, §2.1), CARRYING ends,
  and attribution follows the killing blow's owner (§9). This is intentional
  risk, not an edge case to prevent — a raging barrel is a bomb you are
  choosing to hug.
- Stationary release places it upright (static, solid). No crate-style vault or
  pushback from barrels *(proposed: vault/pushback/wall-jump are crate-exclusive
  utilities; barrels are the volatile sibling)*.

**7.2.3 Explosion (at 0 HP)**
The explosion itself deals **no direct damage and applies no direct force** — it
is a VFX event that **spawns shrapnel**; all damage and pushback are delivered by
the shrapnel (this is the source doc's model: crate pushback comes "from shrapnel
only — not the barrel explosion directly"). Explosion event sequence:

1. **Hit-stop:** global freeze **4 frames** (~67 ms @60fps) on the detonation
   frame (source: 3–5 frames).
2. **Screen shake:** **0.25 s**, amplitude scaled by proximity — full at ≤3
   tiles, fading to zero at ≥12 tiles (source: 0.2–0.3 s, distance-scaled).
   Respects the accessibility toggle (§12.2).
3. **Scorch decal** at the blast center — persistent, visual-only, optional fade
   after **8 s**.
4. **Shrapnel spawn:** §7.2.4.
5. **Chain reactions:** shrapnel striking other barrels damages them → cascades.
   A chain of ≥3 barrels earns a **"CHAIN REACTION!"** callout *(proposed)*.

**7.2.4 Shrapnel (a projectile species)**
- **8 pieces** per barrel, radial with ±12° jitter *(count proposed)*.
- Per piece: **damage 1 · health 2 · speed 8 tiles/s · lifespan 1.2 s**.
- **Bounces off walls and crates** (free — no health cost). **Exchanges damage
  with** enemies, the player, barrels, and **spawners** (all explicit in the
  addendum), losing 1 health per damaging hit; destroyed at 0 health or lifespan.
- **Pushes crates:** a shrapnel hit applies a **0.5-tile pushback impulse** to a
  crate — the *only* thing that moves a crate besides carrying (source doc,
  explicit).
- **Attribution:** shrapnel inherits the attribution of whoever landed the
  barrel's killing blow, and chained barrels propagate that owner onward — a
  player-started chain scores every kill in the cascade; an enemy-started chain
  scores none of them (§9).
- The player's 0.4 s post-hit invulnerability (§2.1) caps point-blank shrapnel at
  ~2 hits — dangerous, not a deletion.

### 7.3 Object Placement

Crates and barrels enter levels two ways (§8.1): **fixed placements** (authored
set pieces — the barricade puzzle, the barrel by the spawner nest) and **spawn
rules** (zone-scattered counts — the source doc's "randomizing obstacle
placements within the fixed layout"). Both run through the same loader path.

---

## 8. LEVEL STRUCTURE

### 8.1 Level Definition Format v2 (adapted from ADD §8.1)

ADD's core contract is preserved verbatim: **every level is a plain data object;
the loader is the only entry point to a playable level; the engine never branches
on a level's origin.** The generator (§8.3) is a *producer* of these objects,
and future hand-authored levels will be written directly as them — identical
pipeline either way, exactly as ADD ships it. What changed from ADD's format
(full accounting in §13.2–§13.3):

- **Layer 2 (conveyor strips) is removed** — Repossessed has no conveyors.
- A **`props` block** is added: per-level flags (darkness, music track, and a
  reserved script hook for future scripted set-piece levels).
- A **`links` list** is added: pressure-plate → door bindings.
- Crates, barrels, spawner variants, keys, food, and treasure join the
  placement/spawn-rule vocabulary; **movable obstacles are entities placed by
  rules, not tiles in the grid**.

A Level Definition:

```
{
  id: "night-12",          // generated levels are numbered "night-N"
  name: "Haunted Manor",   // display name; the generator synthesizes these
  props: {
    dark: true,            // §8.4 lighting pipeline on
    music: "manor",        // track key, §11.3
    script: null           // reserved scripted-level hook (none in scope)
  },

  grid: [                  // Layer 1 — row-major strings, one char per tile
    "##########",
    "#....T..D#",
    "#........#",
    "#._....o.#",
    "##########",
  ],

  zones: [                 // Layer 3 — tagged placement-hint rectangles
    { x: 1, y: 1, w: 8, h: 1, role: "danger" },
    { x: 1, y: 2, w: 8, h: 2, role: "cover"  },
  ],

  placements: [            // fixed, exact-coordinate set pieces
    { type: "player", x: 1, y: 3 },
    { type: "exit",   x: 8, y: 1 },
    { type: "spawner", variant: "bonePile", x: 5, y: 1 },
    { type: "crate",  x: 2, y: 3 },
    { type: "plate",  id: "p1", x: 2, y: 3 },   // beneath the crate above
    { type: "door",   id: "d1", x: 8, y: 1 },   // plate-driven door
    { type: "reaper", x: 7, y: 1 },             // set-piece mini-boss
  ],

  links: [                 // trigger wiring
    { plate: "p1", door: "d1" },
  ],

  spawnRules: [            // zone-scattered, randomized per visit
    { type: "spawner",  variant: "graveMound", count: 2, zone: "danger" },
    { type: "barrel",   count: 4, zone: "cover" },
    { type: "crate",    count: 2, zone: "cover" },
    { type: "powerup",  count: 2, zone: "cover" },
    { type: "food",     count: 2, zone: "any", avoid: "danger" },
    { type: "treasure", count: 3, zone: "danger" },
    { type: "key",      count: 1, zone: "cover" },
  ],
}
```

Zone roles (`spawn`, `cover`, `combat`, `danger`, `any`) and the `avoid` field
carry over from ADD unchanged. **This layer is what delivers the source doc's
§7.1 replayability ask** — "randomizing enemy spawner locations, obstacle
placements, or power-up drop locations within the fixed layout" is exactly a
fixed grid plus spawn rules; the owner's own note that ADD's system "could be
adapted" is hereby taken up.

**Loader contract** (extends ADD §8.1.4):
- Parse the grid into collision/LOS structures via `CFG.TILES` flags.
- Resolve fixed placements; run spawn rules honoring `avoid`; never place on a
  solid tile, a plate *(plates must stay visible)*, or the exit tile.
- Register crates/barrels/spawners in the nav-grid blocker set (§6.4).
- **Validate:** exactly one `player`; ≥1 `exit`; every spawn-rule zone role
  exists or is `any`; every `links` entry references an existing plate id and
  door id; every `door`/`plate` placement sits on a legal tile; if `script` is
  set, its required actors are present.

### 8.2 Tile Set

Per-type flags live in `CFG.TILES` (data-driven, ADD rule). New relative to ADD:
tiles with **runtime-mutable state** (doors, plates) — the world
layer gains a small mutable-tile-state store (§13.6).

| Char | Tile | Solid (ground) | Blocks LOS | Blocks flight | Notes |
| :--- | :---- | :--- | :--- | :--- | :---- |
| `.` | floor | no | no | no | — |
| `#` | wall | yes | yes | no | vaultable if 1 thick (§7.1.5) |
| `T` | tombstone | yes | yes | no | flavor solid; indestructible |
| `o` | pillar | yes | yes | no | — |
| `D` | locked door | yes | yes | no | opens permanently via key (§3.6) |
| `d` | plate door | yes (while closed) | yes (while closed) | no | open ⇔ any linked plate pressed |
| `_` | pressure plate | no | no | no | pressed by player or crate weight |

Notes: closed doors count as walls for Bounce Shot ricochets and for the
Lobber's over-the-top arcs; an open door is plain floor to every system. There
are **no pit/gap tiles** in this design (decision closed).

### 8.3 Level Generation & The Night Plan (endless — ADD's model, reused)

**Final.** Repossessed adopts ADD's shipped progression model whole: levels are
**procedurally generated, endlessly**, one per "Night," with the generator
emitting a standard Level Definition (§8.1) that the loader consumes exactly as
it would a hand-authored one. Hand-authored levels (ADD's `handAuthored`
playlist mode) are a **future addition, deliberately out of scope now** — the
format, loader, and save schema (§12.3) already reserve room for them, so
adding them later is content work, not engine work. *(This reverses v1.0's
fixed 10-slot lineup; §13.24.)*

**The Night counter.** `night` (n = 1, 2, 3, …) is the single escalation index.
Title card each level: **"NIGHT n."** The counter never resets; there is no
loop and no boss/finale slot.

**Two decoupled axes** (the ADD LEVEL_PLAN idea): *what a level contains*
escalates with n; *what a level looks like* does not.

**Axis 1 — geometry (n-independent).** `generateLevel(n, rng)` picks a layout
**archetype** — `arena` (open room, scattered solids), `warrens` (dense
corridor maze), `halls` (rooms joined by doorways), `ring` (circuit around a
solid core) — and produces grid, zones, and fixed placements (player start,
exit, and any locked-door / plate-door set pieces with their key or crate)
from seeded parameters. Level footprint grows mildly with n (from ~24×26
toward the ADD-typical 30×34, then capped). Every generated level must pass
the loader's validation (§8.1) **plus generator-side solvability checks**:
flood-fill connectivity from start to exit and to every placement; any locked
door's key reachable without crossing that door; ≥1 crate reachable whenever a
plate-door puzzle was generated.

**Axis 2 — content (n-driven): `CFG.PLAN`.** Three tables keyed on n:

1. **Introductions** — the first Night each element may appear. Spawner output
   is filtered by the same table (a Bone Pile on Night 2 emits only Skeletons
   until Shooters unlock on Night 3):

| n | Newly eligible |
| :--- | :---- |
| 1 | Ghost, Skeleton · crates, barrels |
| 2 | Bone Pile spawner · keys + locked doors |
| 3 | Skeleton Shooter · plate-door puzzles |
| 4 | Lobber, Bat · Cauldron + Belfry spawners |
| 5 | Spider · Nest spawner · dark levels become possible (§8.4) |
| 6 | Zombie · Grave Mound spawner |
| 7 | Fire Wraith · Ember Pit spawner |
| 9 | Reaper (set-piece placement, ≤1 per level) |

2. **Spawn budget.** The generator spends `B(n) = 24 + 6·(n−1)` points (capped
   at 120) on spawners and loose enemies; each element costs its §6.2 point
   value ÷ 50 (Ghost 1, Skeleton 2, Shooter/Bat/Wraith 3, Zombie/Spider 4,
   spawner 6, Reaper 15). Composition weights lean toward the newest arrivals
   (~40% newest tier, ~60% earlier mix *(proposed weighting)*), which is ADD
   §8.3's "more dangerous mix, higher proportion of mid/high-tier enemies"
   expressed as data.

3. **Props.** `props.dark = true` with probability 0 before Night 5, then
   **25%**, never two dark Nights consecutively *(proposed)*; `props.music`
   cycles a small track pool keyed by archetype (§11.3).

How the eligible roster *behaves* is then governed by `CFG.RAMP` (§8.6). Enemy
HP and damage never scale with n (ADD principle: time-to-kill and lethality
stay learnable).

### 8.4 Dark Levels & Lighting (new subsystem)

Levels with `props.dark = true` render a **darkness overlay** (alpha ≈ 0.92)
punched through by radial light sources. This is a net-new renderer subsystem
(§13.17) motivated directly by the source doc's barrel design ("burning barrels
produce light, making them useful in dark levels").

**Light sources & radii (tiles):**

| Source | Radius | Behavior |
| :---- | :--- | :---- |
| Player lantern | 4.0 | soft, always on |
| Barrel: smolder / burning / raging | 2.0 / 3.0 / 4.5 | flickers; grows with damage (§7.2.1) |
| Barrel explosion flash | 8.0 | 0.3 s pulse |
| Muzzle flash | 1.5 | 2 frames per shot |
| Fire Wraith self-glow | 1.5 | constant — the bomb is always visible |
| Exit door glow | 2.5 | constant wayfinding beacon |
| Nova ring | ring circumference | while expanding |
| Lightning | full screen | 2-frame flash |

**Design intent:** darkness changes information, not simulation — enemies are
fully simulated in the dark (their tracking already ignores vision; §6.1) and are
simply **not drawn** outside light. The strategic question "do I damage this
barrel to buy light, knowing I'm building a bomb?" is the whole point. Render
approach (intent-level): offscreen mask canvas, radial-gradient punch-outs
composited over the scene per frame.

### 8.5 Level End Condition

Single trigger, per the source doc: **the player reaches the exit and leaves,
whenever they choose.** Uncollected gems/treasure/power-ups are forfeited. The
exit is never blocked by script *except* pre-open conditions expressed through
the door/plate/key systems (an exit behind a locked door is legal authoring).
Level-clear interstitial: score recap, then next level (prompt text per input
mode, ADD convention §4.2).

### 8.6 Continuous Escalation & The Ramp Table

**Final.** There is no loop boundary — difficulty rises **continuously with the
Night index**, via two mechanisms: the Plan (§8.3) decides *what appears*, and
`CFG.RAMP` (below) decides *how it behaves*. Per the source doc's stated
intent, ramping is **behavioral, not statistical**: enemy HP and damage never
change. The parameter-table mechanism is the **complete** difficulty-lever
system — no additional qualitative per-tier unlocks are planned (decision
closed).

`CFG.RAMP` parameters step once per **escalation tier**, where a tier is
**8 Nights** (`tier = floor((n − 1) / 8)`) — the v1.0 per-loop steps carry over
unchanged with "loop" read as "tier." Values are evaluated at level load
(`param = clamp(base + step × tier, limit)`); nothing mutates mid-level.

| Parameter | Base (tier 0) | Per tier | Limit | Ref |
| :---- | :--- | :--- | :--- | :--- |
| `shooterStopToShoot` | 0.50 | +0.10 | 0.90 | §6.1.3 (source-flagged ramp param) |
| `lobberErrorRadius` (tiles) | 1.50 | −0.25 | 0.25 | §6.1.4 (source-flagged) |
| `batPauseMin` / `Max` (s) | 0.4 / 1.2 | −0.05 / −0.15 | 0.15 / 0.30 | §6.1.5 (source-flagged) |
| `spawnerInterval` (s) | 5.0 | ×0.90 | 2.0 | §6.3 |
| `spawnerLiveCap` | 4 | +1 per 2 tiers | 8 | §6.3 |
| `enemySpeedMult` | 1.00 | +0.05 | 1.25 | all movers |
| `reaperSummonInterval` (s) | 6.0 | −0.5 | 3.5 | §6.1.9 |
| `spiderWebCooldown` (s) | 4.0 | −0.4 | 2.0 | §6.1.6 |

Escalation feel across a run: Nights 1–8 introduce the roster gently under
base parameters; Nights 9–16 add the Reaper and the first behavior tightening;
every tier after squeezes the same eight dials until their limits, by which
point spawn budget (§8.3) is the remaining pressure. The dials, steps, and
limits are ordinary `CFG` values — tuning them is a config edit, not a design
change.

---

## 9. SCORING & ATTRIBUTION

Per-enemy values: §6.2. Treasure: §3.4. High score: §12.5.

**Enemy-on-enemy damage:** direct enemy projectiles (arrows, dark blasts, webs)
**never damage enemies** — they pass through them and threaten only the player,
even after a crate ricochet *(proposed simplification; §13.15)*. Only two things
cross enemy lines: the Fire Wraith's AoE and neutral barrel shrapnel.

**The attribution rule (ADD §9, extended):** only **player-attributed** kills
score. Player-attributed causes: bullets, melee contact, Nova, Lightning, kicked
barrels, and **any shrapnel cascade the player started**. Enemy-attributed
causes score **zero**: Fire Wraith AoE kills, and shrapnel from a barrel whose
killing blow came from an enemy projectile or Wraith blast.

**Chain-of-custody:** a barrel tags the owner of its killing blow; its shrapnel
carries that tag; a chained barrel killed by tagged shrapnel adopts the same tag.
One player bullet into the right cellar therefore scores the entire firework
show — and a Lobber blindly detonating the same cellar scores nothing. This
ownership tag is the one piece of bookkeeping the whole scoring system hangs on.

**Callouts** *(proposed set)*: "CHAIN REACTION!" (≥3 barrels), "NOVA!" (≥5 kills
in one ring), "THUNDERSTRUCK!" (≥8 kills in one Lightning), floating "+N" score numbers on
every award (ADD convention).

---

## 10. HUD & GAME FEEL

### 10.1 On-Player Health Bar

A compact bar floats **above the player sprite** (source doc — a departure from
ADD's corner-HUD-only health; §13.19), color-coded by percentage of the 20-HP
base:

| Band | Color |
| :---- | :---- |
| 80%+ | Green |
| 60–80% | Blue |
| 40–60% | Yellow |
| 20–40% | Orange |
| <20% | Red |

Overheal (>100%, §2.1) renders as a **gold extension segment** past the bar's
right edge *(proposed)*. The bar briefly enlarges on damage taken.

### 10.2 Corner HUD

- **Score** — upper-left (source doc).
- **Gem-energy bar** — directly below score; fills 0–100; **stored Nova charges
  as a number over the bar** (e.g. "2"); pulses when a full charge banks.
- **Power-up indicator row** — one icon per active weapon power-up with its
  **remaining shot count**; Magnet shows a draining duration ring.
- **Key counter** — key icon × N (§3.6).
- **Ability readiness** *(proposed additions — implied necessities)*: Nova icon
  (lit when ≥ minimum energy or a charge is banked) and Lightning icon with a
  10-s radial cooldown sweep.
- **Night tag** — "NIGHT n," the endless level counter (§8.3).

### 10.3 Game-Feel Systems (shared plumbing)

One FX layer owns these so every system pulls from the same kit: **screen shake**
(amplitude/duration params; barrel spec §7.2.3; Reaper death also invokes it),
**hit-stop** (global N-frame freeze; barrels 4 frames;
Reaper kill 6 *(proposed)*), **decals** (scorch marks; despawn policy §7.2.3),
**floating numbers** (+score, +HP), **callout banners** (§9), **damage flash**
on any entity taking a hit, and the **full-screen Lightning flash** (§5.2). All
of it honors the screen-shake/flash accessibility toggles (§12.2). Tone check
(source doc): kinetic and exaggerated, but "explosions should pop, not pulverize
the screen into unreadability" — feedback must never hide gameplay information
for more than the hit-stop window.

---

## 11. VISUAL & AUDIO STYLE

### 11.1 Art Direction

Stylized retro pixel art; spooky-fun Halloween, high readability. Priorities:
silhouette clarity per enemy type at arcade speed, high contrast between
moment-to-moment clarity and chaotic bursts, glow effects reserved for things
that matter (fire, gems, exit).

### 11.2 Sprite Pipeline — final (REVERSED from v1.0)

**Placeholders first; the owner's real pixel-art sheets drop in later.** The
owner has hand-animated sprites for the player, enemies, barrels, crates, and
more — but their integration is deliberately deferred. Implementation ships
**generated placeholder sprites** built on the *exact frame contract the real
sheets already use*, so the eventual swap is a data change, not a rendering
change:

- **The 32-frame character contract (hard constraint).** Every character — the
  player and each enemy type — animates as a **4-frame cycle × 8 facing
  directions = 32 frames**, with frame index and facing as **independent
  axes**. The renderer resolves `(entityType, facing 0–7, frame 0–3)` → atlas
  cell and knows nothing else. Facing rows are ordered S, SW, W, NW, N, NE, E,
  SE (row 0 = south); the cycle runs at 8 fps while moving and holds frame 0
  when stationary *(row order and cadence proposed; the 4×8 sheet shape is the
  owner's fixed contract and is not negotiable)*.
- **Placeholder generation (approach — designer's call, per the owner):**
  procedurally *drawn* sprites, rendered **once at boot** into offscreen canvas
  atlases. Per entity: a palette + silhouette recipe (body primitives, eye
  dots, a per-direction orientation cue such as facing-side eye/weapon
  placement, and 4-phase bob/flap/shamble offsets) painted into all 32 cells
  with canvas primitives. This keeps ADD's zero-asset bring-up virtue while
  exercising the *real* atlas path from day one — the renderer never
  special-cases placeholders.
- **The atlas metadata is the swap point.** Each sheet carries a JSON atlas —
  `{ image, frameW, frameH, rows: 8 (facing), cols: 4 (frame) }` per entity.
  Integrating real art later = replacing PNG + JSON per entity. Zero code.
- Non-character art (crates, barrels + fire states, pickups, projectiles,
  tiles, decals) uses the same generated-atlas approach with 1–4 frames and no
  facing axis.

This supersedes v1.0's use-the-real-sprites-now recommendation (§13.20): the
answer to the source doc's open question is *both* — ADD-style generated art
now, the owner's sheets later, one renderer throughout.

### 11.3 Audio — final (REVERSED on music delivery)

- **SFX — synthesize via Web Audio**, reusing ADD's shipped `audio.js` approach
  (17 synthesized SFX, `M` mute). Crunchy 16-bit-style one-shots are exactly
  what the synth pipeline is good at, and it keeps SFX zero-asset and instantly
  tweakable. Required SFX list (initial): shot, shot-bounce, melee hit, player
  hurt, enemy death (per-family variants), spawner hit/death, barrel hit,
  barrel ignite, barrel explosion, shrapnel ricochet, crate pickup/drop/vault,
  barrel kick/roll, key pickup, door unlock, plate press, gem pickup,
  gem-charge bank, nova fire/ring hum, lightning strike, stun warble, web hit,
  struggle-free, wraith flash warning, reaper summon, reaper blast, treasure
  pickup, food pickup, level clear, game over.
- **Music — placeholder synthesized tracks now; the owner's OGG files later
  (final).** Real-music integration is deferred alongside sprites (§11.2). A
  small procedural music module extends the same `audio.js` Web Audio pattern:
  each **track key** resolves through a `MUSIC` registry whose entry describes
  a looping synth recipe (tempo, chord progression, bass + lead patterns, an
  8–16-bar loop) — spooky-flavored, deliberately simple, and instantly
  regenerable. **The registry is the swap point:** `props.music: "manor"`
  (§8.1) looks up `MUSIC["manor"]`, which today is `{ type: "synth", recipe }`
  and later becomes `{ type: "ogg", url }`. The level format, the
  track-selection code, and volume/duck behavior (Options volume, light
  low-pass duck while paused *(proposed)*) are untouched by the swap. Prefer
  OGG over MP3 when the real files land.

### 11.4 Audio Cue Rules (ADD §10 conventions carried over)

Dramatic, prominent stings for high-stakes moments — a **Reaper's arrival**
gets the "worker-death-grade" attention sting; barrel **chain reactions**
escalate pitch per link *(proposed)*. Mute toggle `M` persists in options.

---

## 12. META SYSTEMS

### 12.1 Menu Flow (state machine — ADD's real Pause/Save spec, reused)

Top-level game states are **exactly ADD's set**:
`title | playing | paused | levelclear | dead`. The pause overlay owns its own
**sub-screens** (per the ADD spec): `menu | options | save | confirm_overwrite
| confirm_quit | name_entry`, with root menu items **CONTINUE / OPTIONS /
SAVE & QUIT / QUIT**. The title screen owns two phases: `input` (mode select,
§4.2) and `load` (5-slot load screen, entered via `L`).

```
title(input) ──(Space → KB+mouse | A/Start → pad)──► playing
  │ ▲   └─(L)─► title(load): pick slot ─► playing     │ Esc/Space/Start
  │ └◄─ quit · save&quit · run end                    ▼
  ├──► OPTIONS (from title)                        paused
dead ◄─ player death (§2.6)                          ├ CONTINUE → playing
  │  └ high-score check (§12.5)                      ├ OPTIONS (sub-screen, §12.2)
  └──► title                                         ├ SAVE & QUIT → slot picker
levelclear interstitial between Nights (§8.5)        │   → (overwrite confirm)
                                                     │   → name entry → title
                                                     └ QUIT → confirm → title
```

Confirm = Enter/A; Back = Esc/B (source doc). Esc or Space opens the pause
from `playing` (Start on gamepad). Pausing **freezes the simulation
completely** — timers, cooldowns, stun, shrapnel, everything; while paused,
only pause polling runs (ADD rule: `update()` early-returns on `paused`). The
pause menu panel also shows the **weekly achievement progress summary** (§12.4
— an ADD spec convention worth keeping: the pause is where you check your
homework).

### 12.2 Options Screen

Reachable from the title screen and the pause `options` sub-screen. Persisted
immediately on change (`rep_prefs`, §12.3 — the ADD spec's slider behavior:
prefs survive without a save).

- **Controls:** remap every keyboard binding (move ×4, Nova, Lightning, pause,
  mute) via press-to-assign; conflict detection; reset-to-defaults. Gamepad:
  ability-side swap (Nova↔Lightning shoulders) only *(proposed scope)*. Confirm/
  Back keys are fixed *(proposed — remappable menu keys are a soft-lock hazard)*.
- **Audio:** SFX volume, Music volume, Mute.
- **Accessibility:** screen-shake toggle, flash-reduction toggle (caps the
  Lightning/explosion full-screen flashes; §10.3).

### 12.3 Save / Load (reconciled against ADD's real Pause/Save spec — REUSED)

ADD's shipped save architecture is adopted whole; only the snapshot fields
change, because they describe Repossessed state. Per the ADD spec:
`savegame.js` is a **pure leaf module** (imports nothing from game code; the
caller builds the snapshot from game state), and saves are **manual, named,
and slot-based** — v1.0's inferred auto-checkpoint is **withdrawn**; there is
no automatic save.

**localStorage keys** — ADD's layout, `rep_`-prefixed so the two games can
share an origin without colliding with ADD's `add_*` keys:

```
rep_save_0 .. rep_save_4    — five save slots
rep_prefs                   — preferences (the whole §12.2 options object)
rep_high                    — global high score (single value, not per-slot)
```

**Save slot schema** — ADD's, field-for-field, with Repossessed run state
swapped in:

```
{
  version: 1,
  name: string,              // player-entered, max 20 chars
  savedAt: number,           // Date.now()
  score: number,
  night: number,             // the Night index (ADD's `level`)
  gameMode: "levelPlan",     // reserved: "handAuthored" — these four fields
  playlistName: null,        //   are kept exactly as ADD shapes them, for the
  playlistFilename: null,    //   future hand-authored playlist mode (§8.3);
  playlistIndex: 0,          //   only "levelPlan" is live today
  player: {
    hp: number,              // clamped on load to the 30-HP overheal cap (§2.1)
    gemEnergy: number,
    storedCharges: number,
    keys: number,
  },
  powerups: { triple, big, fast, bounce },   // remaining shot counts
}
```

**Function surface (ADD's, verbatim):** `listSaves() / saveGame(slot, name,
snapshot) / loadSave(slot) / deleteSave(slot) / loadPrefs() / savePrefs() /
loadHighScore() / saveHighScore()`.

**Flows (ADD's, verbatim):**
- **SAVE & QUIT** (pause menu, §12.1): pick a slot → overwrite-confirm if
  occupied → name entry (typed on keyboard; gamepad accepts the default
  `"SAVE n"`) → snapshot written → quit to title.
- **Load:** title screen `L` → 5-slot load screen → loading an occupied slot
  starts a run at the saved Night with the saved score/player/power-up state.
  The level itself is **rebuilt fresh** (ADD's `resumeFromSave` → `buildLevel`
  pattern): mid-level entity state is never serialized, and since levels are
  generated, the resumed Night's *layout* may differ — its content budget is
  identical because it derives from n (§8.3).
- **Loading is unlimited** (§2.6, final). Death never touches slots; only the
  player deletes or overwrites them.
- **High score** is one global value, updated on level clear, death, and
  quit-to-title — never stored per slot (ADD rule).
- Corrupt slot JSON parses as an empty slot; a save from a schema the loader
  can't apply is discarded to fresh defaults. Never crash the boot.
- Transient state (Magnet timer, ability cooldowns, stun/entangle) is never
  saved.

### 12.4 Achievements (reconciled against ADD's real ACHIEVEMENTS.md — REUSED)

ADD's designed achievement architecture is adopted whole (§13.22):

- **Event bus** (`events.js`): minimal pub/sub — `emit / on / off`.
  `achievements.js` is the sole subscriber and owns all unlock logic; the
  dependency flows one way and game code never checks achievements inline.
- **Two dimensions:** **weekly challenges** — 5 active per ISO calendar week,
  globally synced (`setIndex = isoWeekNumber % totalSets`, UTC ISO week),
  incomplete progress discarded at rollover — and **lifetime achievements**,
  tiered Bronze → Silver → Gold → Platinum → Diamond, never reset. Plus ADD's
  XP/badge layer and the complete-all-5-weeklies meta slot (ADD's "Employee of
  the Week"; Repossessed skin: **"Monster of the Week"** *(proposed name)*).
- **Storage:** `rep_weekly_{isoYear}_{isoWeek}` and
  `rep_lifetime_achievements`. ADD's keys are **unprefixed** — Repossessed
  prefixes for the same same-origin-collision reason as §12.3.
- **UI surfaces (ADD's four):** title-screen weekly panel (5 slots + the meta
  slot with `n of 5`), non-blocking in-play banner with a synthesized
  congratulatory sound (no pause, no asset), post-level progress modal, and
  the categorized lifetime modal with tier-badge rows and `???` hidden
  entries.
- **Stats tracked independently of achievements** (end-of-run screen), under
  ADD's exact accuracy rule: **1 shot fired per volley regardless of active
  power-ups; each individual connecting bullet = 1 hit** (a fully-connecting
  Triple volley is 3 hits on 1 shot, 300%). Also: kills by type, damage taken,
  per-Night and total run time.

**Event vocabulary** — renamed to ADD's real convention (`module:event_name`,
colon-namespaced snake_case, payload fields in parentheses), organized by
emitting module as ACHIEVEMENTS.md does:

| Module | Events to emit |
| :---- | :---- |
| `player.js` | `player:hit (source)` · `player:hp_changed (hp, maxHp, overhealed)` · `player:died` · `player:vaulted (overWall)` · `player:stunned` · `player:entangled` · `player:struggled_free (remainingMs)` |
| `projectiles.js` | `bolt:fired (kind, activePowerups)` · `bolt:hit (targetType, bounceCount)` · `bolt:missed` · `shrapnel:hit (targetType, chainDepth)` |
| `enemies.js` | `enemy:died (type, killerKind, gemsDropped)` · `enemy:spawned (type, fromSpawner)` · `enemy:fired (type)` · `spawner:destroyed (variant)` · `reaper:summoned (count)` |
| `objects.js` | `crate:picked_up` · `crate:dropped (vaulted)` · `barrel:kicked` · `barrel:exploded (chainDepth, ownerKind)` · `plate:pressed (byCrate)` · `door:opened (kind)` |
| `abilities.js` | `nova:fired (ringHealth, kills)` · `lightning:fired (kills, barrelsDetonated)` · `gem:collected (energy)` · `charge:banked (total)` |
| `items.js` | `powerup:collected (kind)` · `key:used` · `food:eaten (hp, overhealed)` · `treasure:collected (tier)` |
| `level.js` | `night:start (n, dark)` · `night:end (stats)` · `run:start` · `run:end (stats)` |

**The registry lives in its own document.** ADD's explicit convention
(ACHIEVEMENTS.md header: cross-reference only; never reproduce the registry in
the GDD) is adopted: the Repossessed registry — IDs (`prefix_snake` style),
names, descriptions, weekly/hidden flags, five-tier thresholds, consolidation
map, and architecting flags — belongs in a future `REPOSSESSED-ACHIEVEMENTS.md`.
v1.0's ten starter concepts (Chain Reaction, Thunderstruck, Parkour, …) are
carried forward as seed material *for that document* and are no longer restated
here.

### 12.5 High Score

A **single global high score** (`rep_high`, §12.3) — ADD's real model, reused:
not a table, not per-slot. Shown on the title and game-over screens; updated
on level clear, death, and quit-to-title; beating it earns the flourish.
*(v1.0's proposed top-10 table is dropped for parity with the real ADD spec.)*
Score is the game's win condition (§1); the number is the trophy.

---

## 13. ADD COMPATIBILITY REPORT

Every place where Repossessed does **not** cleanly compose with a shipped ADD
system, why, and the disposition taken. Dispositions: **REUSED** (as-is),
**ADAPTED** (pattern kept, contents changed), **REPLACED** (different system in
the same slot), **NEW** (no ADD analog exists), **CONFLICT** (source materials
contradict — resolution recorded), **VERIFY** (pattern reused from an ADD doc
that was not provided — must be reconciled against the real thing).

**13.1 Platform target — CONFLICT (resolved).** The Repossessed source doc
targets Godot 4.3; the project owner's framing for this document specifies ADD's
platform and conventions (HTML5 Canvas + JS). Resolved: HTML5 Canvas. All
Godot-specific assumptions in the source doc are treated as intent, not
implementation.

**13.2 Level Definition, conveyor layer — ADAPTED.** ADD's Layer 2 (conveyor
strips + baked push field) has no Repossessed counterpart; no mechanic pushes
entities via terrain. The layer is **deleted**, not repurposed — the format is
now grid + zones/placements/spawnRules + `props` + `links` (§8.1). The loader's
push-field bake step disappears entirely.

**13.3 Obstacles as tiles vs. entities — did not compose; ADAPTED.** In ADD,
every obstacle (shelf, pallet, pillar) is a **grid tile**; the grid is the sole
collision truth. Repossessed's signature obstacles (crates, barrels) **move** —
they're carried, kicked, pushed by shrapnel, and destroyed — so they cannot live
in the tile grid. Resolution: immovable terrain stays in the grid (§8.2); movable
obstacles are **entities** placed via placements/spawnRules (§7.3) and
registered as dynamic blockers in collision + nav (§6.4). Consequence the
implementation pass must respect: **two collision sources** (static grid +
dynamic object set) where ADD had one.

**13.4 Pathfinding — NEW.** ADD shipped its whole roster on LOS + direct
steering; nothing in ADD pathfinds. Four Repossessed enemies require full
pathfinding *by explicit source text*, and the Reaper needs an **inverted
traversal mask** (walls passable, objects solid) ADD never contemplated. Grid A*
with per-class masks, repath cadence, and nav-dirtying on object changes is
specified in §6.4. This is the largest net-new engine system.

**13.5 Vaulting / pseudo-Z — NEW.** ADD's world is strictly flat; nothing ever
leaves the collision plane. The crate drop-vault and wall-vault (§7.1.3, §7.1.5)
require a scripted airborne state that temporarily exits collision (§2.5
VAULTING). Scoped deliberately narrowly — a fixed-duration scripted hop, not a
physics jump — so the flat-world assumption breaks in exactly one controlled
place.

**13.6 Mutable tiles — ADAPTED.** ADD tiles are immutable at runtime (the one
exception, Forklift-destroyed shelves, was a tile deletion). Repossessed doors
open and plates press/release — the world layer gains a small
runtime tile-state store layered over the static grid (§8.2), and tile mutations
dirty the nav grid (§6.4). The `CFG.TILES` data-driven flag pattern itself is
reused unchanged.

**13.7 Health delivery — REPLACED.** ADD's vending machines (static, single-use,
wall-flush, §2.5 ADD) are replaced by food pickups (§3.3) plus **overheal**
(§2.1), which ADD's hard 20-cap never allowed. The 20-HP integer core, hit-based
damage, carry-over between levels, and even the +5/+10 healing denominations are
all retained — only the container changed. New: 0.4 s universal post-hit
invulnerability, forced by shrapnel burst damage (ADD had no multi-hit burst
source and needed none).

**13.8 Special item vs. abilities — REPLACED, with one organ transplant.** The
Atomic Dustbin (carried consumable, attract-then-detonate) has no direct
descendant; Nova + Lightning + the gem economy (§5) occupy the slot. **Reused
wholesale:** the Dustbin's shipped throw physics — slide, friction deceleration,
wall bounce — is the kicked barrel's movement model verbatim (§7.2.2). The
attract-vortex mechanic dies with the Dustbin; nothing in Repossessed pulls
enemies.

**13.9 Keys & locked doors — NEW (decision taken).** No ADD analog. The source
doc lists keys among pickups and says only "finds keys." Adopted: inventory-count
keys + permanent-unlock doors (§3.6) rather than physically-carried keys, because
carried keys would collide with the one-slot carry system (§7.1.2) and turn every
locked door into a crate-juggling errand. The alternative is preserved as an open
question (§14.1).

**13.10 Keyboard-only fire scheme — DROPPED (decision flagged).** ADD's OPKL
directional-fire keys gave keyboard-without-mouse players full play. Repossessed's
keyboard mode is mouse-mandatory (§4.1–4.2) because the source doc specifies
mouse aim and the carry system overloads the aim input. Anyone who played ADD
keyboard-only loses that option. If it matters, an OPKL-style fallback could be
re-specified later — flagged rather than silently resolved.

**13.11 Input-mode lock — ADAPTED.** Mechanism kept exactly (title-screen select,
session lock, per-mode prompts, `G.inputMode` reset). Rationale changed: ADD
locked because 8-way vs 360° aim mixing was confusing; both Repossessed modes aim
360°, so the lock now buys only prompt clarity and device-detection simplicity
(§4.2).

**13.12 Melee knockback — REUSED + EXTENDED.** ADD knocks only Dan back;
Repossessed knocks both parties (§2.2) because enemy-side displacement machinery
is required anyway for carried-crate pushback (§7.1.4). The re-trigger-on-
re-entry rule is reused unchanged.

**13.13 Telegraph conventions — REUSED.** ADD's ground-shadow landing telegraph
(Sorter box, Drone bomb) is the Lobber's landing shadow (§6.1.4); ADD's
readable-windup principle (Drone COMMIT climb) is the Wraith's FLASH (§6.1.8) and
the Shooter's 0.4 s draw (§6.1.3). Same player-facing grammar: everything that
hurts announces itself.

**13.14 Lobber ≈ Sorter — REUSED (state machine).** The Lobber's
exposed-panic / covered-bombard mood flip is ADD's Sorter Bot state machine with
new numbers plus the accuracy-error ramp parameter. Deliberate: it shipped, it
reads well, players who know one instantly read the other.

**13.15 Enemy friendly fire & no-score — ADAPTED.** ADD's rule (robot-caused
kills score nothing) is kept and **generalized into ownership tags** because
Repossessed adds cascading neutral hazards (barrel chains) that ADD never had —
attribution must survive multi-step chains (§9). Direct enemy projectiles
(arrows, blasts) simply never damage enemies *(proposed simplification; ADD's
Security/Manager friendly fire has no mandate here)* — only AoE (Wraith) and
neutral shrapnel cross the line.

**13.16 Fire Wraith vs. crates — CONFLICT (resolved).** Source doc says the
Wraith explosion "can destroy obstacles (crates, barrels)" **and** that crates
"cannot be destroyed by anything." Resolved in favor of crate indestructibility:
crates are load-bearing traversal/puzzle tools (vaults, plates), and
letting one enemy delete them creates unwinnable puzzle states. The Wraith blast
damages **barrels** only (§6.1.8, §7.1).

**13.17 Darkness/lighting — NEW.** No ADD analog. A masked-overlay lighting
renderer (§8.4) exists because the source doc's barrel design demands it
("burning barrels produce light… useful in dark levels"). Scoped as
visual-information-only: no simulation changes in the dark.

**13.18 Human workers — no analog.** ADD's §7 (5 workers, exponential rescue
scoring, Inventory Bot predation) has no Repossessed counterpart — nothing in
scope asks for rescue or escort gameplay. *(A v1.0 draft transplanted the
worker's follow-on-LOS steering into an Angelic Spirit escort; that content is
deferred wholesale — see §14's deferred block — and this reuse is shelved with
it. The generic `props.script` hook (§8.1) remains as the reintroduction
seam.)*

**13.19 HUD placement — ADAPTED.** ADD is corner-HUD only; the source doc
mandates an on-player color-banded health bar (§10.1). Both coexist: health on
the player, score/gems/power-ups/keys in corners (§10.2). Overheal display is
new.

**13.20 Rendering pipeline — ADAPTED (placeholder-first; reverses a v1.0
decision).** ADD ships on canvas-drawn vector primitives; the owner has real
pixel-art sheets. Final call: **generated placeholder sprites first**, real
sheets later. Placeholders are procedurally drawn at boot into canvas atlases
on the owner's fixed **4-frame × 8-direction (32-frame) character contract**
(§11.2), so the renderer exercises the true sprite-atlas path from day one and
real art lands as a pure PNG+JSON data swap. Net effect: *closer* to ADD's
shipped zero-asset approach than v1.0's use-sprites-now recommendation, while
still standing up the atlas renderer ADD never had.

**13.21 Save/Load & Pause — REUSED (fields adapted; VERIFY closed).** ADD's
real Pause/Save spec has been provided and reconciled (v1.1). Adopted verbatim:
the pure-leaf `savegame.js` module and its full function surface, five named
manual save slots with overwrite-confirm and name entry (gamepad default
name), SAVE & QUIT semantics, the title-screen `L` load phase,
resume-rebuilds-the-level behavior, prefs persisting immediately on change, a
**single global high score**, corrupt-slot-as-empty parsing, the
`title|playing|paused|levelclear|dead` state set, pause sub-screens, and the
full-sim-freeze pause rule. Adapted: snapshot fields carry Repossessed state
(§12.3); `night` replaces `level`; `gameMode`/playlist fields are retained
with only `"levelPlan"` live (§8.3); localStorage keys are `rep_`-prefixed
because ADD's `add_*` keys share the origin. v1.0's inferred auto-checkpoint
model is withdrawn in favor of the real manual-slot system.

**13.22 Achievement system — REUSED (vocabulary adapted; VERIFY closed).**
ADD's real `ACHIEVEMENTS.md` has been provided and reconciled (v1.1). Adopted:
the `events.js` pub/sub with one-way dependency, the weekly (ISO-week
rotating, globally synced) + lifetime (five-tier B/S/G/P/D) dual system, the
XP/badge layer, hidden-`???` entries, the four UI surfaces, the
1-shot-per-volley accuracy stat rule, and the convention that **the registry
lives in its own document** — §12.4 now defines only the architecture plus a
Repossessed event vocabulary renamed to ADD's `module:event_name` style, with
the full registry deferred to a future `REPOSSESSED-ACHIEVEMENTS.md`. Storage
keys gain a `rep_` prefix: ADD's `weekly_*` / `lifetime_achievements` keys are
unprefixed, a real collision risk if the games ever share an origin.

**13.23 Crate ricochet vs. Bounce Shot — overlap resolved.** Crates always
ricochet all bullets (source doc); the Bounce power-up also grants ricochet.
Interaction defined rather than left ambiguous: crates bounce everything
unconditionally; Bounce extends ricochet to walls/terrain; range never resets on
bounce (§3.1). Without Bounce, a wall hit still kills the bullet.

**13.24 Endless procgen — REUSED (reverses a v1.0 decision).** v1.0 replaced
ADD §8.3's endless procgen with a fixed 10-slot authored lineup looping under
`CFG.RAMP`. The final call reverses that: Repossessed is **endless procgen,
exactly ADD's model** — the generator emits a Level Definition per Night,
content escalation rides an ordered index (`CFG.PLAN`, the analog of ADD's
LEVEL_PLAN / `"levelPlan"` game mode) decoupled from geometry, and `CFG.RAMP`
steps on 8-Night tiers instead of loops (§8.3, §8.6). Within-level variance
via zones/spawnRules (the source doc's §7.1 ask) is unchanged and now layers
on top of generated layouts. Hand-authored levels become the future addition —
ADD's `handAuthored` playlist mode, whose fields the save schema already
reserves (§12.3). The Level Definition format itself needed **zero changes**
for this reversal, which is the loader-never-branches-on-origin contract doing
its job.

**13.25 Music delivery — ADAPTED (audio.js extended).** ADD shipped SFX-only
synthesis and no music. Repossessed extends the same Web Audio pattern to
**placeholder synthesized music**, resolved through a `MUSIC` registry keyed
by `props.music` (§11.3); the owner's real OGG files integrate later by
retyping registry entries (`synth` → `ogg`) with no change to the level format
or the selection code. Net: *more* ADD audio-pattern reuse than v1.0's
use-OGG-now recommendation, plus a clean seam for the real assets.

---

## 14. OPEN DESIGN QUESTIONS & DEFERRED CONTENT

**Deferred, not abandoned — the boss / Corruptor / Spirit block.** The final
boss, the Corruptor ("evil character"), and the Angelic Spirit special level
(with its Corrupted Spirit failure form and escort scoring) are **tabled
wholesale and out of scope for this design**. The full prior treatment is
preserved in **GDD v1.0** (§8.7 and old §14.2/§14.3/§14.14) so it can be
reintroduced later without re-deriving anything. Nothing in v1.1 depends on
that content, and the reintroduction seams are already in place: the reserved
`props.script` hook and script-actor validation rule (§8.1), the shelved
follow-steering reuse noted in §13.18, and the callout/sting slots (§9,
§11.4). Reintroduction touches those seams and nothing else — in particular,
it does **not** require a fixed level lineup; a scripted level slots into the
endless sequence as a generator special-case or a future hand-authored level
(§8.3).

Genuinely open items:

**14.1 Keys — scope and carriage.** What do keys actually open — the level
exit, side vaults with treasure, shortcut doors? How many should the generator
budget per Night (§8.3 currently authors them as archetype set pieces)? §3.6
adopts inventory-keys that persist across Nights; the physically-carried
alternative in §13.9 remains available if key-juggling should compete with the
crate/barrel carry slot.

**14.2 Proposed-default sign-off.** Everything still marked *(proposed)* is
implementable behind a config dial but awaits deliberate sign-off rather than
silent adoption. Highest-leverage: per-enemy point values and gem-drop counts
(§6.2 — now the **sole** gem source, so they set Nova cadence directly); the
overheal cap 30 / no-decay rule (§2.1); Nova's 25-energy minimum and 14-tile
cap (§5.1); Lightning's 5-tile radius and Reaper damage (§5.2);
rolling-barrel damage numbers (§7.2.2); the §8.3 generation numbers (budget
curve, introduction schedule, dark-level probability, archetype roster); and
the 8-Night tier length (§8.6).

---

*End of Document — Repossessed GDD v1.1*
