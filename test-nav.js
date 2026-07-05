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
  NAV_MASK, isNavBlocked, getNavVersion, consumeDirtyTiles, installNav,
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
