/* =========================================================================
   config.js — leaf data layer. Imports nothing from gameplay.
   CFG.TILES/PLAN/RAMP/SPAWNER/GEN are pure data; no rng, no geometry, no
   behavior. (SPEC-LEVEL §2, §3.1, §5.1, §5.4, §5.5)
   ========================================================================= */

export const CFG = {
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

  // Generator dials (SPEC-LEVEL §5.3/§5.4, proposed).
  GEN: {
    maxAttempts: 8,
    footprintMin: [24, 26],
    footprintMax: [30, 34],
  },
};
