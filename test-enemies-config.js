/* test-enemies-config.js — headless smoke tests for SPEC-ENEMIES Phase 1
   (CFG.ENEMY/CFG.GEM data + the three shipped-file seam edits: projectiles.js
   maxTravel/effect, player.js applyEntangle, level-loader.js ENTITY_ARRAY +
   G.ebolts). Pure logic, no canvas/render — exercises the REAL modules, not
   inlined copies. Run: node test-enemies-config.js
*/
import { CFG } from "./src/config.js";
import { G } from "./src/state.js";
import { loadTileGrid, isWall } from "./src/world.js";
import { makeShot, updateShots } from "./src/projectiles.js";
import { initPlayer, applyEntangle } from "./src/player.js";
import {
  loadLevel, registerEntityFactory,
} from "./src/level-loader.js";

let passed = 0, failed = 0;
function check(name, ok) {
  if (ok) { passed++; } else { failed++; console.error(`FAIL: ${name}`); }
}
const T = CFG.TILE;
const center = (t) => (t + 0.5) * T;

function hasInfinity(obj, seen = new Set()) {
  if (obj === Infinity || obj === -Infinity) return true;
  if (obj === null || typeof obj !== "object") return false;
  if (seen.has(obj)) return false;
  seen.add(obj);
  for (const v of Object.values(obj)) if (hasInfinity(v, seen)) return true;
  return false;
}

/* ========================================================================= *
   1. CFG.ENEMY / CFG.GEM config sanity (SPEC-ENEMIES §9)
 * ========================================================================= */
{
  const looseTypes = ["ghost", "skeleton", "skeletonShooter", "lobber", "bat",
                       "spider", "zombie", "fireWraith"];
  check("CFG.ENEMY has all 8 loose types + reaper + spawner",
    [...looseTypes, "reaper", "spawner"].every(t => CFG.ENEMY[t] != null));

  // Spider has no base speedMul — its movement is fully described by the
  // burst/pause FSM (burstMul/burstDur/pauseDur/retreatDur), SPEC-ENEMIES §5/§6.1.6.
  let everyTypeHasSpeedOrIsStatic = true;
  for (const t of [...looseTypes, "reaper"]) {
    if (t === "spider") continue;
    if (typeof CFG.ENEMY[t].speedMul !== "number") { everyTypeHasSpeedOrIsStatic = false; console.error(`${t} missing speedMul`); }
  }
  check("every mover type (except spider's FSM-only speed) has a speedMul", everyTypeHasSpeedOrIsStatic);
  check("spawner row has static fields (hp/points/gems/r/emerge/firstDelay)",
    typeof CFG.ENEMY.spawner.hp === "number" &&
    typeof CFG.ENEMY.spawner.emerge === "number" &&
    typeof CFG.ENEMY.spawner.firstDelay === "number");

  check("CFG.ENEMY / CFG.GEM contain no Infinity", !hasInfinity(CFG.ENEMY) && !hasInfinity(CFG.GEM));
  check("CFG.GEM.energy is a finite number", typeof CFG.GEM.energy === "number");

  // E5 guard: CFG.ENEMY loose-type keys == CFG.PLAN introduction element names
  // that are enemy elements (i.e. every loose type above must be a real Plan
  // element name — exact camelCase match, not snake_case).
  const planElements = new Set();
  for (const intro of CFG.PLAN.introductions) for (const el of intro.elements) planElements.add(el);
  check("CFG.ENEMY loose-type keys equal CFG.PLAN introduction element names (E5 guard)",
    looseTypes.every(t => planElements.has(t)) && planElements.has("reaper"));
}

/* ========================================================================= *
   2. projectiles.js — makeShot carries maxTravel/effect; defaults preserved
 * ========================================================================= */
{
  const s1 = makeShot({ x: 0, y: 0, vx: 1, vy: 0, r: 6, dmg: 0, owner: "enemy", maxTravel: 192, effect: "entangle" });
  check("makeShot carries maxTravel", s1.maxTravel === 192);
  check("makeShot carries effect", s1.effect === "entangle");

  const s2 = makeShot({ x: 0, y: 0, vx: 1, vy: 0, r: 6, dmg: 1, owner: "player" });
  check("makeShot without maxTravel/effect defaults effect to 'damage'", s2.effect === "damage");
  check("makeShot without maxTravel/effect leaves maxTravel undefined", s2.maxTravel === undefined);
}

/* ========================================================================= *
   3. updateShots — expires at its own maxTravel when set, else CFG.SHOT.range
 * ========================================================================= */
{
  // Open floor room, no walls in the way for the travel distances used here.
  const cols = 40, rows = 5;
  const tiles = [];
  for (let y = 0; y < rows; y++) {
    let row = "";
    for (let x = 0; x < cols; x++) row += (x === 0 || y === 0 || x === cols - 1 || y === rows - 1) ? "#" : ".";
    tiles.push(row);
  }
  loadTileGrid(tiles);
  G.crates = [];

  const capped = makeShot({ x: center(1), y: center(2), vx: 256, vy: 0, r: 6, dmg: 2, owner: "enemy", maxTravel: 192, effect: "damage" });
  const uncapped = makeShot({ x: center(1), y: center(2), vx: 256, vy: 0, r: 6, dmg: 1, owner: "player" });
  G.shots = [capped, uncapped];

  let frames = 0;
  while (frames < 500 && (G.shots.includes(capped) || G.shots.includes(uncapped))) {
    if (!G.shots.includes(capped) && G.shots.includes(uncapped)) break; // capped already gone, uncapped still flying — enough info
    updateShots(0.02);
    frames++;
  }
  check("a maxTravel:192 shot expires before a range-224 default would",
    !G.shots.includes(capped) && G.shots.includes(uncapped));

  // Drain the uncapped shot separately to confirm it expires at CFG.SHOT.range.
  while (frames < 1000 && G.shots.includes(uncapped)) { updateShots(0.02); frames++; }
  check("a shot with no maxTravel expires at CFG.SHOT.range",
    !G.shots.includes(uncapped) && uncapped.traveled >= CFG.SHOT.range);
}

/* ========================================================================= *
   4. player.js — applyEntangle sink (E7)
 * ========================================================================= */
{
  G.player = null;
  initPlayer();
  const p = G.player;
  p.entangle = 1.0;
  p.entangleAngle = 0.7;
  p.iframe = 0;

  applyEntangle(0.5);
  check("applyEntangle does not lower entangle below its current value", p.entangle === 1.0);

  applyEntangle(2.5);
  check("applyEntangle raises entangle to the max of current/argument", p.entangle === 2.5);
  check("applyEntangle resets entangleAngle to null", p.entangleAngle === null);
  check("applyEntangle does not set/alter iframe (0-damage effect)", p.iframe === 0);
}

/* ========================================================================= *
   5. level-loader.js — clearTransient resets G.ebolts to []
 * ========================================================================= */
{
  const baseDef = {
    id: "test-ebolts", name: "Test",
    tiles: ["#####", "#...#", "#...#", "#...#", "#####"],
    zones: [{ role: "combat", x: 1, y: 1, w: 3, h: 3 }],
    placements: [
      { type: "player", x: 1, y: 1 },
      { type: "exit", x: 3, y: 3 },
    ],
    links: [],
    spawnRules: [],
  };
  G.ebolts = [{ stale: true }];
  loadLevel(baseDef);
  check("clearTransient resets G.ebolts to an empty array",
    Array.isArray(G.ebolts) && G.ebolts.length === 0);
}

/* ========================================================================= *
   6. level-loader.js — ENTITY_ARRAY routes the 8 loose enemy types (E5)
 * ========================================================================= */
{
  registerEntityFactory("ghost", (p) => ({ type: "ghost", x: p.x * T + T / 2, y: p.y * T + T / 2 }));
  const def = {
    id: "test-ghost-route", name: "Test",
    tiles: ["#####", "#...#", "#...#", "#...#", "#####"],
    zones: [{ role: "combat", x: 1, y: 1, w: 3, h: 3 }],
    placements: [
      { type: "player", x: 1, y: 1 },
      { type: "exit", x: 3, y: 3 },
      { type: "ghost", x: 2, y: 2 },
    ],
    links: [],
    spawnRules: [],
  };
  loadLevel(def);
  check("a placed 'ghost' entity lands in G.enemies (ENTITY_ARRAY routes loose types)",
    G.enemies.some(e => e.type === "ghost"));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
