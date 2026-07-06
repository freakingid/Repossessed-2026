/* test-enemies-nav.js — headless smoke tests for the nav CONSUMER layer in
   enemies-ai.js (SPEC-ENEMIES §3, §9). Scope: waypoint-follow steering +
   direct-steer fallback (§3.3/§3.4), round-robin repath budget (§3.2), the
   E3 dirty-repath gate, the R1 single-consumer contract, and R6 import
   discipline. Pure logic — synthetic navigators {x,y,r,speed,face,nav:{}} and
   stub movers; no render/canvas import.

   enemies-ai.js's import graph is config/world/nav(→level-loader), none of
   which touch canvas/audio/document, so no browser-global stubs are needed.
   Run: node test-enemies-nav.js
*/
import { CFG } from "./src/config.js";
import { G } from "./src/state.js";
import { tileCenter } from "./src/world.js";
import { loadLevel, markNavDirty } from "./src/level-loader.js";
import { installNav, consumeDirtyTiles, getNavVersion } from "./src/nav.js";
import {
  NAV_MASK,
} from "./src/nav.js";
import {
  addNavigator, removeNavigator, clearNavigators, scheduleRepaths, steerNavigator,
  __getRepathCount, __resetRepathCount, __rebuildPathTiles,
} from "./src/enemies-ai.js";
import { readFileSync } from "node:fs";

let passed = 0, failed = 0;
function check(name, ok) {
  if (ok) { passed++; } else { failed++; console.error(`FAIL: ${name}`); }
}

installNav();

// Stub movers (drivers): freeMover integrates with no collision; blockedMover
// is a wedged body that never moves (exercises the wpTimeout anti-wedge path).
const freeMover = (e, dx, dy) => { e.x += dx; e.y += dy; };
const blockedMover = () => {};

const wp = (tx, ty) => { const c = tileCenter(tx, ty); return { tx, ty, x: c.x, y: c.y }; };
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

/* ========================================================================= *
   §3.3 Waypoint-follow steering — monotonic advance on a straight corridor.
 * ========================================================================= */
clearNavigators();
{
  const e = { x: tileCenter(2, 2).x, y: tileCenter(2, 2).y, r: 12, speed: 600, face: 0, nav: {} };
  addNavigator(e, NAV_MASK.GROUND, freeMover);
  e.nav.path = [wp(3, 2), wp(4, 2), wp(5, 2)];
  e.nav.wpIndex = 0;
  e.nav.wpTimer = CFG.ENEMY.wpTimeout;
  __rebuildPathTiles(e);

  let prev = 0, monotonic = true, reached = false;
  for (let f = 0; f < 200; f++) {
    steerNavigator(e, { x: 0, y: 0 }, 0.05);   // player pos irrelevant while following a path
    if (e.nav.wpIndex < prev) monotonic = false;
    prev = e.nav.wpIndex;
    if (e.nav.wpIndex >= e.nav.path.length) { reached = true; break; }
  }
  check("corridor: wpIndex advances monotonically as dist <= arriveDist", monotonic);
  check("corridor: path exhausted (all waypoints consumed)", reached && e.nav.wpIndex === 3);
  removeNavigator(e);
}

/* ========================================================================= *
   §3.3 wpTimeout advances a WEDGED navigator (can't move, timer fires).
 * ========================================================================= */
clearNavigators();
{
  const e = { x: tileCenter(2, 2).x, y: tileCenter(2, 2).y, r: 12, speed: 600, face: 0, nav: {} };
  addNavigator(e, NAV_MASK.GROUND, blockedMover);
  e.nav.path = [wp(9, 2), wp(10, 2)];  // far away; never reached by distance
  e.nav.wpIndex = 0;
  e.nav.wpTimer = 0.1;                  // about to time out
  __rebuildPathTiles(e);
  const x0 = e.x, y0 = e.y;

  steerNavigator(e, { x: 0, y: 0 }, 0.05); // wpTimer 0.1 -> 0.05, no advance yet
  const advancedEarly = e.nav.wpIndex;
  steerNavigator(e, { x: 0, y: 0 }, 0.05); // wpTimer -> 0.0, timeout advances
  check("wpTimeout: no advance before timer expires", advancedEarly === 0);
  check("wpTimeout: advances wedged navigator when wpTimer <= 0", e.nav.wpIndex === 1);
  check("wpTimeout: wedged navigator never actually moved", e.x === x0 && e.y === y0);
  removeNavigator(e);
}

/* ========================================================================= *
   §3.4 Direct-steer fallback: findPath -> null (goal boxed) reduces player
   distance; findPath -> [] (same tile) steers to the pixel goal.
 * ========================================================================= */
clearNavigators();
{
  const player = { x: tileCenter(10, 2).x, y: tileCenter(10, 2).y };
  // null path — goal unreachable: direct-steer straight at the player.
  const eN = { x: tileCenter(2, 2).x, y: tileCenter(2, 2).y, r: 12, speed: 600, face: 99, nav: {} };
  addNavigator(eN, NAV_MASK.GROUND, freeMover);
  eN.nav.path = null;
  const before = dist(eN.x, eN.y, player.x, player.y);
  steerNavigator(eN, player, 0.05);
  const after = dist(eN.x, eN.y, player.x, player.y);
  check("null fallback: direct-steer reduces distance to player", after < before);
  check("null fallback: faces the player", Math.abs(eN.face - 0) < 1e-6);

  // [] path — already on the goal tile: steer to the player's pixel position.
  const eE = { x: tileCenter(2, 5).x, y: tileCenter(2, 5).y, r: 12, speed: 600, face: 99, nav: {} };
  addNavigator(eE, NAV_MASK.GROUND, freeMover);
  eE.nav.path = [];
  const b2 = dist(eE.x, eE.y, player.x, player.y);
  steerNavigator(eE, player, 0.05);
  const a2 = dist(eE.x, eE.y, player.x, player.y);
  check("[] fallback: steers toward the player's pixel position", a2 < b2);
  clearNavigators();
}

/* ========================================================================= *
   Scheduler tests need a loaded grid (findPath reads isWall + occupancy).
   Open 15x9 room.
 * ========================================================================= */
const room = {
  id: "ai-room", name: "AiRoom",
  tiles: [
    "###############",
    "#.............#",
    "#.............#",
    "#.............#",
    "#.............#",
    "#.............#",
    "#.............#",
    "#.............#",
    "###############",
  ],
  zones: [{ role: "combat", x: 1, y: 1, w: 13, h: 7 }],
  placements: [
    { type: "player", x: 1, y: 1 },
    { type: "exit",   x: 13, y: 7 },
  ],
  spawnRules: [],
};
loadLevel(room);

/* ========================================================================= *
   §3.2 Round-robin budget: N > budget eligible navigators => at most `budget`
   findPath calls per frame; cursor advances so all are serviced within
   ceil(N/budget) frames; unserviced navigators keep their prior path.
 * ========================================================================= */
clearNavigators();
{
  const player = { x: tileCenter(7, 4).x, y: tileCenter(7, 4).y };
  const N = 6;
  const navs = [];
  for (let i = 0; i < N; i++) {
    const c = tileCenter(1 + i, 1);
    const e = { x: c.x, y: c.y, r: 12, speed: 100, face: 0, nav: {} };
    addNavigator(e, NAV_MASK.GROUND, freeMover);
    e.nav.path = { sentinel: i };   // a marker (not a real path) to prove identity is kept
    navs.push(e);
  }
  __resetRepathCount();
  scheduleRepaths(player, 0.016);
  check("budget: at most repathBudgetPerFrame findPath calls per frame",
    __getRepathCount() === CFG.ENEMY.repathBudgetPerFrame);
  // cursor started at 0 => navs[0..3] serviced, navs[4],navs[5] not.
  check("budget: unserviced navigator keeps its prior path (identity)",
    navs[4].nav.path && navs[4].nav.path.sentinel === 4 &&
    navs[5].nav.path && navs[5].nav.path.sentinel === 5);

  scheduleRepaths(player, 0.016);   // frame 2 — remaining 2 serviced, already-serviced still on floor
  check("budget: all N serviced within ceil(N/budget) frames",
    __getRepathCount() === N);
  clearNavigators();
}

/* ========================================================================= *
   E3 Dirty repath: dirtying a tile on a navigator's pathTiles forces exactly
   that navigator to repath; one whose path doesn't cross the tile does not.
 * ========================================================================= */
clearNavigators();
{
  const player = { x: tileCenter(7, 4).x, y: tileCenter(7, 4).y };
  const goalTile = { tx: 7, ty: 4 };

  const A = { x: tileCenter(2, 3).x, y: tileCenter(2, 3).y, r: 12, speed: 100, face: 0, nav: {} };
  addNavigator(A, NAV_MASK.GROUND, freeMover);
  A.nav.path = [wp(5, 3), wp(6, 3)];      // crosses tile (5,3)
  A.nav.wpIndex = 0; A.nav.goalTile = { ...goalTile }; A.nav.repathTimer = 0;
  __rebuildPathTiles(A);

  const B = { x: tileCenter(2, 6).x, y: tileCenter(2, 6).y, r: 12, speed: 100, face: 0, nav: {} };
  addNavigator(B, NAV_MASK.GROUND, freeMover);
  B.nav.path = [wp(5, 6), wp(6, 6)];      // does NOT cross (5,3)
  B.nav.wpIndex = 0; B.nav.goalTile = { ...goalTile }; B.nav.repathTimer = 0;
  __rebuildPathTiles(B);

  const oldA = A.nav.path, oldB = B.nav.path;
  markNavDirty({ tx: 5, ty: 3 });          // bumps getNavVersion + queues the tile
  __resetRepathCount();
  scheduleRepaths(player, 0);

  check("dirty: exactly one repath fired (only the crossed navigator)", __getRepathCount() === 1);
  check("dirty: navigator whose path crosses the dirtied tile repathed", A.nav.path !== oldA);
  check("dirty: navigator whose path avoids the dirtied tile did NOT repath", B.nav.path === oldB);
  check("dirty: dirtyHit cleared on repath", A.nav.dirtyHit === false && B.nav.dirtyHit === false);
  clearNavigators();
}

/* ========================================================================= *
   R1 Single-consumer: two scheduler ticks in one frame drain
   consumeDirtyTiles ONCE (the second sees empty); the scheduler is the sole
   consumer, so an external drain after scheduling finds nothing.
 * ========================================================================= */
clearNavigators();
{
  const player = { x: tileCenter(7, 4).x, y: tileCenter(7, 4).y };
  const A = { x: tileCenter(2, 3).x, y: tileCenter(2, 3).y, r: 12, speed: 100, face: 0, nav: {} };
  addNavigator(A, NAV_MASK.GROUND, freeMover);
  A.nav.path = [wp(5, 3), wp(6, 3)];
  A.nav.wpIndex = 0; A.nav.goalTile = { tx: 7, ty: 4 }; A.nav.repathTimer = 0;
  __rebuildPathTiles(A);

  markNavDirty({ tx: 5, ty: 3 });
  __resetRepathCount();
  scheduleRepaths(player, 0);              // tick 1 — drains, A repaths
  const afterFirst = __getRepathCount();
  scheduleRepaths(player, 0);              // tick 2, same frame — version unchanged, no drain, no repath
  const afterSecond = __getRepathCount();

  check("R1: first scheduler tick repaths the dirtied navigator", afterFirst === 1);
  check("R1: second tick same frame does not re-repath (no double-drain)", afterSecond === 1);
  check("R1: scheduler is sole consumer — external drain after ticks is empty",
    consumeDirtyTiles().length === 0);
  clearNavigators();
}

/* ========================================================================= *
   R6 Import discipline: enemies-ai.js imports only the allowed set; nav/player/
   projectiles never import it back (one-way flow).
 * ========================================================================= */
{
  const src = readFileSync(new URL("./src/enemies-ai.js", import.meta.url), "utf8");
  const importLines = src.match(/^import .*$/gm) || [];
  const allowed = new Set(["./config.js", "./state.js", "./world.js", "./nav.js", "./projectiles.js"]);
  const importsOk = importLines.every(line => {
    const m = line.match(/from\s+["']([^"']+)["']/);
    return m && allowed.has(m[1]);
  });
  check("enemies-ai.js imports only config/state/world/nav/projectiles", importsOk);
  const forbids = importLines.some(l => /["']\.\/(player|combat|abilities|enemies)\.js["']/.test(l));
  check("enemies-ai.js imports no player/combat/abilities/enemies module", !forbids);

  for (const mod of ["nav.js", "player.js", "projectiles.js"]) {
    const s = readFileSync(new URL(`./src/${mod}`, import.meta.url), "utf8");
    check(`${mod} does not import enemies-ai.js (one-way flow, R6)`, !/enemies-ai/.test(s));
  }
  check("enemies-ai.js contains no literal Infinity (sentinel discipline)",
    !/\bInfinity\b/.test(src));
}

console.log(`\ntest-enemies-nav.js: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
