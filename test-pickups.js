/* test-pickups.js — headless smoke tests for SPEC-PICKUPS Phase 2:
   the food/treasure/powerup factory-decoration wraps in pickups.js.
     · food{kind} -> heal; treasure{kind} -> points; powerup{kind} -> power
     · override wins over the inert placeholder (value field present)
     · key stays unwrapped (no value field expected)
     · mis-kinded (R7): undefined kind -> undefined value, no throw
   No updatePickups here — that's Phase 3.
   Exercises the REAL modules, never inlined copies. Pure logic, no canvas.
   Run: node test-pickups.js
*/

// --- Minimal browser-global stubs (house headless style) --------------------
globalThis.window ||= globalThis;
globalThis.document ||= { createElement: () => ({ getContext: () => ({}) }) };
globalThis.AudioContext ||= function () {};

import { CFG } from "./src/config.js";
import { registerBlockerSink, getEntityFactory } from "./src/level-loader.js";
import "./src/pickups.js";

registerBlockerSink({ registerBlocker() {}, markDirty() {} });

let passed = 0, failed = 0;
function check(name, ok) {
  if (ok) { passed++; } else { failed++; console.error(`FAIL: ${name}`); }
}
// --- food -------------------------------------------------------------------
const foodFactory = getEntityFactory("food");
const candy = foodFactory({ type: "food", x: 0, y: 0, kind: "candy" });
check("food candy heal === CFG.FOOD.candy (5)", candy.heal === CFG.FOOD.candy && candy.heal === 5);

const feast = foodFactory({ type: "food", x: 0, y: 0, kind: "feast" });
check("food feast heal === CFG.FOOD.feast (10)", feast.heal === CFG.FOOD.feast && feast.heal === 10);

// --- treasure ----------------------------------------------------------------
const treasureFactory = getEntityFactory("treasure");
const goldChest = treasureFactory({ type: "treasure", x: 0, y: 0, kind: "goldChest" });
check("treasure goldChest points === 500", goldChest.points === 500);

const candyCorn = treasureFactory({ type: "treasure", x: 0, y: 0, kind: "candyCorn" });
check("treasure candyCorn points === 100", candyCorn.points === 100);

const silverSkull = treasureFactory({ type: "treasure", x: 0, y: 0, kind: "silverSkull" });
check("treasure silverSkull points === 250", silverSkull.points === 250);

// --- powerup -----------------------------------------------------------------
const powerupFactory = getEntityFactory("powerup");
const fast = powerupFactory({ type: "powerup", x: 0, y: 0, kind: "fast" });
check("powerup fast power === 'fast'", fast.power === "fast");

const magnet = powerupFactory({ type: "powerup", x: 0, y: 0, kind: "magnet" });
check("powerup magnet power === 'magnet'", magnet.power === "magnet");

// --- override wins over inert placeholder ------------------------------------
check("food override attaches heal (not just placeholder shape)", candy.heal !== undefined);
check("treasure override attaches points (not just placeholder shape)", goldChest.points !== undefined);
check("powerup override attaches power (not just placeholder shape)", fast.power !== undefined);

// --- key stays unwrapped -------------------------------------------------------
const keyFactory = getEntityFactory("key");
const key = keyFactory({ type: "key", x: 0, y: 0 });
check("key placeholder has no value field", key.value === undefined && key.heal === undefined && key.points === undefined && key.power === undefined);
check("key placeholder shape intact (type/blocks)", key.type === "key" && key.blocks === false);

// --- R7: mis-kinded placement data, no throw ----------------------------------
let bogusFood;
let didThrow = false;
try { bogusFood = foodFactory({ type: "food", x: 0, y: 0, kind: "bogus" }); }
catch (e) { didThrow = true; }
check("mis-kinded food{kind:'bogus'} does not throw", !didThrow);
check("mis-kinded food{kind:'bogus'} heal === undefined", bogusFood && bogusFood.heal === undefined);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
