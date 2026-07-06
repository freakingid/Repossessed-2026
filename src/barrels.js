/* =========================================================================
   barrels.js — the barrel entity, fire ladder, damage intake, the dual
   detonation-seam fill, and the KICK/ROLL physics
   (SPEC-BARRELS Phase 2 §1 B1/B2/B4/B10 + Phase 3 §1 B3/B5/B6, §4).

   BUILT: entity decoration, fireStateOf, damageBarrel, the real
   detonateBarrelsInRadius (registered into BOTH enemies.js and abilities.js),
   shotsVsBarrels; PHASE 3 adds kickBarrel + updateBarrels(dt) (the bespoke roll
   integrator — the SECOND sanctioned moveBody exception after phantomMover) and
   the melee-chip seam fill (registerBarrelDamage). Still owed: detonation
   RESOLUTION + shrapnel + chain reactions (Phase 4) — damageBarrel still leaves
   a Phase-4 TODO at hp<=0 (a kicked/carried barrel CAN reach hp<=0 here but must
   NOT yet spawn shrapnel).

   ---- R6: ONE-WAY IMPORT FLOW --------------------------------------------
   Imports config/state, world (bodyHitsBlocker/isWall/tileCenter — the roll
   integrator uses all three), level-loader (emit/markNavDirty/registerEntity
   Factory/getEntityFactory), enemies.js (registerBarrelDetonation + the new
   registerBarrelDamage seam it fills, sweepDeadEnemies/sweepDeadSpawners),
   abilities.js's registerBarrelDetonation, and player.js's registerBarrelKick
   (barrels.js registers kickBarrel there — player.js NEVER imports barrels.js).
   Nothing imports barrels.js back (verified: grep for "barrels.js" import
   across src/ finds only this file's own imports).
   ========================================================================= */
import { CFG } from "./config.js";
import { G } from "./state.js";
import { bodyHitsBlocker, isWall, tileCenter } from "./world.js";
import {
  emit, markNavDirty, registerEntityFactory, getEntityFactory,
} from "./level-loader.js";
import {
  registerBarrelDetonation as regEnemies, registerBarrelDamage as regBarrelDamage,
  sweepDeadEnemies, sweepDeadSpawners,
} from "./enemies.js";
import { registerBarrelDetonation as regAbilities } from "./abilities.js";
import { registerBarrelKick } from "./player.js";

/* ---- Entity decoration (B2) --------------------------------------------- *
   Decorates the loader's existing barrel placeholder (getEntityFactory
   ("barrel") -> {type,x,y,tc,blocks:true}), same pattern #4 used for the
   spawner (enemies.js makeSpawner): call through, then augment with the
   combat/roll fields. Re-registered via registerEntityFactory so a placed
   barrel carries hp/r/vx/vy/rolling/_cause from load. */
const loaderBarrelFactory = getEntityFactory("barrel");
function makeBarrel(p) {
  const e = loaderBarrelFactory(p);
  const cfg = CFG.BARREL;
  e.hp = cfg.hp;
  e.r = cfg.r;
  e.vx = 0;
  e.vy = 0;
  e.rolling = false;
  e._cause = null;
  // Light emitter seam (§3.3, the Fire-Wraith glow precedent) — a live entity
  // reference so #7 reads the current position + fire-derived radius every
  // frame with no per-frame re-sync here.
  if (!G.lights) G.lights = [];
  G.lights.push({ source: e });
  return e;
}
registerEntityFactory("barrel", makeBarrel);

/* ---- Fire ladder (§2.5, §3.2) — DERIVED from hp, never stored ----------- */
export function fireStateOf(barrel) {
  switch (barrel.hp) {
    case 4: return "intact";
    case 3: return "smolder";
    case 2: return "burning";
    case 1: return "raging";
    default: return "explode"; // hp <= 0
  }
}

export function lightRadiusOf(barrel) {
  const state = fireStateOf(barrel);
  return state === "intact" ? 0 : CFG.BARREL.light[state] * CFG.TILE;
}

/* ---- Damage intake (§3.1) — the single sink every damage source funnels
   through (shotsVsBarrels, the detonation seam, later: shrapnel/rolling
   impacts/carried-barrel melee). Last damager's cause wins (chain-of-custody
   tag, §9). hp<=0 marks for detonation — Phase 4 resolves it; this phase
   intentionally does nothing more. */
export function damageBarrel(barrel, amount, cause) {
  barrel.hp -= amount;
  barrel._cause = cause;
  if (barrel.hp <= 0) {
    // Phase 4: resolve detonation (owner derive, shrapnel spawn, emit
    // "barrel:exploded", markNavDirty, drop light emitter, splice from
    // G.barrels). Do NOT implement shrapnel/splicing here (SPEC-BARRELS §5).
  }
}

/* ---- The detonation seam (§6, B10) — registered into BOTH enemies.js and
   abilities.js at module load. All pixels. Applies `damage` to every barrel
   within `radius + b.r` of (x,y). */
export function detonateBarrelsInRadius(x, y, radius, cause, damage = CFG.BARREL.LETHAL) {
  for (const b of G.barrels) {
    const dx = b.x - x, dy = b.y - y;
    const rr = radius + b.r;
    if (dx * dx + dy * dy <= rr * rr) damageBarrel(b, damage, cause);
  }
}
regEnemies(detonateBarrelsInRadius);
regAbilities(detonateBarrelsInRadius);
// The carried-barrel melee chip (B5): #4's meleeExchange reaches damageBarrel
// through this seam (the carried barrel is spliced out of G.barrels, so the
// radius seam above can't find it).
regBarrelDamage(damageBarrel);

/* ---- Shot -> barrel (§B4) — CONSUME, not ricochet. Self-contained pass,
   run after the enemy/player-shot damage passes (a bullet that already
   struck an enemy is gone; survivors then test barrels). Overlap removes the
   shot (no bounce, §7.2.1) and damages the barrel, tagging _cause from the
   shot's owner. */
export function shotsVsBarrels() {
  for (let i = G.shots.length - 1; i >= 0; i--) {
    const s = G.shots[i];
    for (const b of G.barrels) {
      const dx = s.x - b.x, dy = s.y - b.y;
      const rr = s.r + b.r;
      if (dx * dx + dy * dy < rr * rr) {
        const cause = s.owner === "player" ? "player-bullet" : "enemy-shot";
        damageBarrel(b, s.dmg, cause);
        G.shots.splice(i, 1);
        break;
      }
    }
  }
}

/* =========================================================================
   KICK + ROLL PHYSICS (§4.2, B3) — the SECOND sanctioned moveBody exception
   (after enemies-ai.js's phantomMover). A rolling barrel REFLECTS velocity off
   solids; world.moveBody only slides-and-stops (never reflects), so the roll
   integrator is BESPOKE — ported from ADD dustbin.js slideStep (exponential
   friction + per-axis reflect + corner reflect-both/hold). Do NOT route the
   roll through moveBody.
   ========================================================================= */

/* Kick: re-insert the (already-positioned by player.js) barrel into G.barrels
   rolling along the aim unit at kick.speed. Registered into player.js as the
   moving-release sink — player.js sets the drop position + clears carry, this
   sets velocity + re-inserts (the moving half of the splice-out symmetry). */
export function kickBarrel(barrel, aimX, aimY) {
  const k = CFG.BARREL.kick;
  const m = Math.hypot(aimX, aimY) || 1;
  barrel.vx = (aimX / m) * k.speed;
  barrel.vy = (aimY / m) * k.speed;
  barrel.rolling = true;
  barrel.blocks = true;
  if (!G.barrels) G.barrels = [];
  if (G.barrels.indexOf(barrel) < 0) G.barrels.push(barrel);   // defensive: no double-insert
}
registerBarrelKick(kickBarrel);

// Roll blocker set (§4.2, B3): walls (isWall — tile test at the prospective
// centre, matching ADD) + crates + spawners + OTHER barrels (bodyHitsBlocker,
// filtered to exclude self). Enemies are NOT bounce-blockers — a fast roll
// passes THROUGH them (rolling impact, handled in updateBarrels).
function barrelHitsSolid(barrel, x, y) {
  if (isWall((x / CFG.TILE) | 0, (y / CFG.TILE) | 0)) return true;
  return bodyHitsBlocker(x, y, barrel.r, (e) => e !== barrel);
}

// One roll step (ADD slideStep ported): per-axis reflect off a solid, then a
// corner reflect-both/hold, then exponential friction.
function slideBarrel(b, dt) {
  const k = CFG.BARREL.kick;
  let nx = b.x + b.vx * dt, ny = b.y + b.vy * dt;
  if (barrelHitsSolid(b, nx, b.y)) { b.vx = -b.vx * k.bounce; nx = b.x + b.vx * dt; }   // X axis
  if (barrelHitsSolid(b, b.x, ny)) { b.vy = -b.vy * k.bounce; ny = b.y + b.vy * dt; }   // Y axis
  // Corner: still solid after both axis reflects -> reflect both, hold position.
  if (barrelHitsSolid(b, nx, ny)) { b.vx = -b.vx * k.bounce; b.vy = -b.vy * k.bounce; nx = b.x; ny = b.y; }
  b.x = nx; b.y = ny;
  const decay = Math.exp(-k.friction * dt);
  b.vx *= decay; b.vy *= decay;
}

// Settle a barrel that has slowed below stopSpeed: static, tile-aligned, and a
// blocker again (markNavDirty — occupancy rebuilds lazily off G.barrels).
function settleBarrel(b) {
  b.rolling = false; b.vx = 0; b.vy = 0;
  const tx = (b.x / CFG.TILE) | 0, ty = (b.y / CFG.TILE) | 0;
  const c = tileCenter(tx, ty);
  b.x = c.x; b.y = c.y; b.tc = { x: c.x, y: c.y };
  markNavDirty({ tx, ty });
}

/* updateBarrels(dt) — integrate every rolling barrel; settle below stopSpeed; a
   barrel rolling >= impactSpeed passes THROUGH an overlapped enemy (enemy
   -impactDmg; the barrel -impactSelfHp via damageBarrel "player-kick" and speed
   ×(1-impactSlow)). Enemy deaths route through ONE sweepDeadEnemies after the
   whole pass (never per-hit). The player takes NO rolling damage; barrel-vs-
   barrel is bounce-only (in slideBarrel), no damage (OQ-B1). A kicked barrel
   can reach hp<=0 here (damageBarrel), but detonation RESOLUTION is a Phase-4
   TODO — no shrapnel/splice yet. */
export function updateBarrels(dt) {
  if (!G.barrels) return;
  const k = CFG.BARREL.kick;
  let anyEnemyHit = false;
  for (const b of G.barrels) {
    if (!b.rolling) continue;
    slideBarrel(b, dt);
    const speed = Math.hypot(b.vx, b.vy);
    if (speed < k.stopSpeed) { settleBarrel(b); continue; }
    if (speed >= k.impactSpeed && G.enemies) {
      for (const e of G.enemies) {
        if (e.spawn > 0) continue;                    // emerging enemies don't collide (E4)
        const dx = e.x - b.x, dy = e.y - b.y, rr = e.r + b.r;
        if (dx * dx + dy * dy < rr * rr) {
          e.hp -= k.impactDmg;
          if (e.hp <= 0 && !e._cause) e._cause = "player-kick";
          anyEnemyHit = true;
          damageBarrel(b, k.impactSelfHp, "player-kick");   // barrel loses HP + tags cause
          b.vx *= (1 - k.impactSlow); b.vy *= (1 - k.impactSlow);
        }
      }
    }
  }
  if (anyEnemyHit) sweepDeadEnemies();
}

/* ---- Lazy-init / reset transient state -------------------------------- */
export function initBarrels() {
  G.shrapnel ||= [];
}
