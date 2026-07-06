# Repossessed — GDD-ENEMIES

**Split-out section of the Repossessed Game Design Document (`GDD.md`, v1.1).**
Extracted per the ADD documentation convention once §6 stabilized, ahead of the
subsystem-#4 (Enemies) build. **Section numbers are preserved: this file *is* GDD
§6**, so every `§6`, `§6.1`–`§6.4` reference across `GDD.md`, the `SPEC-*` files,
and `STATUS.md` resolves here unchanged. This is design *intent* only —
implementation detail belongs to `SPEC-ENEMIES.md` (pending) and build reality to
`STATUS.md`. §6.4 (Pathfinding & Navigation Infrastructure) is **BUILT**
(subsystem #3, `nav.js`); the rest is the design source for subsystem #4.

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