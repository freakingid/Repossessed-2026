/* test-enemies-ground.js — headless smoke tests for the Phase-5 GROUND A*
   roster (Skeleton Shooter, Zombie) in enemies-ai.js + their factories in
   enemies.js (SPEC-ENEMIES §6.1.3, §6.1.7, §9). Exercises the REAL modules
   end-to-end (findPath/nav consumer layer included), never inlined copies.
   Pure logic — no render/canvas. Run: node test-enemies-ground.js
*/
import { CFG } from "./src/config.js";
import { G } from "./src/state.js";
import { tileCenter } from "./src/world.js";
import { loadLevel, registerEmit, markNavDirty } from "./src/level-loader.js";
import { installNav } from "./src/nav.js";
import { initPlayer } from "./src/player.js";
import {
  updateSkeletonShooter, updateZombie, clearNavigators, scheduleRepaths,
} from "./src/enemies-ai.js";
import { makeSkeletonShooter, makeZombie } from "./src/enemies.js";

let passed = 0, failed = 0;
function check(name, ok) {
  if (ok) { passed++; } else { failed++; console.error(`FAIL: ${name}`); }
}

registerEmit(() => {});
installNav();

function loadRoom(tiles) {
  loadLevel({
    id: "ground-room", name: "GroundRoom",
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
  G.ramp = { enemySpeedMult: 1, shooterStopToShoot: 0.5 };
  initPlayer();
}

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

/* ========================================================================= *
   Factory sanity (E5/E10).
 * ========================================================================= */
{
  loadRoom(OPEN_ROOM);
  resetWorldState();
  const sh = makeSkeletonShooter({ type: "skeletonShooter", x: 3, y: 4 });
  check("makeSkeletonShooter: base shape from factory",
    sh.type === "skeletonShooter" && sh.hp === CFG.ENEMY.skeletonShooter.hp);
  const zb = makeZombie({ type: "zombie", x: 3, y: 4 });
  check("makeZombie: base shape from factory",
    zb.type === "zombie" && zb.hp === CFG.ENEMY.zombie.hp && zb.speed > 0);
}

/* ========================================================================= *
   Skeleton Shooter — WANDER -> HUNT on LOS acquire.
 * ========================================================================= */
{
  loadRoom(OPEN_ROOM);
  resetWorldState();
  G.player.x = tileCenter(12, 4).x;
  G.player.y = tileCenter(12, 4).y;

  const e = makeSkeletonShooter({ type: "skeletonShooter", x: 2, y: 4 });
  check("Shooter: starts in WANDER", e.shooter === undefined);   // lazily init'd on first update

  let acquired = false;
  for (let f = 0; f < 600; f++) {
    scheduleRepaths(G.player, 1 / 60);
    updateSkeletonShooter(e, G.player, 1 / 60);
    if (e.shooter.state === "hunt") { acquired = true; break; }
  }
  check("Shooter: WANDER -> HUNT on LOS acquire (open room, in range)", acquired);
}

/* ========================================================================= *
   Skeleton Shooter — stop-to-shoot sequence: windup(0.4) -> fire -> cooldown
   (1.5), STATIONARY throughout.
 * ========================================================================= */
{
  loadRoom(OPEN_ROOM);
  resetWorldState();
  G.ramp.shooterStopToShoot = 1.0;   // force the roll to always hit
  G.player.x = tileCenter(6, 4).x;
  G.player.y = tileCenter(4, 4).y;

  const e = makeSkeletonShooter({ type: "skeletonShooter", x: 3, y: 4 });
  e.shooter = {
    state: "hunt", awareT: CFG.ENEMY.skeletonShooter.awareDecay, losT: 0,
    shootPhase: null, shootT: 0, wanderGoal: null, wanderPickT: 0,
  };

  const shotsBefore = G.shots.length;
  let enteredWindup = false, stationaryThroughout = true;
  let x0 = e.x, y0 = e.y;
  const dt = 1 / 60;
  // Drive until it enters the shoot sequence (within los + throttled LOS tick).
  for (let f = 0; f < 30 && !enteredWindup; f++) {
    scheduleRepaths(G.player, dt);
    updateSkeletonShooter(e, G.player, dt);
    if (e.shooter.shootPhase === "windup") enteredWindup = true;
  }
  check("Shooter: enters windup when in range+LOS with stopToShoot=1.0", enteredWindup);

  x0 = e.x; y0 = e.y;
  let firedAt = -1, t = 0;
  for (let f = 0; f < 200; f++) {
    scheduleRepaths(G.player, dt);
    updateSkeletonShooter(e, G.player, dt);
    t += dt;
    if (Math.hypot(e.x - x0, e.y - y0) > 1e-6) stationaryThroughout = false;
    if (G.shots.length > shotsBefore && firedAt < 0) firedAt = t;
    if (e.shooter.shootPhase === null) break;
  }
  check("Shooter: stationary throughout the entire shoot sequence", stationaryThroughout);
  check("Shooter: fires exactly one arrow during the sequence", G.shots.length === shotsBefore + 1);
  check("Shooter: fires after ~windup (0.4s)", firedAt >= 0.4 - 2 * dt && firedAt <= 0.4 + 4 * dt);
  const shot = G.shots[G.shots.length - 1];
  check("Shooter arrow shape: owner=enemy, dmg=2, effect=damage",
    shot.owner === "enemy" && shot.dmg === 2 && shot.effect === "damage");
  check("Shooter: sequence ends only after windup(0.4)+cooldown(1.5)=1.9s",
    t >= 1.9 - 4 * dt && t <= 1.9 + 6 * dt);
}

/* ========================================================================= *
   Skeleton Shooter — awareness decays to WANDER after 8s with no LOS.
   The player is sealed in a pocket unreachable/unseeable from the corridor the
   Shooter is confined to (a wall fully separates them, no line of sight from
   ANY point in the Shooter's reachable space) so HUNT can chase forever
   without ever re-acquiring LOS, isolating the awareDecay timer itself.
 * ========================================================================= */
{
  loadRoom([
    "###############",
    "#.....#.......#",
    "#.....#.......#",
    "#.....#.......#",
    "#.....#.......#",
    "#.....#.......#",
    "#.....#.......#",
    "#.....#.......#",
    "###############",
  ]);
  resetWorldState();
  // Player on the far side of a full-height wall — never in LOS from the left room.
  G.player.x = tileCenter(9, 4).x;
  G.player.y = tileCenter(4, 4).y;

  const e = makeSkeletonShooter({ type: "skeletonShooter", x: 2, y: 4 });
  e.shooter = {
    state: "hunt", awareT: CFG.ENEMY.skeletonShooter.awareDecay, losT: 0,
    shootPhase: null, shootT: 0, wanderGoal: null, wanderPickT: 999,
  };

  let revertedToWander = false, t = 0;
  const dt = 1 / 60;
  for (let f = 0; f < 700 && t < 8.5; f++) {
    scheduleRepaths(G.player, dt);
    updateSkeletonShooter(e, G.player, dt);
    t += dt;
    if (e.shooter.state === "wander") { revertedToWander = true; break; }
  }
  check("Shooter: awareness decays to WANDER after ~8s with no LOS refresh", revertedToWander);
  check("Shooter: awareDecay timing is ~8s (not premature/late)", t >= 8 - 4 * dt && t <= 8 + 8 * dt);
}

/* ========================================================================= *
   Zombie — drives the nav layer: advances along a corridor toward the player.
 * ========================================================================= */
{
  loadRoom(OPEN_ROOM);
  resetWorldState();
  G.player.x = tileCenter(12, 4).x;
  G.player.y = tileCenter(4, 4).y;

  const e = makeZombie({ type: "zombie", x: 2, y: 4 });
  const start = Math.hypot(e.x - G.player.x, e.y - G.player.y);
  for (let f = 0; f < 300; f++) { scheduleRepaths(G.player, 1 / 60); updateZombie(e, G.player, 1 / 60); }
  const after = Math.hypot(e.x - G.player.x, e.y - G.player.y);
  check("Zombie: advances toward the player via the nav layer", after < start);
}

/* ========================================================================= *
   Zombie — routes around a crate barricade after a dirty repath (markNavDirty).
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
  G.player.x = tileCenter(12, 4).x;
  G.player.y = tileCenter(4, 4).y;

  const e = makeZombie({ type: "zombie", x: 2, y: 4 });
  // Run a few frames to get an initial path, then barricade a corridor tile on
  // its path (simulating a crate drop) and confirm it re-routes rather than
  // wedging (net progress continues; final approach still succeeds).
  for (let f = 0; f < 60; f++) { scheduleRepaths(G.player, 1 / 60); updateZombie(e, G.player, 1 / 60); }
  markNavDirty({ tx: 6, ty: 4 });   // a tile plausibly on the direct route
  let reached = false;
  for (let f = 0; f < 500; f++) {
    scheduleRepaths(G.player, 1 / 60);
    updateZombie(e, G.player, 1 / 60);
    if (Math.hypot(e.x - G.player.x, e.y - G.player.y) < CFG.TILE * 1.5) { reached = true; break; }
  }
  check("Zombie: still reaches the player after a dirty repath mid-route", reached);
}

/* ========================================================================= *
   Zombie — degrades to direct-steer when the goal is fully boxed (findPath
   -> null); still presses toward the player rather than freezing.
 * ========================================================================= */
{
  loadRoom([
    "###############",
    "#.............#",
    "#.............#",
    "#.............#",
    "#....#####....#",
    "#....#...#....#",
    "#....#####....#",
    "#.............#",
    "###############",
  ]);
  resetWorldState();
  // Player sealed inside the boxed pocket (5,5) — unreachable by GROUND A*.
  G.player.x = tileCenter(7, 5).x;
  G.player.y = tileCenter(7, 5).y;

  const e = makeZombie({ type: "zombie", x: 2, y: 2 });
  const start = Math.hypot(e.x - G.player.x, e.y - G.player.y);
  for (let f = 0; f < 120; f++) { scheduleRepaths(G.player, 1 / 60); updateZombie(e, G.player, 1 / 60); }
  const after = Math.hypot(e.x - G.player.x, e.y - G.player.y);
  check("Zombie: degrades to direct-steer (null path) and still closes distance",
    after < start);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
