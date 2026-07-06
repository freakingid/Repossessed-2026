/* test-barrels-shrapnel.js — headless smoke tests for SPEC-BARRELS Phase 4:
   the SHRAPNEL species (B7, §5.2) — its own G.shrapnel array, NOT the Shot
   shape. Covers:
     · motion (integrates by v*dt) + 1.2 s lifespan expiry (removed at life>=);
     · FREE bounce off walls + crates (per-axis reflect, NO health cost);
     · PUSH crates 0.5 t on contact — crates take NO damage (no hp field);
     · damage-exchange: -1 health per damaging hit vs enemy / player / barrel /
       spawner (barrel adopts the piece's owner via _cause, chain);
     · enemy + spawner deaths route through sweepDeadEnemies/sweepDeadSpawners
       (gems drop, score by owner);
     · a spent piece (health<=0) is destroyed.
   Exercises the REAL modules, never inlined copies. Pure logic, no canvas.
   Run: node test-barrels-shrapnel.js
*/

// --- Minimal browser-global stubs (defensive; house headless style) ----------
globalThis.window ||= globalThis;
globalThis.document ||= { createElement: () => ({ getContext: () => ({}) }) };
globalThis.AudioContext ||= function () {};

import { CFG } from "./src/config.js";
import { G } from "./src/state.js";
import { tileCenter } from "./src/world.js";
import { loadLevel, registerEmit, registerBlockerSink, getEntityFactory } from "./src/level-loader.js";
import { clearNavigators } from "./src/enemies-ai.js";
import { initPlayer } from "./src/player.js";
import { updateShrapnel, fireStateOf, initBarrels } from "./src/barrels.js";

let passed = 0, failed = 0;
function check(name, ok) {
  if (ok) { passed++; } else { failed++; console.error(`FAIL: ${name}`); }
}
const approx = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

const emitted = [];
registerEmit((type, payload) => emitted.push({ type, payload }));
registerBlockerSink({ registerBlocker() {}, markDirty() {} });

const OPEN_ROOM = [
  "###############",
  "#.............#",
  "#.............#",
  "#.............#",
  "#.............#",
  "#.............#",
  "#.............#",
  "#.............#",
  "###############",
];

function loadRoom() {
  loadLevel({
    id: "barrels-shrapnel-room", name: "BarrelsShrapnelRoom",
    tiles: OPEN_ROOM,
    zones: [{ role: "combat", x: 1, y: 1, w: OPEN_ROOM[0].length - 2, h: OPEN_ROOM.length - 2 }],
    placements: [
      { type: "player", x: 1, y: 1 },
      { type: "exit", x: OPEN_ROOM[0].length - 2, y: OPEN_ROOM.length - 2 },
    ],
    spawnRules: [],
  });
}

function resetWorldState() {
  clearNavigators();
  G.shots = []; G.enemies = []; G.pickups = []; G.crates = []; G.barrels = [];
  G.spawners = []; G.lights = []; G.shrapnel = [];
  G.score = 0;
  G.ramp = { enemySpeedMult: 1 };
  G.maxHp = 100; G.overhealCap = 200;
  initPlayer();
  initBarrels();
  G.hp = G.maxHp;
  G.player.iframe = 0;
  G.player.loco = "NORMAL";
  G.player.carry = null;
  // Park the player far from the test area so it never absorbs stray shrapnel.
  G.player.x = tileCenter(1, 1).x; G.player.y = tileCenter(1, 1).y;
}

// The loader placeholder reads x,y as TILE indices (tileCenter'd internally).
function makeBarrel(tx, ty) {
  return getEntityFactory("barrel")({ type: "barrel", x: tx, y: ty });
}
function mkEnemy(type, x, y, over = {}) {
  const cfg = CFG.ENEMY[type] || {};
  return {
    type, x, y, r: cfg.r ?? 12, hp: cfg.hp ?? 4,
    speed: 0, face: 0, kvx: 0, kvy: 0, contact: false, spawn: 0,
    originSpawner: null, boss: !!cfg.boss, points: cfg.points ?? 0, gems: cfg.gems ?? 0, ...over,
  };
}
function mkShrapnel(x, y, owner, over = {}) {
  const shr = CFG.BARREL.shrapnel;
  return { x, y, vx: 0, vy: 0, r: CFG.SHOT.r, dmg: shr.dmg, health: shr.health, life: 0, owner, ...over };
}
const shr = CFG.BARREL.shrapnel;

loadRoom();

/* ========================================================================= *
   1. Motion — a piece integrates by v*dt; life accumulates.
 * ========================================================================= */
{
  resetWorldState();
  const x0 = tileCenter(6, 4).x, y0 = tileCenter(6, 4).y;
  const s = mkShrapnel(x0, y0, "player", { vx: shr.speed, vy: 0 });
  G.shrapnel = [s];

  updateShrapnel(0.05);

  check("motion: x advanced by vx*dt", approx(s.x, x0 + shr.speed * 0.05));
  check("motion: y unchanged", approx(s.y, y0));
  check("motion: life accumulated", approx(s.life, 0.05));
  check("motion: still alive (no target, within lifespan)", G.shrapnel.length === 1);
}

/* ========================================================================= *
   2. Lifespan (1.2 s) — a piece past its lifespan is destroyed.
 * ========================================================================= */
{
  resetWorldState();
  const s = mkShrapnel(tileCenter(6, 4).x, tileCenter(6, 4).y, "player", { life: shr.lifespan - 0.01 });
  G.shrapnel = [s];

  updateShrapnel(0.05);                                     // life -> lifespan + 0.04

  check("lifespan: piece removed at life >= lifespan (1.2 s)", G.shrapnel.length === 0);
}

/* ========================================================================= *
   3. Free bounce off a WALL — per-axis reflect, NO health cost.
 * ========================================================================= */
{
  resetWorldState();
  const s = mkShrapnel(tileCenter(13, 4).x, tileCenter(13, 4).y, "player", { vx: shr.speed, vy: 0 });
  G.shrapnel = [s];

  updateShrapnel(0.1);                                      // next x lands in the right wall (tile 14)

  check("wall bounce: vx reflects (now negative)", s.vx < 0);
  check("wall bounce: FULL retention (|vx| == speed)", approx(Math.abs(s.vx), shr.speed));
  check("wall bounce: NO health cost (still 2)", s.health === shr.health);
  check("wall bounce: piece survives", G.shrapnel.length === 1);
}

/* ========================================================================= *
   4. Free bounce off a CRATE + 0.5 t push — reflect, NO health cost, crate
      moves cratePush along the piece's incoming direction, crate takes NO
      damage (it has no hp field, §13.16).
 * ========================================================================= */
{
  resetWorldState();
  const crate = { type: "crate", x: tileCenter(7, 4).x, y: tileCenter(7, 4).y };
  G.crates = [crate];
  const cx0 = crate.x;
  const s = mkShrapnel(tileCenter(6, 4).x, tileCenter(6, 4).y, "player", { vx: shr.speed, vy: 0 });
  G.shrapnel = [s];

  updateShrapnel(0.05);                                     // next x overlaps the crate footprint

  check("crate bounce: vx reflects (now negative)", s.vx < 0);
  check("crate bounce: NO health cost (still 2)", s.health === shr.health);
  check("crate push: crate moved cratePush (+x)", approx(crate.x, cx0 + shr.cratePush));
  check("crate push: crate y unchanged", approx(crate.y, tileCenter(7, 4).y));
  check("crate push: crate takes NO damage (no hp field)", crate.hp === undefined);
  check("crate bounce: piece survives", G.shrapnel.length === 1);
}

/* ========================================================================= *
   5. Damage-exchange: -1 health per damaging hit vs ENEMY / PLAYER / BARREL /
      SPAWNER. Each is a single overlapping hit; the piece (health 2) survives
      with health 1.
 * ========================================================================= */
{
  // vs ENEMY
  resetWorldState();
  const e = mkEnemy("zombie", tileCenter(6, 4).x, tileCenter(6, 4).y, { hp: 8 });
  G.enemies = [e];
  const s1 = mkShrapnel(e.x, e.y, "player");
  G.shrapnel = [s1];
  updateShrapnel(0.001);
  check("exchange vs enemy: enemy -dmg", e.hp === 8 - shr.dmg);
  check("exchange vs enemy: piece -1 health", s1.health === shr.health - 1);
  check("exchange vs enemy: piece survives (health 1)", G.shrapnel.indexOf(s1) !== -1);

  // vs PLAYER (i-frames down)
  resetWorldState();
  G.player.x = tileCenter(6, 4).x; G.player.y = tileCenter(6, 4).y; G.player.iframe = 0;
  const hp0 = G.hp;
  const s2 = mkShrapnel(G.player.x, G.player.y, "enemy");
  G.shrapnel = [s2];
  updateShrapnel(0.001);
  check("exchange vs player: player -dmg", G.hp === hp0 - shr.dmg);
  check("exchange vs player: i-frames armed", G.player.iframe > 0);
  check("exchange vs player: piece -1 health", s2.health === shr.health - 1);

  // vs BARREL (adopts the piece's owner via _cause -> chain)
  resetWorldState();
  const b = makeBarrel(6, 4);
  G.barrels = [b];
  const s3 = mkShrapnel(b.x, b.y, "player");
  G.shrapnel = [s3];
  updateShrapnel(0.001);
  check("exchange vs barrel: barrel -dmg (4 -> 3)", b.hp === CFG.BARREL.hp - shr.dmg);
  check("exchange vs barrel: barrel ADOPTS 'player-shrapnel' _cause", b._cause === "player-shrapnel");
  check("exchange vs barrel: barrel now smoldering", fireStateOf(b) === "smolder");
  check("exchange vs barrel: piece -1 health", s3.health === shr.health - 1);

  // vs SPAWNER
  resetWorldState();
  const sp = { type: "spawner", x: tileCenter(6, 4).x, y: tileCenter(6, 4).y, r: 16, hp: 6, points: 300, gems: 3 };
  G.spawners = [sp];
  const s4 = mkShrapnel(sp.x, sp.y, "player");
  G.shrapnel = [s4];
  updateShrapnel(0.001);
  check("exchange vs spawner: spawner -dmg (6 -> 5)", sp.hp === 5);
  check("exchange vs spawner: piece -1 health", s4.health === shr.health - 1);
}

/* ========================================================================= *
   6. A spent piece (health <= 0) is destroyed — two damaging hits in one frame
      (two overlapping barrels) burn both health points and remove the piece.
 * ========================================================================= */
{
  resetWorldState();
  const b1 = makeBarrel(6, 4), b2 = makeBarrel(6, 4);       // stacked -> the piece overlaps both
  G.barrels = [b1, b2];
  const s = mkShrapnel(b1.x, b1.y, "player");
  G.shrapnel = [s];

  updateShrapnel(0.001);

  check("spent: both barrels damaged", b1.hp === CFG.BARREL.hp - shr.dmg && b2.hp === CFG.BARREL.hp - shr.dmg);
  check("spent: piece destroyed after 2 hits (health 0)", G.shrapnel.length === 0);
}

/* ========================================================================= *
   7. Enemy + spawner deaths route through the shared sweeps — gems drop, the
      dead are spliced, score by owner (player-shrapnel scores, enemy-shrapnel 0).
 * ========================================================================= */
{
  // Enemy death via player-shrapnel -> swept, scored, gems dropped.
  resetWorldState();
  const e = mkEnemy("zombie", tileCenter(6, 4).x, tileCenter(6, 4).y, { hp: 1 });
  G.enemies = [e];
  G.shrapnel = [mkShrapnel(e.x, e.y, "player")];
  updateShrapnel(0.001);
  check("sweep: enemy killed + swept", G.enemies.length === 0);
  check("sweep: enemy gems dropped", G.pickups.length === CFG.ENEMY.zombie.gems);
  check("sweep: player-shrapnel enemy kill scores", G.score === CFG.ENEMY.zombie.points);

  // Spawner death via enemy-shrapnel -> swept, gems, but scores 0.
  resetWorldState();
  const sp = { type: "spawner", x: tileCenter(6, 4).x, y: tileCenter(6, 4).y, r: 16, hp: 1, points: 300, gems: 3 };
  G.spawners = [sp];
  G.shrapnel = [mkShrapnel(sp.x, sp.y, "enemy")];
  updateShrapnel(0.001);
  check("sweep: spawner killed + swept", G.spawners.length === 0);
  check("sweep: spawner gems dropped", G.pickups.length === 3);
  check("sweep: enemy-shrapnel spawner kill scores 0", G.score === 0);
}

/* --- summary --------------------------------------------------------------- */
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
