/* test-level-integration.js — cross-cutting §8 tests: the GENERATOR feeds the
   LOADER (SPEC-LEVEL item 1, plus a re-assert of 8 through a generated def).

   The generator is subsystem #1's producer, the loader its sole consumer; this
   file is the only place the two meet. Exercises the REAL modules
   (config/state/world/level-loader/level-generator). No canvas/audio/document,
   so no browser globals are stubbed. Run: node test-level-integration.js
*/
import { CFG } from "./src/config.js";
import { G } from "./src/state.js";
import { map, isWall } from "./src/world.js";
import { loadLevel } from "./src/level-loader.js";
import { generateLevel, makeRng, isSolvable } from "./src/level-generator.js";

let passed = 0, failed = 0;
function check(name, ok) {
  if (ok) { passed++; } else { failed++; console.error(`FAIL: ${name}`); }
}

const NIGHTS = [1, 2, 3, 4, 5, 6, 7, 9, 12, 20, 40];

/* ========================================================================= *
   §8.1 — generator → loader accepts. Every generated def loads without
   throwing, and the live world dims (CFG.COLS/ROWS, set by loadTileGrid) track
   the def's grid.
 * ========================================================================= */
let acceptAll = true, dimsAll = true, gridAll = true;
for (const n of NIGHTS)
  for (let s = 0; s < 6; s++) {
    G._prevDark = false;
    const def = generateLevel(n, makeRng(n * 31 + s));
    G.night = n;                                   // loader reads G.night for ramp + spawner filtering
    try { loadLevel(def); } catch (e) { acceptAll = false; console.error(`  load threw n=${n} s=${s}: ${e.message}`); continue; }
    if (CFG.COLS !== def.cols || CFG.ROWS !== def.rows) dimsAll = false;
    if (map.length !== def.rows || map[0].length !== def.cols) gridAll = false;
  }
check("every generated def is accepted by loadLevel", acceptAll);
check("CFG.COLS/ROWS track the generated grid", dimsAll);
check("world.map dims track the generated grid", gridAll);

/* ========================================================================= *
   §8.7 re-assert end-to-end: a generated, loaded level has its player, exit and
   fixed placements on legal tiles — player/exit non-solid, and the def the
   loader just consumed is flood-fill solvable.
 * ========================================================================= */
G._prevDark = false;
const def = generateLevel(9, makeRng(123));
G.night = 9;
loadLevel(def);
const player = def.placements.find((p) => p.type === "player");
const exit = def.placements.find((p) => p.type === "exit");
check("player spawns on a non-solid tile", !isWall(player.x, player.y));
check("exit sits on a non-solid tile", !isWall(exit.x, exit.y));
check("G.player / G.exit set by the loader", !!G.player && !!G.exit);
check("loaded generated def is solvable", isSolvable(def));

// Door set pieces (halls) round-trip through the loader's link graph: find a
// generated def that has a plate-door, load it, and confirm the door opens when
// its plate is pressed (read black-box via world.isWall on the door tile).
import { setPlatePressed } from "./src/level-loader.js";
let hallsDef = null;
for (let s = 0; s < 80 && !hallsDef; s++) {
  G._prevDark = false;
  const d = generateLevel(4, makeRng(s));
  if (d.placements.some((p) => p.type === "door" && d.tiles[p.y][p.x] === "d")) hallsDef = d;
}
if (hallsDef) {
  G.night = 4;
  loadLevel(hallsDef);
  const door = hallsDef.placements.find((p) => p.type === "door" && hallsDef.tiles[p.y][p.x] === "d");
  const plate = hallsDef.placements.find((p) => p.type === "plate");
  const link = hallsDef.links.find((l) => l.door === door.id);
  check("generated plate-door starts closed (solid)", isWall(door.x, door.y));
  setPlatePressed(link.plate, true);
  check("pressing the generated plate opens its door", !isWall(door.x, door.y));
  setPlatePressed(link.plate, false);
  check("releasing the plate closes the generated door", isWall(door.x, door.y));
} else {
  check("found a generated plate-door to exercise", false);
}

/* ========================================================================= *
   §8.8 re-assert through a generated def: persistent run-state survives a
   generated load; transient arrays come back cleared.
 * ========================================================================= */
G.hp = 11; G.keys = 2; G.gemEnergy = 8; G.score = 4242; G.night = 7;
G._prevDark = false;
const genDef = generateLevel(7, makeRng(77));
loadLevel(genDef);
G.shots.push({}); G.enemies.push({});
loadLevel(genDef);
check("transient shots cleared on generated load", G.shots.length === 0);
check("player hp preserved across generated load", G.hp === 11);
check("player keys preserved across generated load", G.keys === 2);
check("score preserved across generated load", G.score === 4242);
check("night preserved across generated load", G.night === 7);

/* ========================================================================= *
   Spawner rules from the roster are honored: a night whose ghosts map to an
   eligible spawner variant loads at least one spawner entity into G.spawners.
 * ========================================================================= */
let sawSpawner = false;
for (let s = 0; s < 20 && !sawSpawner; s++) {
  G._prevDark = false;
  const d = generateLevel(9, makeRng(s));      // n>=6: ghost→graveMound is eligible
  G.night = 9; loadLevel(d);
  if (G.spawners.length > 0) sawSpawner = true;
}
check("generated spawner rules load spawner entities", sawSpawner);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
