/* =========================================================================
   barrels.js — the barrel entity, fire ladder, damage intake, the dual
   detonation-seam fill, the KICK/ROLL physics, and DETONATION + SHRAPNEL
   (SPEC-BARRELS Phase 2 §1 B1/B2/B4/B10 + Phase 3 §1 B3/B5/B6 §4 + Phase 4
   §1 B7/B8/B9 §5). The barrel subsystem is now COMPLETE.

   BUILT: entity decoration, fireStateOf, damageBarrel, the real
   detonateBarrelsInRadius (registered into BOTH enemies.js and abilities.js),
   shotsVsBarrels; PHASE 3 adds kickBarrel + updateBarrels(dt) (the bespoke roll
   integrator — the SECOND sanctioned moveBody exception after phantomMover) and
   the melee-chip seam fill (registerBarrelDamage); PHASE 4 adds detonation
   RESOLUTION (collected + resolved in updateBarrels AFTER the roll/damage pass,
   never mid-iteration), the SHRAPNEL species (updateShrapnel — its own G.shrapnel
   array, B7), detonate-in-hand (B5, via player.js's notifyCarriedBarrelDestroyed),
   chain reactions (§5.3), and the chain-of-custody attribution (B9). Detonation
   is shrapnel-only — NO direct damage/force (B8, §7.2.3).

   ---- R6: ONE-WAY IMPORT FLOW --------------------------------------------
   Imports config/state, world (bodyHitsBlocker/isWall/tileCenter — the roll
   integrator uses all three), level-loader (emit/markNavDirty/registerEntity
   Factory/getEntityFactory), enemies.js (registerBarrelDetonation + the
   registerBarrelDamage seam it fills, sweepDeadEnemies/sweepDeadSpawners),
   abilities.js's registerBarrelDetonation, and player.js's registerBarrelKick +
   applyDamageToPlayer/carriedBarrel/notifyCarriedBarrelDestroyed (the sanctioned
   barrels→player edge — player.js NEVER imports barrels.js).
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
import {
  registerBarrelKick, applyDamageToPlayer, carriedBarrel, notifyCarriedBarrelDestroyed,
} from "./player.js";

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
   through (shotsVsBarrels, the detonation seam, shrapnel/rolling impacts, the
   carried-barrel melee chip). Last damager's cause wins (chain-of-custody tag,
   §9). hp<=0 leaves the barrel structurally in place (no splice, no shrapnel
   HERE) — detonation is COLLECTED and resolved by updateBarrels AFTER its
   driving pass (§5.1, the collect-then-resolve ordering), so a cascade resolves
   over frames and shrapnel a detonation spawns is never walked by the loop that
   triggered it (§9 phase risk). */
export function damageBarrel(barrel, amount, cause) {
  barrel.hp -= amount;
  barrel._cause = cause;
  // hp<=0: marked-for-detonation implicitly (fireStateOf(barrel) === "explode").
  // resolveDetonations() (called from updateBarrels) collects + resolves it.
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
   barrel is bounce-only (in slideBarrel), no damage (OQ-B1). A kicked barrel can
   reach hp<=0 here (damageBarrel); detonation is then COLLECTED + resolved by
   resolveDetonations AFTER this driving pass — never mid-iteration (§5.1). */
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
  resolveDetonations();   // detonate hp<=0 barrels AFTER the roll pass (§5.1, never mid-iteration)
}

/* =========================================================================
   DETONATION + SHRAPNEL (§5, B7/B8/B9) — a barrel at hp<=0 explodes into
   shrapnel (no direct damage/force, B8 — the OPPOSITE of ADD detonate()).
   The chain-of-custody: a barrel carries _cause; on detonation owner derives
   from it; each shrapnel piece inherits owner; a shrapnel-killed barrel adopts
   that owner via _cause, so a player-started cascade scores every kill and an
   enemy-started one scores none (B9). Detonation is COLLECTED and resolved as
   a wave (never mid the loop that drove the damage) so a cascade resolves over
   frames — the shrapnel a detonation spawns is walked by the NEXT updateShrapnel,
   not the one that triggered it (§9 phase risk).
   ========================================================================= */

/* Resolve one detonation wave: collect every hp<=0 barrel (in G.barrels PLUS the
   carried one, which is spliced OUT of G.barrels — B5) and detonate each. A
   linked cascade of >= chainCallout barrels in a single wave emits chain:reaction
   (§5.3 — a per-wave counter, the sanctioned bookkeeping). */
function resolveDetonations() {
  if (!G.barrels) return;
  const doomed = [];
  for (const b of G.barrels) if (b.hp <= 0) doomed.push(b);
  const held = carriedBarrel();
  if (held && held.hp <= 0) doomed.push(held);       // detonate-in-hand (B5) — not in G.barrels
  if (doomed.length === 0) return;
  let owner = "enemy";
  for (const b of doomed) owner = detonateBarrel(b);  // uniform in a linked cascade; last wins
  if (doomed.length >= CFG.BARREL.explosion.chainCallout) {
    emit("chain:reaction", { count: doomed.length, owner });
  }
}

/* Detonate one barrel (§5.1): derive owner from _cause → spawn shrapnel burst →
   emit barrel:exploded (snapshot FX payload for #10) → drop the light emitter →
   splice from G.barrels (or, detonate-in-hand, notify player.js WITHOUT
   re-inserting, B5). Returns the derived owner (for the chain callout). */
function detonateBarrel(b) {
  const owner = (typeof b._cause === "string" && b._cause.startsWith("player-")) ? "player" : "enemy";
  const held = b === carriedBarrel();
  let cx = b.x, cy = b.y;
  if (held) { const p = G.player; cx = p.x; cy = p.y; }   // shrapnel centred on the player (B5)
  spawnShrapnel(cx, cy, owner);
  const ex = CFG.BARREL.explosion;
  emit("barrel:exploded", {
    x: cx, y: cy, owner,
    hitStopFrames: ex.hitStopFrames, shakeDur: ex.shakeDur,
    shakeFullTiles: ex.shakeFullTiles, shakeZeroTiles: ex.shakeZeroTiles,
  });
  dropBarrelLight(b);   // the persistent emitter goes with the destroyed barrel (mirrors removeLight)
  if (held) {
    // Detonate-in-hand: post-hit i-frames cap the self-damage (§2.1) when the
    // centred shrapnel strikes the player next updateShrapnel. Clear carry +
    // loco via the sink — the ONE release path that skips the re-insert (B5).
    notifyCarriedBarrelDestroyed();
  } else {
    markNavDirty({ tx: (b.x / CFG.TILE) | 0, ty: (b.y / CFG.TILE) | 0 });   // was a blocker (§5.1)
    const idx = G.barrels.indexOf(b);
    if (idx >= 0) G.barrels.splice(idx, 1);
  }
  return owner;
}

/* Spawn CFG.BARREL.shrapnel.count pieces radially (evenly spaced ± jitter) from
   (cx,cy) into G.shrapnel, each owner-tagged (§2.4). No dedicated shrapnel-radius
   dial in §2.3 — reuse CFG.SHOT.r (the small-projectile radius) rather than
   invent a config value (flag if #7/tuning wants its own). */
function spawnShrapnel(cx, cy, owner) {
  const shr = CFG.BARREL.shrapnel;
  if (!G.shrapnel) G.shrapnel = [];
  const step = (Math.PI * 2) / shr.count;
  for (let i = 0; i < shr.count; i++) {
    const ang = i * step + (Math.random() * 2 - 1) * shr.jitter;   // radial ± jitter
    G.shrapnel.push({
      x: cx, y: cy,
      vx: Math.cos(ang) * shr.speed, vy: Math.sin(ang) * shr.speed,
      r: CFG.SHOT.r, dmg: shr.dmg, health: shr.health, life: 0, owner,
    });
  }
}

// Drop a detonated barrel's registered light emitter (mirrors enemies.js
// removeLight — the persistent {source:barrel} entry must not outlive the barrel,
// or #7 would read hp<=0 → fireState "explode" → an undefined light radius).
function dropBarrelLight(b) {
  if (!G.lights || G.lights.length === 0) return;
  const i = G.lights.findIndex((l) => l.source === b);
  if (i >= 0) G.lights.splice(i, 1);
}

/* =========================================================================
   SHRAPNEL (§5.2, B7) — its own species in G.shrapnel (NOT the Shot shape).
   A piece carries health (2): it BOUNCES FREE off walls + crates (per-axis
   reflect, no health cost) and PUSHES crates (cratePush, §13.16 crates take no
   damage — no hp field), but DAMAGE-EXCHANGES (−1 health per damaging hit) with
   enemies / the player / other barrels (→ chain) / spawners. Dies at health<=0
   or life>=lifespan. updateShrapnel never SPAWNS shrapnel (detonation does, in
   updateBarrels), so a piece it triggers is not walked by this same loop.
   ========================================================================= */

// A shrapnel piece hits a wall if its centre tile is a wall (matches the roll
// integrator's center-point isWall test — shrapnel is small).
function shrapnelHitsWall(x, y) {
  return isWall((x / CFG.TILE) | 0, (y / CFG.TILE) | 0);
}

// First crate whose one-tile footprint overlaps (x,y,r), or null — crates use the
// half-tile radius world.bodyHitsBlocker assumes (they carry no r field).
function crateAt(x, y, r) {
  if (!G.crates) return null;
  const rr = r + CFG.TILE / 2;
  for (const c of G.crates) {
    const dx = x - c.x, dy = y - c.y;
    if (dx * dx + dy * dy < rr * rr) return c;
  }
  return null;
}

// One shrapnel step: per-axis reflect off walls + crates (FREE — full retention,
// no health cost); a crate contact also gets pushed cratePush along the piece's
// incoming direction (the only non-carry way a crate moves, §13.16).
function slideShrapnel(s, dt) {
  const vx0 = s.vx, vy0 = s.vy;
  let nx = s.x + s.vx * dt, ny = s.y + s.vy * dt;
  let hitCrate = null;
  if (shrapnelHitsWall(nx, s.y)) { s.vx = -s.vx; nx = s.x; }
  else { const c = crateAt(nx, s.y, s.r); if (c) { hitCrate = c; s.vx = -s.vx; nx = s.x; } }
  if (shrapnelHitsWall(s.x, ny)) { s.vy = -s.vy; ny = s.y; }
  else { const c = crateAt(s.x, ny, s.r); if (c) { hitCrate = c; s.vy = -s.vy; ny = s.y; } }
  s.x = nx; s.y = ny;
  if (hitCrate) {
    const m = Math.hypot(vx0, vy0) || 1;
    const push = CFG.BARREL.shrapnel.cratePush;
    hitCrate.x += (vx0 / m) * push;
    hitCrate.y += (vy0 / m) * push;   // 0.5 t push, no hp change (crates are indestructible)
  }
}

/* updateShrapnel(dt) — integrate + age every piece, resolve its damage-exchange,
   destroy the expired/spent. After the pass, ONE sweepDeadEnemies() +
   sweepDeadSpawners() (never per-hit). A barrel a piece damages adopts the
   piece's owner via damageBarrel (chain propagation, §5.3) but detonates only on
   the NEXT updateBarrels (this pass never spawns/detonates). */
export function updateShrapnel(dt) {
  if (!G.shrapnel) return;
  const shr = CFG.BARREL.shrapnel;
  let enemyHit = false, spawnerHit = false;
  for (let i = G.shrapnel.length - 1; i >= 0; i--) {
    const s = G.shrapnel[i];
    slideShrapnel(s, dt);
    s.life += dt;
    const tag = s.owner === "player" ? "player-shrapnel" : "enemy-shrapnel";
    // Damage-exchange: each overlapping target is a damaging hit (−1 health);
    // stop once the piece is spent. Order enemies → player → barrels → spawners.
    if (s.health > 0 && G.enemies) {
      for (const e of G.enemies) {
        if (e.spawn > 0) continue;                        // emerging enemies don't collide (E4)
        const dx = s.x - e.x, dy = s.y - e.y, rr = s.r + e.r;
        if (dx * dx + dy * dy < rr * rr) {
          e.hp -= s.dmg;
          if (e.hp <= 0 && !e._cause) e._cause = tag;     // attribution (§9)
          enemyHit = true;
          if (--s.health <= 0) break;
        }
      }
    }
    if (s.health > 0) {
      const p = G.player;
      if (p && p.loco !== "DEAD") {
        const dx = s.x - p.x, dy = s.y - p.y, rr = s.r + p.r;
        if (dx * dx + dy * dy < rr * rr) {
          applyDamageToPlayer(s.dmg, s.owner + "-shrapnel");   // self-gates on i-frames (§2.1)
          s.health -= 1;
        }
      }
    }
    if (s.health > 0 && G.barrels) {
      for (const b of G.barrels) {
        const dx = s.x - b.x, dy = s.y - b.y, rr = s.r + b.r;
        if (dx * dx + dy * dy < rr * rr) {
          damageBarrel(b, s.dmg, tag);                    // barrel ADOPTS owner via _cause (chain)
          if (--s.health <= 0) break;
        }
      }
    }
    if (s.health > 0 && G.spawners) {
      for (const sp of G.spawners) {
        const dx = s.x - sp.x, dy = s.y - sp.y, rr = s.r + sp.r;
        if (dx * dx + dy * dy < rr * rr) {
          sp.hp -= s.dmg;
          if (sp.hp <= 0 && !sp._cause) sp._cause = tag;  // attribution (§9)
          spawnerHit = true;
          if (--s.health <= 0) break;
        }
      }
    }
    if (s.health <= 0 || s.life >= shr.lifespan) G.shrapnel.splice(i, 1);
  }
  if (enemyHit) sweepDeadEnemies();
  if (spawnerHit) sweepDeadSpawners();
}

/* ---- Lazy-init / reset transient state -------------------------------- */
export function initBarrels() {
  G.shrapnel ||= [];
}
