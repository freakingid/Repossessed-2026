/* =========================================================================
   abilities.js — Nova, Lightning & the gem-energy economy (SPEC-ABILITIES,
   subsystem #5). THIS FILE, PHASE 2: the FOUNDATION only.

   Built here: the gem-energy accounting (addGemEnergy, A6/§3), the cooldown
   timers (novaCd/lightningCd) + their per-frame tick (updateAbilities), the
   init/reset (initAbilities), the barrel-detonation seam (A8), and the
   registration of the two ability handlers into player.js's registerAbility
   seam. onNova/onLightning are NO-OP STUBS this phase — Nova ring behaviour
   (Phase 4) and Lightning cast (Phase 3) fill their bodies later; the
   registration is by reference, so it stays correct as the bodies grow.

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
   PHASE 2: ticks both cooldowns down by dt, floored at 0. The Nova ring pass
   (expand → enemy hits → projectile erase → dissipate → sweepDeadEnemies)
   lands in Phase 4 at the marked TODO. */
export function updateAbilities(dt) {
  novaCd = Math.max(0, novaCd - dt);
  lightningCd = Math.max(0, lightningCd - dt);

  G.novas ||= [];      // lazy-init: first touch of the ring array (A9)
  // Phase 4: Nova ring pass — for each ring in G.novas: prevR=r; r+=expand·dt;
  // enemy swept-wavefront hits (A3/A4/A2/A1); projectile erase (A10); dissipate
  // at health<=0 or r>=radiusCap (emit ability:cast); then sweepDeadEnemies() once.
}

/* ---- Ability handlers (registered at module load, §7) --------------------
   onNova (Phase 4) is a NO-OP STUB this phase. onLightning (Phase 3, below) is
   FILLED. The registration is by REFERENCE, so filling a body needs no
   re-registration. player.js edge-triggers them on the rising input edge and
   only when not STUNNED (its tryAbilities gate). */
function onNova() {}

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
export { onLightning as __onLightning };
