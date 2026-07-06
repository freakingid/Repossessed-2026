/* =========================================================================
   enemies-ai.js — the NAV CONSUMER LAYER (SPEC-ENEMIES §3, E2/E3, R1, R6).

   nav.js gives paths; this layer SCHEDULES, BUDGETS, FOLLOWS, and DEGRADES.
   It sits between the pure nav.js service and the four A* enemy classes
   (Skeleton Shooter, Zombie, Fire Wraith, Reaper). No roster, no combat here.

   Parameterized: a navigator supplies its own `mask` and `mover`, so the layer
   stays agnostic to GROUND vs the Reaper's PHANTOM mover (§4). `mover(e, dx, dy)`
   is expected to displace the entity with the class-appropriate blocker filter
   (for GROUND navigators, `world.moveBody` with a crates+barrels+spawners
   filter). This layer computes the displacement magnitude from `e.speed`
   (effective px/s — ramp application is the caller's job, E10) and hands the
   direction × step to the mover.

   ---- R1: SINGLE-CONSUMER OWNERSHIP OF consumeDirtyTiles() ----------------
   THIS LAYER IS THE SOLE CONSUMER OF nav.consumeDirtyTiles(). It drains the
   dirty-tile Set EXACTLY ONCE per scheduler tick, gated on a getNavVersion()
   change (see applyDirtyGate). consumeDirtyTiles() CLEARS ON READ; if any other
   system (a renderer, a debug overlay) also drains it, dirtied tiles are lost
   and crate barricades stop re-routing intermittently. Do not call
   consumeDirtyTiles() anywhere else.

   ---- R6: ONE-WAY IMPORT FLOW --------------------------------------------
   enemies-ai.js imports config/state/world/nav (+ projectiles `makeShot` later).
   It must NEVER be imported by nav/player/projectiles. The flow is
   enemies-ai → {nav, world, ...}, never back.
   ========================================================================= */
import { CFG } from "./config.js";
import { moveBody } from "./world.js";
import { findPath, consumeDirtyTiles, getNavVersion } from "./nav.js";

/* ---- Navigator registry ------------------------------------------------- *
   navList is the ordered registry the round-robin cursor walks; recByEntity
   maps an entity to its record for O(1) steering lookup. A record carries the
   entity, its nav mask (GROUND/PHANTOM), and its mover. */
const navList = [];             // { e, mask, mover }
const recByEntity = new Map();  // e -> record
let cursor = 0;                 // round-robin start index (§3.2)

// Version watermark for the dirty gate. Seeded to the live version so the first
// scheduler tick only drains a genuinely NEW dirty event, not startup noise.
let lastNavVersion = getNavVersion();

// Instrumentation for the headless budget / single-consumer tests: repath()
// calls findPath() exactly once, so this counts findPath invocations.
let repathCount = 0;
export function __getRepathCount() { return repathCount; }
export function __resetRepathCount() { repathCount = 0; }

function packTile(tx, ty) { return ty * CFG.COLS + tx; }

// The per-navigator nav sub-block (§2). Fresh navigators are immediately
// eligible (repathTimer 0, goalTile null ⇒ "goal changed", path null ⇒
// "no live path").
function initNav(e) {
  const nav = e.nav || (e.nav = {});
  nav.path = null;         // Array<{tx,ty,x,y}> | [] | null — last findPath result
  nav.wpIndex = 0;         // index of the current target waypoint
  nav.wpTimer = 0;         // s until the stuck-timeout fires
  nav.repathTimer = 0;     // s until eligible to repath (>= repathMinInterval)
  nav.goalTile = null;     // {tx,ty} the current path was cut to
  nav.pathTiles = new Set(); // packed tx,ty of the path — the dirty-intersection set (E3)
  nav.dirtyHit = false;    // sticky force-eligible flag set by the dirty gate
  return nav;
}

export function addNavigator(e, mask, mover) {
  if (recByEntity.has(e)) return;
  initNav(e);
  const rec = { e, mask, mover };
  navList.push(rec);
  recByEntity.set(e, rec);
}

export function removeNavigator(e) {
  const rec = recByEntity.get(e);
  if (!rec) return;
  const i = navList.indexOf(rec);
  if (i >= 0) {
    navList.splice(i, 1);
    if (i < cursor) cursor--;                  // keep the cursor on the same logical slot
  }
  recByEntity.delete(e);
  cursor = navList.length ? ((cursor % navList.length) + navList.length) % navList.length : 0;
}

// Test/lifecycle helper — drop all navigators (e.g. on level load).
export function clearNavigators() {
  navList.length = 0;
  recByEntity.clear();
  cursor = 0;
}

// Rebuild a navigator's pathTiles set from its current path. Exposed (__-prefix)
// so headless tests can synthesise a path and get a matching dirty-intersection
// set without a live findPath; repath() calls it internally in production.
function rebuildPathTiles(nav) {
  nav.pathTiles = new Set();
  if (Array.isArray(nav.path)) {
    for (const wp of nav.path) nav.pathTiles.add(packTile(wp.tx, wp.ty));
  }
}
export function __rebuildPathTiles(e) { rebuildPathTiles(e.nav); }

/* ---- Repath (§3.1) ------------------------------------------------------ */
function repath(rec, player) {
  const e = rec.e, nav = e.nav;
  nav.path = findPath(e.x, e.y, player.x, player.y, rec.mask);
  repathCount++;
  nav.wpIndex = 0;
  nav.wpTimer = CFG.ENEMY.wpTimeout;
  nav.goalTile = { tx: (player.x / CFG.TILE) | 0, ty: (player.y / CFG.TILE) | 0 };
  nav.repathTimer = CFG.ENEMY.repathMinInterval;
  nav.dirtyHit = false;
  rebuildPathTiles(nav);
}

function goalTileChanged(nav, player) {
  const gt = nav.goalTile;
  if (!gt) return true;
  return gt.tx !== ((player.x / CFG.TILE) | 0) || gt.ty !== ((player.y / CFG.TILE) | 0);
}

// "No live path": null (unreachable), [] (already on goal tile), or a finished
// path (wpIndex ran off the end).
function hasNoLivePath(nav) {
  return !Array.isArray(nav.path) || nav.path.length === 0 || nav.wpIndex >= nav.path.length;
}

// Eligible to repath (§3.1): the per-navigator floor has expired AND at least
// one trigger holds — the goal tile moved, a dirtied tile lies on the path, or
// there is no live path to follow.
function isEligible(rec, player) {
  const nav = rec.e.nav;
  if (nav.repathTimer > 0) return false;
  return goalTileChanged(nav, player) || nav.dirtyHit || hasNoLivePath(nav);
}

/* ---- The dirty gate (§3.5 step 2, E3, R1) ------------------------------- *
   ONCE per scheduler tick: if the nav version moved, drain consumeDirtyTiles()
   EXACTLY ONCE and intersect the dirtied tiles against every navigator's
   pathTiles. A navigator whose path crosses a dirtied tile is force-eligible
   (nav.dirtyHit) — sticky until it actually repaths, so an eligible-but-
   unserviced navigator (budget-starved) keeps the signal for its next slot
   even though the dirty Set has already been drained. */
function applyDirtyGate() {
  const v = getNavVersion();
  if (v === lastNavVersion) return;     // no change since last tick — do NOT drain
  lastNavVersion = v;
  const dirty = consumeDirtyTiles();    // R1: THE SOLE DRAIN — clears on read
  if (dirty.length === 0) return;
  for (const rec of navList) {
    const nav = rec.e.nav;
    if (!nav.pathTiles || nav.pathTiles.size === 0) continue;
    for (const t of dirty) {
      if (nav.pathTiles.has(packTile(t.tx, t.ty))) { nav.dirtyHit = true; break; }
    }
  }
}

/* ---- Scheduler: dirty gate + round-robin repath budget (§3.2) ----------- *
   Call ONCE per frame (SPEC-ENEMIES §3.5 step 2). At most
   CFG.ENEMY.repathBudgetPerFrame navigators actually call findPath; the cursor
   walks from where it left off so all eligible navigators are serviced within
   ceil(N/budget) frames. An eligible-but-unserviced navigator keeps its existing
   path this frame and is first in line next frame (steering never stalls). */
export function scheduleRepaths(player, dt) {
  for (const rec of navList) rec.e.nav.repathTimer -= dt;

  applyDirtyGate();                     // R1: exactly once per tick

  const n = navList.length;
  if (n === 0) return;
  const budget = CFG.ENEMY.repathBudgetPerFrame;
  let serviced = 0, lastIdx = -1;
  for (let i = 0; i < n && serviced < budget; i++) {
    const idx = (cursor + i) % n;
    const rec = navList[idx];
    if (isEligible(rec, player)) {
      repath(rec, player);
      serviced++;
      lastIdx = idx;
    }
  }
  if (lastIdx >= 0) cursor = (lastIdx + 1) % n;
}

/* ---- Steering + direct-steer fallback (§3.3, §3.4) ---------------------- */
// Aim at (tx,ty) and move via the navigator's mover. Sets face toward the
// target (§3.3). Displacement = unit direction × e.speed × dt (effective px/s).
function stepToward(e, tx, ty, mover, dt) {
  const dx = tx - e.x, dy = ty - e.y;
  const d = Math.hypot(dx, dy);
  if (d < 1e-6) return;
  e.face = Math.atan2(dy, dx);
  const step = (e.speed || 0) * dt;
  mover(e, (dx / d) * step, (dy / d) * step);
}

// Drive one A* navigator for this frame. Fallbacks first (§3.4): a null path
// (goal blocked/unreachable — a DELIBERATE nav.js fallback, not a bug) and an
// empty path (goal is the current tile) both degrade to steering straight at the
// player's pixel position. Otherwise follow waypoints (§3.3).
export function steerNavigator(e, player, dt) {
  const rec = recByEntity.get(e);
  if (!rec) return;
  const nav = e.nav, mover = rec.mover;

  // §3.4 — direct-steer fallbacks. null: goal unreachable ⇒ Ghost-grade steer,
  // retry on the normal cadence. []: already on the goal tile ⇒ sub-tile approach.
  if (nav.path === null || nav.path.length === 0) {
    stepToward(e, player.x, player.y, mover, dt);
    return;
  }

  // §3.3 — waypoint follow toward path[wpIndex].
  if (nav.wpIndex >= nav.path.length) return;   // exhausted ⇒ repath next eligible slot
  nav.wpTimer -= dt;
  const wp = nav.path[nav.wpIndex];
  const dx = wp.x - e.x, dy = wp.y - e.y;
  const dist = Math.hypot(dx, dy);

  // Advance on arrival OR on the anti-wedge stuck-timeout (§3.3).
  if (dist <= CFG.ENEMY.arriveDist || nav.wpTimer <= 0) {
    nav.wpIndex++;
    nav.wpTimer = CFG.ENEMY.wpTimeout;
    if (nav.wpIndex >= nav.path.length) {       // reached the final waypoint
      e.face = Math.atan2(dy, dx);
      return;                                    // path exhausted → repath next slot
    }
  }
  const tgt = nav.path[nav.wpIndex];
  stepToward(e, tgt.x, tgt.y, mover, dt);
}

// GROUND blocker filter (§4): crates + barrels + spawners all block. Exposed so
// enemies.js can bind a GROUND mover as `(e,dx,dy)=>moveBody(e,dx,dy,groundBlockerFilter)`.
export function groundBlockerFilter(_entity) { return true; }

// Convenience GROUND mover matching the §4 table (walls + all movables + spawners).
export function groundMover(e, dx, dy) { moveBody(e, dx, dy, groundBlockerFilter); }

/* ---- Ghost: direct steer, NO avoidance (§6.1.1) ------------------------- *
   The minimal roster member — steer straight at the player and moveBody with the
   GROUND filter. moveBody's per-axis slide is the ONLY thing keeping it moving
   along a wall; there is no corner-probe or repath, so it wedges in concave
   pockets by design (GDD §6.1.1). No FSM, no nav registry (never calls findPath).
   e.speed is EFFECTIVE px/s (ramp baked in at spawn by enemies.js, E10) — this
   never re-applies G.ramp.enemySpeedMult (matches stepToward's convention). */
export function updateGhost(e, player, dt) {
  const dx = player.x - e.x, dy = player.y - e.y;
  const d = Math.hypot(dx, dy);
  if (d < 1e-6) return;
  e.face = Math.atan2(dy, dx);
  const step = (e.speed || 0) * dt;
  moveBody(e, (dx / d) * step, (dy / d) * step, groundBlockerFilter);
}
