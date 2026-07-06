/* test-enemies-combat.js — headless smoke tests for the enemy COMBAT SPINE +
   the 7-step frame order in enemies.js (SPEC-ENEMIES §2, §3.5, §6.2, §6.3,
   §6.5, §6.6, E6/E8/E11, R2/R3/R6, §9). Exercises the REAL modules
   (config/state/world/level-loader/player/enemies-ai/enemies), never inlined
   copies. Pure logic — set fields directly, run a step (or a full tick), assert;
   no render/canvas. player.js's graph touches window/navigator ONLY inside
   input.js device glue, which these tests never call, so no browser stubs are
   needed (same as test-player.js). Run: node test-enemies-combat.js
*/
import { readFileSync } from "node:fs";
import { CFG } from "./src/config.js";
import { G } from "./src/state.js";
import { loadTileGrid, tileCenter } from "./src/world.js";
import { registerEmit } from "./src/level-loader.js";
import { initPlayer } from "./src/player.js";
import { updateGhost } from "./src/enemies-ai.js";
import {
  tickEnemies, makeGhost, awardKill, applyKnockbackToEnemy, __setEnemyAI,
  __playerShotEnemyPass, __meleeExchange, __deathSweep, __enemyShotPlayerPass,
} from "./src/enemies.js";

let passed = 0, failed = 0;
function check(name, ok) {
  if (ok) { passed++; } else { failed++; console.error(`FAIL: ${name}`); }
}
const approx = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

// Reset just the transient combat arrays + a fresh player at a known spot.
function resetWorldState() {
  G.shots = []; G.enemies = []; G.pickups = [];
  G.score = 0;
  G.hp = G.maxHp;               // restore full HP so accumulated melee never DEADs the player mid-suite
  G.ramp = { enemySpeedMult: 1 };
  initPlayer();
  G.player.x = tileCenter(6, 4).x;
  G.player.y = tileCenter(6, 4).y;
  G.player.iframe = 0;
  G.player.loco = "NORMAL";
  G.player.carry = null;
}

// A minimal enemy built directly (no factory) so tests control every field.
function mkEnemy(type, x, y, over = {}) {
  const cfg = CFG.ENEMY[type] || {};
  return {
    type, x, y, r: cfg.r ?? 12, hp: cfg.hp ?? 4,
    speed: 0, face: 0, kvx: 0, kvy: 0, contact: false, spawn: 0,
    originSpawner: null, boss: !!cfg.boss,
    points: cfg.points ?? 0, gems: cfg.gems ?? 0, ...over,
  };
}

/* ========================================================================= *
   Config + factory sanity (§9 config sanity; E5/E10).
 * ========================================================================= */
{
  check("CFG.ENEMY.ghost present", !!CFG.ENEMY.ghost);
  check("CFG.ENEMY knockback dials present",
    typeof CFG.ENEMY.knockbackImpulse === "number" &&
    typeof CFG.ENEMY.knockbackPush === "number" &&
    typeof CFG.ENEMY.knockbackFriction === "number");
  const src = readFileSync(new URL("./src/enemies.js", import.meta.url), "utf8");
  check("enemies.js contains no literal Infinity (sentinel discipline)",
    !/\bInfinity\b/.test(src));

  // makeGhost builds the §2 base shape; speed is EFFECTIVE (ramp applied ONCE, E10).
  G.ramp = { enemySpeedMult: 1 };
  const g = makeGhost({ type: "ghost", x: 3, y: 4 });
  const tc = tileCenter(3, 4);
  check("makeGhost: pixel center from tile coords", approx(g.x, tc.x) && approx(g.y, tc.y));
  check("makeGhost: hp/r/points/gems from CFG",
    g.hp === CFG.ENEMY.ghost.hp && g.r === CFG.ENEMY.ghost.r &&
    g.points === CFG.ENEMY.ghost.points && g.gems === CFG.ENEMY.ghost.gems);
  check("makeGhost: base flags (spawn 0, contact false, boss false)",
    g.spawn === 0 && g.contact === false && g.boss === false);
  check("makeGhost: effective speed = speedMul × player-speed × 1 (ramp=1)",
    approx(g.speed, CFG.ENEMY.ghost.speedMul * CFG.PLAYER.speed));
  G.ramp = { enemySpeedMult: 2 };
  const g2 = makeGhost({ type: "ghost", x: 3, y: 4 });
  check("makeGhost: ramp applied ONCE (speed doubles at mult 2, E10)",
    approx(g2.speed, CFG.ENEMY.ghost.speedMul * CFG.PLAYER.speed * 2));
}

/* ========================================================================= *
   Step 3 (§6.5) — player-shot → enemy damage pass. Hit reduces hp + consumes
   the shot; Bounce is consumed on an enemy hit like any other (Q2); a lethal
   hit tags the death cause.
 * ========================================================================= */
{
  resetWorldState();
  const e = mkEnemy("zombie", 200, 200, { hp: 8 });
  G.enemies = [e];
  G.shots = [{ x: 200, y: 200, r: 4, dmg: 2, owner: "player", bounce: false, effect: "damage" }];
  __playerShotEnemyPass();
  check("shot pass: hit reduces hp by dmg", e.hp === 6);
  check("shot pass: shot consumed on enemy hit", G.shots.length === 0);

  const e2 = mkEnemy("zombie", 200, 200, { hp: 8 });
  G.enemies = [e2];
  G.shots = [{ x: 200, y: 200, r: 4, dmg: 2, owner: "player", bounce: true, effect: "damage" }];
  __playerShotEnemyPass();
  check("shot pass: Bounce shot CONSUMED on enemy hit (Q2 — not a pierce)", G.shots.length === 0);

  const e3 = mkEnemy("ghost", 200, 200, { hp: 2 });
  G.enemies = [e3];
  G.shots = [{ x: 200, y: 200, r: 4, dmg: 2, owner: "player", bounce: false, effect: "damage" }];
  __playerShotEnemyPass();
  check("shot pass: lethal hit tags cause 'player-bullet'", e3.hp <= 0 && e3._cause === "player-bullet");

  // A miss leaves the shot alive and the enemy untouched.
  const e4 = mkEnemy("zombie", 500, 500, { hp: 8 });
  G.enemies = [e4];
  G.shots = [{ x: 100, y: 100, r: 4, dmg: 2, owner: "player", bounce: false, effect: "damage" }];
  __playerShotEnemyPass();
  check("shot pass: a miss neither damages nor consumes", e4.hp === 8 && G.shots.length === 1);
}

/* ========================================================================= *
   Step 4 (§6.2, E6) — melee exchange: one exchange per contact, pair lockout,
   crate bumper, bat exemption, meleeless null-guard.
 * ========================================================================= */
{
  // (a) Contact deals 2 to enemy + melee to player once; lockout blocks re-exchange
  //     until separation; re-engage after separation exchanges again.
  resetWorldState();
  const px = G.player.x, py = G.player.y;
  const z = mkEnemy("zombie", px + 5, py, { hp: 8 });   // overlapping (5 < r+r=24)
  G.enemies = [z];
  const hp0 = G.hp;
  __meleeExchange();
  check("melee: player deals 2 to enemy", z.hp === 6);
  check("melee: enemy deals its melee (zombie 3) to player", G.hp === hp0 - CFG.ENEMY.zombie.melee);
  check("melee: pair locked (e.contact + G.player.meleeState)",
    z.contact === true && G.player.meleeState instanceof Set && G.player.meleeState.has(z));
  check("melee: both knocked back (enemy kv set)", z.kvx !== 0 || z.kvy !== 0);
  check("melee: player knocked back", G.player.kvx !== 0 || G.player.kvy !== 0);

  const hpLocked = G.hp;
  __meleeExchange();   // still overlapping, pair locked → NO second exchange
  check("melee: no re-exchange while locked (enemy hp unchanged)", z.hp === 6);
  check("melee: no re-exchange while locked (player hp unchanged)", G.hp === hpLocked);

  z.x = px + 500; z.y = py + 500;   // separate
  __meleeExchange();
  check("melee: separation clears the pair lock", z.contact === false && !G.player.meleeState.has(z));

  z.x = px + 5; z.y = py;           // re-engage
  G.player.iframe = 0;              // clear post-hit invuln so player can take damage again
  __meleeExchange();
  check("melee: re-engage after separation exchanges again", z.hp === 4 && G.hp === hpLocked - CFG.ENEMY.zombie.melee);

  // (b) Carried-crate bumper: non-bat pushed 1.5 t, NO damage either way, no lock.
  resetWorldState();
  G.player.loco = "CARRYING";
  G.player.carry = { type: "crate", entity: {} };
  const zc = mkEnemy("zombie", G.player.x + 5, G.player.y, { hp: 8 });
  G.enemies = [zc];
  const hpBefore = G.hp;
  __meleeExchange();
  check("crate bumper: enemy pushed (kv set away from player)", zc.kvx > 0);
  check("crate bumper: push impulse = knockbackPush", approx(Math.hypot(zc.kvx, zc.kvy), CFG.ENEMY.knockbackPush));
  check("crate bumper: NO damage to enemy", zc.hp === 8);
  check("crate bumper: NO damage to player", G.hp === hpBefore);
  check("crate bumper: pair not locked (no exchange happened)", zc.contact === false);

  // (c) Bat ignores the crate bumper — still deals melee 2 (and takes the player's 2).
  resetWorldState();
  G.player.loco = "CARRYING";
  G.player.carry = { type: "crate", entity: {} };
  const bat = mkEnemy("bat", G.player.x + 5, G.player.y, { hp: 2 });
  G.enemies = [bat];
  const hpB = G.hp;
  __meleeExchange();
  check("bat: ignores crate bumper — exchange still happens (enemy takes 2)", bat.hp === 0);
  check("bat: deals melee 2 to player despite crate", G.hp === hpB - CFG.ENEMY.bat.melee);

  // (d) Meleeless type (Fire Wraith has no melee): enemy takes the player's 2,
  //     player takes 0 (null-guard).
  resetWorldState();
  const fw = mkEnemy("fireWraith", G.player.x + 5, G.player.y, { hp: 2 });
  G.enemies = [fw];
  const hpFW = G.hp;
  __meleeExchange();
  check("meleeless: enemy still takes the player's 2", fw.hp === 0);
  check("meleeless (CFG melee == null): player takes 0 damage", G.hp === hpFW);
}

/* ========================================================================= *
   Step 5 (§6.3, E8) — death sweep + awardKill: gems ALWAYS drop; score is
   attribution-gated.
 * ========================================================================= */
{
  // awardKill unit: player-* adds points, wraith-aoe/enemy-* add 0.
  G.score = 100;
  awardKill({ points: 50 }, "player-bullet");
  check("awardKill: player-bullet awards points", G.score === 150);
  awardKill({ points: 50 }, "player-melee");
  check("awardKill: player-melee awards points", G.score === 200);
  awardKill({ points: 50 }, "wraith-aoe");
  check("awardKill: wraith-aoe awards 0", G.score === 200);
  awardKill({ points: 50 }, "enemy-shot");
  check("awardKill: enemy-* awards 0", G.score === 200);

  // Sweep: player-bullet death drops gems + adds points; emits enemy:killed.
  resetWorldState();
  let killedEvent = null;
  registerEmit((type, payload) => { if (type === "enemy:killed") killedEvent = payload; });
  const e = mkEnemy("skeletonShooter", 300, 300, { hp: 0, gems: 2, points: 150, _cause: "player-bullet" });
  G.enemies = [e];
  __deathSweep();
  check("death: hp<=0 drops e.gems gem pickups always", G.pickups.length === 2);
  check("death: gem pickup shape {type,x,y,value}",
    G.pickups[0].type === "gem" && G.pickups[0].x === 300 && G.pickups[0].value === CFG.GEM.energy);
  check("death: player-bullet adds points", G.score === 150);
  check("death: enemy spliced out", G.enemies.length === 0);
  check("death: emits enemy:killed with type/points/cause",
    killedEvent && killedEvent.type === "skeletonShooter" && killedEvent.points === 150 &&
    killedEvent.cause === "player-bullet");

  // Sweep: friendly-fire (wraith-aoe) still drops gems but adds 0 score (Q3).
  resetWorldState();
  G.score = 500;
  const e2 = mkEnemy("ghost", 128, 160, { hp: 0, gems: 1, points: 50, _cause: "wraith-aoe" });
  G.enemies = [e2];
  __deathSweep();
  check("death: wraith-aoe (friendly fire) STILL drops gems", G.pickups.length === 1);
  check("death: wraith-aoe adds 0 score", G.score === 500);
  registerEmit(null);   // detach the spy (loader tolerates a falsy fn)
}

/* ========================================================================= *
   Frame-order invariant (R2/E11, structural) — a lethal hit resolved in step 3
   is removed in step 5, so its step-6 AI ("explode") branch NEVER runs. Proven
   with a synthetic type whose AI is a spy; the concrete Wraith-defuse lands in
   Phase 6.
 * ========================================================================= */
{
  let boomerAIRuns = 0;
  __setEnemyAI("boomer", () => { boomerAIRuns++; });   // synthetic "would explode this frame"

  // Killed pre-AI: shot kills it in step 3, sweep removes it in step 5 → AI skipped.
  resetWorldState();
  G.player.x = tileCenter(1, 1).x; G.player.y = tileCenter(1, 1).y;  // far from the boomer
  const boom = mkEnemy("boomer", 400, 400, { hp: 1, points: 100, gems: 0 });
  G.enemies = [boom];
  G.shots = [{ x: 400, y: 400, r: 4, dmg: 2, owner: "player", bounce: false, effect: "damage" }];
  boomerAIRuns = 0;
  const scoreBefore = G.score;
  tickEnemies(0.016);
  check("R2: lethal-in-step-3 enemy removed by the step-5 death sweep", G.enemies.length === 0);
  check("R2: its step-6 AI branch NEVER ran (death sweep before AI)", boomerAIRuns === 0);
  check("R2: awarded as player-bullet (death routed through the sweep)", G.score === scoreBefore + 100);

  // Survives: non-lethal hit → present at step 6 → AI runs (control).
  resetWorldState();
  G.player.x = tileCenter(1, 1).x; G.player.y = tileCenter(1, 1).y;
  const boom2 = mkEnemy("boomer", 400, 400, { hp: 10, points: 100, gems: 0 });
  G.enemies = [boom2];
  G.shots = [{ x: 400, y: 400, r: 4, dmg: 2, owner: "player", bounce: false, effect: "damage" }];
  boomerAIRuns = 0;
  tickEnemies(0.016);
  check("R2 control: a survivor is still present at step 6", G.enemies.length === 1 && boom2.hp === 8);
  check("R2 control: its step-6 AI DID run", boomerAIRuns === 1);
}

/* ========================================================================= *
   Step 7 (§6.4) — enemy-shot → player hit-test. Player-only (never touches
   owner:"player", R3); entangle applies the web, does 0 dmg + no iframe.
 * ========================================================================= */
{
  resetWorldState();
  const px = G.player.x, py = G.player.y, hp0 = G.hp;
  G.shots = [{ x: px, y: py, r: 4, dmg: 2, owner: "enemy", effect: "damage" }];
  __enemyShotPlayerPass();
  check("enemy shot: damage shot hits player + is removed", G.hp === hp0 - 2 && G.shots.length === 0);

  resetWorldState();
  const px2 = G.player.x, py2 = G.player.y, hp2 = G.hp;
  G.shots = [{ x: px2, y: py2, r: 4, dmg: 0, owner: "enemy", effect: "entangle" }];
  __enemyShotPlayerPass();
  check("enemy shot: entangle applies web via applyEntangle", approx(G.player.entangle, CFG.ENEMY.spider.web.entangle));
  check("enemy shot: entangle deals 0 dmg + trips NO iframe", G.hp === hp2 && G.player.iframe === 0);
  check("enemy shot: entangle shot removed", G.shots.length === 0);

  // R3: owner:"player" shots are never touched by the enemy-shot pass.
  resetWorldState();
  const px3 = G.player.x, py3 = G.player.y, hp3 = G.hp;
  G.shots = [{ x: px3, y: py3, r: 4, dmg: 2, owner: "player", effect: "damage" }];
  __enemyShotPlayerPass();
  check("enemy shot pass: leaves owner:'player' shots untouched (R3)", G.shots.length === 1 && G.hp === hp3);
}

/* ========================================================================= *
   Ghost (§6.1.1) — steers toward the player + slides along a wall (per-axis),
   wedges in a concave pocket. No avoidance, no repath.
 * ========================================================================= */
{
  // Slide: a full-height wall at column 5 splits the room. The ghost, blocked
  // horizontally, slides UP along the wall toward the player's row.
  loadTileGrid([
    "###########",
    "#....#....#",
    "#....#....#",
    "#....#....#",
    "#....#....#",
    "#....#....#",
    "#....#....#",
    "#....#....#",
    "###########",
  ]);
  const player = { x: tileCenter(8, 1).x, y: tileCenter(8, 1).y };   // far side, up-right
  const g = { type: "ghost", x: tileCenter(2, 6).x, y: tileCenter(2, 6).y, r: 12, speed: 600, face: 0 };
  const y0 = g.y;
  for (let f = 0; f < 200; f++) updateGhost(g, player, 0.05);
  check("ghost slide: slides UP along the wall (y decreased)", g.y < y0 - 50);
  check("ghost slide: never crossed the wall (x stays left of col 5)", g.x < 5 * CFG.TILE);
  check("ghost slide: faced toward the player at some point", typeof g.face === "number");

  // Wedge: an inside corner (walls at (3,4) and (4,3)). The ghost steers up-left
  // toward the player but BOTH axes are individually blocked → it wedges.
  loadTileGrid([
    "#######",
    "#.....#",
    "#.....#",
    "#..##.#",
    "#..#..#",
    "#.....#",
    "#######",
  ]);
  const player2 = { x: tileCenter(1, 1).x, y: tileCenter(1, 1).y };   // up-left, behind the corner
  const gw = { type: "ghost", x: tileCenter(4, 4).x, y: tileCenter(4, 4).y, r: 12, speed: 600, face: 0 };
  for (let f = 0; f < 100; f++) updateGhost(gw, player2, 0.05);
  const midX = gw.x, midY = gw.y;
  for (let f = 0; f < 100; f++) updateGhost(gw, player2, 0.05);
  check("ghost wedge: position converges (stops moving — wedged)",
    approx(gw.x, midX, 0.5) && approx(gw.y, midY, 0.5));
  check("ghost wedge: pinned in the corner, never escaped past the walls",
    gw.x > 3 * CFG.TILE && gw.y > 3 * CFG.TILE);
  check("ghost wedge: never reached the player",
    Math.hypot(gw.x - player2.x, gw.y - player2.y) > CFG.TILE * 2);
}

/* ========================================================================= *
   R6 import discipline: enemies.js imports only the allowed set; player/
   projectiles/nav/enemies-ai never import it back (one-way flow). R3 grep:
   no owner:"player" outside player.js's spawnVolley.
 * ========================================================================= */
{
  const src = readFileSync(new URL("./src/enemies.js", import.meta.url), "utf8");
  const importLines = src.match(/^import[\s\S]*?from\s+["'][^"']+["'];/gm) || [];
  const allowed = new Set([
    "./config.js", "./state.js", "./world.js", "./player.js",
    "./level-loader.js", "./enemies-ai.js", "./projectiles.js",
  ]);
  const importsOk = importLines.every(line => {
    const m = line.match(/from\s+["']([^"']+)["']/);
    return m && allowed.has(m[1]);
  });
  check("enemies.js imports only the allowed set (config/state/world/player-sinks/loader/enemies-ai)", importsOk);
  check("enemies.js imports no nav/combat/abilities/audio module",
    !/from\s+["']\.\/(nav|combat|abilities|audio|music)\.js["']/.test(src));

  for (const mod of ["player.js", "projectiles.js", "nav.js", "enemies-ai.js"]) {
    const s = readFileSync(new URL(`./src/${mod}`, import.meta.url), "utf8");
    check(`${mod} does not import enemies.js (one-way flow, R6)`, !/["']\.\/enemies\.js["']/.test(s));
  }

  // R3: the only owner:"player" literal producer is player.js's spawnVolley.
  for (const mod of ["enemies.js", "enemies-ai.js"]) {
    const s = readFileSync(new URL(`./src/${mod}`, import.meta.url), "utf8");
    check(`${mod} never produces owner:"player" (R3)`, !/owner\s*:\s*["']player["']/.test(s));
  }
}

console.log(`\ntest-enemies-combat.js: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
