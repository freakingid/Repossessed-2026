/* test-enemies-wraith.js — headless smoke tests for the Fire Wraith (SPEC-ENEMIES
   §6.1.8, §7, E8, E11, R2) in enemies-ai.js (updateFireWraith) + enemies.js
   (makeFireWraith factory, EXPLODE resolution, barrel-detonation seam). Exercises
   the REAL modules end-to-end via the real tickEnemies spine, never inlined
   copies. Pure logic — no render/canvas. Run: node test-enemies-wraith.js
*/
import { CFG } from "./src/config.js";
import { G } from "./src/state.js";
import { tileCenter } from "./src/world.js";
import { loadLevel, registerEmit, markNavDirty } from "./src/level-loader.js";
import { installNav } from "./src/nav.js";
import { initPlayer } from "./src/player.js";
import { clearNavigators } from "./src/enemies-ai.js";
import {
  tickEnemies, makeFireWraith, registerBarrelDetonation,
} from "./src/enemies.js";

let passed = 0, failed = 0;
function check(name, ok) {
  if (ok) { passed++; } else { failed++; console.error(`FAIL: ${name}`); }
}

registerEmit(() => {});
installNav();

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

function loadRoom(tiles) {
  loadLevel({
    id: "wraith-room", name: "WraithRoom",
    tiles,
    zones: [{ role: "combat", x: 1, y: 1, w: tiles[0].length - 2, h: tiles.length - 2 }],
    placements: [
      { type: "player", x: 1, y: 1 },
      { type: "exit", x: tiles[0].length - 2, y: tiles.length - 2 },
    ],
    spawnRules: [],
  });
}

function resetWorldState() {
  clearNavigators();
  G.shots = []; G.enemies = []; G.pickups = [];
  G.score = 0;
  G.ramp = { enemySpeedMult: 1 };
  initPlayer();
  G.hp = G.maxHp;
  G.player.iframe = 0;
  G.player.loco = "NORMAL";
  G.player.carry = null;
}

/* ========================================================================= *
   Factory sanity — base shape + light-emitter registration seam (§8.4).
 * ========================================================================= */
{
  loadRoom(OPEN_ROOM);
  resetWorldState();
  const w = makeFireWraith({ type: "fireWraith", x: 3, y: 4 });
  check("makeFireWraith: base shape from CFG",
    w.type === "fireWraith" && w.hp === CFG.ENEMY.fireWraith.hp &&
    w.points === CFG.ENEMY.fireWraith.points && w.gems === CFG.ENEMY.fireWraith.gems);
  check("makeFireWraith: registers a light emitter in G.lights (§8.4 seam)",
    Array.isArray(G.lights) && G.lights.some((l) => l.source === w));
  const light = G.lights.find((l) => l.source === w);
  check("makeFireWraith: light radius = glowRadius(1.5t) × TILE",
    light && Math.abs(light.radius - CFG.ENEMY.fireWraith.glowRadius * CFG.TILE) < 1e-6);
}

/* ========================================================================= *
   Defuse (R2/E11): a bullet kills the Wraith mid-FLASH (before the timer
   completes) → the death sweep (step 5) removes it BEFORE step 6 ever runs
   its AI — no EXPLODE, no player damage, no barrel-seam call.
 * ========================================================================= */
{
  loadRoom(OPEN_ROOM);
  resetWorldState();
  let barrelCalls = 0;
  registerBarrelDetonation(() => { barrelCalls++; });

  G.player.x = tileCenter(6, 4).x;
  G.player.y = tileCenter(4, 4).y;

  const w = makeFireWraith({ type: "fireWraith", x: 5, y: 4 });
  G.enemies.push(w);
  // Force it straight into FLASH (skip APPROACH — armDist proximity already met).
  w.wraith = { state: "flash", flashT: CFG.ENEMY.fireWraith.flashDur, explode: false };

  const hpBefore = G.hp;
  // A lethal player-owned shot sitting exactly on the Wraith this frame — the
  // step-3 pass will kill it before step 5's sweep runs, well before flashT
  // could ever complete (flashDur 0.8s >> one frame).
  G.shots.push({
    x: w.x, y: w.y, vx: 0, vy: 0, r: 6, dmg: 99, owner: "player", maxTravel: 999999,
  });

  tickEnemies(1 / 60);

  check("Wraith defuse: killed mid-FLASH by a bullet is removed from G.enemies",
    !G.enemies.includes(w));
  check("Wraith defuse: no AoE — player HP unchanged", G.hp === hpBefore);
  check("Wraith defuse: no barrel-seam call", barrelCalls === 0);
  registerBarrelDetonation(() => {});   // restore no-op default
}

/* ========================================================================= *
   Survive FLASH → EXPLODE (§6.1.8): 4 dmg to the player, friendly-fire damage
   to enemies in radius (0 score, still drops gems), barrel seam called,
   crates left intact, Wraith dies in its own blast.
 * ========================================================================= */
{
  loadRoom(OPEN_ROOM);
  resetWorldState();
  let barrelCall = null;
  registerBarrelDetonation((x, y, r, cause) => { barrelCall = { x, y, r, cause }; });

  // Player 1 tile away (within the 2-tile explode radius, but clear of the
  // melee overlap distance so step 4 doesn't kill the Wraith first — this
  // test is isolating EXPLODE, not the melee exchange).
  G.player.x = tileCenter(4, 4).x;
  G.player.y = tileCenter(4, 4).y;

  const w = makeFireWraith({ type: "fireWraith", x: 5, y: 4 });
  G.enemies.push(w);
  // One frame from EXPLODE — the tick's dt will drive flashT to <=0 this frame.
  w.wraith = { state: "flash", flashT: 1 / 120, explode: false };

  // A bystander enemy well within the 2-tile explode radius (friendly fire).
  const bystander = {
    type: "ghost", x: w.x + 20, y: w.y, r: 12, hp: CFG.ENEMY.ghost.hp,
    speed: 0, face: 0, kvx: 0, kvy: 0, contact: false, spawn: 0,
    originSpawner: null, boss: false, points: CFG.ENEMY.ghost.points, gems: CFG.ENEMY.ghost.gems,
  };
  G.enemies.push(bystander);

  // A crate sitting on top of the blast — must survive (crate indestructibility, §13.16).
  G.crates = [{ type: "crate", x: w.x, y: w.y, blocks: true }];

  const hpBefore = G.hp;
  const scoreBefore = G.score;
  const pickupsBefore = G.pickups.length;

  tickEnemies(1 / 60);

  check("Wraith EXPLODE: dealt explodeDmg(4) to the player",
    hpBefore - G.hp === CFG.ENEMY.fireWraith.explodeDmg);
  check("Wraith EXPLODE: the Wraith itself died in its own blast", !G.enemies.includes(w));
  check("Wraith EXPLODE: the bystander enemy in radius also died (friendly fire)",
    !G.enemies.includes(bystander));
  check("Wraith EXPLODE: friendly-fire kill scored 0 (wraith-aoe)", G.score === scoreBefore);
  check("Wraith EXPLODE: friendly-fire kill still dropped gems (Q3)",
    G.pickups.length === pickupsBefore + w.gems + bystander.gems);
  check("Wraith EXPLODE: barrel-detonation seam called with the blast radius/cause",
    barrelCall !== null && barrelCall.cause === "wraith-aoe" &&
    Math.abs(barrelCall.r - CFG.ENEMY.fireWraith.explodeRadius * CFG.TILE) < 1e-6);
  check("Wraith EXPLODE: crate in radius left intact (§13.16)", G.crates.length === 1);
  check("Wraith EXPLODE: light emitter removed on death", !G.lights.some((l) => l.source === w));

  registerBarrelDetonation(() => {});   // restore no-op default
}

/* ========================================================================= *
   FSM: APPROACH -> FLASH transition on armDist proximity, via the real GROUND
   A* nav layer (drives the whole spine, not a synthetic state assignment).
 * ========================================================================= */
{
  loadRoom(OPEN_ROOM);
  resetWorldState();
  registerBarrelDetonation(() => {});

  G.player.x = tileCenter(10, 4).x;
  G.player.y = tileCenter(4, 4).y;

  const w = makeFireWraith({ type: "fireWraith", x: 2, y: 4 });
  G.enemies.push(w);

  let enteredFlash = false;
  for (let f = 0; f < 600 && !enteredFlash; f++) {
    tickEnemies(1 / 60);
    if (w.wraith && w.wraith.state === "flash") enteredFlash = true;
  }
  check("Wraith FSM: APPROACH -> FLASH once within armDist", enteredFlash);
}

/* ========================================================================= *
   Zombie-style re-route: the Wraith is a GROUND navigator too, so a dirty
   repath (crate barricade) still lets it close distance rather than wedging
   (parity with the Zombie test — same nav consumer layer).
 * ========================================================================= */
{
  loadRoom([
    "###############",
    "#.............#",
    "#.............#",
    "#.............#",
    "#.....#.......#",
    "#.............#",
    "#.............#",
    "#.............#",
    "###############",
  ]);
  resetWorldState();
  registerBarrelDetonation(() => {});

  G.player.x = tileCenter(12, 4).x;
  G.player.y = tileCenter(4, 4).y;

  const w = makeFireWraith({ type: "fireWraith", x: 2, y: 4 });
  G.enemies.push(w);

  for (let f = 0; f < 60; f++) tickEnemies(1 / 60);
  markNavDirty({ tx: 6, ty: 4 });
  let closed = false;
  const start = Math.hypot(w.x - G.player.x, w.y - G.player.y);
  for (let f = 0; f < 500; f++) {
    tickEnemies(1 / 60);
    if (!G.enemies.includes(w)) break;   // exploded — fine, means it reached armDist
    if (Math.hypot(w.x - G.player.x, w.y - G.player.y) < start) { closed = true; }
  }
  check("Wraith: still makes progress after a dirty repath mid-route", closed || !G.enemies.includes(w));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
