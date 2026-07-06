/* =========================================================================
   abilities.js — Nova, Lightning & the gem-energy economy (SPEC-ABILITIES,
   subsystem #5). COMPLETE (Phases 1–4).

   Built here: the gem-energy accounting (addGemEnergy, A6/§3), the cooldown
   timers (novaCd/lightningCd) + their per-frame tick (updateAbilities), the
   init/reset (initAbilities), the barrel-detonation seam (A8), and the
   registration of the two ability handlers into player.js's registerAbility
   seam. onLightning (§5.1, instantaneous radius wipe) and onNova (§4.1, the
   expanding-ring cast) are both FILLED, and updateAbilities runs the per-frame
   Nova ring pass (§4.2: expand → swept-wavefront enemy hits → projectile erase
   → dissipate → one shared sweepDeadEnemies). Registration is by reference, so
   the registered handler identity is stable across the filled bodies.

   ---- R6 / import direction: ONE-WAY, no cycle ---------------------------
   abilities.js imports config/state and, one-way, level-loader (emit),
   player.js (registerAbility/applyStun) and enemies.js (sweepDeadEnemies).
   NONE of those import abilities.js (player forbids it explicitly; enemies
   imports only config/state/world/loader/projectiles/enemies-ai). The
   handlers are registered AT MODULE LOAD (import side-effect), so the boot
   sequence must `import "./abilities.js"` for registerAbility to run before
   the first frame — the standard register-callback load-order contract.
   `emit`, `applyStun` and `sweepDeadEnemies` are imported now to pin the
   one-way graph; their consumers are the Phase 3/4 handler bodies.
 * ========================================================================= */

import { CFG } from "./config.js";
import { G } from "./state.js";
import { emit } from "./level-loader.js";
import { registerAbility, applyStun } from "./player.js";
import { sweepDeadEnemies } from "./enemies.js";

/* ---- Module-local state (§2.4, reset by initAbilities) -------------------
   Cooldown timers only. No edge-detect state lives here — player.js owns the
   prevNova/prevLightning edge detection and calls the registered handler on
   the rising edge (§2.4/§10), so these handlers are "cast now" entry points. */
let novaCd = 0;        // s — Nova anti-double-tap cooldown (§2.3, 0.5s)
let lightningCd = 0;   // s — Lightning cooldown (§2.3, 10s)

/* ---- Barrel-detonation seam (A8, §7) ------------------------------------
   Lightning detonates barrels in its radius; barrels don't exist yet
   (SPEC-BARRELS, post-#4). Same shape as the seam in enemies.js. No-op
   default; SPEC-BARRELS must register its real fn into BOTH consumers
   (enemies.js AND abilities.js). Nova deliberately never touches barrels
   (GDD §5.1), so only Lightning will call this. */
let detonateBarrelsInRadius = () => {};
export function registerBarrelDetonation(fn) { detonateBarrelsInRadius = fn; }

/* ---- Gem-energy economy (A6, §3) — GDD §3.5, §5.1 -----------------------
   The single credit path into the fuel economy. Pure function of (value,
   G.gemEnergy, G.storedCharges) → mutated G state; never reads pickups,
   positions, or the Magnet. SPEC-PICKUPS calls it once per gem collected
   (value = CFG.GEM.energy = 5); tests call it directly.

   Fill the bar 0→barCap; overflow banks whole barCap-sized charges up to
   chargeCap; anything past a full bar AND full charges is discarded (GDD's
   "max 300 total banked"). Algorithm transcribed verbatim from A6. */
export function addGemEnergy(value) {
  const { barCap, chargeCap } = CFG.ABILITY.nova;
  G.gemEnergy += value;
  while (G.gemEnergy > barCap && G.storedCharges < chargeCap) {
    G.gemEnergy -= barCap;
    G.storedCharges++;
  }
  if (G.gemEnergy > barCap) G.gemEnergy = barCap;   // fully banked → clamp the bar
}

/* ---- init / reset (§7) ---------------------------------------------------
   Called on boot + on every level load. Cooldowns are transient (reset to 0,
   A9); G.novas is a per-level transient ring list (also cleared on load by the
   loader's transient-clear line, A9 — this belt-and-braces reset keeps init
   self-sufficient for headless tests that never call loadLevel). gemEnergy /
   storedCharges are PERSISTENT run-state and are NOT touched here (A9). */
export function initAbilities() {
  novaCd = 0;
  lightningCd = 0;
  G.novas = [];
}

/* ---- Cooldown observation (read-only) ------------------------------------
   novaCd/lightningCd are module-local (§2.4). This read-only accessor exposes
   them for (a) headless tests and (b) the HUD ability-readiness icons the spec
   Scope says #5 "maintains the state [they] read" (#10). Mirrors nav.js's
   getNavVersion() precedent of surfacing internal module state without moving
   the storage into G. No caller mutates the returned snapshot. */
export function getCooldowns() {
  return { nova: novaCd, lightning: lightningCd };
}

/* ---- Per-frame step (§4.2) ----------------------------------------------
   Ticks both cooldowns down by dt (floored at 0), then runs the Nova ring
   pass. For each live ring, in REVERSE (removals must not skip entries — the
   §8 risk): advance the swept band [prevR, r], strike the enemies crossed this
   frame (nearest-first, one hit per enemy per ring), erase enemy ordnance in
   the band (free), and dissipate the ring at health≤0 or the radius cap. One
   shared sweepDeadEnemies() runs after ALL rings (A1 — never per-hit, which
   would splice mid-iteration; the ability step is order-tolerant per A1).

   Barrels/crates/spawners are NEVER referenced below — that is how Nova's
   "unaffected" immunity (GDD §5.1) holds by construction, not a special skip. */
export function updateAbilities(dt) {
  novaCd = Math.max(0, novaCd - dt);
  lightningCd = Math.max(0, lightningCd - dt);

  const rings = (G.novas ||= []);   // lazy-init: first touch of the ring array (A9)
  if (rings.length === 0) return;   // no live rings → no ring pass, nothing to sweep

  const nova = CFG.ABILITY.nova;
  const expand = nova.expandTilesPerSec * CFG.TILE;   // px/s
  const radiusCap = nova.radiusCapTiles * CFG.TILE;   // px hard stop (A5/§2.2)
  const enemies = G.enemies || [];
  const shots = G.shots || [];
  const ebolts = G.ebolts || [];

  for (let ri = rings.length - 1; ri >= 0; ri--) {
    const ring = rings[ri];
    ring.prevR = ring.r;                 // last frame's radius = band lower bound (A3)
    ring.r += expand * dt;               // rings expand outward only; r is monotonic
    const lo = ring.prevR, hi = ring.r;  // swept band this frame: lo < dist <= hi

    // 2. ENEMY PASS (A3/A4/A2/A1). Gather this frame's crossings (centre-to-
    //    centre dist, NOT edge — Nova's hit geometry has no e.r term, unlike
    //    Lightning), excluding already-struck enemies; resolve nearest-first.
    const crossed = [];
    for (const e of enemies) {
      if (ring.hit.has(e)) continue;                       // one hit per enemy per ring
      const dx = e.x - ring.x, dy = e.y - ring.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > lo && dist <= hi) crossed.push({ e, dist });
    }
    crossed.sort((a, b) => a.dist - b.dist);               // nearest-first (A4)
    for (const { e } of crossed) {
      ring.hit.add(e);
      if (e.resist?.nova) {
        e.hp -= nova.reaperDamage;        // resisted → chip 10, survives (A2)
        ring.health -= nova.reaperRingCost;  // ring loses 20
      } else {
        const cost = e.hp;                // ring loses the victim's CURRENT hp
        e.hp = 0;
        e._cause = "player-nova";         // player-attributed (§6)
        ring.kills++;                     // destroys only (the dissipation emit)
        ring.health -= cost;
      }
      // A4: the victim that drove health ≤0 stays destroyed (marked above); we
      // stop here — enemies further out this frame are neither struck nor added
      // to hit, and the ring dissipates below (same ≤0 threshold).
      if (ring.health <= 0) break;
    }

    // 3. PROJECTILE ERASE (A10) — FREE (no health cost), same swept band,
    //    independent of ring health so it still runs on the dying frame. Removes
    //    enemy-owned shots (arrows/webs/dark-blasts) + all ebolts (arced lobs, at
    //    their current interpolated ground pos). Player shots are NEVER touched.
    for (let i = shots.length - 1; i >= 0; i--) {
      const s = shots[i];
      if (s.owner !== "enemy") continue;
      const dx = s.x - ring.x, dy = s.y - ring.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > lo && dist <= hi) shots.splice(i, 1);
    }
    for (let i = ebolts.length - 1; i >= 0; i--) {
      const b = ebolts[i];
      const dx = b.x - ring.x, dy = b.y - ring.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > lo && dist <= hi) ebolts.splice(i, 1);
    }

    // 4. DISSIPATE — at health≤0 (spent) OR r≥radiusCap (empty hard stop). Emit
    //    the OQ-A1 snapshot (killCount = destroys accumulated over the ring's
    //    life), then remove the ring (after this frame's hits + erases applied).
    if (ring.health <= 0 || ring.r >= radiusCap) {
      emit("ability:cast", { kind: "nova", killCount: ring.kills });
      rings.splice(ri, 1);
    }
  }

  // 5. ONE shared sweep after ALL rings (A1) — every ring-killed enemy drops
  //    gems, scores (player-nova ⇒ full points), and emits through the same path.
  sweepDeadEnemies();
}

/* ---- Ability handlers (registered at module load, §7) --------------------
   onNova and onLightning are both FILLED; registration is by REFERENCE, so the
   handler identity is stable. player.js edge-triggers them on the rising input
   edge and only when not STUNNED (its tryAbilities gate). */

/* ---- Nova cast (§4.1, A5) — pushes an expanding ring; no emit at cast -----
   The ring's origin is FROZEN at the player's centre at cast (it does not track
   the player — "aimable by positioning", GDD §5.3). Its per-frame expansion +
   hits live in updateAbilities (§4.2); the ability:cast emit fires on
   dissipation, when the ring's total kill count is finally known (not here).

   Order (SPEC §4.1):
   1. cooldown gate;
   2. fuel branch (A5): a stored charge is spent FIRST (bank efficiency, OQ-A2)
      → full ringMaxHp, bar untouched; else a bar ≥ minBarToFire is spent whole
      → health scales by energy/barCap; else the tap cannot pay → rejected no-op
      (no ring, NO cooldown, no spend);
   3. push the ring (r=prevR=0, resolved float health, empty hit Set, kills=0);
   4. arm the cooldown. */
function onNova() {
  if (novaCd > 0) return;                              // 1. cooldown gate

  const nova = CFG.ABILITY.nova;

  // 2. Fuel branch (A5). Keep ring health a FLOAT — the bar-fire scaling is
  //    fractional (e.g. 40 energy → 20.0) and only ever feeds the ≤0 test.
  let health;
  if (G.storedCharges >= 1) {
    G.storedCharges--;                                 // spend one charge; bar keeps filling
    health = nova.ringMaxHp;                            // full 50
  } else if (G.gemEnergy >= nova.minBarToFire) {
    health = nova.ringMaxHp * (G.gemEnergy / nova.barCap);  // scale by live-bar energy
    G.gemEnergy = 0;                                    // consume the whole bar
  } else {
    return;                                             // rejected no-op (no ring/cooldown/spend)
  }

  // 3. Push the ring at the player's current centre (frozen origin).
  (G.novas ||= []).push({
    x: G.player.x, y: G.player.y,
    r: 0, prevR: 0,                                     // prevR=0 (NOT r) so frame 1's band isn't empty
    health,
    hit: new Set(),
    kills: 0,
  });

  novaCd = nova.cooldown;                               // 4. arm anti-double-tap cooldown (0.5s)
}

/* ---- Lightning cast (§5.1, A2/A7/A8/A1) — INSTANTANEOUS -------------------
   Resolved entirely here; there is no persistent Lightning entity to tick.
   Called on the rising input edge, not while STUNNED (player.js tryAbilities
   gate). Consumes NO gem energy (§5.2 — the null case is structural).

   Order (SPEC §5.1):
   1. cooldown gate;
   2. R = radius (px), (px,py) = player centre;
   3. enemy radius wipe — resist.lightning MARKER (A2, NOT boss/type): a resisted
      target takes reaperDamage and SURVIVES (no _cause, not counted); everything
      else is destroyed (hp=0, _cause="player-lightning") and counted;
   4. sweepDeadEnemies() ONCE after the whole pass (A1 — never per-hit, which
      would splice mid-iteration; the shared drop/score/emit/cleanup path);
   5. detonateBarrelsInRadius (A8 seam — no-op until SPEC-BARRELS);
   6. applyStun (A7 — the vulnerability window; force-drops any carried object
      next frame via the existing dropCarried("stun"));
   7. arm the cooldown;
   8. emit a SNAPSHOT ability:cast with killCount = destroys only (OQ-A1; a
      resisted Reaper chipped for 5 is NOT a kill). Subscribers must not reach
      back into G — the one-way-flow rule. */
function onLightning() {
  if (lightningCd > 0) return;                       // 1. cooldown gate

  const cfg = CFG.ABILITY.lightning;
  const R = cfg.radiusTiles * CFG.TILE;              // 2. wipe radius (px)
  const px = G.player.x, py = G.player.y;            //    player centre (frozen at cast)

  // 3. Enemy radius wipe. Spawners/crates are never referenced, so their
  //    immunity (§5.2) holds by construction, not a special-cased skip.
  let killCount = 0;
  const enemies = G.enemies || [];
  for (const e of enemies) {
    const dx = e.x - px, dy = e.y - py;
    const rr = R + e.r;                              // per-enemy reach (edge, not centre)
    if (dx * dx + dy * dy > rr * rr) continue;
    if (e.resist?.lightning) {
      e.hp -= cfg.reaperDamage;                      // resisted → chip 5, survives (A2)
    } else {
      e.hp = 0;
      e._cause = "player-lightning";                 // player-attributed (§6)
      killCount++;                                   // destroys only (OQ-A1)
    }
  }

  sweepDeadEnemies();                                // 4. ONE shared sweep after the pass (A1)
  detonateBarrelsInRadius(px, py, R, "player-lightning"); // 5. barrel seam (A8, inert until SPEC-BARRELS)
  applyStun(cfg.stunSeconds);                        // 6. self-stun 3s (A7)
  lightningCd = cfg.cooldown;                        // 7. arm cooldown (10s)
  emit("ability:cast", { kind: "lightning", killCount }); // 8. snapshot payload (OQ-A1)
}

registerAbility("nova", onNova);
registerAbility("lightning", onLightning);

/* ---- Test affordances (house __-prefixed convention) ---------------------
   The handlers are registered into player.js by reference (above) and are
   otherwise module-local. Export them under __-prefixed aliases so headless
   tests can drive a cast directly (SPEC §9 — set G state, register a barrel
   spy, call the handler), the same posture as enemies.js's __deathSweep /
   __playerShotEnemyPass. player.js still invokes them only via the registry. */
export { onNova as __onNova, onLightning as __onLightning };
