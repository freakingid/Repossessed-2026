/* test-enemies-reaper.js — headless smoke tests for the Reaper (SPEC-ENEMIES
   §6.1.9, §4, E4, E9, R4, R5, R7) in enemies-ai.js (updateReaper + the bespoke
   PHANTOM mover) + enemies.js (makeReaper factory, summon/blast seams, boss-death
   FX). Exercises the REAL modules end-to-end via the real tickEnemies spine —
   never inlined copies. Pure logic, no render/canvas.
   Run: node test-enemies-reaper.js
*/
import { CFG } from "./src/config.js";
import { G } from "./src/state.js";
import { tileCenter } from "./src/world.js";
import { loadLevel, registerEmit } from "./src/level-loader.js";
import { installNav } from "./src/nav.js";
import { initPlayer } from "./src/player.js";
import { updateShots } from "./src/projectiles.js";
import { clearNavigators, phantomMover, reaperBlockerFilter, updateReaper } from "./src/enemies-ai.js";
import { tickEnemies, makeReaper, registerBarrelDetonation } from "./src/enemies.js";

let passed = 0, failed = 0;
function check(name, ok) {
  if (ok) { passed++; } else { failed++; console.error(`FAIL: ${name}`); }
}

let emitted = [];
registerEmit((type, payload) => { emitted.push({ type, payload }); });
installNav();

// A full-height wall column at tx=7 fully separates the left room (tx 1..6) from
// the right room (tx 8..13): a GROUND enemy can never cross, but a PHANTOM Reaper
// walks straight through.
const SPLIT_ROOM = [
  "###############",
  "#......#......#",
  "#......#......#",
  "#......#......#",
  "#......#......#",
  "#......#......#",
  "#......#......#",
  "#......#......#",
  "###############",
];

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
    id: "reaper-room", name: "ReaperRoom",
    tiles,
    zones: [{ role: "combat", x: 1, y: 1, w: tiles[0].length - 2, h: tiles.length - 2 }],
    placements: [
      { type: "player", x: tiles[0].length - 4, y: 4 },
      { type: "exit", x: tiles[0].length - 2, y: tiles.length - 2 },
    ],
    spawnRules: [],
  });
}

function resetWorldState() {
  clearNavigators();
  G.shots = []; G.enemies = []; G.pickups = []; G.ebolts = [];
  G.crates = []; G.barrels = []; G.spawners = [];
  G.score = 0;
  G.ramp = { enemySpeedMult: 1, reaperSummonInterval: CFG.RAMP.reaperSummonInterval.base };
  initPlayer();
  G.hp = G.maxHp;
  G.player.iframe = 0;
  G.player.loco = "NORMAL";
  G.player.carry = null;
  registerBarrelDetonation(() => {});
  emitted = [];
}

/* ========================================================================= *
   Factory sanity + the #5 flags (E9): boss true, resist marker exposed, id set.
 * ========================================================================= */
{
  loadRoom(OPEN_ROOM);
  resetWorldState();
  const r = makeReaper({ type: "reaper", x: 3, y: 4 });
  check("makeReaper: base shape from CFG",
    r.type === "reaper" && r.hp === CFG.ENEMY.reaper.hp &&
    r.points === CFG.ENEMY.reaper.points && r.gems === CFG.ENEMY.reaper.gems &&
    r.r === CFG.ENEMY.reaper.r);
  check("makeReaper: e.boss true (E9)", r.boss === true);
  check("makeReaper: Nova/Lightning seam sees the resist flag (E9)",
    !!r.resist && r.resist.nova === true && r.resist.lightning === true);
  const r2 = makeReaper({ type: "reaper", x: 4, y: 4 });
  check("makeReaper: each Reaper gets a distinct stable id (E4 tag source)",
    r.id != null && r2.id != null && r.id !== r2.id);
  check("makeReaper: speed = speedMul x player x ramp (E10)",
    Math.abs(r.speed - CFG.ENEMY.reaper.speedMul * CFG.PLAYER.speed * 1) < 1e-9);
}

/* ========================================================================= *
   R4 / §0.1 — the bespoke PHANTOM mover: crosses a WALL (never bodyHitsWall),
   is blocked by a CRATE (crates+barrels filter), and PASSES a spawner (excluded).
 * ========================================================================= */
{
  loadRoom(SPLIT_ROOM);
  resetWorldState();

  // A body straddling the wall column: move it +x THROUGH the wall at tx=7.
  const start = tileCenter(6, 4);
  const body = { type: "reaper", x: start.x, y: start.y, r: CFG.ENEMY.reaper.r };
  for (let i = 0; i < 30; i++) phantomMover(body, 4, 0);   // 120 px of intended travel
  check("phantomMover: crosses a wall column without wedging (R4)",
    body.x > tileCenter(8, 4).x);

  // A crate directly ahead of a FRESH body blocks it (crates+barrels-only filter).
  const cbody = { type: "reaper", x: tileCenter(8, 4).x, y: tileCenter(8, 4).y, r: CFG.ENEMY.reaper.r };
  const c = tileCenter(11, 4);
  G.crates.push({ type: "crate", x: c.x, y: c.y });
  const cStart = cbody.x;
  for (let i = 0; i < 40; i++) phantomMover(cbody, 4, 0);
  check("phantomMover: BLOCKED by a crate in its path (R4 filter)",
    cbody.x < c.x - CFG.ENEMY.reaper.r);   // never reaches/penetrates the crate
  check("phantomMover: advanced toward the crate before stopping",
    cbody.x > cStart);

  // A spawner in the path is NOT a blocker (nav routes PHANTOM through spawners).
  G.crates.length = 0;
  const body2 = { type: "reaper", x: tileCenter(2, 6).x, y: tileCenter(2, 6).y, r: CFG.ENEMY.reaper.r };
  G.spawners.push({ type: "spawner", x: tileCenter(4, 6).x, y: tileCenter(4, 6).y });
  const b2before = body2.x;
  for (let i = 0; i < 40; i++) phantomMover(body2, 4, 0);
  check("phantomMover: PASSES THROUGH a spawner (excluded by the filter, §4)",
    body2.x > tileCenter(5, 6).x && body2.x > b2before);
  check("reaperBlockerFilter: crate/barrel block, spawner passes",
    reaperBlockerFilter({ type: "crate" }) === true &&
    reaperBlockerFilter({ type: "barrel" }) === true &&
    reaperBlockerFilter({ type: "spawner" }) === false);
}

/* ========================================================================= *
   Behavioral — the Reaper PHANTOM-A*s across the full wall column to reach a
   player a GROUND enemy could never touch (the wall-crossing regression guard).
 * ========================================================================= */
{
  loadRoom(SPLIT_ROOM);
  resetWorldState();
  G.player.x = tileCenter(11, 4).x;
  G.player.y = tileCenter(4, 4).y;

  const r = makeReaper({ type: "reaper", x: 2, y: 4 });
  // Silence the attacks so this isolates locomotion.
  r.reaperAI = { summonCd: 1e9, blastCd: 1e9 };
  G.enemies.push(r);

  const startX = r.x;
  for (let f = 0; f < 900; f++) tickEnemies(1 / 60);   // 15 s at 44.8 px/s
  check("Reaper: crosses the full wall column toward the player (no wedge, R4)",
    r.x > tileCenter(8, 4).x && r.x > startX);
}

/* ========================================================================= *
   Summon (E4/R5) — picks 2 Ghosts OR 1 Skeleton, tags originSpawner, caps at 6.
 * ========================================================================= */
{
  loadRoom(OPEN_ROOM);
  resetWorldState();

  const r = makeReaper({ type: "reaper", x: 4, y: 4 });
  r.reaperAI = { summonCd: 0.001, blastCd: 1e9 };   // fire a summon on the next tick
  G.enemies.push(r);

  const realRandom = Math.random;
  Math.random = () => 0;                 // pick index 0 -> "ghost" -> 2 Ghosts
  tickEnemies(1 / 60);
  Math.random = realRandom;
  const ghosts = G.enemies.filter((e) => e.type === "ghost" && e.originSpawner === r.id);
  check("Reaper summon: 'ghost' pick spawns exactly 2 Ghosts tagged originSpawner",
    ghosts.length === 2);
  check("Reaper summon: minions emerge via the 0.5 s spawn gate (R5)",
    ghosts.every((g) => g.spawn > 0 && g.spawn <= CFG.ENEMY.spawner.emerge));
}
{
  loadRoom(OPEN_ROOM);
  resetWorldState();

  const r = makeReaper({ type: "reaper", x: 4, y: 4 });
  r.reaperAI = { summonCd: 0.001, blastCd: 1e9 };
  G.enemies.push(r);

  const realRandom = Math.random;
  Math.random = () => 0.9;                // pick index 2 -> "skeleton" -> 1 Skeleton
  tickEnemies(1 / 60);
  Math.random = realRandom;
  const skels = G.enemies.filter((e) => e.type === "skeleton" && e.originSpawner === r.id);
  check("Reaper summon: 'skeleton' pick spawns exactly 1 Skeleton tagged originSpawner",
    skels.length === 1);
}
{
  loadRoom(OPEN_ROOM);
  resetWorldState();

  const r = makeReaper({ type: "reaper", x: 4, y: 4 });
  r.reaperAI = { summonCd: 0.001, blastCd: 1e9 };
  G.enemies.push(r);

  // Seed 5 already-live tagged minions, SOME still in their emergence window, to
  // prove the cap scan counts emergence-window children too (R5).
  for (let k = 0; k < 5; k++) {
    G.enemies.push({
      type: "ghost", x: r.x, y: r.y, r: 12, hp: 2, spawn: k < 2 ? 0.3 : 0,
      originSpawner: r.id, kvx: 0, kvy: 0, contact: false, points: 50, gems: 1,
    });
  }
  const realRandom = Math.random;
  Math.random = () => 0;                  // "ghost" -> would add 2, but only 1 slot left
  tickEnemies(1 / 60);
  Math.random = realRandom;
  const tagged = G.enemies.filter((e) => e.originSpawner === r.id);
  check("Reaper summon: live cap = 6 tagged minions, counting emergence-window ones (E4/R5)",
    tagged.length === 6);
}

/* ========================================================================= *
   Dark blast (R3/R7) — every 9 s, straight makeShot at the player; owner enemy;
   rides updateShots and FIZZLES on a wall (non-bounce), never reaching the player.
 * ========================================================================= */
{
  loadRoom(SPLIT_ROOM);
  resetWorldState();
  G.player.x = tileCenter(11, 4).x;
  G.player.y = tileCenter(4, 4).y;

  const r = makeReaper({ type: "reaper", x: 2, y: 4 });
  r.reaperAI = { summonCd: 1e9, blastCd: 0.001 };   // fire a blast on the next tick
  G.enemies.push(r);

  tickEnemies(1 / 60);
  const blast = G.shots.find((s) => s.owner === "enemy");
  check("Reaper blast: one enemy-owned straight shot minted (R3)", !!blast);
  check("Reaper blast: shape — dmg=blastDmg, speed=blastSpeedMul x player, maxTravel=blastRange (R7)",
    blast && blast.dmg === CFG.ENEMY.reaper.blastDmg &&
    Math.abs(Math.hypot(blast.vx, blast.vy) - CFG.ENEMY.reaper.blastSpeedMul * CFG.PLAYER.speed) < 1e-6 &&
    blast.maxTravel === CFG.ENEMY.reaper.blastRange && blast.effect === "damage" && blast.bounce === false);

  // Drive the shot: it travels +x from tx=2 into the tx=7 wall and fizzles there.
  const hpBefore = G.hp;
  for (let f = 0; f < 300 && G.shots.length > 0; f++) updateShots(1 / 60);
  check("Reaper blast: non-bounce shot FIZZLES on the wall (removed from G.shots)",
    G.shots.length === 0);
  check("Reaper blast: fizzled short of the player — no damage through the wall",
    G.hp === hpBefore);
}

/* ========================================================================= *
   Reaper blast timing is the fixed 9 s clock (independent of the ramped summon).
 * ========================================================================= */
{
  loadRoom(OPEN_ROOM);
  resetWorldState();
  G.player.x = tileCenter(6, 4).x;
  G.player.y = tileCenter(4, 4).y;

  const r = makeReaper({ type: "reaper", x: 5, y: 4 });
  r.reaperAI = { summonCd: 1e9, blastCd: 9.0 };
  G.enemies.push(r);

  // Drive updateReaper directly to isolate the blast CADENCE from melee/death
  // (a full tickEnemies would let the player's melee kill the Reaper before 9 s).
  let blasts = 0;
  const dt = 1 / 60;
  for (let f = 0; f < Math.round(9.5 * 60); f++) {
    const before = G.shots.length;
    updateReaper(r, G.player, dt);
    if (G.shots.length > before) blasts++;
  }
  check("Reaper blast: fires once across a ~9.5 s window (fixed 9 s cadence)", blasts === 1);
}

/* ========================================================================= *
   Death → the boss-kill FX event (screen-shake + hit-stop, §6.3, #7/#10).
 * ========================================================================= */
{
  loadRoom(OPEN_ROOM);
  resetWorldState();

  const r = makeReaper({ type: "reaper", x: 5, y: 4 });
  r.reaperAI = { summonCd: 1e9, blastCd: 1e9 };
  G.enemies.push(r);

  r.hp = 0;
  r._cause = "player-bullet";
  emitted = [];
  tickEnemies(1 / 60);   // step 5 death sweep runs

  const killed = emitted.find((e) => e.type === "enemy:killed" && e.payload.type === "reaper");
  const bossFx = emitted.find((e) => e.type === "boss:killed" && e.payload.type === "reaper");
  check("Reaper death: enemy:killed emitted + points awarded (player cause)",
    !!killed && G.score === CFG.ENEMY.reaper.points);
  check("Reaper death: boss:killed FX event emitted (screen-shake + hit-stop)",
    !!bossFx && bossFx.payload.shake === true && bossFx.payload.hitStop === true);
  check("Reaper death: gems dropped (10)",
    G.pickups.filter((p) => p.type === "gem").length === CFG.ENEMY.reaper.gems);
  check("Reaper death: removed from G.enemies", !G.enemies.includes(r));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
