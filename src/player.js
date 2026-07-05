/* =========================================================================
   player.js — player entity: locomotion, two-source collision, status
   overlays, world hooks (plate press / key spend), and the damage/heal/
   knockback sinks. (SPEC-PLAYER §2, §4, §5, §6, §10.)

   THIS PHASE (5) builds the load-bearing FRAME-UPDATE ORDERING SKELETON plus
   NORMAL locomotion, overlays, and the entry-point sinks. Carry (pickup/toss/
   vault ENTRY — Phase 6) and fire/volley + shot motion (Phase 7) are wired as
   NAMED STUB HOOKS in their correct ordering slots; they are filled later.

   PURE-FUNCTION BOUNDARY (§11): updatePlayer takes the input snapshot as an
   ARGUMENT — it never reaches into input's device glue or any canvas. Tests
   feed synthetic snapshots. The production per-frame entry `tickPlayer(dt)`
   pulls the live snapshot from input.js and delegates to updatePlayer.

   IMPORT DISCIPLINE (§11): imports config/state/world/level-loader/input ONLY.
   It must NOT import abilities/enemies/projectiles — those reach INTO player
   via register-callbacks (abilities registry) or call player's sinks directly
   (enemies/#4 own the melee loop). See STATUS.md architecture decisions.
   ========================================================================= */
import { CFG } from "./config.js";
import { G } from "./state.js";
import { moveBody, bodyHitsWall, isWall, map as worldMap } from "./world.js";
import { setPlatePressedAt, openLockedDoor, emit } from "./level-loader.js";
import { getSnapshot } from "./input.js";

/* ---- Ability seam (§10, register-callbacks) ------------------------------
   input.nova/input.lightning are edge-triggered here and routed to a
   registered handler. player.js NEVER imports abilities.js; #5 registers its
   fn. Default no-op. Abilities are locked while STUNNED (§5.2). */
const abilityHandlers = { nova: () => {}, lightning: () => {} };
export function registerAbility(name, fn) {
  abilityHandlers[name] = typeof fn === "function" ? fn : () => {};
}

// Edge-detect state for the ability triggers (reset by initPlayer).
let prevNova = false;
let prevLightning = false;

/* ---- initPlayer (§2 data shape) ------------------------------------------
   Augments the loader-set G.player {x,y,tx,ty} with the live per-frame fields.
   Called post-load by the game loop; tests call it directly (after setting a
   minimal G.player). Persistent run-state (hp/keys/powerups/…) lives on G and
   is owned by the loader / newGame — never (re)set here. */
export function initPlayer() {
  if (!G.player) G.player = { x: 0, y: 0, tx: 0, ty: 0 };
  const p = G.player;
  p.r = CFG.PLAYER.r;
  p.angle = 0;
  p.vx = 0; p.vy = 0;            // reserved (0 in normal move)
  p.kvx = 0; p.kvy = 0;          // knockback velocity (decays; ADD pattern)
  p.loco = "NORMAL";
  p.carry = null;                // null | { type:"crate", entity }  (barrels deferred)
  p.iframe = 0;                  // post-hit invuln seconds
  p.vault = null;                // null | { t, dur, from:{x,y}, to:{x,y} }
  p.entangle = 0;                // seconds remaining (0 = not)
  p.entangleAngle = null;        // last input dir for the ≥60° shave check
  p.stun = 0;                    // seconds remaining
  p.stunVec = { x: 0, y: 0 };    // current random walk unit vector
  p.stunReroll = 0;              // countdown to next reroll (0 ⇒ roll on first stunned tick)
  p.meleeState = null;           // reserved for #4's pair-lockout wiring (§6.3)
  p.cooldown = 0;                // seconds until next volley (Phase 7)
  p._platesPressed = new Set();  // "tx,ty" of plate tiles currently held by the body
  prevNova = false;
  prevLightning = false;
}

/* =========================================================================
   FRAME UPDATE — the load-bearing ordering (§11). Getting stun-drop AFTER
   fire, or fire BEFORE the carry check, is the bug class this ordering
   prevents. VAULTING short-circuits move+carry+fire (cannot act). Shots
   update always runs (independent of the vault short-circuit).

     snapshot
       → status timers (iframe/entangle/stun/cooldown)
       → status-forced effects (STUN force-drop)
       → [VAULTING] advance vault  |  [else] move+collision(+plate/key)
                                             → carry actions → abilities → fire
       → shots update
   ========================================================================= */
export function updatePlayer(snapshot, dt) {
  const p = G.player;
  if (!p) return;
  if (p.loco === "DEAD") return;   // death is final (§6.1); no further sim

  // 1. status timers
  tickTimers(p, dt);

  // 2. status-forced effects: STUN forces an immediate drop of any carried
  //    object (§5.2). The drop itself is a Phase-6 body — see dropCarried.
  if (p.stun > 0) dropCarried("stun");

  if (p.loco === "VAULTING") {
    // VAULTING: scripted hop, no collision, cannot act, invulnerable (§5.1).
    // Short-circuits move + carry + fire.
    advanceVault(p, dt);
  } else {
    // 3. move + collision (+ plate press / key spend)
    doMovement(p, snapshot, dt);
    // 4. carry actions (pickup / release / vault ENTRY) — STUB (Phase 6)
    carryActions(p, snapshot, dt);
    // 5. abilities (edge-triggered; locked while stunned) — §10
    tryAbilities(p, snapshot);
    // 6. fire / volley — STUB (Phase 7)
    tryFire(p, snapshot, dt);
  }

  // 7. shots update — STUB (Phase 7 owns projectiles.js)
  updateShots(dt);
}

// Production per-frame entry: reads the live input snapshot then runs the pure
// update. Kept thin so updatePlayer stays a pure function of (snapshot, dt, G).
export function tickPlayer(dt) {
  updatePlayer(getSnapshot(), dt);
}

/* ---- status timers (§5.2, §11 step 1) ------------------------------------ */
function tickTimers(p, dt) {
  if (p.iframe > 0)   p.iframe   = Math.max(0, p.iframe - dt);
  if (p.cooldown > 0) p.cooldown = Math.max(0, p.cooldown - dt);
  if (p.entangle > 0) p.entangle = Math.max(0, p.entangle - dt);
  if (p.stun > 0) {
    p.stun = Math.max(0, p.stun - dt);
    // random-walk vector re-rolled every stunReroll seconds (§5.2). stunReroll
    // starts at 0 (initPlayer) so the first stunned tick rolls immediately.
    p.stunReroll -= dt;
    if (p.stunReroll <= 0) {
      rerollStunVec(p);
      p.stunReroll = CFG.PLAYER.stunReroll;
    }
  }
}

function rerollStunVec(p) {
  const a = Math.random() * Math.PI * 2;
  p.stunVec = { x: Math.cos(a), y: Math.sin(a) };
}

/* =========================================================================
   Movement (§4.1/§4.2) — multiplicative speed stack (P3), two-source per-axis
   slide via world.moveBody with a carry-aware blocker filter, world hooks.
   ========================================================================= */
function doMovement(p, snap, dt) {
  const aim  = snap.aim  || { x: 1, y: 0 };
  const move = snap.move || { x: 0, y: 0 };

  // raw input direction drives the ENTANGLED ≥60° shave (player intent, not
  // the stun-substituted vector) — applied before the input is replaced.
  let mvx = move.x, mvy = move.y;
  if (p.entangle > 0) applyEntangleShave(p, mvx, mvy);

  // STUNNED: move input replaced by the current random unit vector (§5.2).
  if (p.stun > 0) { mvx = p.stunVec.x; mvy = p.stunVec.y; }

  // effective speed = base × Π(active P3 modifiers) — MULTIPLICATIVE, they
  // co-occur (carry-while-entangled = 112 × 0.85 × 0.35).
  const eff = effectiveMoveSpeed(p);
  const stepX = mvx * eff * dt;
  const stepY = mvy * eff * dt;

  // move + collision, intercepting a key-spendable locked door on the way.
  moveWithKeySpend(p, stepX, stepY);

  // knockback is integrated SEPARATELY and still respects collision (§4.1, P4).
  integrateKnockback(p, dt);

  // facing = aim while not firing (fire is a Phase-7 stub ⇒ always aim here).
  p.angle = Math.atan2(aim.y, aim.x);

  // world hook: pressure-plate press by weight, keyed on final body position.
  updatePlatePress(p);
}

// Effective per-second move speed after the multiplicative P3 stack (§4.1, P3).
// Exported so tests assert the exact product without a collision confound.
export function effectiveMoveSpeed(p) {
  let mult = 1;
  if (p.loco === "CARRYING") mult *= CFG.PLAYER.carryMult;
  if (p.entangle > 0)        mult *= CFG.PLAYER.entangleMult;
  if (p.stun > 0)            mult *= CFG.PLAYER.stunMult;
  return CFG.PLAYER.speed * mult;
}

// ENTANGLED shave (§5.2, §12.10): an input-direction change ≥ entangleTurnDeg
// (60°) from the last input direction subtracts entangleShaveSec (0.3 s) from
// the remaining entangle. Zero input has no direction — leave the baseline.
function applyEntangleShave(p, mvx, mvy) {
  if (mvx === 0 && mvy === 0) return;
  const ang = Math.atan2(mvy, mvx);
  if (p.entangleAngle != null) {
    let d = Math.abs(ang - p.entangleAngle);
    if (d > Math.PI) d = 2 * Math.PI - d;             // normalize to [0, π]
    if (d >= CFG.PLAYER.entangleTurnDeg * Math.PI / 180)
      p.entangle = Math.max(0, p.entangle - CFG.PLAYER.entangleShaveSec);
  }
  p.entangleAngle = ang;
}

/* ---- Carry-aware blocker filter (§4.2) -----------------------------------
   Policy the caller supplies to world.bodyHitsBlocker (which owns geometry).
   - Never block on the crate we are carrying (spliced from G.crates anyway).
   - Carrying: ALL movable blockers (crate/barrel/spawner) are solid.
   - Hands-free: crates & barrels are pickup TRIGGERS (not walls); only
     spawners are solid. */
function playerBlockerFilter(e) {
  const carry = G.player.carry;
  if (carry && e === carry.entity) return false;
  if (G.player.loco === "CARRYING") return true;
  return e.type === "spawner";
}

/* ---- Move + key-spend (§4.3) ---------------------------------------------
   Per axis: if the step is blocked by a CLOSED locked-door 'D' tile and
   G.keys ≥ 1, spend a key, open the door via the loader seam, then let the
   (now-passable) move through. keys = 0 ⇒ just blocked. */
function moveWithKeySpend(p, dx, dy) {
  if (dx) trySpendKeyForDoor(p, dx, 0);
  if (dy) trySpendKeyForDoor(p, 0, dy);
  moveBody(p, dx, dy, playerBlockerFilter);
}

function trySpendKeyForDoor(p, dx, dy) {
  if (G.keys < 1) return;
  const nx = p.x + dx, ny = p.y + dy;
  if (!bodyHitsWall(nx, ny, p.r)) return;            // not blocked by static/door
  const door = blockingClosedDoorTile(nx, ny, p.r);  // confirm it's a 'D' (§4.3)
  if (!door) return;
  G.keys--;
  openLockedDoor(door.tx, door.ty);
  emit("door:unlocked", { tx: door.tx, ty: door.ty, keysLeft: G.keys });
}

// The first closed locked-door ('D') tile the body at (x,y,r) overlaps, or
// null. Reads world.map to confirm the char is 'D' before a key is ever spent.
function blockingClosedDoorTile(x, y, r) {
  const minX = ((x - r) / CFG.TILE) | 0, maxX = ((x + r) / CFG.TILE) | 0;
  const minY = ((y - r) / CFG.TILE) | 0, maxY = ((y + r) / CFG.TILE) | 0;
  for (let ty = minY; ty <= maxY; ty++) {
    const row = worldMap[ty];
    if (!row) continue;
    for (let tx = minX; tx <= maxX; tx++)
      if (row[tx] === "D" && isWall(tx, ty)) return { tx, ty };
  }
  return null;
}

/* ---- Knockback (§4.1, §6.2, P4) ------------------------------------------
   Integrated separately from move, decays by exp(-friction·dt), zeroed under a
   small threshold. Still routed through moveBody so it respects collision. */
const KNOCKBACK_ZERO = 1;   // px/s below which knockback is snapped to rest
function integrateKnockback(p, dt) {
  if (p.kvx === 0 && p.kvy === 0) return;
  moveBody(p, p.kvx * dt, p.kvy * dt, playerBlockerFilter);
  const decay = Math.exp(-CFG.PLAYER.knockbackFriction * dt);
  p.kvx *= decay; p.kvy *= decay;
  if (Math.hypot(p.kvx, p.kvy) < KNOCKBACK_ZERO) { p.kvx = 0; p.kvy = 0; }
}

/* ---- Pressure-plate press by weight (§4.3, §7.1.6) -----------------------
   While the body overlaps a '_' plate tile it is held pressed; on leaving,
   released. Both go through the loader's coord-keyed seam (single recompute
   path). Dropped-crate hold is Phase 6. */
function updatePlatePress(p) {
  const r = p.r;
  const minX = ((p.x - r) / CFG.TILE) | 0, maxX = ((p.x + r) / CFG.TILE) | 0;
  const minY = ((p.y - r) / CFG.TILE) | 0, maxY = ((p.y + r) / CFG.TILE) | 0;
  const now = new Set();
  for (let ty = minY; ty <= maxY; ty++) {
    const row = worldMap[ty];
    if (!row) continue;
    for (let tx = minX; tx <= maxX; tx++)
      if (row[tx] === "_") now.add(tx + "," + ty);
  }
  const prev = p._platesPressed || new Set();
  for (const key of prev)
    if (!now.has(key)) { const [tx, ty] = key.split(",").map(Number); setPlatePressedAt(tx, ty, false); }
  for (const key of now)
    if (!prev.has(key)) { const [tx, ty] = key.split(",").map(Number); setPlatePressedAt(tx, ty, true); }
  p._platesPressed = now;
}

/* ---- Abilities (§10) — edge-triggered, locked while stunned --------------- */
function tryAbilities(p, snap) {
  const novaEdge  = snap.nova && !prevNova;
  const lightEdge = snap.lightning && !prevLightning;
  prevNova = !!snap.nova;
  prevLightning = !!snap.lightning;
  if (p.stun > 0) return;                    // abilities locked while STUNNED (§5.2)
  if (novaEdge)  abilityHandlers.nova();
  if (lightEdge) abilityHandlers.lightning();
}

/* =========================================================================
   VAULTING kinematics (§5.1). Position lerps from→to over `dur`; collision and
   input are skipped; iframe treated active (applyDamageToPlayer no-ops on
   loco === "VAULTING"). Vault ENTRY (moving-release drop, wall-vault) is a
   Phase-6 body — it sets p.vault + loco; this advancement completes the hop.
   ========================================================================= */
function advanceVault(p, dt) {
  const v = p.vault;
  if (!v) { p.loco = "NORMAL"; return; }     // defensive: no vault data
  v.t += dt;
  const t = Math.min(1, v.t / v.dur);
  p.x = v.from.x + (v.to.x - v.from.x) * t;
  p.y = v.from.y + (v.to.y - v.from.y) * t;
  if (v.t >= v.dur) {
    p.x = v.to.x; p.y = v.to.y;
    p.vault = null;
    p.loco = "NORMAL";
  }
}

/* =========================================================================
   Damage / heal / knockback sinks (§6.1/§6.2) — the single entry points that
   #4 (enemy loop), #3 (food/pickups) and later damage drivers call. Owned
   here; drivers deferred.
   ========================================================================= */

// Every damage source funnels through here (§6.1). No-op under post-hit invuln
// or VAULTING; otherwise subtract HP, arm iframe, and finalize death.
export function applyDamageToPlayer(amount, sourceTag) {
  const p = G.player;
  if (!p || p.loco === "DEAD") return;
  if (p.iframe > 0 || p.loco === "VAULTING") return;
  G.hp -= amount;                            // overheal is just hp > 20; no decay (§2.1)
  p.iframe = CFG.PLAYER.iframe;
  if (G.hp <= 0) {
    p.loco = "DEAD";                         // death is final — single-life run (§2.6)
    emit("player:died", { night: G.night, score: G.score, source: sourceTag });
  }
}

// Healing side owns the overheal cap so the invariant lives in one place (§6.1).
export function healPlayer(amount) {
  G.hp = Math.min(G.hp + amount, G.overhealCap);
}

// Knockback receive (§6.2, P4): kv = unit(dir) × impulse; decay in step 3.
export function applyKnockbackToPlayer(dirX, dirY, impulse) {
  const p = G.player;
  if (!p) return;
  const mag = Math.hypot(dirX, dirY);
  if (mag === 0) { p.kvx = 0; p.kvy = 0; return; }
  p.kvx = (dirX / mag) * impulse;
  p.kvy = (dirY / mag) * impulse;
}

/* =========================================================================
   STUB HOOKS — filled by later phases; present now so the ordering skeleton is
   correct and complete (§11 "wire the stub hooks in their correct slots now").
   ========================================================================= */

// Carry actions: pickup (hands-free contact) / release (toss or drop+vault) /
// wall-vault. Phase 6 fills this. No-op now.
function carryActions(p, snap, dt) { /* Phase 6 — crate carry system (§9) */ }

// Ranged fire + volley gate + power-up decrement. Phase 7 fills this. Fire runs
// only in NORMAL (CARRYING repurposes the input, VAULTING/DEAD can't act). No-op now.
function tryFire(p, snap, dt) { /* Phase 7 — ranged fire (§7) */ }

// Player-shot motion / range / ricochet. Phase 7 (projectiles.js) fills this. No-op now.
function updateShots(dt) { /* Phase 7 — projectiles.js (§8) */ }

// Force-drop of a carried object (STUN, §5.2). Phase 6 owns the real drop
// (settle the crate on the current tile, re-insert into G.crates+nav, press a
// '_' under it). Phase-5 stub exits the CARRYING state so the status-forced
// drop is correct-direction and observable (emits crate:dropped); the crate
// LANDING is Phase 6. No-op when hands-free (the common Phase-5 case).
function dropCarried(reason) {
  const p = G.player;
  if (!p.carry) return;
  emit("crate:dropped", {
    reason, x: p.x, y: p.y,
    tx: (p.x / CFG.TILE) | 0, ty: (p.y / CFG.TILE) | 0,
  });
  p.carry = null;
  if (p.loco === "CARRYING") p.loco = "NORMAL";
}
