/* test-barrels-carry.js — headless smoke tests for SPEC-BARRELS Phase 3:
   the carry/kick integration (player.js B5/B6) + the roll physics
   (barrels.js B3). Covers:
     · pickup a barrel (carry.type "barrel", spliced from G.barrels);
     · carriedBarrel() accessor (barrel yes / crate no / hands-free no);
     · release: stationary PLACE (static) + moving KICK (rolling) — BOTH
       re-insert into G.barrels (splice-out symmetry);
     · no vault / wall-vault / crate-bumper pushback for a carried barrel;
     · enemy melee -> player damaged AND carried barrel -1 (via the seam);
     · roll integrator: exponential decel; bounce off wall/crate/spawner/
       other-barrel at 0.6; settle < stopSpeed -> static + nav-dirty; rolling
       impact >= 3 t/s (enemy -1, barrel -1 & -40% speed); below threshold
       inert; player takes NO roll damage; barrel-vs-barrel bounce, no damage.
   NO detonation/shrapnel resolution yet (Phase 4 owes that) — a kicked/carried
   barrel CAN reach hp<=0 here but must NOT spawn shrapnel.
   Exercises the REAL modules, never inlined copies. Pure logic, no canvas.
   Run: node test-barrels-carry.js
*/

// --- Minimal browser-global stubs (defensive; house headless style) ----------
globalThis.window ||= globalThis;
globalThis.document ||= { createElement: () => ({ getContext: () => ({}) }) };
globalThis.AudioContext ||= function () {};

import { CFG } from "./src/config.js";
import { G } from "./src/state.js";
import { tileCenter, loadTileGrid, isWall } from "./src/world.js";
import { loadLevel, registerEmit, registerBlockerSink, getEntityFactory } from "./src/level-loader.js";
import { clearNavigators } from "./src/enemies-ai.js";
import {
  initPlayer, updatePlayer, carriedBarrel, notifyCarriedBarrelDestroyed, isCarryingCrate,
} from "./src/player.js";
import { __meleeExchange } from "./src/enemies.js";
import {
  kickBarrel, updateBarrels, damageBarrel, fireStateOf, initBarrels,
} from "./src/barrels.js";

let passed = 0, failed = 0;
function check(name, ok) {
  if (ok) { passed++; } else { failed++; console.error(`FAIL: ${name}`); }
}
const approx = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

// Emit spy (level-loader routes every emit here once registered).
const emitted = [];
registerEmit((type, payload) => emitted.push({ type, payload }));
const sawEmit = (type) => emitted.some((e) => e.type === type);
const lastEmitOf = (type) => [...emitted].reverse().find((e) => e.type === type);

// Nav-blocker spy: capture markNavDirty tiles (default sink is a no-op).
const navDirtied = [];
registerBlockerSink({ registerBlocker() {}, markDirty(t) { navDirtied.push(t); } });

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
    id: "barrels-carry-room", name: "BarrelsCarryRoom",
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
  G.shots = []; G.enemies = []; G.pickups = []; G.crates = []; G.barrels = []; G.spawners = []; G.lights = [];
  G.score = 0;
  G.ramp = { enemySpeedMult: 1 };
  G.maxHp = 100; G.overhealCap = 200;
  initPlayer();
  initBarrels();
  G.hp = G.maxHp;
  G.player.iframe = 0;
  G.player.loco = "NORMAL";
  G.player.carry = null;
}

// A decorated barrel via the registered factory (mirrors test-barrels.js).
function makeBarrel(tx = 0, ty = 0) {
  return getEntityFactory("barrel")({ type: "barrel", x: tx, y: ty });
}
// Place one decorated barrel into G.barrels at a tile.
function placeBarrel(tx, ty) {
  const b = makeBarrel(tx, ty);
  G.barrels.push(b);
  return b;
}
// Minimal enemy (mirrors test-enemies-combat.js's mkEnemy).
function mkEnemy(type, x, y, over = {}) {
  const cfg = CFG.ENEMY[type] || {};
  return {
    type, x, y, r: cfg.r ?? 12, hp: cfg.hp ?? 4,
    speed: 0, face: 0, kvx: 0, kvy: 0, contact: false, spawn: 0,
    originSpawner: null, boss: !!cfg.boss, points: cfg.points ?? 0, gems: cfg.gems ?? 0, ...over,
  };
}
function snap(o = {}) {
  return Object.assign({
    move: { x: 0, y: 0 }, aim: { x: 1, y: 0 }, fireHeld: false,
    nova: false, lightning: false, pause: false, confirm: false, back: false, mute: false,
    mode: "keyboard",
  }, o);
}
const speedOf = (b) => Math.hypot(b.vx, b.vy);

loadRoom();

/* ========================================================================= *
   1. Pickup (B5/B6) — hands-free barrel overlap -> CARRYING, barrel spliced
      from G.barrels, carry.type "barrel", nav-dirty + barrel:pickup emit.
 * ========================================================================= */
{
  resetWorldState();
  G.player.x = tileCenter(6, 4).x; G.player.y = tileCenter(6, 4).y;
  const barrel = placeBarrel(6, 4);                          // sits exactly on the player
  navDirtied.length = 0; emitted.length = 0;

  updatePlayer(snap(), 0.05);                                // hands-free, no move -> pickup

  check("pickup: enters CARRYING", G.player.loco === "CARRYING");
  check("pickup: carry.type 'barrel', references the barrel",
    G.player.carry && G.player.carry.type === "barrel" && G.player.carry.entity === barrel);
  check("pickup: barrel spliced from G.barrels", G.barrels.indexOf(barrel) === -1 && G.barrels.length === 0);
  check("pickup: nav dirtied at the barrel's old tile (6,4)", navDirtied.some((t) => t.tx === 6 && t.ty === 4));
  check("pickup: emits barrel:pickup", sawEmit("barrel:pickup"));
  check("pickup: isCarryingCrate() stays false (barrel is not a crate)", isCarryingCrate() === false);
}

/* ========================================================================= *
   2. carriedBarrel() accessor (B5) — barrel yes / crate no / hands-free no;
      notifyCarriedBarrelDestroyed clears WITHOUT re-inserting (Phase-4 sink).
 * ========================================================================= */
{
  resetWorldState();
  const barrel = makeBarrel();
  G.player.loco = "CARRYING"; G.player.carry = { type: "barrel", entity: barrel };
  check("carriedBarrel(): returns the held barrel", carriedBarrel() === barrel);

  G.player.carry = { type: "crate", entity: {} };
  check("carriedBarrel(): null while carrying a crate", carriedBarrel() === null);

  G.player.loco = "NORMAL"; G.player.carry = null;
  check("carriedBarrel(): null hands-free", carriedBarrel() === null);

  // notifyCarriedBarrelDestroyed: clears carry + loco, does NOT re-insert.
  G.player.loco = "CARRYING"; G.player.carry = { type: "barrel", entity: barrel }; G.barrels = [];
  notifyCarriedBarrelDestroyed();
  check("notifyCarriedBarrelDestroyed: carry cleared", G.player.carry === null);
  check("notifyCarriedBarrelDestroyed: loco -> NORMAL", G.player.loco === "NORMAL");
  check("notifyCarriedBarrelDestroyed: NOT re-inserted (detonate-in-hand path)",
    G.barrels.indexOf(barrel) === -1);
}

/* ========================================================================= *
   3. Stationary release = PLACE upright static (B6) — re-inserts into
      G.barrels, never rolls, settles 1 tile along aim, nav-dirty + emit.
 * ========================================================================= */
{
  resetWorldState();
  G.player.x = tileCenter(6, 4).x; G.player.y = tileCenter(6, 4).y;
  const barrel = makeBarrel();
  G.player.loco = "CARRYING"; G.player.carry = { type: "barrel", entity: barrel };
  navDirtied.length = 0; emitted.length = 0;

  updatePlayer(snap({ move: { x: 0, y: 0 }, aim: { x: 1, y: 0 }, fireHeld: true }), 0);

  check("place: returns to NORMAL, carry cleared", G.player.loco === "NORMAL" && G.player.carry === null);
  check("place: barrel re-inserted into G.barrels", G.barrels.indexOf(barrel) !== -1 && G.barrels.length === 1);
  check("place: static (rolling false, vx/vy 0)", barrel.rolling === false && barrel.vx === 0 && barrel.vy === 0);
  check("place: settles 1 tile ahead along aim (7,4), grid-snapped",
    barrel.x === tileCenter(7, 4).x && barrel.y === tileCenter(7, 4).y);
  check("place: emits barrel:placed(reason='place')", lastEmitOf("barrel:placed")?.payload.reason === "place");
  check("place: nav dirtied at the settle tile (7,4)", navDirtied.some((t) => t.tx === 7 && t.ty === 4));
}

/* ========================================================================= *
   4. Moving release = KICK it rolling (B6/B3) — re-inserts into G.barrels,
      rolling true, velocity = aim unit * kick.speed, dropped on player's tile.
 * ========================================================================= */
{
  resetWorldState();
  G.player.x = tileCenter(6, 4).x; G.player.y = tileCenter(6, 4).y;
  const barrel = makeBarrel();
  G.player.loco = "CARRYING"; G.player.carry = { type: "barrel", entity: barrel };
  emitted.length = 0;

  updatePlayer(snap({ move: { x: 1, y: 0 }, aim: { x: 1, y: 0 }, fireHeld: true }), 0);

  check("kick: returns to NORMAL, carry cleared", G.player.loco === "NORMAL" && G.player.carry === null);
  check("kick: barrel re-inserted into G.barrels", G.barrels.indexOf(barrel) !== -1 && G.barrels.length === 1);
  check("kick: rolling true", barrel.rolling === true);
  check("kick: velocity = aim unit * kick.speed (+x)",
    approx(barrel.vx, CFG.BARREL.kick.speed) && approx(barrel.vy, 0));
  check("kick: dropped on the player's current tile (6,4)",
    barrel.x === tileCenter(6, 4).x && barrel.y === tileCenter(6, 4).y);
  check("kick: emits barrel:kicked", sawEmit("barrel:kicked"));
}

/* ========================================================================= *
   5. Enemy melee -> player damaged AND carried barrel -1 (B5) — via the
      registerBarrelDamage seam. Also proves NO crate-bumper pushback (a real
      exchange happens: the enemy takes its 2, not a damage-free bump).
 * ========================================================================= */
{
  resetWorldState();
  G.player.x = tileCenter(6, 4).x; G.player.y = tileCenter(6, 4).y;
  const barrel = makeBarrel();
  G.player.loco = "CARRYING"; G.player.carry = { type: "barrel", entity: barrel };
  const z = mkEnemy("zombie", G.player.x + 5, G.player.y, { hp: 8 });   // overlapping
  G.enemies = [z];
  const hp0 = G.hp;

  __meleeExchange();

  check("melee: player takes normal melee damage (zombie 3)", G.hp === hp0 - CFG.ENEMY.zombie.melee);
  check("melee: carried barrel takes 1 (4 -> 3)", barrel.hp === 3);
  check("melee: barrel tagged _cause 'enemy-zombie'", barrel._cause === "enemy-zombie");
  check("melee: barrel fireState now smolder (hp 3)", fireStateOf(barrel) === "smolder");
  check("melee: NO carried-barrel pushback (real exchange — enemy took 2)", z.hp === 6);
}

/* ========================================================================= *
   6. Kick integrator basics (B3) — kickBarrel sets rolling + velocity;
      updateBarrels applies exponential decel with no wall in the way.
 * ========================================================================= */
{
  resetWorldState();
  const b = placeBarrel(6, 4);
  kickBarrel(b, 1, 0);
  check("kickBarrel: rolling true", b.rolling === true);
  check("kickBarrel: speed == kick.speed", approx(speedOf(b), CFG.BARREL.kick.speed));

  const s0 = speedOf(b);
  updateBarrels(0.05);
  const s1 = speedOf(b);
  check("roll: exponential decel — speed decreases", s1 < s0);
  check("roll: one-step decay matches exp(-friction*dt)",
    approx(s1, CFG.BARREL.kick.speed * Math.exp(-CFG.BARREL.kick.friction * 0.05), 0.5));
  updateBarrels(0.05);
  check("roll: monotonic decel over a second step", speedOf(b) < s1);
}

/* ========================================================================= *
   7. Settle (B3) — below stopSpeed -> rolling false, velocity 0, tile-aligned,
      nav-dirty (a blocker again).
 * ========================================================================= */
{
  resetWorldState();
  const b = placeBarrel(6, 4);
  b.rolling = true; b.vx = 20; b.vy = 0;                     // below stopSpeed (30) after friction
  navDirtied.length = 0;

  updateBarrels(0.02);

  check("settle: rolling false", b.rolling === false);
  check("settle: velocity zeroed", b.vx === 0 && b.vy === 0);
  check("settle: tile-aligned to (6,4)", b.x === tileCenter(6, 4).x && b.y === tileCenter(6, 4).y);
  check("settle: nav dirtied at the settle tile (6,4)", navDirtied.some((t) => t.tx === 6 && t.ty === 4));
}

/* ========================================================================= *
   8. Bounce off a WALL at 0.6 retention (B3) — vx reflects (then friction).
 * ========================================================================= */
{
  resetWorldState();
  const b = placeBarrel(13, 4);                             // adjacent to the right wall (tile 14)
  b.rolling = true; b.vx = CFG.BARREL.kick.speed; b.vy = 0;

  updateBarrels(0.1);                                       // one step reaches the wall tile

  check("wall bounce: vx reflects (now negative)", b.vx < 0);
  const expected = -CFG.BARREL.kick.speed * CFG.BARREL.kick.bounce * Math.exp(-CFG.BARREL.kick.friction * 0.1);
  check("wall bounce: retention 0.6 (× friction)", approx(b.vx, expected, 0.5));
  check("wall bounce: still rolling (above stopSpeed)", b.rolling === true);
}

/* ========================================================================= *
   9. Bounce off a CRATE / SPAWNER / OTHER BARREL (B3) — all solid; reflect,
      no damage to anyone (barrel-vs-barrel is bounce-only, OQ-B1).
 * ========================================================================= */
function bounceOffBlocker(name, place) {
  resetWorldState();
  const b = placeBarrel(6, 4);                              // x=208
  b.rolling = true; b.vx = CFG.BARREL.kick.speed; b.vy = 0;
  const blocker = place();                                  // one tile to the +x (x=240)
  updateBarrels(0.1);
  check(`${name} bounce: vx reflects (now negative)`, b.vx < 0);
  check(`${name} bounce: barrel undamaged (hp 4)`, b.hp === 4);
  return blocker;
}
{
  bounceOffBlocker("crate", () => {
    const c = { type: "crate", x: tileCenter(7, 4).x, y: tileCenter(7, 4).y };
    G.crates.push(c); return c;
  });
  bounceOffBlocker("spawner", () => {
    const s = { type: "spawner", x: tileCenter(7, 4).x, y: tileCenter(7, 4).y, r: 16, hp: 6 };
    G.spawners.push(s); return s;
  });
  const other = bounceOffBlocker("other-barrel", () => placeBarrel(7, 4));
  check("other-barrel bounce: the STATIC barrel is undamaged too", other.hp === 4);
}

/* ========================================================================= *
   10. Rolling impact >= 3 t/s (B3) — enemy -1, barrel -1 HP & -40% speed,
       tagged 'player-kick'; barrel passes THROUGH (enemy not a bounce-blocker).
 * ========================================================================= */
{
  resetWorldState();
  const b = placeBarrel(6, 4);                              // x=208
  kickBarrel(b, 1, 0);                                      // rolling +x at 224 (>= impactSpeed 96)
  const e = mkEnemy("zombie", b.x + 10, b.y, { hp: 8 });    // overlapping the roll path
  G.enemies = [e];
  const dt = 0.01;
  const preImpact = CFG.BARREL.kick.speed * Math.exp(-CFG.BARREL.kick.friction * dt);   // post-slide, pre-slow

  updateBarrels(dt);

  check("roll impact: enemy takes impactDmg (1)", e.hp === 7);
  check("roll impact: barrel loses impactSelfHp (4 -> 3)", b.hp === 3);
  check("roll impact: barrel tagged 'player-kick'", b._cause === "player-kick");
  check("roll impact: barrel speed -40% (× 0.6)", approx(speedOf(b), preImpact * (1 - CFG.BARREL.kick.impactSlow), 0.5));
  check("roll impact: barrel passes through (still rolling)", b.rolling === true);
}

/* ========================================================================= *
   11. Below the impact threshold = inert cover (B3) — a slow roll (30..96
       px/s) neither damages an overlapped enemy nor self-damages.
 * ========================================================================= */
{
  resetWorldState();
  const b = placeBarrel(6, 4);
  b.rolling = true; b.vx = 50; b.vy = 0;                    // between stopSpeed (30) and impactSpeed (96)
  const e = mkEnemy("zombie", b.x + 8, b.y, { hp: 8 });
  G.enemies = [e];

  updateBarrels(0.01);

  check("inert roll: enemy undamaged (below 3 t/s)", e.hp === 8);
  check("inert roll: barrel undamaged", b.hp === 4);
  check("inert roll: still rolling (above stopSpeed)", b.rolling === true);
}

/* ========================================================================= *
   12. Player takes NO rolling damage (B3) — a barrel rolling over the player
       leaves G.hp untouched (the player kicked it away).
 * ========================================================================= */
{
  resetWorldState();
  const b = placeBarrel(6, 4);
  G.player.x = b.x; G.player.y = b.y;                       // player standing where the barrel rolls
  const hp0 = G.hp;
  kickBarrel(b, 1, 0);

  updateBarrels(0.01);

  check("no roll damage to player: G.hp unchanged", G.hp === hp0);
}

/* ========================================================================= *
   13. No wall-vault for a carried barrel (B6) — a crate would vault a 1-thick
       wall; a barrel does NOT (stays CARRYING, never dropped).
 * ========================================================================= */
{
  loadTileGrid([
    "#######",
    "#.#...#",
    "#.#...#",
    "#.....#",
    "#######",
  ]);
  G.player = { x: 1.5 * CFG.TILE, y: 1.5 * CFG.TILE, tx: 1, ty: 1 };
  initPlayer();
  G.crates = []; G.barrels = []; G.spawners = []; G.shots = [];
  const barrel = makeBarrel();
  G.player.loco = "CARRYING"; G.player.carry = { type: "barrel", entity: barrel };

  for (let i = 0; i < 5; i++) updatePlayer(snap({ move: { x: 1, y: 0 } }), 0.1);   // push into the wall

  check("no wall-vault: never enters VAULTING", G.player.loco !== "VAULTING");
  check("no wall-vault: stays CARRYING", G.player.loco === "CARRYING");
  check("no wall-vault: barrel still carried (not dropped)", carriedBarrel() === barrel);
  check("no wall-vault: barrel not re-inserted mid-carry", G.barrels.indexOf(barrel) === -1);
}

/* --- summary --------------------------------------------------------------- */
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
