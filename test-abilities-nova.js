/* test-abilities-nova.js — headless smoke tests for SPEC-ABILITIES Phase 4:
   the Nova cast (abilities.js onNova, §4.1) + the per-frame ring pass in
   updateAbilities (§4.2) + the ability:cast(nova) emit fired on dissipation
   (§7/OQ-A1). Exercises the REAL modules (config/state/level-loader/player/
   enemies/abilities), never inlined copies. Pure logic — set G state directly,
   register a barrel-detonation spy + an emit spy, drive a cast, step frames,
   assert; no render/canvas/input glue.

   onNova is registered into player.js by reference and is module-local;
   abilities.js exports it as __onNova (house __-prefixed convention, like
   __onLightning / enemies.js's __deathSweep) so a cast can be driven directly.
   The handler itself only gates on novaCd (§4.1 step 1); the STUNNED cast-lock
   is a player-side tryAbilities gate tested elsewhere.

   Frame arithmetic used below: expandTilesPerSec 12 × TILE 32 = 384 px/s, so a
   dt=0.5 frame advances the ring radius by 192 px. radiusCap = 14 × 32 = 448 px.
   Enemies are placed on the x-axis (dy=0) so centre-to-centre dist == |dx|.
   Run: node test-abilities-nova.js
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
  __onNova,
} from "./src/abilities.js";

let passed = 0, failed = 0;
function check(name, ok) {
  if (ok) { passed++; } else { failed++; console.error(`FAIL: ${name}`); }
}

const TILE = CFG.TILE;
const NV = CFG.ABILITY.nova;                   // barCap 100, ringMaxHp 50, expand 12, cap 14, cd 0.5, reaper 10/20
const STEP = 0.5;                              // dt: 384×0.5 = 192 px of radius per frame

// A minimal enemy built directly (no factory) so tests control every field.
// Mirrors test-abilities-lightning.js's mkEnemy.
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

// Barrel-detonation seam spy — Nova must NEVER call this (immunity by omission).
let barrelCalls = [];
registerBarrelDetonation((x, y, radius, cause) => barrelCalls.push({ x, y, radius, cause }));

// Fresh world for a cast: player at a known centre, empty transient arrays,
// zeroed fuel/cooldowns/score, and cleared spies.
function resetForCast() {
  initPlayer();
  G.player.x = 500; G.player.y = 500;
  G.enemies = [];
  G.shots = [];
  G.ebolts = [];
  G.spawners = [];
  G.crates = [];
  G.pickups = [];
  G.score = 0;
  G.gemEnergy = 0;
  G.storedCharges = 0;
  initAbilities();                 // novaCd → 0, G.novas → []
  emitted = [];
  barrelCalls = [];
}

/* ========================================================================= *
   1. Fuel branch (A5) — charge-first, else bar≥minBarToFire, else no-op.
 * ========================================================================= */
{
  // --- a stored charge fires a full ring, bar untouched --------------------
  resetForCast();
  G.storedCharges = 1; G.gemEnergy = 40;
  __onNova();
  check("fuel/charge: one charge consumed, bar left filling",
    G.storedCharges === 0 && G.gemEnergy === 40);
  check("fuel/charge: ring pushed with full ringMaxHp (50)",
    G.novas.length === 1 && G.novas[0].health === NV.ringMaxHp);
  check("fuel/charge: fresh ring starts r=prevR=0, empty hit, kills=0",
    G.novas[0].r === 0 && G.novas[0].prevR === 0 &&
    G.novas[0].hit instanceof Set && G.novas[0].hit.size === 0 && G.novas[0].kills === 0);
  check("fuel/charge: ring origin frozen at player centre",
    G.novas[0].x === 500 && G.novas[0].y === 500);
  check("fuel/charge: novaCd armed to cooldown (0.5)", getCooldowns().nova === NV.cooldown);
  check("fuel/charge: no ability:cast emit at cast", emitsOf("ability:cast").length === 0);

  // --- 0 charges, bar ≥ 25 → consume the whole bar, health scales ----------
  resetForCast();
  G.storedCharges = 0; G.gemEnergy = 40;              // ≥ minBarToFire (25)
  __onNova();
  check("fuel/bar: ring health = ringMaxHp × energy/barCap (50×40/100 = 20)",
    G.novas.length === 1 && G.novas[0].health === NV.ringMaxHp * (40 / NV.barCap));
  check("fuel/bar: whole live bar consumed (gemEnergy → 0)", G.gemEnergy === 0);
  check("fuel/bar: no charge touched", G.storedCharges === 0);

  // --- 0 charges, bar < 25 → rejected no-op (no ring, no cooldown, no spend)-
  resetForCast();
  G.storedCharges = 0; G.gemEnergy = 20;              // < minBarToFire (25)
  __onNova();
  check("fuel/no-op: bar < 25 & 0 charges pushes NO ring", G.novas.length === 0);
  check("fuel/no-op: cooldown NOT started", getCooldowns().nova === 0);
  check("fuel/no-op: no energy spent", G.gemEnergy === 20 && G.storedCharges === 0);
}

/* ========================================================================= *
   2. Cooldown gate (§4.1 step 1) — a second cast within 0.5 s is a full no-op;
      after the cooldown ticks to 0 a fresh cast fires again.
 * ========================================================================= */
{
  resetForCast();
  G.storedCharges = 2;                                 // enough fuel for two casts
  __onNova();
  check("cooldown gate: first cast pushes a ring + spends one charge",
    G.novas.length === 1 && G.storedCharges === 1);
  __onNova();                                          // immediate second cast → gated
  check("cooldown gate: second cast within cooldown pushes NO ring",
    G.novas.length === 1 && G.storedCharges === 1);

  // tick the cooldown to 0 (this also advances the live ring), then re-fire.
  updateAbilities(NV.cooldown);
  check("cooldown gate: updateAbilities decrements novaCd to 0", getCooldowns().nova === 0);
  const ringsBefore = G.novas.length;
  __onNova();
  check("cooldown gate: cast re-fires once novaCd reaches 0 (new ring + charge spent)",
    G.novas.length === ringsBefore + 1 && G.storedCharges === 0 &&
    getCooldowns().nova === NV.cooldown);
}

/* ========================================================================= *
   3. Single hit per enemy per ring (A3 hit Set) — a resisted enemy that
      lingers in the band across frames is struck exactly ONCE even after it
      moves into a later frame's swept band.
 * ========================================================================= */
{
  resetForCast();
  G.storedCharges = 1;
  const px = G.player.x, py = G.player.y;
  const rp = mkEnemy("reaper", px + 50, py, { hp: 100, resist: { nova: true } });
  G.enemies = [rp];
  __onNova();

  updateAbilities(STEP);                               // band (0,192] — crosses dist 50
  check("hit-set: resist enemy chipped once on crossing (hp 100→90, ring 50→30)",
    rp.hp === 90 && G.novas[0].health === 30);
  check("hit-set: resist enemy recorded in the ring's hit Set", G.novas[0].hit.has(rp));

  rp.x = px + 120;                                     // move it into the NEXT frame's band
  updateAbilities(STEP);                               // band (192,384] — dist 120 is inside it
  check("hit-set: already-struck enemy in a later band is NOT struck again",
    rp.hp === 90 && G.novas[0].health === 30);
}

/* ========================================================================= *
   4. Destroy + ring-health cost (A1/A2) — a lone 4-HP enemy is destroyed once,
      ring health drops by its HP, and the shared sweep drops a gem + scores.
 * ========================================================================= */
{
  resetForCast();
  G.storedCharges = 1;
  const px = G.player.x, py = G.player.y;
  const g = mkEnemy("ghost", px + 50, py, { hp: 4 });
  G.enemies = [g];
  __onNova();
  updateAbilities(STEP);                               // band (0,192] — crosses dist 50

  check("destroy: 4-HP enemy destroyed & swept out of G.enemies", !G.enemies.includes(g));
  check("destroy: ring health dropped by the victim's HP (50 → 46)",
    G.novas.length === 1 && G.novas[0].health === NV.ringMaxHp - 4);
  check("destroy: ring recorded one kill", G.novas[0].kills === 1);
  const ghostGems = CFG.ENEMY.ghost.gems, ghostPts = CFG.ENEMY.ghost.points;
  check("destroy: shared sweep dropped the enemy's gems",
    G.pickups.length === ghostGems &&
    G.pickups.every((p) => p.type === "gem" && p.value === CFG.GEM.energy));
  check("destroy: player-nova scores full points (awardKill player-*)",
    G.score === ghostPts);
  check("destroy: enemy:killed emitted once with cause player-nova",
    emitsOf("enemy:killed").length === 1 &&
    emitsOf("enemy:killed")[0].payload.cause === "player-nova");
}

/* ========================================================================= *
   5. Weak-ring-kills-final-victim (A4) — a ring whose health is LESS than the
      victim's HP still destroys that victim, then dissipates.
 * ========================================================================= */
{
  resetForCast();
  G.storedCharges = 0; G.gemEnergy = 25;               // bar-fire → health 50×25/100 = 12.5
  const px = G.player.x, py = G.player.y;
  const tough = mkEnemy("zombie", px + 50, py, { hp: 20 });   // HP > ring health
  G.enemies = [tough];
  __onNova();
  check("weak-ring: ring starts under-strength (12.5 < victim HP 20)",
    G.novas[0].health === 12.5);
  updateAbilities(STEP);
  check("weak-ring: under-strength ring still destroys its final victim",
    !G.enemies.includes(tough) && tough.hp === 0 && tough._cause === "player-nova");
  check("weak-ring: ring dissipated at health ≤ 0 (removed from G.novas)",
    G.novas.length === 0);
  const casts = emitsOf("ability:cast");
  check("weak-ring: dissipation emit fired once, killCount 1",
    casts.length === 1 && casts[0].payload.kind === "nova" && casts[0].payload.killCount === 1);
}

/* ========================================================================= *
   6. Nearest-first margin (A4) — a 15-health ring meeting three in-band enemies
      in ONE frame kills the nearer, then the farther as its final victim, and
      does NOT reach a third still farther out.
 * ========================================================================= */
{
  resetForCast();
  G.storedCharges = 0; G.gemEnergy = 30;               // bar-fire → health 50×30/100 = 15
  const px = G.player.x, py = G.player.y;
  const near = mkEnemy("ghost", px + 40, py, { hp: 10 });
  const mid  = mkEnemy("ghost", px + 50, py, { hp: 10 });
  const far  = mkEnemy("ghost", px + 60, py, { hp: 10 });   // in-band (60 ≤ 192) but never reached
  G.enemies = [near, mid, far];
  __onNova();
  check("margin: ring health is exactly 15", G.novas[0].health === 15);
  updateAbilities(STEP);                               // all three inside band (0,192]

  check("margin: nearest destroyed (final-victim break happens AFTER it dies)",
    !G.enemies.includes(near) && near.hp === 0 && near._cause === "player-nova");
  check("margin: second-nearest destroyed as the final victim (health 15→5→-5)",
    !G.enemies.includes(mid) && mid.hp === 0 && mid._cause === "player-nova");
  check("margin: the third (farther) enemy is NOT struck — survives untouched",
    G.enemies.includes(far) && far.hp === 10 && far._cause === undefined);
  const casts = emitsOf("ability:cast");
  check("margin: dissipation emit killCount = 2 (the two destroyed, not the third)",
    casts.length === 1 && casts[0].payload.killCount === 2);
}

/* ========================================================================= *
   7. Reaper nova-resist (A2) — 10 damage, ring −20, survives, not counted.
 * ========================================================================= */
{
  resetForCast();
  G.storedCharges = 1;                                 // full 50-health ring
  const px = G.player.x, py = G.player.y;
  const rp = mkEnemy("reaper", px + 50, py, { hp: 30, resist: { nova: true } });
  G.enemies = [rp];
  __onNova();
  updateAbilities(STEP);

  check("resist: reaper takes reaperDamage (30 → 20) and survives",
    rp.hp === 20 && G.enemies.includes(rp));
  check("resist: reaper is NOT death-tagged", rp._cause === undefined);
  check("resist: ring loses reaperRingCost (50 → 30)", G.novas[0].health === 30);
  check("resist: resisted hit is not counted as a kill", G.novas[0].kills === 0);
}

/* ========================================================================= *
   8. Projectile erase (A10) — enemy shots + ebolts in the band are removed for
      FREE (no health cost); player shots are KEPT; erase runs on the dying frame.
 * ========================================================================= */
{
  // (a) basic erase: enemy shot gone, player shot kept, ebolt gone -----------
  resetForCast();
  G.storedCharges = 1;
  const px = G.player.x, py = G.player.y;
  const eShot = { x: px + 50, y: py, owner: "enemy", r: 6, dmg: 2 };
  const pShot = { x: px + 60, y: py, owner: "player", r: 6, dmg: 1 };   // same band, KEPT
  const bolt  = { kind: "arc", x: px + 80, y: py, owner: "enemy", dmg: 2 };
  G.shots = [eShot, pShot];
  G.ebolts = [bolt];
  __onNova();
  const healthBefore = G.novas[0].health;
  updateAbilities(STEP);                               // band (0,192] covers 50/60/80

  check("erase: enemy-owned shot in band removed", !G.shots.includes(eShot));
  check("erase: player-owned shot in band KEPT", G.shots.includes(pShot));
  check("erase: ebolt in band removed", !G.ebolts.includes(bolt));
  check("erase: erasing costs the ring no health (free)",
    G.novas[0].health === healthBefore);

  // (b) erase still happens on the frame the ring's health hits ≤ 0 ----------
  resetForCast();
  G.storedCharges = 0; G.gemEnergy = 25;               // health 12.5
  const px2 = G.player.x, py2 = G.player.y;
  const killer = mkEnemy("zombie", px2 + 40, py2, { hp: 20 });   // drops ring ≤ 0
  const eShot2 = { x: px2 + 60, y: py2, owner: "enemy", r: 6, dmg: 2 };
  G.enemies = [killer];
  G.shots = [eShot2];
  __onNova();
  updateAbilities(STEP);                               // ring dies this frame (12.5 − 20)

  check("erase(dying): ring dissipated this frame", G.novas.length === 0);
  check("erase(dying): enemy shot still erased on the dying frame",
    G.shots.length === 0);
}

/* ========================================================================= *
   9. Immunity (by omission) — spawners/crates untouched; the barrel seam spy
      is NEVER called by Nova (GDD §5.1). Verified across ALL of §1–§8 above:
      no test registered a barrel call, so a single global assertion here would
      be weakened by resets; assert immunity in a fresh, targeted scenario.
 * ========================================================================= */
{
  resetForCast();
  G.storedCharges = 1;
  const px = G.player.x, py = G.player.y;
  const sp = { type: "spawner", x: px + 50, y: py, r: 16, hp: 6, points: 300, gems: 3 };
  const crate = { type: "crate", x: px + 50, y: py, r: 16 };
  G.spawners = [sp];
  G.crates = [crate];
  __onNova();
  // Expand the ring fully past both objects (multiple frames to the cap).
  for (let i = 0; i < 4 && G.novas.length > 0; i++) updateAbilities(STEP);

  check("immunity: spawner in-band is untouched (hp unchanged, still present)",
    G.spawners.length === 1 && sp.hp === 6 && sp._cause === undefined);
  check("immunity: crate in-band is untouched (still present)",
    G.crates.length === 1 && G.crates.includes(crate));
  check("immunity: the barrel-detonation seam spy is NEVER called by Nova",
    barrelCalls.length === 0);
}

/* ========================================================================= *
   10. Dissipation emit (OQ-A1) — a ring that destroys 2 enemies over its LIFE
       emits {kind:"nova", killCount:2} exactly ONCE, on dissipation (not at
       cast, not per hit); a resisted enemy chipped in the same ring is NOT
       counted.
 * ========================================================================= */
{
  resetForCast();
  G.storedCharges = 1;                                 // full 50-health ring
  const px = G.player.x, py = G.player.y;
  const a  = mkEnemy("ghost", px + 40,  py, { hp: 10 });          // crossed frame 1
  const rp = mkEnemy("reaper", px + 60, py, { hp: 100, resist: { nova: true } }); // chipped f1, survives
  const b  = mkEnemy("ghost", px + 300, py, { hp: 10 });          // crossed frame 2
  G.enemies = [a, rp, b];
  __onNova();
  check("emit: no ability:cast at cast time", emitsOf("ability:cast").length === 0);

  updateAbilities(STEP);   // band (0,192]: kills a (health 40), chips rp (health 20), b out of band
  check("emit: no dissipation emit while the ring is still alive (after frame 1)",
    emitsOf("ability:cast").length === 0 &&
    G.novas.length === 1 && G.novas[0].kills === 1 && rp.hp === 90);

  updateAbilities(STEP);   // band (192,384]: kills b (health 10); r 384 < cap, still alive
  check("emit: still no emit after frame 2 (ring alive, 2 kills banked)",
    emitsOf("ability:cast").length === 0 && G.novas[0].kills === 2);

  updateAbilities(STEP);   // r 576 ≥ radiusCap 448 → dissipate
  const casts = emitsOf("ability:cast");
  check("emit: dissipation fires exactly once on the ring's death",
    casts.length === 1 && G.novas.length === 0);
  check("emit: payload = {kind:'nova', killCount:2} — destroys only (resist not counted)",
    casts[0].payload.kind === "nova" && casts[0].payload.killCount === 2);
  check("emit: the resisted reaper survived and is uncounted",
    G.enemies.includes(rp) && rp.hp === 90);
  check("emit: the barrel seam was never called across the whole Nova life",
    barrelCalls.length === 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
