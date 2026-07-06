/* test-enemies-lobber.js — headless smoke tests for the Lobber (SPEC-ENEMIES
   §6.1.4, §6.4, E1) in enemies-ai.js (updateLobber, ADAPTS ADD updateSorter) +
   enemies.js (makeLobber factory, lob-fire seam, updateEbolts arced-ordnance
   system). Exercises the REAL modules end-to-end via the real tickEnemies
   spine, never inlined copies. Pure logic — no render/canvas.
   Run: node test-enemies-lobber.js
*/
import { CFG } from "./src/config.js";
import { G } from "./src/state.js";
import { tileCenter } from "./src/world.js";
import { loadLevel, registerEmit } from "./src/level-loader.js";
import { installNav } from "./src/nav.js";
import { initPlayer } from "./src/player.js";
import { clearNavigators } from "./src/enemies-ai.js";
import { tickEnemies, makeLobber, registerBarrelDetonation } from "./src/enemies.js";

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
    id: "lobber-room", name: "LobberRoom",
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
  G.shots = []; G.enemies = []; G.pickups = []; G.ebolts = [];
  G.score = 0;
  G.ramp = { enemySpeedMult: 1, lobberErrorRadius: CFG.RAMP.lobberErrorRadius.base };
  initPlayer();
  G.hp = G.maxHp;
  G.player.iframe = 0;
  G.player.loco = "NORMAL";
  G.player.carry = null;
  registerBarrelDetonation(() => {});
}

/* ========================================================================= *
   Factory sanity.
 * ========================================================================= */
{
  loadRoom(OPEN_ROOM);
  resetWorldState();
  const l = makeLobber({ type: "lobber", x: 3, y: 4 });
  check("makeLobber: base shape from CFG",
    l.type === "lobber" && l.hp === CFG.ENEMY.lobber.hp &&
    l.points === CFG.ENEMY.lobber.points && l.gems === CFG.ENEMY.lobber.gems);
}

/* ========================================================================= *
   Exposed (canSee) -> panic: flees AWAY at fleeMul, holds fire (no ebolt).
 * ========================================================================= */
{
  loadRoom(OPEN_ROOM);
  resetWorldState();

  G.player.x = tileCenter(7, 4).x;
  G.player.y = tileCenter(4, 4).y;

  const l = makeLobber({ type: "lobber", x: 2, y: 4 });
  G.enemies.push(l);

  // Force LOS-acquired state directly (open room already gives LOS; drive one
  // tick to let the throttled check populate canSee).
  tickEnemies(1 / 60);
  check("Lobber: canSee becomes true in an open room with clear LOS",
    l.lobber && l.lobber.canSee === true);

  const distBefore = Math.hypot(l.x - G.player.x, l.y - G.player.y);
  for (let f = 0; f < 30; f++) tickEnemies(1 / 60);
  const distAfter = Math.hypot(l.x - G.player.x, l.y - G.player.y);
  check("Lobber: exposed -> flees AWAY from the player (distance grows)",
    distAfter > distBefore);
  check("Lobber: exposed -> holds fire (no ebolt minted)", G.ebolts.length === 0);
}

/* ========================================================================= *
   In cover (!canSee) -> advances at 0.40x and lobs every lobEvery once within
   lobRange. Verified against a wall blocking LOS.
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

  // Player and Lobber on opposite sides of the wall column (tx=6), both row 4
  // — LOS is blocked, and they're within lobRange (9t).
  G.player.x = tileCenter(9, 4).x;
  G.player.y = tileCenter(4, 4).y;

  const l = makeLobber({ type: "lobber", x: 2, y: 4 });
  G.enemies.push(l);

  tickEnemies(1 / 60);
  check("Lobber: !canSee behind an intervening wall", l.lobber && l.lobber.canSee === false);

  const x0 = l.x;
  for (let f = 0; f < 30; f++) tickEnemies(1 / 60);
  check("Lobber: in cover -> advances toward the player", l.x > x0);

  // Run long enough to guarantee at least one lob (lobEvery 2.5s).
  let lobs = 0;
  for (let f = 0; f < 400; f++) {
    const before = G.ebolts.length;
    tickEnemies(1 / 60);
    if (G.ebolts.length > before) lobs++;
  }
  check("Lobber: in cover within range -> lobs at least once", lobs >= 1);
}

/* ========================================================================= *
   The lob is an arced G.ebolts entry (E1), not a Shot: verify shape, and that
   the landing lands within G.ramp.lobberErrorRadius of the player's position
   at fire time.
 * ========================================================================= */
{
  loadRoom(OPEN_ROOM);
  resetWorldState();
  G.ramp.lobberErrorRadius = 1.5;   // base — generous window for the assertion

  G.player.x = tileCenter(6, 4).x;
  G.player.y = tileCenter(4, 4).y;

  const l = makeLobber({ type: "lobber", x: 5, y: 4 });   // in range, in cover (no wall, but force canSee false)
  l.lobber = { canSee: false, losT: 999, fireCd: 0, wander: 0 };
  G.enemies.push(l);

  const px = G.player.x, py = G.player.y;
  tickEnemies(1 / 60);

  check("Lobber lob: G.shots stays empty (arced ordnance is not a Shot, E1)",
    G.shots.length === 0);
  check("Lobber lob: exactly one G.ebolts entry minted", G.ebolts.length === 1);
  const b = G.ebolts[0];
  check("Lobber lob: ebolt shape (kind arc, owner enemy, dur=airtime, blast/dmg from CFG)",
    b.kind === "arc" && b.owner === "enemy" &&
    Math.abs(b.dur - CFG.ENEMY.lobber.airtime) < 1e-9 &&
    Math.abs(b.blast - CFG.ENEMY.lobber.blast * CFG.TILE) < 1e-9 &&
    b.dmg === CFG.ENEMY.lobber.lobDmg);
  const errPx = G.ramp.lobberErrorRadius * CFG.TILE;
  const landDist = Math.hypot(b.tx - px, b.ty - py);
  check("Lobber lob: lands within G.ramp.lobberErrorRadius of the player's fire-time position",
    landDist <= errPx + 1e-6);
}

/* ========================================================================= *
   updateEbolts (§6.4): airtime interpolation, AoE at landing hits the player
   at <= 1.25t, ignoring an intervening wall (wall-agnostic in flight); barrel
   seam called.
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

  let barrelCall = null;
  registerBarrelDetonation((x, y, r, cause) => { barrelCall = { x, y, r, cause }; });

  const landing = tileCenter(9, 4);
  G.player.x = landing.x;
  G.player.y = landing.y;

  // Synthesize an in-flight ebolt directly (isolating updateEbolts itself,
  // not the Lobber's targeting) launched from across the wall at (2,4).
  const launch = tileCenter(2, 4);
  G.ebolts.push({
    kind: "arc",
    x: launch.x, y: launch.y, x0: launch.x, y0: launch.y,
    tx: landing.x, ty: landing.y,
    t: 0, dur: CFG.ENEMY.lobber.airtime,
    height: 0,
    dmg: CFG.ENEMY.lobber.lobDmg, blast: CFG.ENEMY.lobber.blast * CFG.TILE,
    owner: "enemy",
  });

  const hpBefore = G.hp;
  // Advance short of landing — no splat yet, AoE not yet applied.
  tickEnemies(CFG.ENEMY.lobber.airtime * 0.5);
  check("updateEbolts: mid-flight, no damage yet, ebolt still live",
    G.hp === hpBefore && G.ebolts.length === 1);

  // Finish the flight — splat + AoE should land now, ignoring the intervening wall.
  tickEnemies(CFG.ENEMY.lobber.airtime * 0.6);
  check("updateEbolts: AoE at landing hits the player through an intervening wall",
    hpBefore - G.hp === CFG.ENEMY.lobber.lobDmg);
  check("updateEbolts: ebolt removed after landing", G.ebolts.length === 0);
  check("updateEbolts: barrel-detonation seam called at the landing point",
    barrelCall !== null && barrelCall.cause === "enemy-lob" &&
    Math.abs(barrelCall.r - CFG.ENEMY.lobber.blast * CFG.TILE) < 1e-6);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
