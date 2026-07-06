/* test-pickups.js — headless smoke tests for SPEC-PICKUPS Phase 2+3:
   Phase 2: the food/treasure/powerup factory-decoration wraps in pickups.js.
     · food{kind} -> heal; treasure{kind} -> points; powerup{kind} -> power
     · override wins over the inert placeholder (value field present)
     · key stays unwrapped (no value field expected)
     · mis-kinded (R7): undefined kind -> undefined value, no throw
   Phase 3: updatePickups(dt) contact routing + gem despawn (§4, §8).
   Magnet-pull-specific coverage lives in test-pickups-magnet.js.
   Exercises the REAL modules, never inlined copies. Pure logic, no canvas.
   Run: node test-pickups.js
*/

// --- Minimal browser-global stubs (house headless style) --------------------
globalThis.window ||= globalThis;
globalThis.document ||= { createElement: () => ({ getContext: () => ({}) }) };
globalThis.AudioContext ||= function () {};

import { CFG } from "./src/config.js";
import { G } from "./src/state.js";
import { registerBlockerSink, registerEmit, getEntityFactory } from "./src/level-loader.js";
import { initAbilities } from "./src/abilities.js";
import { initPlayer } from "./src/player.js";
import { updatePickups } from "./src/pickups.js";

registerBlockerSink({ registerBlocker() {}, markDirty() {} });

const emitted = [];
registerEmit((type, payload) => emitted.push({ type, payload }));

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

// --- Phase 3: updatePickups(dt) contact routing + despawn -------------------

function freshG() {
  initPlayer();
  initAbilities();
  G.pickups = [];
  G.magnet = 0;
  G.keys = 0;
  G.score = 0;
  G.powerups = {};
  G.gemEnergy = 0;       // PERSISTENT run-state (initAbilities intentionally skips it) — reset per-test
  G.storedCharges = 0;
  G.player.x = 0; G.player.y = 0;
  emitted.length = 0;
}

// gem -> addGemEnergy
freshG();
G.pickups.push({ type: "gem", x: 0, y: 0, value: CFG.GEM.energy });
updatePickups(1 / 60);
check("gem collect credits addGemEnergy (gemEnergy rises by value)", G.gemEnergy === CFG.GEM.energy);
check("gem collect splices the pickup", G.pickups.length === 0);
check("gem collect emits one pickup:collected", emitted.length === 1 && emitted[0].type === "pickup:collected");
check("gem collect emit amount === value", emitted[0].payload.amount === CFG.GEM.energy);

// food -> healPlayer
freshG();
G.hp = 10;
G.pickups.push({ type: "food", x: 0, y: 0, kind: "candy", heal: CFG.FOOD.candy });
updatePickups(1 / 60);
check("food collect heals player by heal amount", G.hp === 10 + CFG.FOOD.candy);

// food overheal clamp
freshG();
G.hp = 28;
G.overhealCap = 30;
G.pickups.push({ type: "food", x: 0, y: 0, kind: "feast", heal: CFG.FOOD.feast });
updatePickups(1 / 60);
check("food overheal clamps to overhealCap (28+10 -> 30, not 38)", G.hp === 30);

// treasure -> G.score
freshG();
G.pickups.push({ type: "treasure", x: 0, y: 0, kind: "goldChest", points: CFG.TREASURE.goldChest });
updatePickups(1 / 60);
check("treasure collect adds points to G.score", G.score === CFG.TREASURE.goldChest);

// key -> G.keys++
freshG();
G.pickups.push({ type: "key", x: 0, y: 0 });
updatePickups(1 / 60);
check("key collect increments G.keys", G.keys === 1);

// powerup fast -> G.powerups.fast, additive stack
freshG();
G.pickups.push({ type: "powerup", x: 0, y: 0, kind: "fast", power: "fast" });
updatePickups(1 / 60);
check("powerup fast grants powerupShots (75)", G.powerups.fast === CFG.PICKUP.powerupShots);
G.pickups.push({ type: "powerup", x: 0, y: 0, kind: "fast", power: "fast" });
updatePickups(1 / 60);
check("second powerup fast stacks additively (150)", G.powerups.fast === CFG.PICKUP.powerupShots * 2);

// powerup magnet -> G.magnet, NOT G.powerups.magnet (D4/R5)
freshG();
G.pickups.push({ type: "powerup", x: 0, y: 0, kind: "magnet", power: "magnet" });
updatePickups(1 / 60);
check("powerup magnet sets G.magnet to duration", G.magnet === CFG.PICKUP.magnet.duration);
check("powerup magnet leaves G.powerups.magnet untouched (D4)", G.powerups.magnet === undefined);

// magnet refresh is additive (D8) — G.magnet already > 0 so the pull pass
// ticks it down by dt BEFORE the collect adds +duration (pull-then-collect
// ordering, §4); expected value accounts for that same-frame tick.
freshG();
G.magnet = 3;
G.pickups.push({ type: "powerup", x: 0, y: 0, kind: "magnet", power: "magnet" });
const dt = 1 / 60;
updatePickups(dt);
check("second magnet pickup adds +duration (additive refresh)", G.magnet === Math.max(0, 3 - dt) + CFG.PICKUP.magnet.duration);

// gem despawn
freshG();
G.pickups.push({ type: "gem", x: 1000, y: 1000, value: CFG.GEM.energy }); // far from player, no contact
for (let t = 0; t < CFG.PICKUP.gemDespawn; t += 1) updatePickups(1);
check("gem aged >= gemDespawn is spliced", G.pickups.length === 0);
check("expired gem credits nothing", G.gemEnergy === 0);
check("despawn emits nothing", emitted.length === 0);

// gem collected before despawn credits normally
freshG();
G.pickups.push({ type: "gem", x: 0, y: 0, value: CFG.GEM.energy });
for (let t = 0; t < CFG.PICKUP.gemDespawn - 1; t += 1) updatePickups(1); // ages but stays in contact range
check("gem collected before despawn window elapses (in contact range every frame)", G.gemEnergy === CFG.GEM.energy && G.pickups.length === 0);

// a gem that crosses the despawn threshold this frame is despawned (not also
// collected) even if in contact range — despawn is checked before contact
// within the same per-item pass, so it's despawn-or-collect, never both (§4).
freshG();
G.pickups.push({ type: "gem", x: 0, y: 0, value: CFG.GEM.energy, life: CFG.PICKUP.gemDespawn - 0.001 });
updatePickups(0.002); // life crosses gemDespawn this same frame, in contact range
check("gem crossing despawn threshold this frame despawns, not double-handled", G.gemEnergy === 0 && G.pickups.length === 0);
check("despawn-not-collect emits nothing", emitted.length === 0);

// loco-agnostic collect (D9)
freshG();
G.player.loco = "CARRYING";
G.pickups.push({ type: "key", x: 0, y: 0 });
updatePickups(1 / 60);
check("pickup collects while CARRYING (loco-agnostic, D9)", G.keys === 1 && G.pickups.length === 0);

freshG();
G.player.loco = "STUNNED";
G.pickups.push({ type: "key", x: 0, y: 0 });
updatePickups(1 / 60);
check("pickup collects while STUNNED (loco-agnostic, D9)", G.keys === 1 && G.pickups.length === 0);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
