// test-config.js — headless smoke test, no canvas (CLAUDE.md convention).
import { CFG } from "./src/config.js";
import { G } from "./src/state.js";

let passed = 0, failed = 0;

function check(name, ok) {
  if (ok) { passed++; }
  else { failed++; console.error(`FAIL: ${name}`); }
}

function throws(name, fn) {
  try { fn(); check(name, false); }
  catch (e) { check(name, true); }
}

// --- no Infinity anywhere in CFG ---------------------------------------
function hasInfinity(obj, seen = new Set()) {
  if (obj === Infinity || obj === -Infinity) return true;
  if (obj === null || typeof obj !== "object") return false;
  if (seen.has(obj)) return false;
  seen.add(obj);
  for (const v of Object.values(obj)) {
    if (hasInfinity(v, seen)) return true;
  }
  return false;
}
check("CFG contains no Infinity", !hasInfinity(CFG));

// --- CFG.RAMP: every entry has base/step/limit/mode with valid mode ----
const validModes = new Set(["add", "mul"]);
let rampOk = true;
for (const [key, param] of Object.entries(CFG.RAMP)) {
  if (typeof param.base !== "number") { rampOk = false; console.error(`RAMP.${key} missing base`); }
  if (typeof param.step !== "number") { rampOk = false; console.error(`RAMP.${key} missing step`); }
  if (typeof param.limit !== "number") { rampOk = false; console.error(`RAMP.${key} missing limit`); }
  if (!validModes.has(param.mode)) { rampOk = false; console.error(`RAMP.${key} invalid mode: ${param.mode}`); }
}
check("CFG.RAMP entries all have base/step/limit/valid mode", rampOk);

// --- CFG.PLAN.introductions nights non-decreasing -----------------------
let nightsNonDecreasing = true;
for (let i = 1; i < CFG.PLAN.introductions.length; i++) {
  if (CFG.PLAN.introductions[i].night < CFG.PLAN.introductions[i - 1].night) {
    nightsNonDecreasing = false;
  }
}
check("PLAN.introductions nights are non-decreasing", nightsNonDecreasing);

// --- every introduced element that can cost budget has a costs entry ---
// "cost budget" elements are loose enemies/spawners in CFG.PLAN.costs keys;
// non-costed introductions (crate, barrel, key, lockedDoor, plateDoor,
// darkLevel, graveMound/eggSac/belfry/emberPit/cauldron skins) are structural
// or spawner-skin elements, not budget-costed roster entries.
const costedKinds = new Set(Object.keys(CFG.PLAN.costs));
const spawnerSkins = new Set(["bonePile", "graveMound", "eggSac", "belfry", "emberPit", "cauldron"]);
const nonCosted = new Set(["crate", "barrel", "key", "lockedDoor", "plateDoor", "darkLevel"]);
let allElementsAccounted = true;
for (const intro of CFG.PLAN.introductions) {
  for (const el of intro.elements) {
    const accounted = costedKinds.has(el) || spawnerSkins.has(el) || nonCosted.has(el);
    if (!accounted) {
      allElementsAccounted = false;
      console.error(`introduced element "${el}" (night ${intro.night}) has no costs entry and is not a recognized non-costed/skin element`);
    }
  }
}
check("every introduced budget-costed element has a costs entry", allElementsAccounted);

// --- CFG.SPAWNER has a key for every spawner variant the PLAN introduces
let spawnerVariantsOk = true;
for (const skin of spawnerSkins) {
  if (!(skin in CFG.SPAWNER)) {
    spawnerVariantsOk = false;
    console.error(`PLAN introduces spawner skin "${skin}" with no CFG.SPAWNER entry`);
  }
}
check("CFG.SPAWNER has a key for every spawner variant the PLAN introduces", spawnerVariantsOk);

// --- CFG.TILES sanity: one record per required char, correct shape -----
const requiredChars = [".", "#", "T", "o", "D", "d", "_"];
let tilesOk = true;
for (const ch of requiredChars) {
  const t = CFG.TILES[ch];
  if (!t) { tilesOk = false; console.error(`CFG.TILES missing "${ch}"`); continue; }
  for (const field of ["name", "solid", "blocksLOS", "blocksFlight"]) {
    if (!(field in t)) { tilesOk = false; console.error(`CFG.TILES["${ch}"] missing ${field}`); }
  }
  if (!("mutable" in t)) { tilesOk = false; console.error(`CFG.TILES["${ch}"] missing mutable`); }
}
check("CFG.TILES has all required chars with correct shape", tilesOk);
check("CFG.TILES has no destructible field (dropped per SPEC-LEVEL §3.1)",
  Object.values(CFG.TILES).every(t => !("destructible" in t)));

// --- config.js imports nothing from gameplay (structural check) --------
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("./src/config.js", import.meta.url), "utf8");
const importLines = src.match(/^import .*$/gm) || [];
check("config.js has no import statements (leaf module)", importLines.length === 0);

// --- G run-state shape ---------------------------------------------------
check("G has persistent run-state fields",
  "hp" in G && "gemEnergy" in G && "storedCharges" in G && "keys" in G &&
  "powerups" in G && "score" in G && "night" in G);
check("G.ramp slot exists (filled at load)", "ramp" in G && typeof G.ramp === "object");
check("G._prevDark exists, unsaved boolean, init false", G._prevDark === false);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
