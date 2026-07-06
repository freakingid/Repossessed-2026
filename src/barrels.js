/* =========================================================================
   barrels.js — the barrel entity, fire ladder, damage intake, and the dual
   detonation-seam fill (SPEC-BARRELS Phase 2, §1 B1/B2/B4/B10, §2, §3, §6).

   THIS PHASE ONLY: entity decoration, fireStateOf, damageBarrel, the real
   detonateBarrelsInRadius (registered into BOTH enemies.js and abilities.js),
   and shotsVsBarrels. NO roll/kick physics, NO detonation resolution/shrapnel
   yet — damageBarrel leaves a Phase-4 TODO at hp<=0 (§5 is a later phase).

   ---- R6: ONE-WAY IMPORT FLOW --------------------------------------------
   Imports config/state, world (bodyHitsBlocker/isWall/tileCenter — mechanism
   only, unused directly this phase but pinned per the spec's import list),
   level-loader (emit/markNavDirty/registerEntityFactory/getEntityFactory),
   and BOTH enemies.js and abilities.js's registerBarrelDetonation (aliased —
   this is the one dual-registration seam fill the whole subsystem hinges on).
   Nothing imports barrels.js back (verified: grep for "barrels.js" import
   across src/ finds only this file's own imports).
   ========================================================================= */
import { CFG } from "./config.js";
import { G } from "./state.js";
import { bodyHitsBlocker, isWall, tileCenter } from "./world.js";
import {
  emit, markNavDirty, registerEntityFactory, getEntityFactory,
} from "./level-loader.js";
import { registerBarrelDetonation as regEnemies, sweepDeadEnemies, sweepDeadSpawners } from "./enemies.js";
import { registerBarrelDetonation as regAbilities } from "./abilities.js";

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

/* ---- Lazy-init / reset transient state -------------------------------- */
export function initBarrels() {
  G.shrapnel ||= [];
}
