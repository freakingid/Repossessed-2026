/* test-nav.js — headless smoke tests for nav.js Phase 1 (SPEC-PATHFINDING).
   Scope: mask predicates, mask-split occupancy (derived from live G, D3),
   dirty/version accounting, the blocker-sink seam, import discipline, and
   the Infinity sentinel grep. findPath is Phase 2 — not exercised here.

   nav.js's import graph is config/state/world/level-loader, none of which
   touch canvas/audio/document, so no browser-global stubs are needed.
   Run: node test-nav.js
*/
import { CFG } from "./src/config.js";
import { G } from "./src/state.js";
import { isWall } from "./src/world.js";
import { loadLevel, setPlatePressedAt, markNavDirty } from "./src/level-loader.js";
import {
  NAV_MASK, isNavBlocked, getNavVersion, consumeDirtyTiles, installNav, findPath,
} from "./src/nav.js";
import { readFileSync } from "node:fs";

let passed = 0, failed = 0;
function check(name, ok) {
  if (ok) { passed++; } else { failed++; console.error(`FAIL: ${name}`); }
}

installNav();

/* ========================================================================= *
   Mask predicates: GROUND wall/floor, closed/open plate-door round-trip.
 * ========================================================================= */
const doorDef = {
  id: "nav-door", name: "NavDoor",
  tiles: [
    "#########",
    "#...d...#",   // door 'd' at (4,1)
    "#.._....#",   // plate '_' at (3,2), linked
    "#.......#",
    "#########",
  ],
  zones: [],
  placements: [
    { type: "player", x: 1, y: 3 },
    { type: "exit",   x: 7, y: 3 },
    { type: "door",   x: 4, y: 1, id: "gate" },
    { type: "plate",  x: 3, y: 2, id: "pA" },
  ],
  links: [{ plate: "pA", door: "gate" }],
};
loadLevel(doorDef);

check("GROUND: wall tile blocked", isNavBlocked(0, 0, NAV_MASK.GROUND));
check("GROUND: open floor passable", !isNavBlocked(1, 1, NAV_MASK.GROUND));
check("GROUND: closed plate-door blocks", isNavBlocked(4, 1, NAV_MASK.GROUND));
setPlatePressedAt(3, 2, true);
check("GROUND: door open after linked plate press -> passable", !isNavBlocked(4, 1, NAV_MASK.GROUND));
setPlatePressedAt(3, 2, false);
check("GROUND: door closed again after plate release -> blocked", isNavBlocked(4, 1, NAV_MASK.GROUND));

check("PHANTOM: passes a wall tile", !isNavBlocked(0, 0, NAV_MASK.PHANTOM));
check("PHANTOM: passes a closed-door tile", !isNavBlocked(4, 1, NAV_MASK.PHANTOM));
check("PHANTOM: rejects OOB tile (negative)", isNavBlocked(-1, 0, NAV_MASK.PHANTOM));
check("PHANTOM: rejects OOB tile (>=COLS)", isNavBlocked(CFG.COLS, 0, NAV_MASK.PHANTOM));

/* ========================================================================= *
   Spawner occupancy (Q2 baseline, spec test 11): GROUND blocked, PHANTOM
   passes.
 * ========================================================================= */
const spawnerDef = {
  id: "nav-spawner", name: "NavSpawner",
  tiles: [
    "#######",
    "#.....#",
    "#.....#",
    "#.....#",
    "#######",
  ],
  zones: [{ role: "combat", x: 1, y: 1, w: 5, h: 3 }],
  placements: [
    { type: "player", x: 1, y: 1 },
    { type: "exit",   x: 5, y: 3 },
  ],
  spawnRules: [],
};
loadLevel(spawnerDef);
G.spawners.push({ type: "spawner", x: 3 * CFG.TILE + CFG.TILE / 2, y: 2 * CFG.TILE + CFG.TILE / 2, blocks: true });
markNavDirty({ tx: 3, ty: 2 }); // real callers (loader placement) always pair the push with a seam call
check("spawner: blocks GROUND", isNavBlocked(3, 2, NAV_MASK.GROUND));
check("spawner: passable to PHANTOM", !isNavBlocked(3, 2, NAV_MASK.PHANTOM));

/* ========================================================================= *
   Occupancy derives from live G (D3): seed a crate, splice it, verify.
 * ========================================================================= */
loadLevel(spawnerDef);
G.crates.push({ type: "crate", x: 2 * CFG.TILE + CFG.TILE / 2, y: 2 * CFG.TILE + CFG.TILE / 2, blocks: true });
markNavDirty({ tx: 2, ty: 2 }); // signal the seed, forcing a rebuild on next query
check("crate: blocks GROUND before splice", isNavBlocked(2, 2, NAV_MASK.GROUND));
check("crate: blocks PHANTOM before splice", isNavBlocked(2, 2, NAV_MASK.PHANTOM));
G.crates.splice(0, 1);
markNavDirty({ tx: 2, ty: 2 }); // real callers (carry system) always pair splice with markDirty
check("crate: no longer blocked after splice + markDirty", !isNavBlocked(2, 2, NAV_MASK.GROUND));
check("crate: no longer blocked (PHANTOM) after splice + markDirty", !isNavBlocked(2, 2, NAV_MASK.PHANTOM));

// registerBlocker is handed a whole entity but must be consumed purely as an
// invalidation signal (D3/R2) — an entity never pushed to any G array must
// not become a phantom blocker; a rebuild derived from G sees nothing there.
const fakeEntity = { type: "crate", x: 4 * CFG.TILE + CFG.TILE / 2, y: 2 * CFG.TILE + CFG.TILE / 2, blocks: true };
markNavDirty({ tx: 4, ty: 2 }); // force invalidation as if registerBlocker(fakeEntity) had fired
check("registerBlocker/markDirty with no backing G entry blocks nothing there",
  !isNavBlocked(4, 2, NAV_MASK.GROUND) && !!fakeEntity);

/* ========================================================================= *
   Version + dirty accounting.
 * ========================================================================= */
loadLevel(spawnerDef);
consumeDirtyTiles(); // drain whatever accumulated from earlier sections
const v0 = getNavVersion();
markNavDirty({ tx: 1, ty: 1 });
const v1 = getNavVersion();
check("getNavVersion strictly increases after markDirty", v1 > v0);
markNavDirty({ tx: 2, ty: 2 });
const v2 = getNavVersion();
check("getNavVersion strictly increases again", v2 > v1);
const dirty = consumeDirtyTiles();
check("consumeDirtyTiles returns exactly the accumulated tiles",
  dirty.length === 2 &&
  dirty.some(t => t.tx === 1 && t.ty === 1) &&
  dirty.some(t => t.tx === 2 && t.ty === 2));
check("consumeDirtyTiles clears after read", consumeDirtyTiles().length === 0);

/* ========================================================================= *
   installNav wiring: a loader-side door open/close reaches nav (version bump).
 * ========================================================================= */
loadLevel(doorDef);
const vBefore = getNavVersion();
setPlatePressedAt(3, 2, true);
const vAfter = getNavVersion();
check("installNav wiring: loader door-press bumps nav version", vAfter > vBefore);

/* ========================================================================= *
   findPath — Phase 2 grid A* (spec §10 tests 1-6, 9, 10). Pixel centers via
   px(t); synthetic maps built through loadLevel (rebuilds tile-state cleanly).
 * ========================================================================= */
const px = (t) => t * CFG.TILE + CFG.TILE / 2;
const openDef = (tiles) => ({
  id: "nav-fp", name: "NavFP", tiles, zones: [],
  placements: [
    { type: "player", x: 1, y: 1 },
    { type: "exit", x: tiles[0].length - 2, y: tiles.length - 2 },
  ],
});

// 1. Open-floor straight diagonal (GROUND): monotone, length == chebyshev.
loadLevel(openDef([
  "##########",
  "#........#",
  "#........#",
  "#........#",
  "#........#",
  "#........#",
  "#........#",
  "#........#",
  "#........#",
  "##########",
]));
{
  const p = findPath(px(1), px(1), px(8), px(8), NAV_MASK.GROUND);
  let ok = p.length === 7;
  for (let i = 0; i < p.length; i++) {
    if (p[i].tx !== i + 2 || p[i].ty !== i + 2) ok = false;      // pure diagonal, forced by chebyshev
    if (p[i].x !== px(p[i].tx) || p[i].y !== px(p[i].ty)) ok = false; // waypoint carries pixel center (D5)
  }
  check("findPath GROUND open-floor: monotone straight diagonal, length == chebyshev(7)", ok);
}

// 2 + 5 share one wall map. Straight diagonal (1,1)->(8,8) crosses wall (5,5).
const diagWallDef = openDef([
  "##########",
  "#........#",
  "#........#",
  "#........#",
  "#....#...#",
  "#....#...#",
  "#....#...#",
  "#........#",
  "#........#",
  "##########",
]);

// 2. Wall detour (GROUND): routes around, crosses no wall, longer than straight.
loadLevel(diagWallDef);
{
  const p = findPath(px(1), px(1), px(8), px(8), NAV_MASK.GROUND);
  const nonNull = Array.isArray(p) && p.length > 0;
  const noWall = nonNull && p.every(w => !isWall(w.tx, w.ty));
  const longer = nonNull && p.length > 7;   // chebyshev straight = 7; a length-7 path must be pure diagonal (hits the wall)
  check("findPath GROUND wall-detour: routes around, no wall tile, longer than straight line", nonNull && noWall && longer);
}

// 5. PHANTOM ignores walls: same map, straight diagonal that crosses wall tiles.
{
  const p = findPath(px(1), px(1), px(8), px(8), NAV_MASK.PHANTOM);
  let straight = p.length === 7;
  for (let i = 0; i < p.length; i++) if (p[i].tx !== i + 2 || p[i].ty !== i + 2) straight = false;
  const crossesWall = p.some(w => isWall(w.tx, w.ty));   // (5,5) is a wall — PHANTOM passes it, corner-cut is object-aware
  check("findPath PHANTOM ignores walls: straight diagonal crosses a wall tile", straight && crossesWall);
}

// 3. Corner-cut (GROUND): two walls meeting diagonally at (2,2)/(3,3) — the
//    squeeze (2,3)<->(3,2) between them must never be taken.
loadLevel(openDef([
  "######",
  "#....#",
  "#.#..#",   // wall (2,2)
  "#..#.#",   // wall (3,3)
  "#....#",
  "######",
]));
{
  const p = findPath(px(1), px(4), px(4), px(1), NAV_MASK.GROUND);
  const nonNull = Array.isArray(p) && p.length > 0;
  let noCut = true, illegalSqueeze = false, prevTx = 1, prevTy = 4;   // start tile (1,4), excluded
  for (const w of p) {
    const dx = w.tx - prevTx, dy = w.ty - prevTy;
    if (dx !== 0 && dy !== 0) {   // every diagonal hop: both shared orthogonals must be passable
      if (isNavBlocked(prevTx + dx, prevTy, NAV_MASK.GROUND)) noCut = false;
      if (isNavBlocked(prevTx, prevTy + dy, NAV_MASK.GROUND)) noCut = false;
    }
    if ((prevTx === 2 && prevTy === 3 && w.tx === 3 && w.ty === 2) ||
        (prevTx === 3 && prevTy === 2 && w.tx === 2 && w.ty === 3)) illegalSqueeze = true;
    prevTx = w.tx; prevTy = w.ty;
  }
  check("findPath GROUND corner-cut: no diagonal clips a wall corner (no wall-squeeze)", nonNull && noCut && !illegalSqueeze);
}

// 4. Door closed blocks / open passes (GROUND). Two rooms joined ONLY by a
//    plate-door; press the linked plate via the loader seam -> repath through.
loadLevel({
  id: "nav-fp-door", name: "NavFPDoor",
  tiles: [
    "#########",
    "#_..#...#",   // plate '_' (1,1), divider wall (4,1)
    "#...d...#",   // door 'd' (4,2) — the sole passage
    "#...#...#",   // divider wall (4,3)
    "#########",
  ],
  zones: [],
  placements: [
    { type: "player", x: 1, y: 2 },
    { type: "exit",   x: 7, y: 2 },
    { type: "door",   x: 4, y: 2, id: "gate" },
    { type: "plate",  x: 1, y: 1, id: "pA" },
  ],
  links: [{ plate: "pA", door: "gate" }],
});
{
  const closedPath = findPath(px(1), px(2), px(7), px(2), NAV_MASK.GROUND);
  check("findPath GROUND door closed: no path (only passage sealed)", closedPath === null);
  setPlatePressedAt(1, 1, true);   // opens 'gate' + markNavDirty -> nav invalidation
  const openPath = findPath(px(1), px(2), px(7), px(2), NAV_MASK.GROUND);
  const through = Array.isArray(openPath) && openPath.some(w => w.tx === 4 && w.ty === 2);
  check("findPath GROUND door open: repath routes through the opened door tile", through);
}

// 6. PHANTOM blocked by crates + dirty rebuild. A crate line across the
//    straight path -> detour; splice + markDirty -> straight again.
loadLevel(openDef([
  "##########",
  "#........#",
  "#........#",
  "#........#",
  "#........#",
  "#........#",
  "#........#",
  "#........#",
  "#........#",
  "##########",
]));
const crateTiles = [[4, 4], [4, 5], [4, 6]];
for (const [tx, ty] of crateTiles) {
  G.crates.push({ type: "crate", x: px(tx), y: px(ty), blocks: true });
  markNavDirty({ tx, ty });   // carry-system pairing: push + markDirty
}
{
  const p = findPath(px(1), px(5), px(8), px(5), NAV_MASK.PHANTOM);
  const nonNull = Array.isArray(p) && p.length > 0;
  const avoidsCrates = nonNull && !p.some(w => crateTiles.some(([tx, ty]) => w.tx === tx && w.ty === ty));
  const detoured = nonNull && p.some(w => w.ty !== 5);   // must leave the (blocked) straight row to get around
  check("findPath PHANTOM crate-line: routes around crates (leaves the blocked straight row)", nonNull && avoidsCrates && detoured);
}
G.crates.splice(0, G.crates.length);
for (const [tx, ty] of crateTiles) markNavDirty({ tx, ty });
{
  const p = findPath(px(1), px(5), px(8), px(5), NAV_MASK.PHANTOM);
  let straight = p.length === 7;
  for (let i = 0; i < p.length; i++) if (p[i].ty !== 5) straight = false;
  check("findPath PHANTOM after splice+markDirty: straight line restored (length 7, ty=5)", straight);
}

// 9. Degenerate cases: sealed-pocket goal (exhaust) -> null; PHANTOM OOB goal
//    (R4) -> null; start tile === goal tile -> [].
loadLevel(openDef([
  "#######",
  "#.....#",
  "#.###.#",
  "#.#.#.#",   // floor (3,3) sealed on all 8 sides by walls
  "#.###.#",
  "#.....#",
  "#######",
]));
{
  const pocket = findPath(px(1), px(1), px(3), px(3), NAV_MASK.GROUND);
  check("findPath GROUND sealed-pocket goal: null (open set exhausted, goal not blocked)", pocket === null);
  const oob = findPath(px(1), px(1), (CFG.COLS + 2) * CFG.TILE, px(1), NAV_MASK.PHANTOM);
  check("findPath PHANTOM out-of-bounds goal: null (R4)", oob === null);
  const same = findPath(px(2), px(2), px(2) + 3, px(2) + 3, NAV_MASK.GROUND);   // both in tile (2,2)
  check("findPath start tile === goal tile: []", Array.isArray(same) && same.length === 0);
}

// 10. Determinism (D7): identical inputs -> deep-equal path arrays.
loadLevel(diagWallDef);
{
  const a = findPath(px(1), px(1), px(8), px(8), NAV_MASK.GROUND);
  const b = findPath(px(1), px(1), px(8), px(8), NAV_MASK.GROUND);
  check("findPath determinism: identical inputs -> deep-equal paths",
    a.length > 0 && JSON.stringify(a) === JSON.stringify(b));
}

/* ========================================================================= *
   Import discipline (spec test 12) + Infinity sentinel grep (spec test 13).
 * ========================================================================= */
const navSrc = readFileSync(new URL("./src/nav.js", import.meta.url), "utf8");
const importLines = navSrc.match(/^import .*$/gm) || [];
const allowedImports = new Set(["./config.js", "./state.js", "./world.js", "./level-loader.js"]);
const importsOk = importLines.every(line => {
  const m = line.match(/from\s+["']([^"']+)["']/);
  return m && allowedImports.has(m[1]);
});
check("nav.js imports only config/state/world/level-loader", importsOk);
check("nav.js does not import enemies/player/combat/abilities/projectiles",
  !/enemies|player\.js|combat|abilities|projectiles/.test(navSrc.replace(/\/\*[\s\S]*?\*\//g, "")));
check("nav.js contains no literal Infinity (D6 sentinel)", !/\bInfinity\b/.test(navSrc));

console.log(`\ntest-nav.js: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
