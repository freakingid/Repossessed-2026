/* =========================================================================
   config.js — leaf data layer. Imports nothing from gameplay.
   CFG.TILES/PLAN/RAMP/SPAWNER/GEN are pure data; no rng, no geometry, no
   behavior. (SPEC-LEVEL §2, §3.1, §5.1, §5.4, §5.5)
   ========================================================================= */

export const CFG = {
  // Tile pixel size. Missing from Phase 1 (config/state foundation); required
  // by world.js's geometry helpers (bodyHitsWall, tileCenter, hasLineOfSight,
  // …). Ported verbatim from add2026 CFG.TILE — a fixed pixel constant, not a
  // design decision. Flagged in STATUS.md as a Phase-1 spec gap.
  TILE: 32,

  // LIVE world dims — set by the loader from each level's tile grid
  // (loadTileGrid). Declared here as metadata only (SPEC-LEVEL §2).
  COLS: 0,
  ROWS: 0,

  // Tile flags (SPEC-LEVEL §3.1). One entry per grid char. `d`/`D` carry the
  // STATIC closed-door flags (solid+blocksLOS true); the mutable tile-state
  // store (Phase 3) overrides these at runtime when a door is open.
  TILES: {
    ".": { name: "floor",      solid: false, blocksLOS: false, blocksFlight: false, mutable: null },
    "#": { name: "wall",       solid: true,  blocksLOS: true,  blocksFlight: true,  mutable: null },
    "T": { name: "tombstone",  solid: true,  blocksLOS: true,  blocksFlight: false, mutable: null },
    "o": { name: "pillar",     solid: true,  blocksLOS: true,  blocksFlight: true,  mutable: null },
    "D": { name: "lockedDoor", solid: true,  blocksLOS: true,  blocksFlight: false, mutable: "key-unlock" },
    "d": { name: "plateDoor",  solid: true,  blocksLOS: true,  blocksFlight: false, mutable: "plate-linked" },
    "_": { name: "plate",      solid: false, blocksLOS: false, blocksFlight: false, mutable: "pressed-state" },
  },

  // Content plan — pure function of Night index `n`, no rng, no geometry
  // (SPEC-LEVEL §5.1; upholds D2's content-purity boundary).
  PLAN: {
    introductions: [
      { night: 1, elements: ["ghost", "skeleton", "crate", "barrel"] },
      { night: 2, elements: ["bonePile", "key", "lockedDoor"] },
      { night: 3, elements: ["skeletonShooter", "plateDoor"] },
      { night: 4, elements: ["lobber", "bat", "cauldron", "belfry"] },
      { night: 5, elements: ["spider", "eggSac", "darkLevel"] },
      { night: 6, elements: ["zombie", "graveMound"] },
      { night: 7, elements: ["fireWraith", "emberPit"] },
      { night: 9, elements: ["reaper"] },
    ],
    budget: { base: 24, perNight: 6, cap: 120 },
    // NOTE: SPEC-LEVEL §5.1's costs table omits "lobber" despite introducing
    // it as a roster element (night 4). Filled here via the documented
    // formula (GDD §6.2 pts ÷ 50): Lobber = 100 pts -> 2. Flagged in
    // STATUS.md as a spec gap, not an invented design value.
    costs: {
      ghost: 1, skeleton: 2, skeletonShooter: 3, lobber: 2, bat: 3, fireWraith: 3,
      zombie: 4, spider: 4, spawner: 6, reaper: 15,
    },
    weights: { newestTier: 0.40, earlierMix: 0.60 },
    darkProb: { beforeNight: 5, prob: 0.25, noConsecutive: true },
  },

  // Difficulty ramp (SPEC-LEVEL §5.5; GDD §8.6). Evaluated once at level load,
  // snapshotted into G.ramp — never re-read mid-level. tier = floor((n-1)/8).
  // mode "add": base + step*tier, clamped toward limit.
  // mode "mul": base * step**tier, clamped toward limit.
  RAMP: {
    shooterStopToShoot:    { base: 0.50, step:  0.10,  limit: 0.90, mode: "add" },
    lobberErrorRadius:     { base: 1.50, step: -0.25,  limit: 0.25, mode: "add" },
    batPauseMin:           { base: 0.4,  step: -0.05,  limit: 0.15, mode: "add" },
    batPauseMax:           { base: 1.2,  step: -0.15,  limit: 0.30, mode: "add" },
    spawnerInterval:       { base: 5.0,  step:  0.90,  limit: 2.0,  mode: "mul" },
    spawnerLiveCap:        { base: 4,    step:  0.5,   limit: 8,    mode: "add" },
    enemySpeedMult:        { base: 1.00, step:  0.05,  limit: 1.25, mode: "add" },
    reaperSummonInterval:  { base: 6.0,  step: -0.5,   limit: 3.5,  mode: "add" },
    spiderWebCooldown:     { base: 4.0,  step: -0.4,   limit: 2.0,  mode: "add" },
  },

  // Spawner variant table (SPEC-LEVEL §5.1, §6.3 seam; GDD §6.3). Each entry
  // is inert data: a weighted enemy table plus placeholder interval/live-cap.
  // The per-frame emit loop belongs to #4 — this is what generation (§5.1)
  // and validation (§4.3.8) read to confirm a variant exists.
  SPAWNER: {
    bonePile:   { name: "Bone Pile",    table: { skeleton: 0.70, skeletonShooter: 0.30 }, interval: 5.0, liveCap: 4 },
    graveMound: { name: "Grave Mound",  table: { ghost: 0.80, zombie: 0.20 },              interval: 5.0, liveCap: 4 },
    eggSac:     { name: "Egg Sac",      table: { spider: 1.00 },                            interval: 5.0, liveCap: 4 },
    belfry:     { name: "Belfry Roost", table: { bat: 1.00 },                                interval: 5.0, liveCap: 4 },
    emberPit:   { name: "Ember Pit",    table: { fireWraith: 1.00 },                         interval: 5.0, liveCap: 4 },
    cauldron:   { name: "Cauldron",     table: { lobber: 1.00 },                             interval: 5.0, liveCap: 4 },
  },

  // Generator dials (SPEC-LEVEL §5.3/§5.4, all (proposed) §14.2 — Q5 tuning,
  // not blockers). Geometry/placement reads these; never hardcode.
  GEN: {
    maxAttempts: 8,                    // solvability re-rolls before arena fallback (§5.4)
    footprintMin: [24, 26],            // [cols, rows] at n=1
    footprintMax: [30, 34],            // [cols, rows] cap
    footprintGrowNights: 12,           // nights to interpolate min→max over (then cap)

    // arena: single-tile o/T obstacles at this density of interior area, each
    // kept isolated by a clearance radius so they can never seal a region.
    arenaClusterDensity: 0.05,
    arenaClearance: 2,

    // warrens: 2-tile corridors on a pitch-3 cell grid; knock this fraction of
    // cell-count extra walls to add flanking loops (a perfect maze reads badly).
    warrensCorridorW: 2,
    warrensLoopFactor: 0.15,

    // halls: BSP leaves; corridors this wide connect sibling room centers.
    hallsMinLeaf: 6,
    hallsMaxDepth: 4,
    hallsCorridorW: 2,

    // ring: solid centered core, perimeter loop this wide, one horizontal spoke
    // always + a vertical spoke at this chance (spokes are carved chords, they
    // add routes, never cut the loop).
    ringLoopWidth: 2,
    ringSpokeChance: 0.5,

    // roster → spawnRules: collapse this many same-variant roster picks into one
    // extra spawner source, capped; loose (spawner-less) enemies capped per level.
    spawnerPickDivisor: 8,
    maxSpawnersPerVariant: 3,
    maxLoosePerLevel: 14,

    // props.music (§6.5 seam): archetype→track-pool key. The MUSIC registry
    // (#11.3) resolves these keys synth→ogg later; the generator only stamps.
    music: {
      arena:   ["battle_a", "battle_b"],
      warrens: ["skulk_a"],
      halls:   ["gothic_a"],
      ring:    ["siege_a"],
    },
  },

  // Player tunables (SPEC-PLAYER §1 P2-P4, §2, §4-9). Px values are GDD
  // tile/sec or tile-distance values × TILE(32) per §1 P7; comments name the
  // tile source. (proposed) dials are flagged Q-P1/Q-P2 — play-feel, not
  // blocking (SPEC-PLAYER §13).
  PLAYER: {
    speed: 112,            // 3.5 t/s × 32  (NOT ADD's 185)  (§1 P7)
    r: 12,                 // (proposed, Q-P1) under TILE/2=16 so player fits 1-tile gaps (§1 P2)
    iframe: 0.40,          // post-hit invuln (s)  (§6.1)
    vaultDur: 0.35,        // VAULTING hop duration (s)  (§5.1)
    vaultHop: 64,          // 2.0 t × 32  (§5.1, §9)
    tossMax: 48,           // 1.5 t × 32  (stationary-release toss reach)  (§9)
    carryMult: 0.85,       // CARRYING speed ×  (§2.5, §1 P3)
    entangleMult: 0.35,    // ENTANGLED speed ×  (§2.5, §1 P3)
    stunMult: 0.70,        // STUNNED random-vector speed ×  (§2.5, §1 P3)
    entangleDur: 2.5, stunDur: 3.0, stunReroll: 0.30,   // (§5.2)
    entangleShaveSec: 0.30, entangleTurnDeg: 60,        // >=60 deg turn shaves 0.3s  (§5.2)
    meleeDamageToEnemy: 2,                              // ADD mop value (sink; exchange loop is #4)  (§6.3)
    knockbackImpulse: 520, knockbackFriction: 9,        // (proposed, Q-P1) ADD model; tuned to ~=0.75 t  (§1 P4, §6.2)
  },

  SHOT: {
    speed: 288,            // 9 t/s × 32  (NOT ADD's 470)  (§1 P7)
    range: 224,            // 7 t × 32    (NOT ADD's 360)  (§1 P7)
    cooldown: 0.25,        // 4/s base    (NOT ADD's 0.16) (§1 P7, §7)
    baseMax: 3,            // base on-screen cap  (§7)
    r: 6,                  // (proposed, Q-P2) ADD value  (§13)
    muzzle: 6,             // ADD muzzle offset r + 6  (§7)
    spread: 0.2094,        // +-12 deg in rad (Triple fan)  (§1 P1, §7)
    bigDmgMult: 2, bigRadiusMult: 1.6,   // Big: independent dmg x2 and hitbox x1.6  (§1 P1, §13)
  },

  // Remappable default keybinds (SPEC-PLAYER §3, §4.1). input.js reads this
  // map (or a runtime override); the Options remap UI (#6) writes it via
  // input.js's setKeybinds(map) seam.
  KEYS: {
    move: { up: "KeyW", down: "KeyS", left: "KeyA", right: "KeyD" },
    nova: "KeyN", lightning: "KeyL", pause: ["Space", "Escape"],
    confirm: "Enter", back: "Escape", mute: "KeyM",
    deadzone: 0.2,        // stick deadzone (move + right-stick fire)  (§3)
    gamepad: {},          // §4.1 indices — stub; not fully enumerated in fetched spec excerpts
  },
};
