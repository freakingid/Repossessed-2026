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
import { loadLevel, registerEmit, registerBlockerSink } from "./src/level-loader.js";
import {
  initPlayer, updatePlayer, effectiveMoveSpeed,
  applyDamageToPlayer, healPlayer, applyKnockbackToPlayer, registerAbility,
  isCarryingCrate,
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
// Most-recent emit of a type — for reason-specific checks (many crate:dropped fire).
const lastEmitOf = (type) => [...emitted].reverse().find((e) => e.type === type);

// Nav-blocker spy: capture markNavDirty tiles (default sink is a no-op).
const navDirtied = [];
registerBlockerSink({ registerBlocker() {}, markDirty(t) { navDirtied.push(t); } });

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
   11. Carry — pickup (§9, §12 item 2/7): hands-free contact → CARRYING,
   crate spliced + nav dirtied; carrying + contact = no swap.
 * ========================================================================= */
openWorld();
placePlayer(2, 2);
{
  const crate = { type: "crate", x: 3.5 * CFG.TILE, y: 2.5 * CFG.TILE };   // tile (3,2)
  G.crates = [crate];
  navDirtied.length = 0;
  updatePlayer(snap({ move: { x: 1, y: 0 } }), 0.15);                       // step into overlap
  check("pickup: hands-free crate contact enters CARRYING", G.player.loco === "CARRYING");
  check("pickup: carry references the crate (type 'crate')",
    G.player.carry && G.player.carry.entity === crate && G.player.carry.type === "crate");
  check("pickup: crate spliced from G.crates", G.crates.indexOf(crate) === -1 && G.crates.length === 0);
  check("pickup: nav dirtied at the crate's old tile (3,2)", navDirtied.some((t) => t.tx === 3 && t.ty === 2));
  check("pickup: emits crate:pickup", sawEmit("crate:pickup"));
  check("isCarryingCrate true while carrying", isCarryingCrate() === true);
}
// carrying + contact = no swap.
placePlayer(2, 2);
{
  const held = { type: "crate", entity: {} };
  G.player.loco = "CARRYING"; G.player.carry = held;
  const other = { type: "crate", x: 3.5 * CFG.TILE, y: 2.5 * CFG.TILE };
  G.crates = [other];
  updatePlayer(snap({ move: { x: 1, y: 0 } }), 0.15);
  check("carrying + crate contact = no swap (still holding original)", G.player.carry === held);
  check("carrying + crate contact: other crate not picked up", G.crates.indexOf(other) === 0);
}

/* ========================================================================= *
   12. Carry — stationary release / toss (§9, §12 item 7): tosses ≤1.5t to the
   first free tile along aim; returns to NORMAL; re-inserts the crate.
 * ========================================================================= */
openWorld();
placePlayer(3, 3);
{
  G.player.loco = "CARRYING";
  G.player.carry = { type: "crate", entity: { type: "crate" } };
  updatePlayer(snap({ move: { x: 0, y: 0 }, aim: { x: 1, y: 0 }, fireHeld: true }), 0);
  check("toss: returns to NORMAL", G.player.loco === "NORMAL" && G.player.carry === null);
  check("toss: crate re-inserted into G.crates", G.crates.length === 1);
  const c = G.crates[0];
  check("toss: settles 1 tile ahead along aim (≤1.5t, grid-snapped)",
    ((c.x / CFG.TILE) | 0) === 4 && Math.abs(c.x - G.player.x) <= CFG.PLAYER.tossMax);
  check("toss: emits crate:dropped(reason='toss')", lastEmitOf("crate:dropped")?.payload.reason === "toss");
  check("isCarryingCrate false after release", isCarryingCrate() === false);
}

/* ========================================================================= *
   13. Carry — moving release / drop-vault (§9, §5.1, §12 item 7): enters
   VAULTING to +2t, invulnerable + non-colliding for vaultDur; non-walkable
   landing degrades to a toss.
 * ========================================================================= */
// vault passes THROUGH a 1-tile wall (non-colliding) to the +2t landing, invuln.
loadTileGrid([
  "#######",
  "#.#...#",
  "#.#...#",
  "#.....#",
  "#######",
]);
{
  G.player = { x: 1.5 * CFG.TILE, y: 1.5 * CFG.TILE, tx: 1, ty: 1 };
  initPlayer();
  G.crates = []; G.barrels = []; G.spawners = []; G.shots = [];
  G.player.loco = "CARRYING";
  G.player.carry = { type: "crate", entity: { type: "crate" } };
  G.hp = 20;
  const startX = G.player.x;
  updatePlayer(snap({ move: { x: 1, y: 0 }, fireHeld: true }), 0);          // dt=0: enter cleanly, no drift
  check("drop-vault: enters VAULTING", G.player.loco === "VAULTING");
  check("drop-vault: vault dur = CFG.PLAYER.vaultDur", approx(G.player.vault.dur, CFG.PLAYER.vaultDur));
  check("drop-vault: crate dropped + re-inserted on the start tile (1,1)",
    G.crates.length === 1 && ((G.crates[0].x / CFG.TILE) | 0) === 1);
  applyDamageToPlayer(5, "midair");
  check("drop-vault: invulnerable mid-hop (damage no-op)", G.hp === 20);
  for (let i = 0; i < 5; i++) updatePlayer(snap(), 0.1);                    // advance past dur (input ignored while vaulting)
  check("drop-vault: returns to NORMAL after the hop", G.player.loco === "NORMAL" && G.player.vault === null);
  check("drop-vault: lands 2t ahead, passing THROUGH the wall (non-colliding)",
    approx(G.player.x, startX + CFG.PLAYER.vaultHop));
}
// non-walkable landing ⇒ degrade to a toss (no vault).
loadTileGrid([
  "#######",
  "#..#..#",
  "#######",
]);
{
  G.player = { x: 1.5 * CFG.TILE, y: 1.5 * CFG.TILE, tx: 1, ty: 1 };
  initPlayer();
  G.crates = []; G.barrels = []; G.spawners = []; G.shots = [];
  G.player.loco = "CARRYING";
  G.player.carry = { type: "crate", entity: { type: "crate" } };
  updatePlayer(snap({ move: { x: 1, y: 0 }, aim: { x: 1, y: 0 }, fireHeld: true }), 0);
  check("drop-vault degrade: non-walkable landing → NORMAL toss (not VAULTING)",
    G.player.loco === "NORMAL" && G.player.vault === null && G.player.carry === null);
  check("drop-vault degrade: crate tossed / re-inserted", G.crates.length === 1);
}

/* ========================================================================= *
   14. Carry — wall-vault (§9, §12 item 8): 1-thick wall + walkable far side ⇒
   auto-drop + vault to far side; 2-thick ⇒ no vault (bump), crate still carried.
 * ========================================================================= */
loadTileGrid([
  "#######",
  "#.#...#",
  "#######",
]);
{
  G.player = { x: 1.5 * CFG.TILE, y: 1.5 * CFG.TILE, tx: 1, ty: 1 };
  initPlayer();
  G.crates = []; G.barrels = []; G.spawners = []; G.shots = [];
  G.player.loco = "CARRYING";
  G.player.carry = { type: "crate", entity: { type: "crate" } };
  updatePlayer(snap({ move: { x: 1, y: 0 } }), 0.05);                       // walk into the 1-thick wall
  check("wall-vault: 1-thick wall auto-enters VAULTING", G.player.loco === "VAULTING");
  check("wall-vault: crate auto-dropped against the near face (1,1)",
    G.crates.length === 1 && ((G.crates[0].x / CFG.TILE) | 0) === 1);
  check("wall-vault: targets the far side (tile 3)", ((G.player.vault.to.x / CFG.TILE) | 0) === 3);
  for (let i = 0; i < 5; i++) updatePlayer(snap(), 0.1);
  check("wall-vault: lands on the far side (tile 3), back to NORMAL",
    G.player.loco === "NORMAL" && ((G.player.x / CFG.TILE) | 0) === 3);
}
loadTileGrid([
  "########",
  "#.##...#",
  "########",
]);
{
  G.player = { x: 1.5 * CFG.TILE, y: 1.5 * CFG.TILE, tx: 1, ty: 1 };
  initPlayer();
  G.crates = []; G.barrels = []; G.spawners = []; G.shots = [];
  const held = { type: "crate", entity: { type: "crate" } };
  G.player.loco = "CARRYING"; G.player.carry = held;
  updatePlayer(snap({ move: { x: 1, y: 0 } }), 0.05);
  check("wall-vault: 2-thick wall ⇒ no vault (still CARRYING)",
    G.player.loco === "CARRYING" && G.player.carry === held);
  check("wall-vault: 2-thick wall ⇒ crate NOT dropped", G.crates.length === 0);
}

/* ========================================================================= *
   15. Carry — STUN force-drop (real re-insert) + vault status guards (§5.1/§5.2,
   §12 item 7): STUN drops in place; VAULTING cannot start while ENTANGLED/STUNNED.
 * ========================================================================= */
openWorld();
placePlayer(6, 6);
{
  G.player.loco = "CARRYING";
  G.player.carry = { type: "crate", entity: { type: "crate" } };
  G.player.stun = 3.0;
  const origRandom = Math.random; Math.random = () => 0;                    // deterministic stunVec
  updatePlayer(snap({ move: { x: 1, y: 0 }, fireHeld: true }), 0);
  Math.random = origRandom;
  check("stun force-drop: carry cleared, back to NORMAL", G.player.carry === null && G.player.loco === "NORMAL");
  check("stun force-drop: crate re-inserted on the player's tile (6,6)",
    G.crates.length === 1 && ((G.crates[0].x / CFG.TILE) | 0) === 6 && ((G.crates[0].y / CFG.TILE) | 0) === 6);
  check("stun force-drop: emits crate:dropped(reason='stun')", lastEmitOf("crate:dropped")?.payload.reason === "stun");
  check("stunned: no VAULTING started (crate force-dropped first)", G.player.loco === "NORMAL");
}
// ENTANGLED: moving release cannot vault → degrades to a toss.
openWorld();
placePlayer(6, 6);
{
  G.player.loco = "CARRYING";
  G.player.carry = { type: "crate", entity: { type: "crate" } };
  G.player.entangle = 2.0;
  updatePlayer(snap({ move: { x: 1, y: 0 }, aim: { x: 1, y: 0 }, fireHeld: true }), 0);
  check("entangled: moving release cannot vault → degrades to toss (NORMAL)",
    G.player.loco === "NORMAL" && G.player.vault === null && G.player.carry === null);
}
// ENTANGLED: wall-vault cannot start → bump, keep carrying.
loadTileGrid([
  "#######",
  "#.#...#",
  "#######",
]);
{
  G.player = { x: 1.5 * CFG.TILE, y: 1.5 * CFG.TILE, tx: 1, ty: 1 };
  initPlayer();
  G.crates = []; G.barrels = []; G.spawners = []; G.shots = [];
  const held = { type: "crate", entity: { type: "crate" } };
  G.player.loco = "CARRYING"; G.player.carry = held; G.player.entangle = 2.0;
  updatePlayer(snap({ move: { x: 1, y: 0 } }), 0.05);
  check("entangled: wall-vault cannot start → bump, still CARRYING",
    G.player.loco === "CARRYING" && G.player.carry === held && G.crates.length === 0);
}

/* ========================================================================= *
   16. Carry — dropped crate holds a plate (§7.1.6, §12 item 7/9): a crate on a
   '_' keeps its linked door open after the player leaves, until it is removed.
 * ========================================================================= */
loadLevel({
  id: "hold-t", name: "HoldT",
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
{
  // Stand ADJACENT to the plate (tile 2,2), not on it, so the door stays closed
  // until the crate itself presses the plate — then the crate alone holds it.
  G.player.x = 2.5 * CFG.TILE; G.player.y = 2.5 * CFG.TILE;
  G.player._platesPressed = new Set();
  G.player.loco = "CARRYING";
  G.player.carry = { type: "crate", entity: { type: "crate" } };
  check("plate closed while player is off it and hands empty", isWall(3, 1) === true);
  // stationary release aimed at the plate ⇒ crate settles on (3,2) and presses it.
  updatePlayer(snap({ move: { x: 0, y: 0 }, aim: { x: 1, y: 0 }, fireHeld: true }), 0);
  check("crate settled on the plate tile (3,2)",
    G.crates.length === 1 && ((G.crates[0].x / CFG.TILE) | 0) === 3 && ((G.crates[0].y / CFG.TILE) | 0) === 2);
  check("dropped crate presses the '_' (linked door opens)", isWall(3, 1) === false);
  check("stationary release returns to NORMAL", G.player.loco === "NORMAL" && G.player.carry === null);
  G.player.x = 1.5 * CFG.TILE; G.player.y = 3.5 * CFG.TILE;   // player walks away
  updatePlayer(snap({ move: { x: 0, y: 0 } }), 0);
  check("dropped crate holds the plate after the player leaves (door stays open)", isWall(3, 1) === false);
  G.crates = [];                                              // crate removed
  updatePlayer(snap({ move: { x: 0, y: 0 } }), 0);
  check("removing the crate releases the plate (door closes)", isWall(3, 1) === true);
}

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
