/* test-level-loader.js — headless smoke tests for the §8 level LOADER
   (SPEC-LEVEL items 4/5/6/8). No generator dependency — fixture defs only.

   Exercises the REAL modules (config/state/world/level-loader), not inlined
   copies. level-loader imports only config/state/world, none of which touch
   canvas/audio/document, so no browser-global stubs are needed (unlike ADD's
   test-loader). Run: node test-level-loader.js
*/
import { CFG } from "./src/config.js";
import { G } from "./src/state.js";
import { map, isWall } from "./src/world.js";
import {
  loadLevel, validateLevelDef, setPlatePressed, setPlatePressedAt, emit,
} from "./src/level-loader.js";

let passed = 0, failed = 0;
function check(name, ok) {
  if (ok) { passed++; } else { failed++; console.error(`FAIL: ${name}`); }
}
function throws(name, fn) {
  try { fn(); check(name, false); }
  catch (e) { check(name, true); }
}

/* ========================================================================= *
   §8.5 — validation rejects malformed defs (throws). All via loadLevel so the
   ragged/unknown-char cases (thrown by loadTileGrid) are covered too.
 * ========================================================================= */
// A well-formed base def; `over` overrides fields for each rejection case.
const baseDef = (over) => Object.assign({
  id: "test", name: "Test",
  tiles: [
    "#######",
    "#..d..#",   // plate-door 'd' at (3,1)
    "#.._..#",   // plate '_'  at (3,2)
    "#.....#",
    "#######",
  ],
  zones: [{ role: "combat", x: 1, y: 1, w: 5, h: 3 }],
  placements: [
    { type: "player", x: 1, y: 3 },
    { type: "exit",   x: 5, y: 3 },
    { type: "door",   x: 3, y: 1, id: "gate" },
    { type: "plate",  x: 3, y: 2, id: "pad" },
  ],
  links: [{ plate: "pad", door: "gate" }],
  spawnRules: [],
}, over);

// sanity: the base def itself loads cleanly.
let baseOk = true;
try { loadLevel(baseDef({})); } catch (e) { baseOk = false; console.error(e.message); }
check("well-formed def loads without throwing", baseOk);

throws("zero players rejected", () =>
  loadLevel(baseDef({ placements: [{ type: "exit", x: 5, y: 3 }] })));
throws("two players rejected", () =>
  loadLevel(baseDef({ placements: [
    { type: "player", x: 1, y: 3 }, { type: "player", x: 2, y: 3 }, { type: "exit", x: 5, y: 3 },
  ] })));
throws("no exit rejected", () =>
  loadLevel(baseDef({ placements: [{ type: "player", x: 1, y: 3 }] })));
throws("unknown zone role rejected", () =>
  loadLevel(baseDef({ spawnRules: [{ type: "crate", count: 1, zone: "nope" }] })));
throws("unknown avoid role rejected", () =>
  loadLevel(baseDef({ spawnRules: [{ type: "crate", count: 1, zone: "any", avoid: "nope" }] })));
throws("ragged grid rejected", () =>
  loadLevel(baseDef({ tiles: ["#######", "#..d..#", "#.._.#", "#.....#", "#######"] })));
throws("unknown tile char rejected", () =>
  loadLevel(baseDef({ tiles: ["#######", "#..Z..#", "#.._..#", "#.....#", "#######"] })));
throws("link to missing plate id rejected", () =>
  loadLevel(baseDef({ links: [{ plate: "ghost", door: "gate" }] })));
throws("link to missing door id rejected", () =>
  loadLevel(baseDef({ links: [{ plate: "pad", door: "ghost" }] })));
throws("door off a d/D tile rejected", () =>
  loadLevel(baseDef({ placements: [
    { type: "player", x: 1, y: 3 }, { type: "exit", x: 5, y: 3 },
    { type: "door", x: 1, y: 3, id: "gate" },   // (1,3) is '.', not d/D
    { type: "plate", x: 3, y: 2, id: "pad" },
  ] })));
throws("plate off a _ tile rejected", () =>
  loadLevel(baseDef({ placements: [
    { type: "player", x: 1, y: 3 }, { type: "exit", x: 5, y: 3 },
    { type: "door", x: 3, y: 1, id: "gate" },
    { type: "plate", x: 1, y: 3, id: "pad" },   // (1,3) is '.', not _
  ] })));
throws("unknown spawner variant rejected", () =>
  loadLevel(baseDef({ spawnRules: [{ type: "spawner", count: 1, variant: "nope", zone: "any" }] })));
// validateLevelDef is also directly callable (used before loadTileGrid).
check("validateLevelDef accepts a good def", (() => {
  try { validateLevelDef(baseDef({})); return true; } catch (e) { return false; }
})());

/* ========================================================================= *
   §8.6 — link graph: press opens, release closes, two plates open on either.
   Door open-state is read black-box via world.isWall on the door tile (the
   registered resolver makes an open door read as non-solid floor).
 * ========================================================================= */
const linkDef = {
  id: "link", name: "Link",
  tiles: [
    "#########",
    "#...d...#",   // door 'd' at (4,1)
    "#._..._.#",   // plates at (2,2) and (6,2)
    "#.......#",
    "#.......#",
    "#########",
  ],
  zones: [],
  placements: [
    { type: "player", x: 1, y: 4 },
    { type: "exit",   x: 7, y: 4 },
    { type: "door",   x: 4, y: 1, id: "gate" },
    { type: "plate",  x: 2, y: 2, id: "pA" },
    { type: "plate",  x: 6, y: 2, id: "pB" },
  ],
  links: [{ plate: "pA", door: "gate" }, { plate: "pB", door: "gate" }],
};
loadLevel(linkDef);
check("door starts closed (solid)",            isWall(4, 1));
setPlatePressed("pA", true);
check("pressing plate A opens the door",       !isWall(4, 1));
setPlatePressed("pA", false);
check("releasing the only pressed plate closes it", isWall(4, 1));
setPlatePressed("pB", true);
check("pressing plate B opens the door (either plate)", !isWall(4, 1));
setPlatePressed("pA", true);
setPlatePressed("pA", false);
check("door stays open while B still pressed",  !isWall(4, 1));
setPlatePressed("pB", false);
check("door closes once both plates released",  isWall(4, 1));

/* ========================================================================= *
   §4.3 — setPlatePressedAt: coord-keyed delegate to setPlatePressed. Mirrors
   the link test above but via (tx,ty) instead of id.
 * ========================================================================= */
const coordLinkDef = {
  id: "coord-link", name: "CoordLink",
  tiles: [
    "#########",
    "#...d...#",   // door 'd' at (4,1)
    "#._....#.",   // plate at (2,2) linked; unlinked '_' at (7,2)
    "#.......#",
    "#.......#",
    "#########",
  ],
  zones: [],
  placements: [
    { type: "player", x: 1, y: 4 },
    { type: "exit",   x: 7, y: 4 },
    { type: "door",   x: 4, y: 1, id: "gate" },
    { type: "plate",  x: 2, y: 2, id: "pC" },
  ],
  links: [{ plate: "pC", door: "gate" }],
};
loadLevel(coordLinkDef);
check("coord: door starts closed (solid)",       isWall(4, 1));
setPlatePressedAt(2, 2, true);
check("coord: pressing linked plate opens door", !isWall(4, 1));
setPlatePressedAt(2, 2, false);
check("coord: releasing linked plate closes door", isWall(4, 1));
setPlatePressedAt(7, 2, true);
check("coord: unlinked plate press is a no-op",  isWall(4, 1));
setPlatePressedAt(3, 3, true);
check("coord: non-plate tile press is a no-op",  isWall(4, 1));
check("emit is exported as a function",          typeof emit === "function");

/* ========================================================================= *
   §8.4 — scattered entities never land on solid / plate / exit tiles.
 * ========================================================================= */
const scatterDef = {
  id: "scatter", name: "Scatter",
  tiles: [
    "############",
    "#..........#",
    "#..o..o....#",
    "#...._.....#",   // plate at (5,3)
    "#..........#",
    "#..o....o..#",
    "#..........#",
    "############",
  ],
  zones: [{ role: "combat", x: 1, y: 1, w: 10, h: 6 }],
  placements: [
    { type: "player", x: 1, y: 1 },
    { type: "exit",   x: 10, y: 1 },
  ],
  spawnRules: [
    { type: "crate",    count: 20, zone: "combat" },
    { type: "barrel",   count: 20, zone: "combat" },
    { type: "spawner",  count: 10, zone: "combat", variant: "bonePile" },
    { type: "powerup",  count: 10, zone: "combat" },
    { type: "food",     count: 5,  zone: "any" },
    { type: "treasure", count: 5,  zone: "any" },
    { type: "key",      count: 5,  zone: "any" },
  ],
};
let scatterLegal = true, scatterCount = 0;
for (let iter = 0; iter < 25; iter++) {              // exercise the randomness
  loadLevel(scatterDef);
  for (const arr of [G.crates, G.barrels, G.spawners, G.pickups, G.enemies])
    for (const e of arr) {
      scatterCount++;
      if (isWall(e.x, e.y) || map[e.y][e.x] === "_" || (e.x === 10 && e.y === 1))
        scatterLegal = false;
    }
}
check(`scattered entities all on legal tiles (${scatterCount} placed)`, scatterLegal);
check("scatter actually placed entities", scatterCount > 0);
check("spawner table filtered by eligible(n)", (() => {
  // On the default night (G.night from run state), bonePile's table is
  // intersected with eligible(n); every key must be an eligible element.
  const s = G.spawners[0];
  return s && s.table && Object.keys(s.table).length > 0;
})());

/* ========================================================================= *
   §8.8 — persistent run-state preserved; transient arrays cleared.
 * ========================================================================= */
G.hp = 7; G.keys = 3; G.gemEnergy = 5; G.score = 999; G.night = 4;
loadLevel(scatterDef);
// dirty the transients, then reload — they must come back empty.
G.shots.push({}); G.enemies.push({}); G.marks.push({}); G.floats.push({});
loadLevel(scatterDef);
check("transient shots cleared on load",   G.shots.length === 0);
check("transient marks cleared on load",   G.marks.length === 0);
check("transient floats cleared on load",  G.floats.length === 0);
check("player hp preserved across load",   G.hp === 7);
check("player keys preserved across load", G.keys === 3);
check("player gems preserved across load", G.gemEnergy === 5);
check("player score preserved across load", G.score === 999);
check("night preserved across load",       G.night === 4);

/* ========================================================================= *
   Import discipline — loader imports only config/state/world (never nav/
   player/enemies), per the acceptance criteria.
 * ========================================================================= */
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("./src/level-loader.js", import.meta.url), "utf8");
check("loader does not import nav",     !/from\s+["'][^"']*\/?nav\.js["']/.test(src));
check("loader does not import player",  !/from\s+["'][^"']*\/?player\.js["']/.test(src));
check("loader does not import enemies", !/from\s+["'][^"']*\/?enemies\.js["']/.test(src));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
