/* test-abilities-lightning.js — headless smoke tests for SPEC-ABILITIES Phase 3:
   the Lightning cast body (abilities.js onLightning, §5.1) + the ability:cast
   (Lightning) emit (§7/OQ-A1). Exercises the REAL modules
   (config/state/level-loader/player/enemies/abilities), never inlined copies.
   Pure logic — set G state directly, register a barrel-detonation spy + an emit
   spy, drive a cast, assert; no render/canvas/input glue.

   The Lightning handler is registered into player.js by reference and is
   module-local; abilities.js exports it as __onLightning (house __-prefixed
   test convention, like enemies.js's __deathSweep) so a cast can be driven
   directly — the handler itself only gates on lightningCd (§5.1 step 1); the
   STUNNED cast-lock is a player-side tryAbilities gate tested elsewhere.

   abilities.js transitively imports player.js (whose graph touches window only
   inside input.js device glue these tests never call); a minimal defensive
   browser stub is installed anyway, same posture as test-abilities.js.
   Run: node test-abilities-lightning.js
*/

// --- Minimal browser-global stubs (defensive; house headless style) ----------
globalThis.window ||= globalThis;
globalThis.document ||= { createElement: () => ({ getContext: () => ({}) }) };
globalThis.AudioContext ||= function () {};

import { CFG } from "./src/config.js";
import { G } from "./src/state.js";
import { registerEmit } from "./src/level-loader.js";
import { initPlayer } from "./src/player.js";
import {
  initAbilities,
  updateAbilities,
  getCooldowns,
  registerBarrelDetonation,
  __onLightning,
} from "./src/abilities.js";

let passed = 0, failed = 0;
function check(name, ok) {
  if (ok) { passed++; } else { failed++; console.error(`FAIL: ${name}`); }
}

const TILE = CFG.TILE;
const LC = CFG.ABILITY.lightning;              // radiusTiles 5, reaperDamage 5, cooldown 10, stunSeconds 3
const R = LC.radiusTiles * TILE;               // 160 px

// A minimal enemy built directly (no factory) so tests control every field.
// Mirrors test-enemies-combat.js's mkEnemy.
function mkEnemy(type, x, y, over = {}) {
  const cfg = CFG.ENEMY[type] || {};
  return {
    type, x, y, r: cfg.r ?? 12, hp: cfg.hp ?? 4,
    speed: 0, face: 0, kvx: 0, kvy: 0, contact: false, spawn: 0,
    originSpawner: null, boss: !!cfg.boss,
    points: cfg.points ?? 0, gems: cfg.gems ?? 0, ...over,
  };
}

// Emit spy — capture every (type, payload); replaces the loader's emit sink.
let emitted = [];
registerEmit((type, payload) => emitted.push({ type, payload }));
const emitsOf = (type) => emitted.filter((e) => e.type === type);

// Barrel-detonation seam spy — capture args + call count (A8).
let barrelCalls = [];
registerBarrelDetonation((x, y, radius, cause) => barrelCalls.push({ x, y, radius, cause }));

// Fresh world for a cast: player at a known centre, empty transient arrays,
// zeroed cooldowns/score, and cleared spies.
function resetForCast() {
  initPlayer();
  G.player.x = 500; G.player.y = 500;
  G.enemies = [];
  G.pickups = [];
  G.score = 0;
  initAbilities();                 // lightningCd → 0
  emitted = [];
  barrelCalls = [];
}

/* ========================================================================= *
   1. Lightning radius wipe (§5.1, A2/A1) — non-resist destroyed & swept;
      one just outside R+e.r survives; a lightning-resist target takes 5 and
      survives; self-stun 3; cooldown 10; gemEnergy untouched (free); barrel
      seam called once; ability:cast emits once with killCount = destroys only.
 * ========================================================================= */
{
  resetForCast();
  const px = G.player.x, py = G.player.y;

  // gem fuel present, must be UNCHANGED by Lightning (§5.2 — costs no energy).
  G.gemEnergy = 42; G.storedCharges = 1;

  // Three non-resist ghosts well inside R → destroyed + counted.
  const g1 = mkEnemy("ghost", px + 40, py, { hp: 2 });        // dist 40
  const g2 = mkEnemy("ghost", px, py + 40, { hp: 2 });        // dist 40
  const g3 = mkEnemy("ghost", px - 40, py, { hp: 2 });        // dist 40
  // A lightning-resist Reaper INSIDE the radius → takes 5, survives, NOT counted.
  const rp = mkEnemy("reaper", px + 20, py, { hp: 20, resist: { lightning: true } }); // dist 20, r 14
  // A zombie JUST outside R + e.r (172) → survives, untouched.
  const zOut = mkEnemy("zombie", px + 174, py, { hp: 8 });    // dist 174 > 160+12
  G.enemies = [g1, g2, g3, rp, zOut];

  __onLightning();

  // --- destroyed non-resist enemies are swept out of G.enemies -------------
  check("lightning: all three in-radius non-resist ghosts destroyed & swept",
    !G.enemies.includes(g1) && !G.enemies.includes(g2) && !G.enemies.includes(g3));
  check("lightning: survivors remain (resist Reaper + out-of-range zombie)",
    G.enemies.length === 2 && G.enemies.includes(rp) && G.enemies.includes(zOut));

  // --- shared sweep dropped gems + scored + emitted enemy:killed ------------
  const ghostGems = CFG.ENEMY.ghost.gems, ghostPts = CFG.ENEMY.ghost.points;
  check("lightning: gems dropped for each destroyed enemy (shared sweep)",
    G.pickups.length === 3 * ghostGems &&
    G.pickups.every((p) => p.type === "gem" && p.value === CFG.GEM.energy));
  check("lightning: player-lightning scores full points (awardKill player-*)",
    G.score === 3 * ghostPts);
  check("lightning: enemy:killed emitted once per destroyed enemy",
    emitsOf("enemy:killed").length === 3 &&
    emitsOf("enemy:killed").every((e) => e.payload.cause === "player-lightning"));

  // --- resist target: chipped by reaperDamage, survives, NOT tagged ---------
  check("lightning: resist target takes reaperDamage (20 → 15) and survives",
    rp.hp === 20 - LC.reaperDamage && G.enemies.includes(rp));
  check("lightning: resist target is NOT death-tagged (survives, not destroyed)",
    rp._cause === undefined);

  // --- just-outside enemy untouched ----------------------------------------
  check("lightning: enemy just outside R+e.r is untouched",
    zOut.hp === 8 && zOut._cause === undefined);

  // --- free ability: gem fuel untouched ------------------------------------
  check("lightning: consumes no gem energy (gemEnergy/storedCharges unchanged)",
    G.gemEnergy === 42 && G.storedCharges === 1);

  // --- self-stun + cooldown -------------------------------------------------
  check("lightning: self-stun == stunSeconds (3)", G.player.stun === LC.stunSeconds);
  check("lightning: lightningCd == cooldown (10)", getCooldowns().lightning === LC.cooldown);

  // --- barrel seam called ONCE with (px, py, R, "player-lightning") ---------
  check("lightning: barrel seam called exactly once", barrelCalls.length === 1);
  check("lightning: barrel seam args = (px, py, 5×TILE, 'player-lightning')",
    barrelCalls[0].x === px && barrelCalls[0].y === py &&
    barrelCalls[0].radius === R && barrelCalls[0].cause === "player-lightning");

  // --- ability:cast emitted ONCE with killCount = destroys only -------------
  const casts = emitsOf("ability:cast");
  check("lightning: ability:cast emitted exactly once", casts.length === 1);
  check("lightning: ability:cast payload = {kind:'lightning', killCount:3} (resist Reaper NOT counted)",
    casts[0].payload.kind === "lightning" && casts[0].payload.killCount === 3);
}

/* ========================================================================= *
   2. Cooldown gate (§5.1 step 1) — a cast while lightningCd > 0 is a full
      no-op: no damage, no sweep, no stun refresh, no barrel call, no emit.
      After the cooldown ticks to 0, a fresh cast fires again.
 * ========================================================================= */
{
  resetForCast();
  const px = G.player.x, py = G.player.y;

  // First cast: arms lightningCd = 10.
  const first = mkEnemy("ghost", px + 30, py, { hp: 2 });
  G.enemies = [first];
  __onLightning();
  check("cooldown gate: first cast destroys the in-range enemy", G.enemies.length === 0);
  check("cooldown gate: cooldown armed to 10 after first cast", getCooldowns().lightning === LC.cooldown);

  // Second cast while cooldown > 0 → rejected no-op.
  emitted = []; barrelCalls = [];
  const blocked = mkEnemy("ghost", px + 30, py, { hp: 2 });
  G.enemies = [blocked];
  __onLightning();
  check("cooldown gate: blocked cast leaves the enemy untouched", blocked.hp === 2 && G.enemies.length === 1);
  check("cooldown gate: blocked cast fires no ability:cast / enemy:killed emit",
    emitsOf("ability:cast").length === 0 && emitsOf("enemy:killed").length === 0);
  check("cooldown gate: blocked cast does not call the barrel seam", barrelCalls.length === 0);

  // Tick the cooldown down; a fresh cast fires again.
  updateAbilities(LC.cooldown);
  check("cooldown gate: updateAbilities decrements lightningCd to 0", getCooldowns().lightning === 0);
  G.player.stun = 0;               // simulate the stun window having elapsed
  emitted = []; barrelCalls = [];
  __onLightning();
  check("cooldown gate: cast re-fires once cooldown reaches 0",
    G.enemies.length === 0 && emitsOf("ability:cast").length === 1 &&
    emitsOf("ability:cast")[0].payload.killCount === 1);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
