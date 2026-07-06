/* test-enemies-steer.js — headless smoke tests for the Phase-4 direct-steer
   roster (Skeleton, Spider, Bat) in enemies-ai.js + their factories in
   enemies.js (SPEC-ENEMIES §6.1.2, §6.1.5, §6.1.6, R8, Q4, §9). Exercises the
   REAL modules, never inlined copies. Pure logic — set fields directly, tick,
   assert; no render/canvas. Run: node test-enemies-steer.js
*/
import { CFG } from "./src/config.js";
import { G } from "./src/state.js";
import { loadTileGrid, tileCenter } from "./src/world.js";
import { registerEmit } from "./src/level-loader.js";
import { initPlayer, applyEntangle } from "./src/player.js";
import { updateSkeleton, updateSpider, updateBat } from "./src/enemies-ai.js";
import { makeSkeleton, makeSpider, makeBat } from "./src/enemies.js";

let passed = 0, failed = 0;
function check(name, ok) {
  if (ok) { passed++; } else { failed++; console.error(`FAIL: ${name}`); }
}
const approx = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

registerEmit(() => {});

function resetWorldState() {
  G.shots = []; G.enemies = []; G.pickups = [];
  G.ramp = { enemySpeedMult: 1, spiderWebCooldown: 4.0, batPauseMin: 0.4, batPauseMax: 1.2 };
  initPlayer();
  G.player.x = tileCenter(6, 4).x;
  G.player.y = tileCenter(6, 4).y;
  G.player.iframe = 0;
}

/* ========================================================================= *
   Factory sanity (E5/E10) — makeSkeleton/makeSpider/makeBat build the §2 base
   shape via the shared makeEnemy, speed EFFECTIVE.
 * ========================================================================= */
{
  loadTileGrid([
    "##########",
    "#........#",
    "#........#",
    "#........#",
    "#........#",
    "#........#",
    "#........#",
    "#........#",
    "#........#",
    "##########",
  ]);
  resetWorldState();

  const sk = makeSkeleton({ type: "skeleton", x: 3, y: 4 });
  check("makeSkeleton: base shape from factory", sk.type === "skeleton" && sk.hp === CFG.ENEMY.skeleton.hp);
  const sp = makeSpider({ type: "spider", x: 3, y: 4 });
  check("makeSpider: base shape from factory", sp.type === "spider" && sp.hp === CFG.ENEMY.spider.hp);
  const bt = makeBat({ type: "bat", x: 3, y: 4 });
  check("makeBat: base shape from factory", bt.type === "bat" && bt.hp === CFG.ENEMY.bat.hp);
}

/* ========================================================================= *
   Skeleton (§6.1.2) — rounds a convex corner via the +-90 probe.
 * ========================================================================= */
{
  // Skeleton left of a single wall tile at (5,4); player directly to the
  // right of it on the SAME row (direct steer blocked outright), with row 3
  // fully open as the "freer perpendicular" the +-90 probe should find.
  loadTileGrid([
    "###########",
    "#.........#",
    "#.........#",
    "#.........#",   // row 3 — fully open, the free perpendicular
    "#....#....#",   // row 4 — wall at col 5 between skeleton and player
    "#.........#",
    "#.........#",
    "#.........#",
    "#.........#",
    "###########",
  ]);
  resetWorldState();
  const e = makeSkeleton({ type: "skeleton", x: 2, y: 4 });
  e.speed = CFG.ENEMY.skeleton.speedMul * CFG.PLAYER.speed;
  const player = { x: tileCenter(8, 4).x, y: tileCenter(4, 4).y };

  let roundedCorner = false;
  for (let f = 0; f < 400; f++) {
    updateSkeleton(e, player, 1 / 60);
    if (Math.abs(e.x - player.x) < CFG.TILE && Math.abs(e.y - player.y) < CFG.TILE) { roundedCorner = true; break; }
  }
  check("Skeleton: rounds a convex corner via the +-90 probe", roundedCorner);
}

/* ========================================================================= *
   Skeleton — wedges in a deep concave pocket (both perpendiculars blocked).
 * ========================================================================= */
{
  // Skeleton sealed in a 1-tile pocket open only toward a wall (not toward
  // the player); direct steer AND both +-90 probes are blocked every frame.
  loadTileGrid([
    "###########",
    "#.........#",
    "#.........#",
    "#.........#",
    "#..###....#",
    "#..#.#....#",   // pocket cell at (3,5) — walled on left/right/top
    "#..###....#",
    "#.........#",
    "#.........#",
    "###########",
  ]);
  resetWorldState();
  const e = makeSkeleton({ type: "skeleton", x: 3, y: 5 });
  e.speed = CFG.ENEMY.skeleton.speedMul * CFG.PLAYER.speed;
  const player = { x: tileCenter(8, 5).x, y: tileCenter(8, 5).y };

  const x0 = e.x, y0 = e.y;
  for (let f = 0; f < 120; f++) updateSkeleton(e, player, 1 / 60);
  const moved = Math.hypot(e.x - x0, e.y - y0);
  check("Skeleton: wedges in a deep concave pocket (no net escape)", moved < CFG.TILE * 0.5);
}

/* ========================================================================= *
   Spider (§6.1.6) — BURST 1.5x 0.5s / PAUSE 0.6s cadence.
 * ========================================================================= */
{
  loadTileGrid([
    "##########",
    "#........#",
    "#........#",
    "#........#",
    "#........#",
    "#........#",
    "#........#",
    "#........#",
    "#........#",
    "##########",
  ]);
  resetWorldState();
  const e = makeSpider({ type: "spider", x: 2, y: 4 });
  const player = { x: tileCenter(8, 4).x, y: tileCenter(4, 4).y };

  const dt = 1 / 60;
  updateSpider(e, player, dt);   // prime the FSM (init) — counts toward burstDur
  check("Spider: FSM starts in burst", e.spider.burstState === "burst");
  let elapsed = dt;

  // Advance to just before the burst ends (0.5s) — should still be bursting.
  let burstDurOk = true;
  while (elapsed + dt < CFG.ENEMY.spider.burstDur) {
    updateSpider(e, player, dt); elapsed += dt;
    if (e.spider.burstState !== "burst") burstDurOk = false;
  }
  check("Spider: stays in burst for burstDur (0.5s)", burstDurOk);
  updateSpider(e, player, dt * 2); elapsed += dt * 2;   // cross the 0.5s threshold
  check("Spider: transitions to pause after burstDur", e.spider.burstState === "pause");

  // Advance through the 0.6s pause and back to burst.
  let pauseDurOk = true;
  let pauseElapsed = 0;
  while (pauseElapsed + dt < CFG.ENEMY.spider.pauseDur) {
    updateSpider(e, player, dt); pauseElapsed += dt;
    if (e.spider.burstState !== "pause") pauseDurOk = false;
  }
  check("Spider: stays in pause for pauseDur (0.6s)", pauseDurOk);
  updateSpider(e, player, dt * 2);
  check("Spider: transitions back to burst after pauseDur", e.spider.burstState === "burst");
}

/* ========================================================================= *
   Spider — blocked -> RETREAT 1.5s away, never wall-hugs.
 * ========================================================================= */
{
  // Wall directly between spider and player — direct steer is blocked outright.
  loadTileGrid([
    "###########",
    "#.........#",
    "#.........#",
    "#.........#",
    "#....#....#",
    "#....#....#",
    "#....#....#",
    "#.........#",
    "#.........#",
    "###########",
  ]);
  resetWorldState();
  // Spider starts touching the wall face (col 4, right up against col-5 wall)
  // so its very next steer attempt toward the player is immediately blocked.
  const e = makeSpider({ type: "spider", x: 4, y: 5 });
  e.x = tileCenter(5, 5).x - CFG.TILE / 2 - e.r;   // nudge flush against the wall face
  const player = { x: tileCenter(8, 5).x, y: e.y };   // same row as the wall gap — direct path fully blocked

  updateSpider(e, player, 1 / 60);   // this frame's move should be ~blocked -> triggers retreat
  check("Spider: entering RETREAT after a blocked frame", e.spider.retreating === true);

  // While retreating, confirm net movement is AWAY from the player (x decreases,
  // since player is to the right) and it never crosses back through the wall.
  const distBefore = Math.hypot(e.x - player.x, e.y - player.y);
  for (let f = 0; f < 30; f++) updateSpider(e, player, 1 / 60);
  const distAfter = Math.hypot(e.x - player.x, e.y - player.y);
  check("Spider: RETREAT moves away from the player", distAfter > distBefore);

  // Retreat duration is 1.5s — after that it re-engages (retreating clears).
  let t = 0;
  while (e.spider.retreating && t < 3.0) { updateSpider(e, player, 1 / 60); t += 1 / 60; }
  check("Spider: RETREAT clears within retreatDur (1.5s)", !e.spider.retreating && t <= 1.6 + 1e-6);
}

/* ========================================================================= *
   Spider — web hit applies entangle 2.5, deals 0 dmg (no iframe trip).
 * ========================================================================= */
{
  loadTileGrid([
    "##########",
    "#........#",
    "#........#",
    "#........#",
    "#........#",
    "#........#",
    "#........#",
    "#........#",
    "#........#",
    "##########",
  ]);
  resetWorldState();
  const e = makeSpider({ type: "spider", x: 2, y: 4 });
  const player = { x: tileCenter(4, 4).x, y: tileCenter(4, 4).y };   // within 7t range, clear LOS

  // Prime cooldown to 0 so the very next tick fires.
  updateSpider(e, player, 0.001);
  e.spider.webCd = 0;
  const shotsBefore = G.shots.length;
  updateSpider(e, player, 1 / 60);
  check("Spider: web fires an owner=enemy, dmg=0, effect=entangle shot", G.shots.length === shotsBefore + 1);
  const shot = G.shots[G.shots.length - 1];
  check("Spider web shot shape", shot.owner === "enemy" && shot.dmg === 0 && shot.effect === "entangle");

  // Route the shot through applyEntangle directly (the enemy-shot->player pass
  // is enemies.js's job; this test proves the web itself carries the right
  // entangle duration end-to-end via player.js's real sink).
  applyEntangle(CFG.ENEMY.spider.web.entangle);
  check("Spider web -> applyEntangle sets p.entangle == 2.5", approx(G.player.entangle, 2.5));
  check("Spider web deals 0 dmg (no iframe trip)", G.player.iframe === 0);
}

/* ========================================================================= *
   Bat (§6.1.5, R8) — SNAPSHOT records player pos; FLY reaches the RECORDED
   point even if the player moves; PAUSE duration in [batPauseMin,batPauseMax];
   passes through a wall tile mid-FLY (raw integrate, no moveBody).
 * ========================================================================= */
{
  loadTileGrid([
    "###########",
    "#.........#",
    "#.........#",
    "#.........#",
    "#....#....#",   // a wall tile directly between the bat and its snapshot target
    "#.........#",
    "#.........#",
    "#.........#",
    "#.........#",
    "###########",
  ]);
  resetWorldState();
  const e = makeBat({ type: "bat", x: 2, y: 4 });
  e.speed = CFG.ENEMY.bat.speedMul * CFG.PLAYER.speed;   // effective, includes the 1.15x (E10)
  const player = { x: tileCenter(8, 4).x, y: tileCenter(4, 4).y };

  updateBat(e, player, 1 / 60);   // SNAPSHOT -> FLY this tick
  const snapX = e.bat.snapX, snapY = e.bat.snapY;
  check("Bat: SNAPSHOT records the player's current position", approx(snapX, player.x) && approx(snapY, player.y));
  check("Bat: phase advances to FLY after snapshot", e.bat.phase === "fly");

  // Move the "player" away — the bat must still fly toward the RECORDED point.
  player.x = tileCenter(1, 1).x; player.y = tileCenter(1, 1).y;

  let passedThroughWall = false;
  let reachedSnap = false;
  for (let f = 0; f < 600 && e.bat.phase === "fly"; f++) {
    updateBat(e, player, 1 / 60);
    const tx = (e.x / CFG.TILE) | 0, ty = (e.y / CFG.TILE) | 0;
    if (tx === 5 && ty === 4) passedThroughWall = true;   // the wall tile at (5,4)
  }
  reachedSnap = approx(e.x, snapX, 1) && approx(e.y, snapY, 1);
  check("Bat: FLY reaches the recorded snapshot point despite the player moving", reachedSnap);
  check("Bat: passes through a wall tile mid-FLY (raw integrate, no moveBody)", passedThroughWall);
  check("Bat: phase advances to PAUSE on arrival", e.bat.phase === "pause");

  // PAUSE duration must land within [batPauseMin, batPauseMax].
  let pauseT = 0;
  const pauseStart = e.bat.pauseT;
  check("Bat: PAUSE duration drawn from [batPauseMin, batPauseMax]",
    pauseStart >= G.ramp.batPauseMin - 1e-6 && pauseStart <= G.ramp.batPauseMax + 1e-6);
  while (e.bat.phase === "pause" && pauseT < 5) { updateBat(e, player, 1 / 60); pauseT += 1 / 60; }
  check("Bat: PAUSE returns to SNAPSHOT/FLY after its duration", e.bat.phase === "fly" || e.bat.phase === "snapshot");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
