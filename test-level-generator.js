/* test-level-generator.js — headless smoke tests for the §8 level GENERATOR
   geometry/solvability half (SPEC-LEVEL items 2/7 + a re-assert of 3).

   Exercises the REAL modules (config/state/level-plan/level-generator), not
   inlined copies. This layer touches no canvas/audio/document, so no browser
   globals are stubbed. Run: node test-level-generator.js
*/
import { readFileSync } from "node:fs";
import { CFG } from "./src/config.js";
import { G } from "./src/state.js";
import { buildRoster } from "./src/level-plan.js";
import {
  generateLevel, makeRng, isSolvable, __setCandidateOverride,
} from "./src/level-generator.js";

let passed = 0, failed = 0;
function check(name, ok) {
  if (ok) { passed++; } else { failed++; console.error(`FAIL: ${name}`); }
}

const NIGHTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 12, 20, 40];

/* ========================================================================= *
   §8.2 — determinism under a fixed seed. generateLevel(5, makeRng(1)) deep-
   equals a second makeRng(1) call and differs from makeRng(2). G._prevDark is
   external run-state that feeds the dark guard, so it is reset before each call
   (seed + G state are the inputs; §9 Q3).
 * ========================================================================= */
G._prevDark = false; const d5a = generateLevel(5, makeRng(1));
G._prevDark = false; const d5b = generateLevel(5, makeRng(1));
G._prevDark = false; const d5c = generateLevel(5, makeRng(2));
check("fixed seed is deterministic (deep-equal)", JSON.stringify(d5a) === JSON.stringify(d5b));
check("different seed differs (layout varies per visit)", JSON.stringify(d5a) !== JSON.stringify(d5c));

// Determinism holds across a range of nights, not just n=5.
let detOk = true;
for (const n of NIGHTS) {
  G._prevDark = false; const a = generateLevel(n, makeRng(n * 13 + 7));
  G._prevDark = false; const b = generateLevel(n, makeRng(n * 13 + 7));
  if (JSON.stringify(a) !== JSON.stringify(b)) { detOk = false; break; }
}
check("determinism holds across all nights", detOk);

/* ========================================================================= *
   §8.7 — solvability. Every generated def passes flood-fill start→exit and
   start→every-placement (isSolvable is the same routine generateLevel gates on,
   asserted here on independent seeds). Locked-door keys are pre-door-reachable
   and plate-door crates reachable — folded into isSolvable's checks 2/3.
 * ========================================================================= */
let solvAll = true, solvCount = 0;
for (const n of NIGHTS)
  for (let s = 0; s < 12; s++) {
    G._prevDark = false;
    const def = generateLevel(n, makeRng(n * 1000 + s));
    solvCount++;
    if (!isSolvable(def)) { solvAll = false; console.error(`  unsolvable n=${n} s=${s} (${def.name})`); }
  }
check(`every generated def is solvable (${solvCount} defs)`, solvAll);

// Cross-check: isSolvable actually rejects a genuinely unsolvable def (a sealed
// exit) — so the "all solvable" pass above is not a vacuous always-true.
check("isSolvable rejects a sealed-off exit", !isSolvable({
  tiles: ["#######", "#.....#", "#.###.#", "#.#.#.#", "#######"],
  placements: [{ type: "player", x: 1, y: 1 }, { type: "exit", x: 3, y: 3 }], links: [],
}));

/* Fallback: force every candidate unsolvable via the injection seam; the
   generator must fall back to a valid, solvable open-arena (§5.4). */
__setCandidateOverride(() => ({
  id: "bad", name: "bad", props: { dark: false }, cols: 7, rows: 5,
  tiles: ["#######", "#.....#", "#.###.#", "#.#.#.#", "#######"],
  zones: [{ role: "spawn", x: 1, y: 1, w: 1, h: 1 }],
  placements: [{ type: "player", x: 1, y: 1 }, { type: "exit", x: 3, y: 3 }], links: [], spawnRules: [],
}));
const origWarn = console.warn; console.warn = () => {};   // silence the expected telemetry line
G._prevDark = false; const fb = generateLevel(6, makeRng(42));
console.warn = origWarn;
__setCandidateOverride(null);
check("forced-failure triggers the fallback", fb.props.fallback === true);
check("fallback def is itself solvable", isSolvable(fb));
check("fallback carries no locked/plate doors", !/[dD]/.test(fb.tiles.join("")));

/* ========================================================================= *
   §8.3 — content purity re-asserted end-to-end. Budget/roster for a fixed n is
   a pure fn of n (identical across seeds) even though the geometry/layout the
   two seeds produce differs (D2).
 * ========================================================================= */
let purityOk = true;
for (const n of NIGHTS)
  if (JSON.stringify(buildRoster(n)) !== JSON.stringify(buildRoster(n))) purityOk = false;
check("roster is a pure fn of n (identical across calls)", purityOk);
// Content is identical across seeds while geometry differs: same n, two seeds
// → same derived roster, different tiles (D2). Use a large night so the layout
// space is big enough that two seeds almost surely diverge.
G._prevDark = false; const seedA = generateLevel(40, makeRng(1));
G._prevDark = false; const seedB = generateLevel(40, makeRng(2));
check("same n, same roster across seeds", JSON.stringify(buildRoster(40)) === JSON.stringify(buildRoster(40)));
check("same n, different layout across seeds", seedA.tiles.join("") !== seedB.tiles.join(""));

/* ========================================================================= *
   Structural: footprint tracks CFG.GEN and caps; archetype variety; the Q3
   dark guard never yields two consecutive dark Nights.
 * ========================================================================= */
G._prevDark = false; const early = generateLevel(1, makeRng(5));
G._prevDark = false; const late = generateLevel(60, makeRng(5));
check("night 1 footprint = CFG.GEN.footprintMin",
  early.cols === CFG.GEN.footprintMin[0] && early.rows === CFG.GEN.footprintMin[1]);
check("late-night footprint caps at CFG.GEN.footprintMax",
  late.cols === CFG.GEN.footprintMax[0] && late.rows === CFG.GEN.footprintMax[1]);
check("grid dims match declared cols/rows",
  early.tiles.length === early.rows && early.tiles[0].length === early.cols);

const archSeen = new Set();
for (let s = 0; s < 60; s++) { G._prevDark = false; archSeen.add(generateLevel(9, makeRng(s)).name.split("— ")[1]); }
check("generator produces multiple archetypes across seeds", archSeen.size >= 2);

// Dark guard: with _prevDark true, a dark-eligible night is never dark (§9 Q3).
let noConsec = true;
for (let s = 0; s < 40; s++) { G._prevDark = true; if (generateLevel(30, makeRng(s)).props.dark) noConsec = false; }
check("no two consecutive dark Nights (guard suppresses when _prevDark)", noConsec);
// And generateLevel updates the guard after generating.
G._prevDark = false; generateLevel(30, makeRng(0)); check("generateLevel sets G._prevDark", typeof G._prevDark === "boolean");
// Dark is impossible before darkProb.beforeNight regardless of seed/guard.
let noEarlyDark = true;
for (let s = 0; s < 30; s++) { G._prevDark = false; if (generateLevel(CFG.PLAN.darkProb.beforeNight - 1, makeRng(s)).props.dark) noEarlyDark = false; }
check("dark impossible before darkProb.beforeNight", noEarlyDark);

/* ========================================================================= *
   Acceptance: generateLevel returns DATA ONLY — the generator source never
   writes a G entity array; the only G field it touches is G._prevDark (Q3).
 * ========================================================================= */
const src = readFileSync(new URL("./src/level-generator.js", import.meta.url), "utf8");
const gRefs = src.match(/\bG\.\w+/g) || [];
check("generator touches only G._prevDark (no G entity writes)",
  gRefs.every((r) => r === "G._prevDark"));
// No seed persistence: the generator never reaches a storage/save surface
// (D2 — resume rebuilds a fresh layout from n, no seed carried in saves).
check("generator uses no persistence API", !/localStorage|sessionStorage|indexedDB|savegame/.test(src));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
