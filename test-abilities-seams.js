/* test-abilities-seams.js — headless smoke tests for SPEC-ABILITIES Phase 1,
   the four surgical ENABLING edits (abilities.js NOT built yet):
     - config.js    CFG.ABILITY block (§2.3): nova{} + lightning{} dials
     - enemies.js   `export { deathSweep as sweepDeadEnemies }` (A1)
     - player.js    `applyStun(seconds)` extends-not-shortens sink (A7)
     - level-loader.js  G.novas cleared on load (A9)
   Exercises the REAL modules, never inlined copies. Pure logic, no canvas.
   player.js's graph touches window ONLY inside input.js device glue, which these
   tests never call, so no browser stubs are strictly needed (same posture as
   test-player.js / test-enemies-combat.js). A minimal defensive stub is installed
   below anyway so the test survives an import-graph shift. Run: node test-abilities-seams.js
*/

// --- Minimal browser-global stubs (defensive; house headless style) ----------
globalThis.window ||= globalThis;
globalThis.document ||= { createElement: () => ({ getContext: () => ({}) }) };
globalThis.AudioContext ||= function () {};

import { CFG } from "./src/config.js";
import { G } from "./src/state.js";
import { initPlayer, applyStun } from "./src/player.js";
import { sweepDeadEnemies } from "./src/enemies.js";
import { loadLevel } from "./src/level-loader.js";

let passed = 0, failed = 0;
function check(name, ok) {
  if (ok) { passed++; } else { failed++; console.error(`FAIL: ${name}`); }
}
function throws(name, fn) {
  let threw = false;
  try { fn(); } catch { threw = true; }
  if (threw) { passed++; } else { failed++; console.error(`FAIL (expected throw): ${name}`); }
}

/* ========================================================================= *
   1. config.js — CFG.ABILITY block (§2.3): expected nova/lightning keys+values
 * ========================================================================= */
{
  check("CFG.ABILITY exists", CFG.ABILITY != null && typeof CFG.ABILITY === "object");

  const nova = CFG.ABILITY.nova;
  check("CFG.ABILITY.nova exists", nova != null && typeof nova === "object");
  check("nova.barCap === 100", nova.barCap === 100);
  check("nova.chargeCap === 2", nova.chargeCap === 2);
  check("nova.minBarToFire === 25", nova.minBarToFire === 25);
  check("nova.ringMaxHp === 50", nova.ringMaxHp === 50);
  check("nova.expandTilesPerSec === 12", nova.expandTilesPerSec === 12);
  check("nova.strokeTiles === 0.6", nova.strokeTiles === 0.6);
  check("nova.radiusCapTiles === 14", nova.radiusCapTiles === 14);
  check("nova.cooldown === 0.5", nova.cooldown === 0.5);
  check("nova.reaperDamage === 10", nova.reaperDamage === 10);
  check("nova.reaperRingCost === 20", nova.reaperRingCost === 20);
  // §2.3 nova has EXACTLY these 10 dials — no stray keys.
  check("nova has exactly the 10 spec'd keys",
    Object.keys(nova).sort().join(",") ===
    ["barCap","chargeCap","cooldown","expandTilesPerSec","minBarToFire",
     "radiusCapTiles","reaperDamage","reaperRingCost","ringMaxHp","strokeTiles"].join(","));

  const lit = CFG.ABILITY.lightning;
  check("CFG.ABILITY.lightning exists", lit != null && typeof lit === "object");
  check("lightning.radiusTiles === 5", lit.radiusTiles === 5);
  check("lightning.reaperDamage === 5", lit.reaperDamage === 5);
  check("lightning.cooldown === 10", lit.cooldown === 10);
  check("lightning.stunSeconds === 3", lit.stunSeconds === 3);
  // §2.3 lightning costs no gem energy — the null case is structural, no field.
  check("lightning has exactly the 4 spec'd keys (no energy cost field)",
    Object.keys(lit).sort().join(",") ===
    ["cooldown","radiusTiles","reaperDamage","stunSeconds"].join(","));

  // GEM.energy(=5) is referenced by §2.3's comment and must remain unchanged.
  check("CFG.GEM.energy still === 5 (unchanged by this edit)", CFG.GEM.energy === 5);
}

/* ========================================================================= *
   2. enemies.js — deathSweep is exported under the alias sweepDeadEnemies (A1)
 * ========================================================================= */
{
  check("sweepDeadEnemies is imported as a function", typeof sweepDeadEnemies === "function");

  // Behavior smoke: a dead (hp<=0) enemy is swept out of G.enemies via the
  // shared path; a live one stays. (Same body as deathSweep — alias, no logic change.)
  G.player = null;
  initPlayer();
  G.enemies = [
    { type: "ghost", x: 100, y: 100, r: 12, hp: 0, _cause: "player-nova", points: 0, gems: 0 },
    { type: "ghost", x: 200, y: 200, r: 12, hp: 5, points: 0, gems: 0 },
  ];
  G.pickups = []; G.floats = []; G.marks = [];
  const dead = G.enemies[0];
  const live = G.enemies[1];
  sweepDeadEnemies();
  check("sweepDeadEnemies removes the hp<=0 enemy", !G.enemies.includes(dead));
  check("sweepDeadEnemies keeps the live enemy", G.enemies.includes(live) && G.enemies.length === 1);
}

/* ========================================================================= *
   3. player.js — applyStun extends-not-shortens, no iframe/loco gate (A7)
 * ========================================================================= */
{
  G.player = null;
  initPlayer();
  const p = G.player;

  throws("applyStun with no player state throws before init (sanity of the sink)",
    () => { const save = G.player; G.player = null; try { applyStun(1); } finally { G.player = save; } });

  p.stun = 2;
  p.iframe = 0;
  const locoBefore = p.loco;

  applyStun(1);
  check("applyStun(1) does NOT shorten an existing stun of 2 (stays 2)", p.stun === 2);

  applyStun(3);
  check("applyStun(3) extends the stun to 3", p.stun === 3);

  check("applyStun sets no iframe (0-damage effect)", p.iframe === 0);
  check("applyStun does not gate/alter loco", p.loco === locoBefore);
}

/* ========================================================================= *
   4. level-loader.js — clearTransient resets G.novas to [] on load (A9)
 * ========================================================================= */
{
  const def = {
    id: "test-novas", name: "Test",
    tiles: ["#####", "#...#", "#...#", "#...#", "#####"],
    zones: [{ role: "combat", x: 1, y: 1, w: 3, h: 3 }],
    placements: [
      { type: "player", x: 1, y: 1 },
      { type: "exit", x: 3, y: 3 },
    ],
    links: [],
    spawnRules: [],
  };
  G.novas = [{ stale: true }];
  loadLevel(def);
  check("clearTransient resets G.novas to an empty array",
    Array.isArray(G.novas) && G.novas.length === 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
