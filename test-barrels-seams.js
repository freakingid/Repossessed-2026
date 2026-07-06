/* test-barrels-seams.js — headless smoke tests for SPEC-BARRELS Phase 1,
   the config + enabling edits only (barrels.js NOT built yet):
     - config.js   CFG.BARREL block (§2.3): hp/r/kick/shrapnel/explosion/light/LETHAL
     - enemies.js  `export { spawnerDeathSweep as sweepDeadSpawners }` (B9)
     - enemies.js  the two detonateBarrelsInRadius call sites (Wraith EXPLODE,
       Lobber lob splat) now pass a 5th damage argument (B10) — inert until the
       seam is filled by SPEC-BARRELS Phase 2, but must not break the suite.
   Exercises the REAL modules, never inlined copies. Pure logic, no canvas.
   Run: node test-barrels-seams.js
*/

// --- Minimal browser-global stubs (defensive; house headless style) ----------
globalThis.window ||= globalThis;
globalThis.document ||= { createElement: () => ({ getContext: () => ({}) }) };
globalThis.AudioContext ||= function () {};

import { CFG } from "./src/config.js";
import { G } from "./src/state.js";
import { tileCenter } from "./src/world.js";
import { installNav } from "./src/nav.js";
import { initPlayer } from "./src/player.js";
import { clearNavigators } from "./src/enemies-ai.js";
import {
  sweepDeadSpawners, tickEnemies, makeFireWraith, registerBarrelDetonation,
} from "./src/enemies.js";
import { loadLevel, registerEmit } from "./src/level-loader.js";

let passed = 0, failed = 0;
function check(name, ok) {
  if (ok) { passed++; } else { failed++; console.error(`FAIL: ${name}`); }
}
function throws(name, fn) {
  let threw = false;
  try { fn(); } catch { threw = true; }
  if (threw) { passed++; } else { failed++; console.error(`FAIL (expected throw): ${name}`); }
}

registerEmit(() => {});
installNav();

const OPEN_ROOM = [
  "###############",
  "#.............#",
  "#.............#",
  "#.............#",
  "#.............#",
  "#.............#",
  "#.............#",
  "#.............#",
  "###############",
];

function loadRoom(tiles) {
  loadLevel({
    id: "barrel-seams-room", name: "BarrelSeamsRoom",
    tiles,
    zones: [{ role: "combat", x: 1, y: 1, w: tiles[0].length - 2, h: tiles.length - 2 }],
    placements: [
      { type: "player", x: 1, y: 1 },
      { type: "exit", x: tiles[0].length - 2, y: tiles.length - 2 },
    ],
    spawnRules: [],
  });
}

function resetWorldState() {
  clearNavigators();
  G.shots = []; G.enemies = []; G.pickups = [];
  G.score = 0;
  G.ramp = { enemySpeedMult: 1 };
  initPlayer();
  G.hp = G.maxHp;
  G.player.iframe = 0;
  G.player.loco = "NORMAL";
  G.player.carry = null;
}

/* ========================================================================= *
   1. config.js — CFG.BARREL block (§2.3): expected keys/values, spot-checked
 * ========================================================================= */
{
  check("CFG.BARREL exists", CFG.BARREL != null && typeof CFG.BARREL === "object");
  check("BARREL.hp === 4", CFG.BARREL.hp === 4);
  check("BARREL.r === 14", CFG.BARREL.r === 14);
  check("BARREL.LETHAL === 1e9", CFG.BARREL.LETHAL === 1e9);

  const kick = CFG.BARREL.kick;
  check("BARREL.kick exists", kick != null && typeof kick === "object");
  check("kick.speed === 224", kick.speed === 224);
  check("kick.friction === 2.0", kick.friction === 2.0);
  check("kick.bounce === 0.6", kick.bounce === 0.6);
  check("kick.stopSpeed === 30", kick.stopSpeed === 30);
  check("kick.impactSpeed === 96", kick.impactSpeed === 96);
  check("kick.impactDmg === 1", kick.impactDmg === 1);
  check("kick.impactSelfHp === 1", kick.impactSelfHp === 1);
  check("kick.impactSlow === 0.40", kick.impactSlow === 0.40);

  const shrapnel = CFG.BARREL.shrapnel;
  check("BARREL.shrapnel exists", shrapnel != null && typeof shrapnel === "object");
  check("shrapnel.count === 8", shrapnel.count === 8);
  check("shrapnel.jitter === 0.2094", shrapnel.jitter === 0.2094);
  check("shrapnel.dmg === 1", shrapnel.dmg === 1);
  check("shrapnel.health === 2", shrapnel.health === 2);
  check("shrapnel.speed === 256", shrapnel.speed === 256);
  check("shrapnel.lifespan === 1.2", shrapnel.lifespan === 1.2);
  check("shrapnel.cratePush === 16", shrapnel.cratePush === 16);

  const explosion = CFG.BARREL.explosion;
  check("BARREL.explosion exists", explosion != null && typeof explosion === "object");
  check("explosion.hitStopFrames === 4", explosion.hitStopFrames === 4);
  check("explosion.shakeDur === 0.25", explosion.shakeDur === 0.25);
  check("explosion.shakeFullTiles === 3", explosion.shakeFullTiles === 3);
  check("explosion.shakeZeroTiles === 12", explosion.shakeZeroTiles === 12);
  check("explosion.scorchFade === 8", explosion.scorchFade === 8);
  check("explosion.chainCallout === 3", explosion.chainCallout === 3);

  const light = CFG.BARREL.light;
  check("BARREL.light exists", light != null && typeof light === "object");
  check("light.smolder === 2.0", light.smolder === 2.0);
  check("light.burning === 3.0", light.burning === 3.0);
  check("light.raging === 4.5", light.raging === 4.5);
  check("light.flash === 8.0", light.flash === 8.0);
}

/* ========================================================================= *
   2. enemies.js — spawnerDeathSweep is exported under the alias
      sweepDeadSpawners (B9); sweeps an hp<=0 spawner (drops gems, nav-dirty)
 * ========================================================================= */
{
  check("sweepDeadSpawners is imported as a function", typeof sweepDeadSpawners === "function");

  loadLevel({
    id: "test-barrel-seams", name: "Test",
    tiles: ["#####", "#...#", "#...#", "#...#", "#####"],
    zones: [{ role: "combat", x: 1, y: 1, w: 3, h: 3 }],
    placements: [
      { type: "player", x: 1, y: 1 },
      { type: "exit", x: 3, y: 3 },
    ],
    links: [],
    spawnRules: [],
  });

  G.pickups = []; G.score = 0;
  const dead = { type: "spawner", x: 64, y: 64, r: 16, hp: 0, points: 300, gems: 3, _cause: "player-bullet" };
  const live = { type: "spawner", x: 96, y: 96, r: 16, hp: 6, points: 300, gems: 3 };
  G.spawners = [dead, live];

  const beforePickups = G.pickups.length;
  sweepDeadSpawners();

  check("sweepDeadSpawners removes the hp<=0 spawner", !G.spawners.includes(dead));
  check("sweepDeadSpawners keeps the live spawner", G.spawners.includes(live) && G.spawners.length === 1);
  check("sweepDeadSpawners drops gems", G.pickups.length - beforePickups === dead.gems);
  check("sweepDeadSpawners awards points (player-bullet)", G.score === dead.points);
}

/* ========================================================================= *
   3. enemies.js — the two detonateBarrelsInRadius call sites now pass a 5th
      damage argument (B10); the registered seam is still the no-op default
      and simply ignores the extra arg, so this stays inert.
 * ========================================================================= */
{
  loadRoom(OPEN_ROOM);
  resetWorldState();
  let barrelCall = null;
  registerBarrelDetonation((x, y, r, cause, damage) => { barrelCall = { x, y, r, cause, damage }; });

  // Fire-Wraith EXPLODE call site (mirrors test-enemies-wraith.js's EXPLODE case).
  G.player.x = tileCenter(4, 4).x;
  G.player.y = tileCenter(4, 4).y;
  const w = makeFireWraith({ type: "fireWraith", x: 5, y: 4 });
  G.enemies.push(w);
  w.wraith = { state: "flash", flashT: 1 / 120, explode: false };

  tickEnemies(1 / 60);

  check("Wraith EXPLODE call site fires the barrel seam", barrelCall !== null && barrelCall.cause === "wraith-aoe");
  check("Wraith EXPLODE passes explodeDmg as the 5th arg",
    barrelCall && barrelCall.damage === CFG.ENEMY.fireWraith.explodeDmg);

  // Restore the no-op default so later suites aren't affected by this test's
  // registration (this test file owns the only registerBarrelDetonation call
  // in the process — running standalone is the house convention).
  registerBarrelDetonation(() => {});
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
