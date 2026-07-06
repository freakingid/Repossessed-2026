/* test-enemies-spawner.js — headless smoke tests for spawners (SPEC-ENEMIES
   §6.3, §0.4, E4, R5) in enemies.js (makeSpawner factory, spawnerTick emission,
   spawner-as-target damage/melee/death). Exercises the REAL modules end-to-end
   via the real tickEnemies spine — never inlined copies. Pure logic, no
   render/canvas.
   Run: node test-enemies-spawner.js
*/
import { CFG } from "./src/config.js";
import { G } from "./src/state.js";
import { tileCenter } from "./src/world.js";
import { loadLevel, registerEmit } from "./src/level-loader.js";
import { installNav } from "./src/nav.js";
import { initPlayer } from "./src/player.js";
import { clearNavigators } from "./src/enemies-ai.js";
import {
  tickEnemies, registerBarrelDetonation,
  __spawnerTick, __playerShotEnemyPass, __meleeExchange,
} from "./src/enemies.js";
import { makeShot } from "./src/projectiles.js";

let passed = 0, failed = 0;
function check(name, ok) {
  if (ok) { passed++; } else { failed++; console.error(`FAIL: ${name}`); }
}

let emitted = [];
registerEmit((type, payload) => { emitted.push({ type, payload }); });
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

function loadRoom(tiles, extraPlacements) {
  loadLevel({
    id: "spawner-room", name: "SpawnerRoom",
    tiles,
    zones: [{ role: "combat", x: 1, y: 1, w: tiles[0].length - 2, h: tiles.length - 2 }],
    placements: [
      { type: "player", x: tiles[0].length - 4, y: 4 },
      { type: "exit", x: tiles[0].length - 2, y: tiles.length - 2 },
      ...(extraPlacements || []),
    ],
    spawnRules: [],
  });
}

function resetWorldState() {
  clearNavigators();
  G.shots = []; G.enemies = []; G.pickups = []; G.ebolts = [];
  G.crates = []; G.barrels = []; G.spawners = [];
  G.score = 0;
  G.ramp = {
    enemySpeedMult: 1,
    spawnerInterval: CFG.RAMP.spawnerInterval.base,
    spawnerLiveCap: CFG.RAMP.spawnerLiveCap.base,
  };
  initPlayer();
  G.hp = G.maxHp;
  G.player.iframe = 0;
  G.player.loco = "NORMAL";
  G.player.carry = null;
  registerBarrelDetonation(() => {});
  emitted = [];
}

/* ========================================================================= *
   Factory sanity (§0.4): hp/points/gems/r from CFG.ENEMY.spawner, distinct
   stable ids, and the loader's own variant/table/interval/liveCap survive the
   decoration (the wrap-not-replace contract).
 * ========================================================================= */
{
  resetWorldState();
  loadRoom(OPEN_ROOM, [{ type: "spawner", x: 3, y: 3, variant: "bonePile" }]);
  const sp = G.spawners[0];
  check("makeSpawner: base shape from CFG.ENEMY.spawner",
    sp.hp === CFG.ENEMY.spawner.hp && sp.points === CFG.ENEMY.spawner.points &&
    sp.gems === CFG.ENEMY.spawner.gems && sp.r === CFG.ENEMY.spawner.r);
  check("makeSpawner: emitT seeded at firstDelay (2 s)", sp.emitT === CFG.ENEMY.spawner.firstDelay);
  check("makeSpawner: id assigned", sp.id != null);
  check("makeSpawner: loader's variant/table/interval/liveCap preserved",
    sp.variant === "bonePile" && sp.table && Object.keys(sp.table).length > 0 &&
    sp.interval === CFG.RAMP.spawnerInterval.base && sp.liveCap === CFG.RAMP.spawnerLiveCap.base);
  check("makeSpawner: still a nav blocker (blocks:true)", sp.blocks === true);

  resetWorldState();
  loadRoom(OPEN_ROOM, [
    { type: "spawner", x: 3, y: 3, variant: "bonePile" },
    { type: "spawner", x: 5, y: 3, variant: "bonePile" },
  ]);
  check("makeSpawner: each spawner gets a distinct stable id",
    G.spawners[0].id !== G.spawners[1].id);
}

/* ========================================================================= *
   Emission (E4): first emit at 2 s, then every interval; weighted pick only
   from the Plan-filtered table; emerges via the 0.5 s spawn gate.
 * ========================================================================= */
{
  resetWorldState();
  loadRoom(OPEN_ROOM, [{ type: "spawner", x: 3, y: 3, variant: "bonePile" }]);
  const sp = G.spawners[0];
  // bonePile table = { skeleton: 0.70, skeletonShooter: 0.30 } — both eligible
  // on the default G.night (1)? Check eligibility directly off the live table.
  check("spawner table is non-empty (Plan-filtered)", Object.keys(sp.table).length > 0);

  __spawnerTick(1.99);
  check("no emit before firstDelay (2 s)", G.enemies.length === 0);
  __spawnerTick(0.02);
  check("first emit fires at 2 s (E4)", G.enemies.length === 1);
  check("emitted child tagged originSpawner", G.enemies[0].originSpawner === sp.id);
  check("emitted child type is from the Plan-filtered table",
    Object.keys(sp.table).includes(G.enemies[0].type));
  check("emitted child emerges via the 0.5 s spawn gate",
    G.enemies[0].spawn > 0 && G.enemies[0].spawn <= CFG.ENEMY.spawner.emerge);
  check("emitT reset to the ramped interval", Math.abs(sp.emitT - sp.interval) < 1e-9);

  // Advance to just before the next interval — no second emit yet.
  __spawnerTick(sp.interval - 0.01);
  check("no second emit before the interval elapses", G.enemies.length === 1);
  __spawnerTick(0.02);
  check("second emit fires on the interval", G.enemies.length === 2);
}

/* ========================================================================= *
   Live-cap (E4/R5): a spawner may emit only while live tagged children (INCLUDING
   emergence-window ones) < liveCap.
 * ========================================================================= */
{
  resetWorldState();
  loadRoom(OPEN_ROOM, [{ type: "spawner", x: 3, y: 3, variant: "bonePile" }]);
  const sp = G.spawners[0];
  sp.liveCap = 2;
  sp.interval = 0.5;

  __spawnerTick(2.0);   // first emit
  __spawnerTick(0.5);   // second emit -> live == liveCap
  check("live-cap: reaches exactly liveCap", G.enemies.length === 2);
  __spawnerTick(0.5);   // would be a third emit, but cap blocks it
  check("live-cap: blocks emission at cap (E4)", G.enemies.length === 2);

  // R5: children still emerging (spawn > 0) MUST count toward the cap.
  check("R5: both live children are still in their emergence window",
    G.enemies.every((e) => e.spawn > 0));

  // Killing one child frees a cap slot for the next interval.
  G.enemies.pop();
  __spawnerTick(0.5);
  check("live-cap: a freed slot allows the next emit", G.enemies.length === 2);
}

/* ========================================================================= *
   Spawner-as-target (§0.4): player bullet and melee both damage a spawner;
   at hp<=0 it drops gems, awards points, emits enemy:killed, and is removed
   from G.spawners (via the real tickEnemies spine, R1-safe ordering).
 * ========================================================================= */
{
  resetWorldState();
  loadRoom(OPEN_ROOM, [{ type: "spawner", x: 3, y: 3, variant: "bonePile" }]);
  const sp = G.spawners[0];
  const c = tileCenter(3, 3);

  G.shots.push(makeShot({
    x: c.x - sp.r, y: c.y, vx: 0, vy: 0, r: 4, dmg: 3, owner: "player", maxTravel: 1e9, effect: "damage",
  }));
  __playerShotEnemyPass();
  check("player bullet damages a spawner", sp.hp === CFG.ENEMY.spawner.hp - 3);
  check("bullet consumed on hit", G.shots.length === 0);

  G.player.x = c.x - sp.r; G.player.y = c.y;
  __meleeExchange();
  check("player melee damages a spawner", sp.hp === CFG.ENEMY.spawner.hp - 3 - CFG.PLAYER.meleeDamageToEnemy);
  check("spawner deals no melee back (static, no melee-to-player)", G.hp === G.maxHp);
}
{
  resetWorldState();
  loadRoom(OPEN_ROOM, [{ type: "spawner", x: 3, y: 3, variant: "bonePile" }]);
  const sp = G.spawners[0];
  sp.hp = 1;   // one hit from death
  const c = tileCenter(3, 3);
  G.shots.push(makeShot({
    x: c.x, y: c.y, vx: 0, vy: 0, r: 4, dmg: 3, owner: "player", maxTravel: 1e9, effect: "damage",
  }));
  const beforePickups = G.pickups.length;
  tickEnemies(1 / 60);
  check("destroyed spawner drops its gems", G.pickups.length - beforePickups === CFG.ENEMY.spawner.gems);
  check("destroyed spawner awards points (player-bullet)", G.score === CFG.ENEMY.spawner.points);
  check("destroyed spawner removed from G.spawners", G.spawners.length === 0);
  const killEvt = emitted.find((e) => e.type === "enemy:killed" && e.payload.type === "spawner");
  check("destroyed spawner emits enemy:killed", !!killEvt && killEvt.payload.points === CFG.ENEMY.spawner.points);
}

/* ========================================================================= *
   Config sanity: spawner block present with the §0.4 fields.
 * ========================================================================= */
{
  const s = CFG.ENEMY.spawner;
  check("CFG.ENEMY.spawner has hp/points/gems/r/emerge/firstDelay",
    s && s.hp === 6 && s.points === 300 && s.gems === 3 && s.r === 16 &&
    s.emerge === 0.5 && s.firstDelay === 2.0);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
