/* test-player.js — headless smoke tests for player.js (SPEC-PLAYER Phase 5:
   ordering skeleton, NORMAL locomotion, two-source collision, status overlays,
   world hooks, damage/heal/knockback sinks). No canvas.

   Exercises the REAL modules (config/state/world/level-loader/input/player),
   not inlined copies. player.js's import graph touches window/navigator ONLY
   inside input.js's device-glue functions (installDeviceListeners/pollGamepad),
   which these tests never call — so no browser-global stubs are needed (same as
   test-level-loader.js). Run: node test-player.js
*/
import { readFileSync } from "node:fs";
import { CFG } from "./src/config.js";
import { G } from "./src/state.js";
import { loadTileGrid, isWall, map } from "./src/world.js";
import { loadLevel, registerEmit } from "./src/level-loader.js";
import {
  initPlayer, updatePlayer, effectiveMoveSpeed,
  applyDamageToPlayer, healPlayer, applyKnockbackToPlayer, registerAbility,
} from "./src/player.js";

let passed = 0, failed = 0;
function check(name, ok) {
  if (ok) { passed++; } else { failed++; console.error(`FAIL: ${name}`); }
}
const approx = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

/* ---- shared fixtures ----------------------------------------------------- */
// An all-floor room with a solid border wall.
function openWorld(cols = 15, rows = 11) {
  const tiles = [];
  for (let y = 0; y < rows; y++) {
    let row = "";
    for (let x = 0; x < cols; x++)
      row += (x === 0 || y === 0 || x === cols - 1 || y === rows - 1) ? "#" : ".";
    tiles.push(row);
  }
  loadTileGrid(tiles);
}
// Fresh player centered on a tile, transient collision arrays cleared.
function placePlayer(tx, ty) {
  G.player = { x: (tx + 0.5) * CFG.TILE, y: (ty + 0.5) * CFG.TILE, tx, ty };
  initPlayer();
  G.crates = []; G.barrels = []; G.spawners = []; G.shots = [];
}
function snap(o = {}) {
  return Object.assign({
    move: { x: 0, y: 0 }, aim: { x: 1, y: 0 }, fireHeld: false,
    nova: false, lightning: false, pause: false, confirm: false, back: false, mute: false,
    mode: "keyboard",
  }, o);
}

// Global emit spy (level-loader routes every emit here once registered).
const emitted = [];
registerEmit((type, payload) => emitted.push({ type, payload }));
const sawEmit = (type) => emitted.some((e) => e.type === type);

/* ========================================================================= *
   1. Movement + slide (§12.2)
 * ========================================================================= */
// per-axis wall slide at an L-corner (moveBody does x then y).
loadTileGrid([
  "#######",
  "#.....#",
  "#.##..#",
  "#.....#",
  "#######",
]);
{
  G.player = { x: 1.5 * CFG.TILE, y: 1.5 * CFG.TILE, tx: 1, ty: 1 };
  initPlayer();
  G.crates = []; G.barrels = []; G.spawners = []; G.shots = [];
  const sx = G.player.x, sy = G.player.y;
  const s = 1 / Math.SQRT2;
  updatePlayer(snap({ move: { x: s, y: s } }), 0.5);   // toward the (2,2) corner
  check("moveBody slides at a wall corner: x advances, y reverts",
    G.player.x > sx && approx(G.player.y, sy));
}

// spawner is solid to a hands-free player (blocked).
openWorld();
placePlayer(2, 2);
G.spawners = [{ type: "spawner", x: 3.5 * CFG.TILE, y: 2.5 * CFG.TILE }];
{
  const sx = G.player.x;
  updatePlayer(snap({ move: { x: 1, y: 0 } }), 0.1);   // small step lands overlapping the spawner
  check("hands-free player blocked by a spawner", approx(G.player.x, sx));
}

// a free crate is a pickup trigger (NOT a wall) to a hands-free player.
placePlayer(2, 2);
G.crates = [{ type: "crate", x: 3.5 * CFG.TILE, y: 2.5 * CFG.TILE }];
{
  const sx = G.player.x;
  updatePlayer(snap({ move: { x: 1, y: 0 } }), 0.1);
  check("hands-free player NOT blocked by a free crate (pickup trigger)", G.player.x > sx);
}

// the same crate IS solid to a CARRYING player.
placePlayer(2, 2);
G.crates = [{ type: "crate", x: 3.5 * CFG.TILE, y: 2.5 * CFG.TILE }];
G.player.loco = "CARRYING";
G.player.carry = { type: "crate", entity: {} };   // carrying a DIFFERENT crate
{
  const sx = G.player.x;
  updatePlayer(snap({ move: { x: 1, y: 0 } }), 0.1);
  check("CARRYING player blocked by a crate", approx(G.player.x, sx));
}

/* ========================================================================= *
   2. Speed stacking is MULTIPLICATIVE (§12.3, P3)
 * ========================================================================= */
check("effective speed: base (no modifiers) = 112",
  approx(effectiveMoveSpeed({ loco: "NORMAL", entangle: 0, stun: 0 }), CFG.PLAYER.speed));
check("effective speed: carry only = 112 × 0.85",
  approx(effectiveMoveSpeed({ loco: "CARRYING", entangle: 0, stun: 0 }), 112 * 0.85));
check("effective speed: carry × entangle = 112 × 0.85 × 0.35 (multiplicative)",
  approx(effectiveMoveSpeed({ loco: "CARRYING", entangle: 1, stun: 0 }), 112 * 0.85 * 0.35));
check("effective speed: carry × entangle × stun = 112 × 0.85 × 0.35 × 0.70",
  approx(effectiveMoveSpeed({ loco: "CARRYING", entangle: 1, stun: 1 }), 112 * 0.85 * 0.35 * 0.70));

/* ========================================================================= *
   3. Damage / heal intake (§12.6)
 * ========================================================================= */
openWorld();
placePlayer(3, 3);
G.hp = 20; G.player.iframe = 0;
applyDamageToPlayer(5, "test");
check("applyDamageToPlayer subtracts hp", G.hp === 15);
check("applyDamageToPlayer arms 0.4s iframe", approx(G.player.iframe, CFG.PLAYER.iframe));
applyDamageToPlayer(5, "test");
check("applyDamageToPlayer is a no-op during iframe", G.hp === 15);

G.player.iframe = 0; G.player.loco = "VAULTING";
applyDamageToPlayer(5, "test");
check("applyDamageToPlayer is a no-op during VAULTING", G.hp === 15);
G.player.loco = "NORMAL";

G.hp = 25; healPlayer(20);
check("healPlayer clamps at overhealCap (30)", G.hp === 30);
G.hp = 18; healPlayer(3);
check("healPlayer adds below the cap", G.hp === 21);

G.hp = 5; G.player.iframe = 0; G.player.loco = "NORMAL";
applyDamageToPlayer(100, "lethal");
check("lethal damage sets loco DEAD", G.player.loco === "DEAD");
check("lethal damage emits player:died", sawEmit("player:died"));
// death is final: further updates are inert.
const deadX = G.player.x;
updatePlayer(snap({ move: { x: 1, y: 0 } }), 0.5);
check("DEAD player does not move (death is final)", approx(G.player.x, deadX));

/* ========================================================================= *
   4. ENTANGLED shave (§12.10) — dt=0 isolates the shave from the timer decay
 * ========================================================================= */
openWorld();
placePlayer(5, 5);
G.player.entangle = 2.5;
updatePlayer(snap({ move: { x: 1, y: 0 } }), 0);            // baseline dir, no prior → no shave
check("entangle: first input sets baseline, no shave", approx(G.player.entangle, 2.5));
updatePlayer(snap({ move: { x: 0, y: 1 } }), 0);            // 90° turn ≥ 60° → shave 0.3
check("entangle: ≥60° input-dir change subtracts 0.3s", approx(G.player.entangle, 2.2));
updatePlayer(snap({ move: { x: Math.cos(2 * Math.PI / 3), y: Math.sin(2 * Math.PI / 3) } }), 0); // 30° turn < 60°
check("entangle: sub-threshold change does not shave", approx(G.player.entangle, 2.2));

/* ========================================================================= *
   5. STUNNED (§5.2) — move replaced by a re-rolled random unit vector;
   force-drops a carried crate. Deterministic via a stubbed Math.random.
 * ========================================================================= */
openWorld();
placePlayer(7, 5);
G.player.stun = 3.0;
G.player.loco = "CARRYING";
G.player.carry = { type: "crate", entity: {} };
{
  const origRandom = Math.random;
  Math.random = () => 0.125;                              // angle = π/4 → stunVec ≈ (0.707, 0.707)
  const sx = G.player.x, sy = G.player.y;
  updatePlayer(snap({ move: { x: 1, y: 0 } }), 0.1);     // input is +x only …
  Math.random = origRandom;

  check("stun: stunVec is a unit vector", approx(Math.hypot(G.player.stunVec.x, G.player.stunVec.y), 1));
  check("stun: move replaced by the random vector (y moves though input y=0)", G.player.y - sy > 0);
  const spd = 112 * CFG.PLAYER.stunMult * 0.1;           // eff = base × stunMult; dt=0.1
  check("stun: displacement magnitude = base × stunMult × dt",
    approx(Math.hypot(G.player.x - sx, G.player.y - sy), spd, 1e-3));
  check("stun: force-drops the carried crate (carry cleared)", G.player.carry === null);
  check("stun: force-drop emits crate:dropped", sawEmit("crate:dropped"));
}

/* ========================================================================= *
   6. World hooks (§12.9) — plate press + key spend, through the loader seams
 * ========================================================================= */
// --- pressure plate opens/closes its linked door ---
loadLevel({
  id: "plate-t", name: "PlateT",
  tiles: [
    "#######",
    "#..d..#",   // plate-door 'd' at (3,1)
    "#.._..#",   // plate '_'  at (3,2)
    "#.....#",
    "#######",
  ],
  placements: [
    { type: "player", x: 1, y: 3 }, { type: "exit", x: 5, y: 3 },
    { type: "door", x: 3, y: 1, id: "gate" }, { type: "plate", x: 3, y: 2, id: "pad" },
  ],
  links: [{ plate: "pad", door: "gate" }],
});
initPlayer();
check("linked door starts closed (solid)", isWall(3, 1) === true);
G.player.x = 3.5 * CFG.TILE; G.player.y = 2.5 * CFG.TILE; G.player._platesPressed = new Set();
updatePlayer(snap(), 0);
check("standing on a '_' plate opens its linked door", isWall(3, 1) === false);
G.player.x = 1.5 * CFG.TILE; G.player.y = 3.5 * CFG.TILE;   // step off the plate
updatePlayer(snap(), 0);
check("leaving the '_' plate closes its linked door", isWall(3, 1) === true);

// --- key spend on a closed 'D' ---
const lockedDef = {
  id: "lock-t", name: "LockT",
  tiles: [
    "#######",
    "#.D...#",   // locked door 'D' at (2,1) — pure key tile (no placement/link)
    "#.....#",
    "#######",
  ],
  placements: [{ type: "player", x: 1, y: 2 }, { type: "exit", x: 5, y: 2 }],
};
// keys ≥ 1 → spend one and open, then pass through.
loadLevel(lockedDef);
initPlayer();
G.keys = 1;
G.player.x = 1.5 * CFG.TILE; G.player.y = 1.5 * CFG.TILE;
{
  const sx = G.player.x;
  check("locked 'D' starts closed", isWall(2, 1) === true);
  updatePlayer(snap({ move: { x: 1, y: 0 } }), 0.1);
  check("bumping 'D' with a key spends it (keys 1→0)", G.keys === 0);
  check("spent key opens the 'D' door (now passable)", isWall(2, 1) === false);
  check("player passes through the opened door", G.player.x > sx);
  check("key spend emits door:unlocked", sawEmit("door:unlocked"));
}
// keys = 0 → just blocked, no spend, door stays closed.
loadLevel(lockedDef);       // fresh: door closed again
initPlayer();
G.keys = 0;
G.player.x = 1.5 * CFG.TILE; G.player.y = 1.5 * CFG.TILE;
{
  const sx = G.player.x;
  updatePlayer(snap({ move: { x: 1, y: 0 } }), 0.1);
  check("keys=0: 'D' stays closed", isWall(2, 1) === true);
  check("keys=0: player is blocked by the 'D'", approx(G.player.x, sx));
  check("keys=0: no key spent (stays 0)", G.keys === 0);
}

/* ========================================================================= *
   7. Knockback (§6.2) — separate integration, exp decay, still collides
 * ========================================================================= */
openWorld();
placePlayer(7, 5);
applyKnockbackToPlayer(1, 0, CFG.PLAYER.knockbackImpulse);
check("applyKnockbackToPlayer sets kv = unit(dir) × impulse", approx(G.player.kvx, CFG.PLAYER.knockbackImpulse) && G.player.kvy === 0);
{
  const x0 = G.player.x;
  updatePlayer(snap(), 0.05);
  check("knockback displaces the player", G.player.x > x0);
  check("knockback velocity decays", G.player.kvx > 0 && G.player.kvx < CFG.PLAYER.knockbackImpulse);
  for (let i = 0; i < 200; i++) updatePlayer(snap(), 0.05);
  check("knockback settles to rest (zeroed under threshold)", G.player.kvx === 0 && G.player.kvy === 0);
}

/* ========================================================================= *
   8. Abilities seam (§10) — edge-triggered, locked while stunned
 * ========================================================================= */
openWorld();
placePlayer(7, 5);
let novaCalls = 0;
registerAbility("nova", () => { novaCalls++; });
updatePlayer(snap({ nova: true }), 0.016);
check("nova fires on rising edge", novaCalls === 1);
updatePlayer(snap({ nova: true }), 0.016);
check("nova does not re-fire while held", novaCalls === 1);
updatePlayer(snap({ nova: false }), 0.016);
G.player.stun = 3.0;
updatePlayer(snap({ nova: true }), 0.016);
check("nova is locked while STUNNED", novaCalls === 1);
registerAbility("nova", null);   // reset to no-op

/* ========================================================================= *
   9. initPlayer data shape (§2)
 * ========================================================================= */
G.player = { x: 100, y: 200, tx: 3, ty: 6 };
initPlayer();
check("initPlayer preserves loader-set position", G.player.x === 100 && G.player.tx === 3);
check("initPlayer sets loco NORMAL", G.player.loco === "NORMAL");
check("initPlayer sets r = CFG.PLAYER.r", G.player.r === CFG.PLAYER.r);
check("initPlayer sets carry null / iframe 0 / cooldown 0",
  G.player.carry === null && G.player.iframe === 0 && G.player.cooldown === 0);

/* ========================================================================= *
   10. Import discipline (§11) — config/state/world/level-loader/input ONLY
 * ========================================================================= */
const src = readFileSync(new URL("./src/player.js", import.meta.url), "utf8");
const imports = [...src.matchAll(/from\s+["'](.+?)["']/g)].map((m) => m[1]);
const allowed = new Set(["./config.js", "./state.js", "./world.js", "./level-loader.js", "./input.js"]);
check("player.js imports only config/state/world/level-loader/input",
  imports.length > 0 && imports.every((p) => allowed.has(p)));
check("player.js does not import abilities/enemies/projectiles/combat",
  imports.every((p) => !/(abilities|enemies|projectiles|combat)/.test(p)));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
