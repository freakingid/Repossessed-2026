/* test-projectiles.js — headless smoke tests for projectiles.js (SPEC-PLAYER
   Phase 7: shot motion, range expiry, two-source ricochet). No canvas.

   Exercises the REAL modules (config/state/world/projectiles), not inlined
   copies. projectiles.js imports config/state/world only — no browser globals
   are touched, so no stubs are needed. Run: node test-projectiles.js
*/
import { CFG } from "./src/config.js";
import { G } from "./src/state.js";
import { loadTileGrid, isWall } from "./src/world.js";
import { makeShot, updateShots } from "./src/projectiles.js";

let passed = 0, failed = 0;
function check(name, ok) {
  if (ok) { passed++; } else { failed++; console.error(`FAIL: ${name}`); }
}
const T = CFG.TILE;
const center = (t) => (t + 0.5) * T;

// All-floor room with a solid border wall (cols × rows).
function openWorld(cols, rows) {
  const tiles = [];
  for (let y = 0; y < rows; y++) {
    let row = "";
    for (let x = 0; x < cols; x++)
      row += (x === 0 || y === 0 || x === cols - 1 || y === rows - 1) ? "#" : ".";
    tiles.push(row);
  }
  loadTileGrid(tiles);
}
// Run updateShots until the given shot leaves G.shots or `stop(s)` is true,
// capped so a bug can't hang the suite. Returns frames elapsed.
function runUntil(s, stop, dt = 0.02, cap = 2000) {
  let f = 0;
  while (f < cap && G.shots.includes(s) && !stop(s)) { updateShots(dt); f++; }
  return f;
}

/* ========================================================================= *
   1. Range expiry — a shot fizzles at CFG.SHOT.range (224 px)
 * ========================================================================= */
openWorld(20, 5);
G.crates = [];
{
  const s = makeShot({ x: center(1), y: center(1), vx: CFG.SHOT.speed, vy: 0, r: CFG.SHOT.r, dmg: 1, owner: "player", bounce: false });
  G.shots = [s];
  runUntil(s, () => false);                         // run until removed
  check("shot expires at ~CFG.SHOT.range (224 px)",
    s.traveled >= CFG.SHOT.range && s.traveled < CFG.SHOT.range + CFG.SHOT.speed * 0.02);
  check("range expiry, not a wall hit (final tile is floor)",
    !isWall((s.x / T) | 0, (s.y / T) | 0));
  check("shot removed from G.shots on expiry", !G.shots.includes(s));
}

/* ========================================================================= *
   2. Non-bounce shot dies on first wall — and does NOT ricochet off it
 * ========================================================================= */
loadTileGrid([
  "##########",
  "#....#...#",   // interior wall column at tile x=5
  "##########",
]);
G.crates = [];
{
  const s = makeShot({ x: center(1), y: center(1), vx: CFG.SHOT.speed, vy: 0, r: CFG.SHOT.r, dmg: 1, owner: "player", bounce: false });
  G.shots = [s];
  runUntil(s, () => false);
  check("non-bounce shot dies on first wall (before range)",
    !G.shots.includes(s) && s.traveled < CFG.SHOT.range);
  check("non-bounce shot does NOT ricochet off a wall (vx never reversed)", s.vx > 0);
}

/* ========================================================================= *
   3. Bounce power-up shot reflects off a wall (per-axis), keeps owner/dmg,
      range not reset, bounceCount++
 * ========================================================================= */
loadTileGrid([
  "##########",
  "#....#...#",
  "##########",
]);
G.crates = [];
{
  const s = makeShot({ x: center(1), y: center(1), vx: CFG.SHOT.speed, vy: 0, r: CFG.SHOT.r, dmg: 1, owner: "player", bounce: true });
  G.shots = [s];
  const distToWall = center(5) - center(1);           // ~ where it should turn around
  runUntil(s, (sh) => sh.vx < 0);                     // until it reflects
  check("bounce shot reflects off a wall (vx reversed)", s.vx < 0);
  check("bounce wall ricochet retains owner", s.owner === "player");
  check("bounce wall ricochet retains dmg", s.dmg === 1);
  check("bounce increments bounceCount", s.bounceCount >= 1);
  check("bounce shot survives wall contact (not removed)", G.shots.includes(s));
  check("range NOT reset by a bounce (traveled kept accumulating)", s.traveled > distToWall * 0.5);
}

/* ========================================================================= *
   4. Bounce shot reflects off a fixture crate — keeps owner/dmg, survives
 * ========================================================================= */
openWorld(12, 5);
{
  G.crates = [{ type: "crate", x: center(5), y: center(1) }];
  const s = makeShot({ x: center(1), y: center(1), vx: CFG.SHOT.speed, vy: 0, r: CFG.SHOT.r, dmg: 1, owner: "player", bounce: true });
  G.shots = [s];
  runUntil(s, (sh) => sh.vx < 0);
  check("bounce shot reflects off a fixture crate (vx reversed)", s.vx < 0);
  check("crate ricochet retains owner/dmg", s.owner === "player" && s.dmg === 1);
  check("crate ricochet: shot survives (crate-always reflect)", G.shots.includes(s));
}

/* ========================================================================= *
   5. Non-bounce shot ALSO ricochets off a crate (crate-always rule)
 * ========================================================================= */
openWorld(12, 5);
{
  G.crates = [{ type: "crate", x: center(5), y: center(1) }];
  const s = makeShot({ x: center(1), y: center(1), vx: CFG.SHOT.speed, vy: 0, r: CFG.SHOT.r, dmg: 1, owner: "player", bounce: false });
  G.shots = [s];
  runUntil(s, (sh) => sh.vx < 0);
  check("non-bounce shot ricochets off a crate (crate-always, even without Bounce)",
    s.vx < 0 && G.shots.includes(s));
  check("non-bounce crate ricochet retains owner/dmg", s.owner === "player" && s.dmg === 1);
  check("non-bounce crate ricochet does NOT increment bounceCount (§8 asymmetry)",
    s.bounceCount === 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
