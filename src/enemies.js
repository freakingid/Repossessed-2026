/* =========================================================================
   enemies.js — the ENEMY COMBAT SPINE + the load-bearing frame order
   (SPEC-ENEMIES §2, §3.5, §6.2, §6.3, §6.5, §6.6, E6/E8/E11, R2/R3/R6).

   This phase builds the combat spine end-to-end and proves it with the
   simplest roster member, the Ghost (§6.1.1). Per-type AI for the other eight
   types lands in later phases; the dispatch table + the 7-step tick are shaped
   to admit them without reordering.

   ---- tickEnemies(dt): THE 7-STEP FRAME ORDER (§3.5 / E11) ----------------
   The order is a CONTRACT, not a convenience — damage/death MUST resolve before
   the AI's EXPLODE decision or a Wraith shot down the frame its FLASH completes
   wrongly detonates (R2). Exactly, in order:
     1. spawners emit            (Phase 4 — hook only, no-op here)
     2. nav scheduler tick       (enemies-ai.scheduleRepaths — the Phase-2 layer)
     3. player-shot → enemy damage pass (§6.5)   // marks hp; tags deaths
     4. melee exchange (§6.2)
     5. death sweep (§6.3)        // an APPROACH/FLASH Wraith removed here is DEFUSED
     6. enemy AI tick over survivors: emergence gate → move/steer → per-type
        attack. A surviving Wraith whose FLASH completes EXPLODEs HERE (Phase 6).
     7. ordnance update: updateEbolts (Phase 7) + enemy-shot → player hit-test.

   ---- R6: ONE-WAY IMPORT FLOW --------------------------------------------
   enemies.js imports config/state/world, the player SINKS
   (applyDamageToPlayer / applyKnockbackToPlayer / applyEntangle /
   isCarryingCrate), level-loader seams (emit / registerEntityFactory), and the
   update* fns from enemies-ai.js. It is NEVER imported by player / projectiles /
   nav / enemies-ai — the flow is enemies → {player-sinks, enemies-ai}, never
   back. Factory registration is a loader→enemies CALLBACK (registerEntityFactory),
   not a loader import of enemies.
   ========================================================================= */
import { CFG } from "./config.js";
import { G } from "./state.js";
import { tileCenter } from "./world.js";
import {
  applyDamageToPlayer, applyKnockbackToPlayer, applyEntangle, isCarryingCrate,
} from "./player.js";
import { emit, registerEntityFactory } from "./level-loader.js";
import { scheduleRepaths, groundMover, updateGhost } from "./enemies-ai.js";

/* ---- Per-type AI dispatch (step 6) -------------------------------------- *
   Keyed by entity type. Later phases add their updater here; this phase ships
   only the Ghost. Each handler is (e, player, dt) => void and does the type's
   move/steer + attack. Unknown types no-op. */
const aiByType = new Map([
  ["ghost", updateGhost],
]);

// Test seam (structural R2 frame-order proof): inject a synthetic type's AI so a
// headless test can flag an entity "would explode this frame" and assert its AI
// branch never runs when it was killed in the pre-AI death sweep. Test-only.
export function __setEnemyAI(type, fn) { aiByType.set(type, fn); }

/* =========================================================================
   FACTORY REGISTRATION (E5) — enemies.js registers real factories for the
   loose element types; the loader's ENTITY_ARRAY already routes them to
   G.enemies. This phase ships the Ghost; later phases register the rest.
   ========================================================================= */

// Build a base enemy (§2) from a placement (p.x,p.y are TILE coords). Positions
// on the entity are PIXEL centers (the reconciled coord space, SPEC-PLAYER Ph6).
// speed is stored EFFECTIVE: base speedMul×player-speed×enemySpeedMult — E10's
// single ramp application (ramp is snapshotted before placements, so it is live
// here; it never changes mid-level). This reconciles §2's "speed = BASE" comment
// with the enemies-ai layer's read-time contract (e.speed is effective there).
function makeEnemy(type, p) {
  const cfg = CFG.ENEMY[type];
  const tc = tileCenter(p.x, p.y);
  const mult = (G.ramp && G.ramp.enemySpeedMult) || 1;
  return {
    type,
    x: tc.x, y: tc.y, r: cfg.r,
    hp: cfg.hp,
    speed: cfg.speedMul * CFG.PLAYER.speed * mult,   // EFFECTIVE px/s (E10)
    face: 0,
    kvx: 0, kvy: 0,          // knockback velocity (decays; shared ADD model, §6.6)
    contact: false,          // melee pair-lockout with the player (E6)
    spawn: 0,                // placed enemies emerge immediately (spawner-emitted set >0)
    originSpawner: p.originSpawner ?? null,
    boss: !!cfg.boss,
    points: cfg.points,      // denormalized for the death sweep / awardKill (§6.3)
    gems: cfg.gems,
  };
}

export function makeGhost(p) { return makeEnemy("ghost", p); }
registerEntityFactory("ghost", makeGhost);

/* =========================================================================
   THE SPINE
   ========================================================================= */

const KNOCKBACK_ZERO = 1;   // px/s below which enemy knockback snaps to rest

// Enemy knockback receive (§6.6) — SETS kv = unit(dir)×impulse, mirroring the
// player's model (a fresh impulse overwrites, it does not accumulate).
export function applyKnockbackToEnemy(e, dirX, dirY, impulse) {
  const mag = Math.hypot(dirX, dirY);
  if (mag === 0) return;
  e.kvx = (dirX / mag) * impulse;
  e.kvy = (dirY / mag) * impulse;
}

// Integrate + decay one enemy's knockback (§6.6). Ground/A* types route through
// moveBody (a knocked enemy still can't tunnel a wall); flight (Bat, Phase 4)
// takes it as a RAW position nudge — the fn is shaped to admit that now (R8).
function integrateEnemyKnockback(e, dt) {
  if (!e.kvx && !e.kvy) return;
  const dx = e.kvx * dt, dy = e.kvy * dt;
  const cfg = CFG.ENEMY[e.type];
  if (cfg && cfg.nav === "flight") {
    e.x += dx; e.y += dy;              // raw nudge, no collision (R8)
  } else {
    groundMover(e, dx, dy);            // moveBody vs walls+movables — no tunneling
  }
  const decay = Math.exp(-CFG.ENEMY.knockbackFriction * dt);
  e.kvx *= decay; e.kvy *= decay;
  if (Math.hypot(e.kvx, e.kvy) < KNOCKBACK_ZERO) { e.kvx = 0; e.kvy = 0; }
}

/* ---- The player↔enemy melee pair registry (E6) -------------------------- *
   The re-trigger lockout (a pair cannot re-exchange until contact breaks) is
   held BOTH on e.contact (the gate) and G.player.meleeState (the player-side
   view, reserved by initPlayer as null). A Set of enemy refs is the pair set —
   single player, so the enemy identifies the pair. */
function meleeSet() {
  const p = G.player;
  if (!(p.meleeState instanceof Set)) p.meleeState = new Set();
  return p.meleeState;
}
function clearMeleePair(e) {
  const p = G.player;
  if (p && p.meleeState instanceof Set) p.meleeState.delete(e);
}

// Step 3 (§6.5) — player-shot → enemy damage pass. Each player-owned shot is
// circle-vs-circle tested against every (non-emerging) enemy; on hit e.hp -=
// s.dmg and the shot is CONSUMED (Q2: a Bounce shot is consumed on enemy hit
// like any other — Bounce is a wall ricochet, not a pierce). A lethal hit tags
// the enemy's cause for the death sweep.
function playerShotEnemyPass() {
  const shots = G.shots, enemies = G.enemies;
  if (!shots || !enemies) return;
  for (let i = shots.length - 1; i >= 0; i--) {
    const s = shots[i];
    if (s.owner !== "player") continue;
    for (const e of enemies) {
      if (e.spawn > 0) continue;                 // emerging enemies don't collide (E4)
      const dx = s.x - e.x, dy = s.y - e.y;
      const rr = s.r + e.r;
      if (dx * dx + dy * dy > rr * rr) continue;
      e.hp -= s.dmg;
      if (e.hp <= 0) e._cause = "player-bullet";
      shots.splice(i, 1);                        // consumed on enemy hit (Q2)
      break;                                     // shot gone — stop testing enemies
    }
  }
}

// Step 4 (§6.2) — melee exchange. For every enemy overlapping the player:
//  · carrying a crate AND not a bat → push the enemy back 1.5 t, SKIP damage;
//  · else, if the pair is unlocked → player deals 2, enemy deals its melee (null-
//    guarded — the Fire Wraith has none), knock BOTH back, lock the pair;
//  · on separation → clear the lock.
// Bats deal melee 2 on contact but ignore the crate bumper (they fly over).
function meleeExchange() {
  const p = G.player, enemies = G.enemies;
  if (!p || !enemies || p.loco === "DEAD") return;
  const carrying = isCarryingCrate();
  for (const e of enemies) {
    if (e.spawn > 0) continue;                   // emerging enemies don't collide (E4)
    const dx = e.x - p.x, dy = e.y - p.y;        // player → enemy
    const dist = Math.hypot(dx, dy);
    if (dist > e.r + p.r) {                       // separated → clear the pair lock
      if (e.contact) { e.contact = false; clearMeleePair(e); }
      continue;
    }
    // Unit direction player→enemy (enemy is pushed this way; player the opposite).
    const nx = dist > 1e-6 ? dx / dist : 1, ny = dist > 1e-6 ? dy / dist : 0;

    if (carrying && e.type !== "bat") {           // crate bumper (§6.4) — no damage
      applyKnockbackToEnemy(e, nx, ny, CFG.ENEMY.knockbackPush);
      continue;                                   // do NOT lock — no exchange happened
    }
    if (!e.contact) {                             // pair unlocked → one exchange
      e.hp -= CFG.PLAYER.meleeDamageToEnemy;      // player deals 2 (ADD mop value)
      const m = CFG.ENEMY[e.type]?.melee;         // MELEE NULL-GUARD (meleeless types deal 0)
      if (m != null) applyDamageToPlayer(m, e.type);
      applyKnockbackToPlayer(-nx, -ny, CFG.PLAYER.knockbackImpulse);   // player away from enemy
      applyKnockbackToEnemy(e, nx, ny, CFG.ENEMY.knockbackImpulse);    // enemy away from player
      e.contact = true;
      meleeSet().add(e);
      if (e.hp <= 0 && !e._cause) e._cause = "player-melee";
    }
  }
}

// Drop e.gems gem pickups at the enemy's position (§6.3) — ALWAYS, regardless of
// killer (gems are position loot, not a score award; Q3 baked-in: friendly-fire
// kills still drop gems).
function dropGems(e) {
  if (!G.pickups) G.pickups = [];
  const n = e.gems || 0;
  for (let k = 0; k < n; k++)
    G.pickups.push({ type: "gem", x: e.x, y: e.y, value: CFG.GEM.energy });
}

// Step 5 (§6.3) — death sweep. Each hp≤0 enemy: drop gems (always), awardKill,
// emit enemy:killed, splice out. A mid-FLASH Wraith removed here is DEFUSED (its
// EXPLODE branch in step 6 never runs) — the R2/E11 invariant.
function deathSweep() {
  const enemies = G.enemies;
  if (!enemies) return;
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    if (e.hp > 0) continue;
    const cause = e._cause || "unknown";
    dropGems(e);
    awardKill(e, cause);
    emit("enemy:killed", { type: e.type, x: e.x, y: e.y, points: e.points, cause });
    if (e.contact) clearMeleePair(e);
    enemies.splice(i, 1);
  }
}

// awardKill seam (§6.3 / E8) — THIN direct impl. player-* causes ("player-bullet",
// "player-melee") award e.points; wraith-aoe / enemy-* / unknown award 0. The full
// chain-of-custody (barrel tags, shrapnel adoption, Nova/Lightning) is SPEC-SCORING,
// which replaces this seam and receives the same `cause` string.
export function awardKill(e, cause) {
  if (typeof cause === "string" && cause.startsWith("player-")) G.score += e.points;
}

// Step 6 (§6) — AI tick over survivors. Emergence gate first (spawn>0 ⇒ decrement
// and skip — the enemy exists but does not act or collide, E4), then knockback
// integration (§6.6), then the per-type move/steer + attack. A synthetic entity
// killed in step 5 is already gone from G.enemies, so its handler never runs here
// (the death-sweep-before-AI invariant, R2).
function enemyAITick(dt) {
  const enemies = G.enemies, player = G.player;
  if (!enemies) return;
  for (const e of enemies) {
    if (e.spawn > 0) { e.spawn -= dt; continue; }   // emergence gate (E4)
    integrateEnemyKnockback(e, dt);
    const ai = aiByType.get(e.type);
    if (ai) ai(e, player, dt);
  }
}

// Step 7 — arced ordnance (Phase 7). G.ebolts is cleared by the loader; no lobs
// exist yet, so this is an intentional no-op hook holding the frame-order slot.
function updateEbolts(_dt) { /* Phase 7: Lobber lobs (arced, timer-resolved). */ }

// Step 7 (§6.4) — enemy-shot → player hit-test. Player-ONLY (enemy shots never
// hit enemies, R3): only owner==="enemy" shots are tested; player-owned shots are
// never touched here. entangle → applyEntangle (0 dmg, no iframe); else damage.
// SEQUENCING ASSUMPTION (main loop, not fixed here): player.js updateShots(dt)
// already advanced enemy shots this frame, so a shot that reached the player
// connects. No enemy shots exist until Phase 4/5 — this runs on an empty set now.
function enemyShotPlayerPass() {
  const shots = G.shots, p = G.player;
  if (!shots || !p) return;
  for (let i = shots.length - 1; i >= 0; i--) {
    const s = shots[i];
    if (s.owner !== "enemy") continue;           // R3: never touch player-owned shots
    const dx = s.x - p.x, dy = s.y - p.y;
    const rr = s.r + p.r;
    if (dx * dx + dy * dy > rr * rr) continue;
    if (s.effect === "entangle") applyEntangle(CFG.ENEMY.spider.web.entangle);  // §6.4
    else applyDamageToPlayer(s.dmg, "enemy-shot");
    shots.splice(i, 1);
  }
}

/* ---- tickEnemies: the 7-step contract (§3.5, E11) ----------------------- */
export function tickEnemies(dt) {
  const player = G.player;
  // 1. spawners emit — Phase 4. Hook left as a no-op; new enemies would start
  //    with spawn>0 (emergence telegraph).
  //    (spawnerTick(dt) — not built)
  // 2. nav scheduler tick (drains consumeDirtyTiles once; repaths A* navigators).
  scheduleRepaths(player, dt);
  // 3. player-shot → enemy damage pass (marks hp; tags deaths).
  playerShotEnemyPass();
  // 4. melee exchange.
  meleeExchange();
  // 5. death sweep (a mid-FLASH Wraith removed here is DEFUSED — R2/E11).
  deathSweep();
  // 6. enemy AI tick over survivors (a surviving Wraith EXPLODEs HERE, Phase 6).
  enemyAITick(dt);
  // 7. ordnance update: arced lobs + the enemy-shot → player hit-test.
  updateEbolts(dt);
  enemyShotPlayerPass();
}

/* ---- Test seams (headless, per-step) ------------------------------------ *
   The spine's individual passes, exposed __-prefixed so a headless test can
   "set fields, run one step, assert" without the side effects of a full tick
   (e.g. exercise the melee exchange without the AI moving the enemy after).
   Test-only; production drives the whole `tickEnemies` order. */
export {
  playerShotEnemyPass as __playerShotEnemyPass,
  meleeExchange as __meleeExchange,
  deathSweep as __deathSweep,
  enemyAITick as __enemyAITick,
  enemyShotPlayerPass as __enemyShotPlayerPass,
};
