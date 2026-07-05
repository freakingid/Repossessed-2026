// test-world.js — headless smoke test, no canvas (CLAUDE.md convention).
import { CFG } from "./src/config.js";
import { G } from "./src/state.js";
import {
  loadTileGrid, isWall, blocksLOS, registerTileStateResolver,
  moveBody, bodyHitsBlocker,
} from "./src/world.js";

let passed = 0, failed = 0;

function check(name, ok) {
  if (ok) { passed++; }
  else { failed++; console.error(`FAIL: ${name}`); }
}

function throws(name, fn) {
  try { fn(); check(name, false); }
  catch (e) { check(name, true); }
}

// --- static isWall/blocksLOS for each tile char --------------------------
loadTileGrid([
  "#######",
  "#.T.o.#",
  "#D.d._#",
  "#.....#",
  "#######",
]);

check("'.' floor is not a wall",            !isWall(1, 1));
check("'.' floor does not block LOS",       !blocksLOS(1, 1));
check("'#' wall is a wall",                  isWall(0, 0));
check("'#' wall blocks LOS",                 blocksLOS(0, 0));
check("'T' tombstone is a wall",             isWall(2, 1));
check("'T' tombstone blocks LOS",            blocksLOS(2, 1));
check("'o' pillar is a wall",                isWall(4, 1));
check("'o' pillar blocks LOS",               blocksLOS(4, 1));
check("'D' locked door (no resolver) is a wall (static fallback)", isWall(1, 2));
check("'D' locked door (no resolver) blocks LOS (static fallback)", blocksLOS(1, 2));
check("'d' plate door (no resolver) is a wall (static fallback)", isWall(3, 2));
check("'_' plate is not a wall",            !isWall(5, 2));
check("'_' plate does not block LOS",       !blocksLOS(5, 2));
check("out-of-bounds is a wall",             isWall(-1, 0));
check("out-of-bounds blocks LOS",            blocksLOS(100, 100));

// --- resolver seam: stub reporting a 'd' cell open/closed ----------------
let doorOpen = false;
registerTileStateResolver((tx, ty) => {
  if (tx === 3 && ty === 2) return { kind: "door", open: doorOpen };
  return null;
});

check("'d' cell reads non-solid when resolver reports open", (doorOpen = true, !isWall(3, 2)));
check("'d' cell reads non-LOS-blocking when resolver reports open", !blocksLOS(3, 2));
doorOpen = false;
check("'d' cell reverts to solid when resolver reports closed", isWall(3, 2));
check("'d' cell reverts to LOS-blocking when resolver reports closed", blocksLOS(3, 2));
check("cells the resolver doesn't cover still use the static flag", isWall(0, 0));

registerTileStateResolver(null);

// --- loadTileGrid sets CFG.COLS/ROWS -------------------------------------
loadTileGrid([
  "####",
  "#..#",
  "####",
]);
check("loadTileGrid sets CFG.COLS", CFG.COLS === 4);
check("loadTileGrid sets CFG.ROWS", CFG.ROWS === 3);

throws("loadTileGrid throws on ragged grid", () => {
  loadTileGrid(["####", "#..#", "###"]);
});
throws("loadTileGrid throws on unknown tile char", () => {
  loadTileGrid(["####", "#Z.#", "####"]);
});

// --- moveBody: per-axis slide against walls ------------------------------
loadTileGrid([
  "#######",
  "#.....#",
  "#.##..#",
  "#.....#",
  "#######",
]);
{
  // Diagonal step into the L-corner at (2,2)/(2,1)-(1,2) walls: moving
  // toward (2,2) from (1,1)-ish should slide along the free axis, not pass
  // through the corner.
  const b = { x: 1.5 * CFG.TILE, y: 1.5 * CFG.TILE, r: 8 };
  const startX = b.x, startY = b.y;
  moveBody(b, CFG.TILE, CFG.TILE); // toward the wall block at tx=2,ty=2 and tx=2,ty=1(open)/tx=1,ty=2(open)
  check("moveBody slides along one axis at a wall corner (doesn't pass through)",
    (b.x !== startX + CFG.TILE) || (b.y !== startY + CFG.TILE));
}

// --- bodyHitsBlocker: synthetic G.spawners, filter policy ----------------
G.spawners = [{ x: 3.5 * CFG.TILE, y: 1.5 * CFG.TILE }];
G.crates = []; G.barrels = [];
check("bodyHitsBlocker: overlapping spawner blocked when filter accepts",
  bodyHitsBlocker(3.5 * CFG.TILE, 1.5 * CFG.TILE, 8, () => true));
check("bodyHitsBlocker: overlapping spawner NOT blocked when filter rejects",
  !bodyHitsBlocker(3.5 * CFG.TILE, 1.5 * CFG.TILE, 8, () => false));
check("bodyHitsBlocker: no filter ⇒ never blocked",
  !bodyHitsBlocker(3.5 * CFG.TILE, 1.5 * CFG.TILE, 8, undefined));

// --- moveBody with a blockerFilter matching a crate at a tile -------------
G.crates = [{ x: 2.5 * CFG.TILE, y: 1.5 * CFG.TILE }];
{
  const b = { x: 1.5 * CFG.TILE, y: 1.5 * CFG.TILE, r: 8 };
  moveBody(b, CFG.TILE, 0, () => true);
  check("moveBody reverts into a crate tile when filter matches",
    b.x === 1.5 * CFG.TILE);

  const b2 = { x: 1.5 * CFG.TILE, y: 1.5 * CFG.TILE, r: 8 };
  moveBody(b2, CFG.TILE, 0, () => false);
  check("moveBody passes through when filter rejects the crate",
    b2.x === 2.5 * CFG.TILE);
}
G.crates = []; G.barrels = []; G.spawners = [];

// --- world.js must not import level-loader.js ----------------------------
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("./src/world.js", import.meta.url), "utf8");
check("world.js does not import level-loader.js", !/from\s+["'].*level-loader\.js["']/.test(src));
check("world.js imports only config.js and state.js", (() => {
  const imports = [...src.matchAll(/from\s+["'](.+?)["']/g)].map(m => m[1]);
  return imports.every(p => p === "./config.js" || p === "./state.js");
})());

// --- conveyor/destructible symbols are gone ------------------------------
check("world.js has no bakeConveyors", !/bakeConveyors/.test(src));
check("world.js has no isDestructible", !/isDestructible/.test(src));
check("world.js has no destroyShelf", !/destroyShelf/.test(src));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
