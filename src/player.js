/* =========================================================================
   player.js — player entity: locomotion, two-source collision, status
   overlays, world hooks (plate press / key spend), and the damage/heal/
   knockback sinks. (SPEC-PLAYER §2, §4, §5, §6, §10.)

   COMPLETE (SPEC-PLAYER Phases 5–7): the load-bearing FRAME-UPDATE ORDERING
   SKELETON, NORMAL locomotion + overlays + sinks (Phase 5), the crate carry
   system (pickup/toss/drop-vault/wall-vault/STUN-drop, Phase 6), and the ranged
   fire hook (tryFire volley gate + power-up decrement, Phase 7 — shot MOTION/
   ricochet lives in projectiles.js, imported as makeShot/updateShots).

   PURE-FUNCTION BOUNDARY (§11): updatePlayer takes the input snapshot as an
   ARGUMENT — it never reaches into input's device glue or any canvas. Tests
   feed synthetic snapshots. The production per-frame entry `tickPlayer(dt)`
   pulls the live snapshot from input.js and delegates to updatePlayer.

   IMPORT DISCIPLINE (§11): imports config/state/world/level-loader/input plus
   the projectiles shot factory (one-way — projectiles.js imports config/state/
   world only, never player; the shot's shooter is a string `owner` tag, not a
   back-reference). It must NOT import abilities/enemies/combat — those reach
   INTO player via register-callbacks (abilities registry) or call player's sinks
   directly (enemies/#4 own the melee loop). Audio is a leaf seam (registerSfx;
   player.js never imports audio.js). See STATUS.md architecture decisions.
   ========================================================================= */
import { CFG } from "./config.js";
import { G } from "./state.js";
import { moveBody, bodyHitsWall, isWall, map as worldMap } from "./world.js";
import { setPlatePressedAt, openLockedDoor, markNavDirty, emit } from "./level-loader.js";
import { getSnapshot } from "./input.js";
import { makeShot, updateShots } from "./projectiles.js";

/* ---- Ability seam (§10, register-callbacks) ------------------------------
   input.nova/input.lightning are edge-triggered here and routed to a
   registered handler. player.js NEVER imports abilities.js; #5 registers its
   fn. Default no-op. Abilities are locked while STUNNED (§5.2). */
const abilityHandlers = { nova: () => {}, lightning: () => {} };
export function registerAbility(name, fn) {
  abilityHandlers[name] = typeof fn === "function" ? fn : () => {};
}

/* ---- Audio seam (§10, leaf) ----------------------------------------------
   player.js calls sfx.* behind a seam but never imports audio.js (a later leaf
   subsystem). Default no-ops; audio.js registers real handlers at boot via
   registerSfx. Keeps player.js's import graph gameplay-free (config/state/world/
   level-loader/input/projectiles only). */
const sfx = { shoot() {} };
export function registerSfx(handlers) {
  if (handlers && typeof handlers === "object") Object.assign(sfx, handlers);
}

/* ---- Barrel-kick seam (SPEC-BARRELS B3, register-callbacks) --------------
   A moving barrel release KICKS it rolling (barrels.js kickBarrel: re-insert
   into G.barrels + set roll velocity). player.js NEVER imports barrels.js
   (the one-way rule — nothing imports barrels.js); barrels.js registers its
   kick fn here at load, exactly like #5 registers its ability handlers.
   Default no-op (a kick before barrels.js loads would silently drop the
   barrel — acceptable; boot + every test import barrels.js). */
let barrelKickSink = () => {};
export function registerBarrelKick(fn) {
  barrelKickSink = typeof fn === "function" ? fn : () => {};
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
  p.carry = null;                // null | { type:"crate"|"barrel", entity }
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
    // 4. carry actions (pickup / release / vault ENTRY)
    //    Capture CARRYING *before* the carry step: while CARRYING the fire input
    //    is repurposed as RELEASE (§7), so even if a stationary release tosses
    //    the crate and returns to NORMAL this same frame, fire must NOT also
    //    trigger — "fired while carrying" is the §11-flagged ordering bug.
    const wasCarrying = p.loco === "CARRYING";
    carryActions(p, snapshot, dt);
    // 5. abilities (edge-triggered; locked while stunned) — §10
    tryAbilities(p, snapshot);
    // 6. fire / volley (§7) — only in NORMAL; suppressed the frame a carry was
    //    released so the fire input can't double as toss + shot.
    if (!wasCarrying) tryFire(p, snapshot, dt);
  }

  // 7. shots update — projectiles.js owns motion/range/ricochet (§8)
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

  // facing = aim here; tryFire (§7, later this frame) overrides it to the fire
  // direction on a frame the player fires (§2: aim while not firing, fire dir
  // while firing).
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

// Entangle sink (SPEC-ENEMIES §1 E7): the Spider web calls INTO player rather
// than reaching G.player directly. Extends (never shortens) the remaining
// duration; resets entangleAngle so the next-turn shave baseline is fresh.
// Does not trip iframe (0-damage effect) and does not gate on loco (§2.5 —
// entangle stacks with locomotion).
export function applyEntangle(seconds) {
  const p = G.player;
  p.entangle = Math.max(p.entangle, seconds);
  p.entangleAngle = null;
}

/* SPEC-ABILITIES A7 — the missing STUNNED producer (parallel to E7's applyEntangle).
   player.js already MODELS stun (p.stun timer, tickTimers decrement, tryAbilities
   lock, dropCarried("stun") force-drop) but nothing set p.stun; Lightning is the
   first. Abilities call this sink, not the field. Extends-not-shortens; no iframe,
   no loco gate. The carried-object force-drop follows for free next frame. */
export function applyStun(seconds) {
  const p = G.player;
  p.stun = Math.max(p.stun, seconds);
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
   A '_' plate is held pressed while ANY weight rests on it: the player body OR
   a dropped crate resting on its tile. The loader's plate seam is a boolean per
   plate (no refcount), so player.js is the single authority that OR-combines the
   two weight sources into one pressed-set and diffs it against the previous set —
   a plate only releases when neither the player nor any crate sits on it. Called
   from doMovement (player moved) AND from every crate pickup/drop (crates
   changed), so a dropped crate keeps its door open after the player walks off,
   until the crate itself is removed. */
function updatePlatePress(p) {
  const now = new Set();
  addFootprintPlates(now, p.x, p.y, p.r);           // player weight
  if (G.crates) for (const e of G.crates) {         // resting crates each hold their tile
    const tx = (e.x / CFG.TILE) | 0, ty = (e.y / CFG.TILE) | 0;
    if (worldMap[ty] && worldMap[ty][tx] === "_") now.add(tx + "," + ty);
  }
  const prev = p._platesPressed || new Set();
  for (const key of prev)
    if (!now.has(key)) { const [tx, ty] = key.split(",").map(Number); setPlatePressedAt(tx, ty, false); }
  for (const key of now)
    if (!prev.has(key)) { const [tx, ty] = key.split(",").map(Number); setPlatePressedAt(tx, ty, true); }
  p._platesPressed = now;
}

// Add every '_' plate tile under an AABB(radius) footprint at (x,y) to `set`.
function addFootprintPlates(set, x, y, r) {
  const minX = ((x - r) / CFG.TILE) | 0, maxX = ((x + r) / CFG.TILE) | 0;
  const minY = ((y - r) / CFG.TILE) | 0, maxY = ((y + r) / CFG.TILE) | 0;
  for (let ty = minY; ty <= maxY; ty++) {
    const row = worldMap[ty];
    if (!row) continue;
    for (let tx = minX; tx <= maxX; tx++)
      if (row[tx] === "_") set.add(tx + "," + ty);
  }
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
   CARRY SYSTEM (§9) — the CARRY slot, run AFTER move+collision. Dispatches:
     hands-free → automatic pickup on crate overlap
     CARRYING + fire input → release (stationary toss | moving drop+vault)
     CARRYING + moving into a 1-thick wall → wall-vault
   STUN force-drop runs earlier (updatePlayer step 2, BEFORE move); see
   dropCarried. carry.type is "crate"-only here, shaped to admit "barrel" later
   (SPEC-BARRELS) without rework.
   ========================================================================= */
function carryActions(p, snap, dt) {
  if (p.loco === "CARRYING") {
    // While CARRYING, the fire input is repurposed as the RELEASE command (P5).
    if (snap.fireHeld) { releaseCarry(p, snap); return; }
    // Barrels never wall-vault (B6) — vault is a crate-exclusive utility.
    if (p.carry && p.carry.type === "barrel") return;
    // No release ⇒ a carrying player walking into a 1-thick wall auto-vaults it.
    tryWallVault(p, snap);
    return;
  }
  // Hands-free only: automatic pickup on contact (no button). Locked while
  // STUNNED (§5.2: pickup locked). Already CARRYING/VAULTING/DEAD never reach here.
  if (p.loco === "NORMAL" && p.stun <= 0) tryPickup(p);
}

/* ---- Pickup (§9, automatic) ----------------------------------------------
   Hands-free overlap with a free crate ⇒ CARRYING. The crate is spliced from
   the collision/nav sources (out of G.crates, its tile nav-dirtied) so it stops
   blocking while held; carry state lives on G.player, not the crate. */
function tryPickup(p) {
  if (p.carry) return;                                // safety: never swap
  const crate = firstOverlappingCrate(p);
  if (crate) {                                        // crate-FIRST order preserved (B6)
    const idx = G.crates.indexOf(crate);
    if (idx >= 0) G.crates.splice(idx, 1);
    markNavDirty(crateTile(crate));                   // old tile no longer blocks
    updatePlatePress(p);                              // crate lifted ⇒ release its plate (unless player holds it)
    p.carry = { type: "crate", entity: crate };
    p.loco = "CARRYING";
    emit("crate:pickup", { x: p.x, y: p.y, tx: (p.x / CFG.TILE) | 0, ty: (p.y / CFG.TILE) | 0 });
    return;
  }
  // Barrels are the volatile carry sibling (SPEC-BARRELS B5/B6): same hands-free
  // pickup, spliced from G.barrels so it stops blocking/occupying while held. If a
  // crate AND a barrel both overlap, the crate wins (checked first, above). No
  // plate press — barrels aren't in the crate plate-weight system.
  const barrel = firstOverlappingBarrel(p);
  if (!barrel) return;
  const bidx = G.barrels.indexOf(barrel);
  if (bidx >= 0) G.barrels.splice(bidx, 1);
  markNavDirty({ tx: (barrel.x / CFG.TILE) | 0, ty: (barrel.y / CFG.TILE) | 0 });
  p.carry = { type: "barrel", entity: barrel };
  p.loco = "CARRYING";
  emit("barrel:pickup", { x: p.x, y: p.y, tx: (p.x / CFG.TILE) | 0, ty: (p.y / CFG.TILE) | 0 });
}

// First crate whose one-tile footprint overlaps the player body, or null. Pixel
// circle test at (r + TILE/2), matching world.bodyHitsBlocker's contract.
function firstOverlappingCrate(p) {
  if (!G.crates) return null;
  const rr = p.r + CFG.TILE / 2;
  for (const e of G.crates) {
    const dx = p.x - e.x, dy = p.y - e.y;
    if (dx * dx + dy * dy < rr * rr) return e;
  }
  return null;
}

// First barrel whose body overlaps the player, or null. Uses the barrel's own
// body radius (r) — the barrel-specific passes in barrels.js likewise test b.r.
function firstOverlappingBarrel(p) {
  if (!G.barrels) return null;
  for (const e of G.barrels) {
    const rr = p.r + e.r;
    const dx = p.x - e.x, dy = p.y - e.y;
    if (dx * dx + dy * dy < rr * rr) return e;
  }
  return null;
}

/* ---- Release (§9, P5) — fire input while CARRYING ------------------------
   Branch on move-input THIS FRAME (nonzero = "moving", NOT measured velocity —
   Q-P3): moving ⇒ drop-in-place + auto-vault; stationary (or vault-blocked) ⇒
   short toss along aim. */
function releaseCarry(p, snap) {
  const move = snap.move || { x: 0, y: 0 };
  const moving = move.x !== 0 || move.y !== 0;
  if (p.carry && p.carry.type === "barrel") { releaseBarrel(p, snap, moving); return; }
  if (moving && canVault(p)) movingReleaseVault(p, snap, move);
  else stationaryToss(p, snap);                       // stationary, or entangled/stunned ⇒ degrade to toss
}

/* ---- Barrel release (SPEC-BARRELS B6) ------------------------------------
   Diverges from crates: NO vault. Moving ⇒ KICK it rolling (barrels.js
   kickBarrel via the registered seam — re-inserts into G.barrels + sets roll
   velocity); stationary ⇒ place upright static on the settle tile (crate-toss
   settle, never rolls after). BOTH paths re-insert the barrel into G.barrels —
   the splice-out symmetry the whole carry hinges on (the ONLY release path that
   skips the re-insert is detonate-in-hand: Phase 4's notifyCarriedBarrelDestroyed). */
function releaseBarrel(p, snap, moving) {
  const barrel = p.carry.entity;
  if (moving) {
    // KICK: drop on the player's current tile centre, then roll along aim (B3).
    const tx = (p.x / CFG.TILE) | 0, ty = (p.y / CFG.TILE) | 0;
    const cx = (tx + 0.5) * CFG.TILE, cy = (ty + 0.5) * CFG.TILE;
    barrel.x = cx; barrel.y = cy; barrel.tc = { x: cx, y: cy };
    p.carry = null;
    p.loco = "NORMAL";
    const a = unit(snap.aim || { x: 1, y: 0 });
    barrelKickSink(barrel, a.x, a.y);                 // barrels.js: re-insert + roll velocity
    emit("barrel:kicked", { x: cx, y: cy, tx, ty });
  } else {
    // PLACE: settle upright static on the first free tile along aim (like a
    // crate toss); never rolls after settling.
    const t = tossSettleTile(p, snap.aim || { x: 1, y: 0 });
    placeBarrelAtTile(p, barrel, t.tx, t.ty, "place");
    p.loco = "NORMAL";
  }
}

// Stationary release: settle the crate on the first free tile up to tossMax(1.5t)
// along aim; press a '_' under it; back to NORMAL. Also the degrade target for a
// vault that can't happen. Never rolls — a single grid settle (§7.1.6).
function stationaryToss(p, snap) {
  const t = tossSettleTile(p, snap.aim || { x: 1, y: 0 });
  dropCrateAtTile(p, t.tx, t.ty, "toss");
  p.loco = "NORMAL";
}

// Moving release: drop on the player's current tile, then VAULT to from+2t along
// move. Landing validated at ENTRY only (Q-P4) — if it isn't walkable, degrade to
// a stationary toss instead of vaulting.
function movingReleaseVault(p, snap, move) {
  const a = unit(move);
  const to = { x: p.x + a.x * CFG.PLAYER.vaultHop, y: p.y + a.y * CFG.PLAYER.vaultHop };
  if (!walkableTile((to.x / CFG.TILE) | 0, (to.y / CFG.TILE) | 0)) { stationaryToss(p, snap); return; }
  dropCrateAtTile(p, (p.x / CFG.TILE) | 0, (p.y / CFG.TILE) | 0, "drop-vault");
  enterVault(p, to);
}

/* ---- Wall-vault (§9, crate-only) -----------------------------------------
   CARRYING + moving into a wall EXACTLY 1 tile thick along the move axis with a
   walkable far tile ⇒ auto-drop against the near face + vault to the far side.
   Raycast from the player tile along move: ahead1 solid AND ahead2 walkable ⇒
   1-thick ⇒ vault; ahead2 also solid ⇒ ≥2-thick ⇒ no vault, just a bump (the hop
   can't clear two tiles) and the crate stays carried. */
function tryWallVault(p, snap) {
  const move = snap.move || { x: 0, y: 0 };
  if (move.x === 0 && move.y === 0) return;           // not moving ⇒ no wall-vault
  if (!canVault(p)) return;                           // entangled/stunned ⇒ bump only, keep carrying
  const dir = dominantAxis(move);
  const ptx = (p.x / CFG.TILE) | 0, pty = (p.y / CFG.TILE) | 0;
  const a1x = ptx + dir.dx, a1y = pty + dir.dy;       // ahead1 (the wall?)
  const a2x = ptx + 2 * dir.dx, a2y = pty + 2 * dir.dy; // ahead2 (far side)
  if (!isWall(a1x, a1y)) return;                      // not blocked by a wall ahead
  if (isWall(a2x, a2y)) return;                       // ≥2-thick ⇒ bump, crate stays carried
  dropCrateAtTile(p, ptx, pty, "wall-vault");         // drop against the near face
  enterVault(p, { x: (a2x + 0.5) * CFG.TILE, y: (a2y + 0.5) * CFG.TILE });
}

/* ---- Drop / vault helpers ------------------------------------------------ */

// Re-insert the carried crate as a resting blocker at tile (tx,ty): reposition
// (pixel center), push to G.crates, nav-dirty, press a '_' under it, clear carry,
// emit. Used by EVERY drop path (toss / moving-drop / wall-vault / stun) so none
// can miss the G.crates push + markNavDirty (a missed nav-dirty = ghost blocker).
function dropCrateAtTile(p, tx, ty, reason) {
  const crate = (p.carry && p.carry.entity) || {};
  const cx = (tx + 0.5) * CFG.TILE, cy = (ty + 0.5) * CFG.TILE;
  crate.type = crate.type || "crate";
  crate.x = cx; crate.y = cy; crate.tc = { x: cx, y: cy };
  crate.blocks = true;
  if (!G.crates) G.crates = [];
  G.crates.push(crate);
  markNavDirty({ tx, ty });
  p.carry = null;
  updatePlatePress(p);                                // press the '_' the crate now rests on (if any)
  emit("crate:dropped", { reason, x: cx, y: cy, tx, ty });
}

// Re-insert the carried barrel as a resting STATIC blocker at tile (tx,ty):
// reposition (pixel centre), zero roll, push to G.barrels, nav-dirty, clear
// carry, emit. Mirrors dropCrateAtTile but for the barrel array — NO plate press
// (barrels aren't in the crate plate-weight system), NO vault, never rolls after.
// Used by the stationary place release AND the STUN force-drop (dropCarried) so
// neither leaks the barrel out of the world nor misroutes it into G.crates.
function placeBarrelAtTile(p, barrel, tx, ty, reason) {
  const cx = (tx + 0.5) * CFG.TILE, cy = (ty + 0.5) * CFG.TILE;
  barrel.type = "barrel";
  barrel.x = cx; barrel.y = cy; barrel.tc = { x: cx, y: cy };
  barrel.blocks = true;
  barrel.vx = 0; barrel.vy = 0; barrel.rolling = false;
  if (!G.barrels) G.barrels = [];
  G.barrels.push(barrel);
  markNavDirty({ tx, ty });
  p.carry = null;
  emit("barrel:placed", { reason, x: cx, y: cy, tx, ty });
}

// Enter VAULTING toward `to` (a pixel point). advanceVault (§5.1) lerps from→to
// over vaultDur and auto-returns to NORMAL; during it collision + input are
// skipped and iframe is treated active (applyDamageToPlayer no-ops on VAULTING).
function enterVault(p, to) {
  p.vault = { t: 0, dur: CFG.PLAYER.vaultDur, from: { x: p.x, y: p.y }, to: { x: to.x, y: to.y } };
  p.loco = "VAULTING";
}

// VAULTING cannot be entered while ENTANGLED or STUNNED (§5.1). (Stun also
// force-drops the crate before this runs, so stun is belt-and-suspenders.)
function canVault(p) { return p.entangle <= 0 && p.stun <= 0; }

// Farthest free tile within tossMax along `aim`, stopping at the first
// wall/blocker; falls back to the player's own tile (min 1-tile placement).
// Whole-tile steps: tossMax(48)/TILE(32) floors to 1, so a toss settles ≤1 tile
// ahead — within the 1.5 t reach and grid-snapped (a crate never lands mid-tile).
function tossSettleTile(p, aim) {
  const a = unit(aim);
  const ptx = (p.x / CFG.TILE) | 0, pty = (p.y / CFG.TILE) | 0;
  let best = { tx: ptx, ty: pty };
  const maxTiles = Math.max(1, Math.floor(CFG.PLAYER.tossMax / CFG.TILE));
  for (let k = 1; k <= maxTiles; k++) {
    const tx = ((p.x + a.x * k * CFG.TILE) / CFG.TILE) | 0;
    const ty = ((p.y + a.y * k * CFG.TILE) / CFG.TILE) | 0;
    if (isWall(tx, ty) || tileHasBlocker(tx, ty)) break;
    best = { tx, ty };
  }
  return best;
}

// Does any movable blocker (crate/barrel/spawner) rest on tile (tx,ty)?
function tileHasBlocker(tx, ty) {
  for (const arr of [G.crates, G.barrels, G.spawners]) {
    if (!arr) continue;
    for (const e of arr)
      if (((e.x / CFG.TILE) | 0) === tx && ((e.y / CFG.TILE) | 0) === ty) return true;
  }
  return false;
}

const walkableTile = (tx, ty) => !isWall(tx, ty);
const crateTile = (e) => ({ tx: (e.x / CFG.TILE) | 0, ty: (e.y / CFG.TILE) | 0 });
function unit(v) { const m = Math.hypot(v.x, v.y); return m > 0 ? { x: v.x / m, y: v.y / m } : { x: 1, y: 0 }; }
// Dominant move axis as a one-axis unit step (wall-vault raycasts along it).
function dominantAxis(move) {
  return Math.abs(move.x) >= Math.abs(move.y)
    ? { dx: Math.sign(move.x), dy: 0 }
    : { dx: 0, dy: Math.sign(move.y) };
}

/* ---- Carried-crate pushback flag (§6.4) ----------------------------------
   #4's melee loop reads this: on player↔enemy contact while it's true, push the
   enemy back 1.5 t and SKIP the damage exchange (the crate is a bumper) — except
   bats (they fly over). The pushback + bat exemption execute in #4; player.js
   only exposes the state. */
export function isCarryingCrate() {
  const p = G.player;
  return !!(p && p.loco === "CARRYING" && p.carry && p.carry.type === "crate");
}

/* ---- Carried-barrel accessors (SPEC-BARRELS B5) --------------------------
   The carried barrel is spliced OUT of G.barrels (crate pattern) so it stops
   blocking/occupying — its effective hit position is the player centre. #4's
   meleeExchange and barrels.js's shot/shrapnel passes test this in addition to
   G.barrels: an enemy hitting a carrying player also chips the held barrel, and
   at 0 HP it detonates in-hand (Phase 4). */
export function carriedBarrel() {
  const p = G.player;
  return p && p.carry && p.carry.type === "barrel" ? p.carry.entity : null;
}

// Detonate-in-hand sink (Phase 4 calls it): clears the carried barrel WITHOUT
// re-inserting into G.barrels — the ONE release path that legitimately skips the
// re-insert (the barrel exploded; it is gone from the world). loco → NORMAL.
export function notifyCarriedBarrelDestroyed() {
  const p = G.player;
  if (!p || !p.carry || p.carry.type !== "barrel") return;
  p.carry = null;
  if (p.loco === "CARRYING") p.loco = "NORMAL";
}

/* =========================================================================
   Ranged fire (§7) — the volley gate + per-trigger power-up decrement. Shot
   MOTION/range/ricochet is projectiles.js (imported updateShots); this owns the
   fire decision + volley spawn only. Runs only in NORMAL (CARRYING repurposes
   the input as release, VAULTING/DEAD can't act); STUNNED *allows* fire (§2.5)
   but can't be CARRYING since stun force-drops.
   ========================================================================= */
function tryFire(p, snap, dt) {
  if (p.loco !== "NORMAL") return;         // fire only in NORMAL (§7)
  if (!snap.fireHeld) return;
  if (p.cooldown > 0) return;

  // Per-trigger power-up flags (§7, P1). Empty G.powerups ⇒ base fire.
  const pu   = G.powerups || (G.powerups = {});
  const tri  = pu.triple > 0;
  const big  = pu.big    > 0;
  const fast = pu.fast   > 0;
  const bn   = pu.bounce > 0;

  const cap    = CFG.SHOT.baseMax + (fast ? 3 : 0) + (tri ? 3 : 0);
  const volley = tri ? 3 : 1;

  // Owner-scoped cap: count ONLY owner==="player" shots on screen — NOT
  // G.shots.length. Enemy arrows share G.shots later and must not consume the
  // player's cap (the key divergence from ADD).
  const shots = G.shots || (G.shots = []);
  let playerShotCount = 0;
  for (const s of shots) if (s.owner === "player") playerShotCount++;
  if (playerShotCount + volley > cap) return;

  // GATE passed — spawn, set cooldown, decrement each active counter by 1.
  spawnVolley(p, snap.aim || { x: 1, y: 0 }, tri, big, bn);
  p.cooldown = CFG.SHOT.cooldown / (fast ? 2 : 1);
  if (tri)  pu.triple--;
  if (big)  pu.big--;
  if (fast) pu.fast--;
  if (bn)   pu.bounce--;

  sfx.shoot();   // one bloop per trigger, not per pellet (audio leaf seam, §10)
  emit("player:fired", { x: p.x, y: p.y, tx: (p.x / CFG.TILE) | 0, ty: (p.y / CFG.TILE) | 0 });
}

// Spawn the volley via the projectiles factory. Single shot along aim, or a
// Triple fan at angle∓Δ, angle, angle+Δ (Δ = CFG.SHOT.spread, ±12°). Each shot
// muzzles + travels along its OWN fan angle (so Triple genuinely diverges);
// Big is two INDEPENDENT multipliers — hitbox ×1.6 AND damage ×2 (P1).
function spawnVolley(p, aim, tri, big, bn) {
  const a = unit(aim);
  const base = Math.atan2(a.y, a.x);
  p.angle = base;                          // facing = fire dir while firing (§2)
  const angles = tri
    ? [base - CFG.SHOT.spread, base, base + CFG.SHOT.spread]
    : [base];
  const r   = CFG.SHOT.r * (big ? CFG.SHOT.bigRadiusMult : 1);
  const dmg = 1 * (big ? CFG.SHOT.bigDmgMult : 1);
  const off = p.r + CFG.SHOT.muzzle;
  for (const ang of angles) {
    const dx = Math.cos(ang), dy = Math.sin(ang);
    G.shots.push(makeShot({
      x: p.x + dx * off, y: p.y + dy * off,
      vx: dx * CFG.SHOT.speed, vy: dy * CFG.SHOT.speed,
      r, dmg, owner: "player", bounce: bn,
    }));
  }
}

// Force-drop of a carried crate (STUN, §5.2) — runs BEFORE move resolves
// (updatePlayer step 2). Settles the crate in place on the player's current tile
// (re-insert into G.crates + nav-dirty + press a '_' under it via dropCrateAtTile)
// and returns to NORMAL. No-op when hands-free.
function dropCarried(reason) {
  const p = G.player;
  if (!p.carry) return;
  const tx = (p.x / CFG.TILE) | 0, ty = (p.y / CFG.TILE) | 0;
  // Barrel force-drop settles STATIC into G.barrels (splice-out symmetry) — must
  // NOT route through dropCrateAtTile, which would push the barrel into G.crates.
  if (p.carry.type === "barrel") placeBarrelAtTile(p, p.carry.entity, tx, ty, reason);
  else dropCrateAtTile(p, tx, ty, reason);
  if (p.loco === "CARRYING") p.loco = "NORMAL";
}
