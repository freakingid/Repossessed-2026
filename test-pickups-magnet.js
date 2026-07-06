/* test-pickups-magnet.js — headless smoke tests for SPEC-PICKUPS Phase 3:
   the Magnet pull pass in updatePickups(dt) (§4, D7, R3).
     · gems within radius pull toward the player by pullSpeed·TILE·dt, no overshoot
     · gems beyond radius are unmoved
     · non-gem pickups (food) are never pulled (D7 — gems only)
     · G.magnet ticks down by dt every frame it's active, floors at 0
     · pull-before-contact: a gem pulled into grab range collects the same frame
   Exercises the REAL modules, never inlined copies. Pure logic, no canvas.
   Run: node test-pickups-magnet.js
*/

// --- Minimal browser-global stubs (house headless style) --------------------
globalThis.window ||= globalThis;
globalThis.document ||= { createElement: () => ({ getContext: () => ({}) }) };
globalThis.AudioContext ||= function () {};

import { CFG } from "./src/config.js";
import { G } from "./src/state.js";
import { registerBlockerSink, registerEmit } from "./src/level-loader.js";
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
const approx = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

function freshG() {
  initPlayer();
  initAbilities();
  G.pickups = [];
  G.magnet = 0;
  G.keys = 0;
  G.score = 0;
  G.powerups = {};
  G.gemEnergy = 0;
  G.storedCharges = 0;
  G.player.x = 0; G.player.y = 0;
  emitted.length = 0;
}

const TILE = CFG.TILE;
const dt = 1 / 60;

// --- gem within radius pulls toward player, no overshoot --------------------
freshG();
G.magnet = 5;
const gemNear = { type: "gem", x: 4 * TILE, y: 0, value: CFG.GEM.energy };
G.pickups.push(gemNear);
updatePickups(dt);
const step = CFG.PICKUP.magnet.pullSpeed * TILE * dt;
const expectedX = 4 * TILE - step;
check("gem within magnet radius moves toward player by pullSpeed*TILE*dt", approx(gemNear.x, expectedX));

// --- pulled gem never overshoots the player position -------------------------
freshG();
G.magnet = 5;
const gemClose = { type: "gem", x: 0.05 * TILE, y: 0, value: CFG.GEM.energy };
G.pickups.push(gemClose);
updatePickups(dt); // step would be larger than remaining distance
const remaining = G.pickups.length ? Math.hypot(gemClose.x - G.player.x, gemClose.y - G.player.y) : 0;
check("pulled gem does not overshoot the player (either collected or clamped at distance)", remaining >= 0);

// --- gem beyond radius is unmoved --------------------------------------------
freshG();
G.magnet = 5;
const gemFar = { type: "gem", x: 8 * TILE, y: 0, value: CFG.GEM.energy };
G.pickups.push(gemFar);
updatePickups(dt);
check("gem beyond magnet radius (8t > 6t) is unmoved", gemFar.x === 8 * TILE);

// --- food is never pulled (gems only, D7) ------------------------------------
freshG();
G.magnet = 5;
const foodNear = { type: "food", x: 3 * TILE, y: 0, kind: "candy", heal: CFG.FOOD.candy };
G.pickups.push(foodNear);
updatePickups(dt);
check("food within magnet radius is NOT pulled (gems only, D7)", foodNear.x === 3 * TILE);

// --- G.magnet ticks down by dt, floors at 0 ----------------------------------
freshG();
G.magnet = 0.005;
updatePickups(dt); // dt (1/60 ~= 0.0167) > remaining magnet time
check("G.magnet floors at 0, never goes negative", G.magnet === 0);

freshG();
G.magnet = 5;
updatePickups(dt);
check("G.magnet ticks down by dt while active", approx(G.magnet, 5 - dt));

// --- pull-before-contact: gem pulled into grab range collects same frame -----
freshG();
G.magnet = 5;
const grabRange = G.player.r + CFG.PICKUP.grab * TILE;
// place gem just outside grab range, but well within one frame's pull step
const startDist = grabRange + 0.001;
const gemToGrab = { type: "gem", x: startDist, y: 0, value: CFG.GEM.energy };
G.pickups.push(gemToGrab);
updatePickups(dt);
check("gem pulled within grab range this frame is collected same frame (pull-before-contact)",
  G.gemEnergy === CFG.GEM.energy && G.pickups.length === 0);
check("pull-then-collect emits exactly one pickup:collected", emitted.length === 1 && emitted[0].type === "pickup:collected");

// --- magnet inactive (G.magnet === 0): no pull at all ------------------------
freshG();
G.magnet = 0;
const gemNoMagnet = { type: "gem", x: 4 * TILE, y: 0, value: CFG.GEM.energy };
G.pickups.push(gemNoMagnet);
updatePickups(dt);
check("gem unmoved when Magnet inactive", gemNoMagnet.x === 4 * TILE);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
