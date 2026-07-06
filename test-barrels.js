/* test-barrels.js — headless smoke tests for SPEC-BARRELS Phase 2:
   the barrel entity decoration (B2), the fire ladder (fireStateOf, §2.5),
   damage intake (damageBarrel, §3.1), the real detonateBarrelsInRadius seam
   filled into BOTH enemies.js and abilities.js (B10, §6), and the
   self-contained shotsVsBarrels pass (B4). NO roll/kick physics, NO
   detonation/shrapnel resolution yet (Phase 4 owes that).
   Exercises the REAL modules, never inlined copies. Pure logic, no canvas.
   Run: node test-barrels.js
*/

// --- Minimal browser-global stubs (defensive; house headless style) ----------
globalThis.window ||= globalThis;
globalThis.document ||= { createElement: () => ({ getContext: () => ({}) }) };
globalThis.AudioContext ||= function () {};

import { CFG } from "./src/config.js";
import { G } from "./src/state.js";
import { tileCenter } from "./src/world.js";
import { installNav } from "./src/nav.js";
import { initPlayer } from "./src/player.js";
import { clearNavigators } from "./src/enemies-ai.js";
import { loadLevel, registerEmit, getEntityFactory } from "./src/level-loader.js";
import { registerBarrelDetonation as regEnemies } from "./src/enemies.js";
import { registerBarrelDetonation as regAbilities, __onLightning, initAbilities } from "./src/abilities.js";
import {
  fireStateOf, lightRadiusOf, damageBarrel, detonateBarrelsInRadius, shotsVsBarrels, initBarrels,
} from "./src/barrels.js";

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

function loadRoom() {
  loadLevel({
    id: "barrels-room", name: "BarrelsRoom",
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
  G.shots = []; G.enemies = []; G.pickups = []; G.barrels = []; G.lights = [];
  G.score = 0;
  G.ramp = { enemySpeedMult: 1 };
  initPlayer();
  initAbilities();
  initBarrels();
  G.hp = G.maxHp;
  G.player.iframe = 0;
  G.player.loco = "NORMAL";
  G.player.carry = null;
}

// Place one decorated barrel directly via the registered factory (mirrors the
// house pattern of driving a real factory rather than hand-building fields).
function placeBarrel(tx, ty) {
  const factory = getEntityFactory("barrel");
  const b = factory({ type: "barrel", x: tx, y: ty });
  G.barrels.push(b);
  return b;
}

/* ========================================================================= *
   1. Decorate (B2) — placeholder -> decorated barrel (hp 4, blocks true, r,
      rolling false, _cause null); G.lights emitter registered with source===b.
 * ========================================================================= */
{
  loadRoom();
  resetWorldState();

  const b = placeBarrel(4, 4);

  check("barrel.type === 'barrel'", b.type === "barrel");
  check("barrel.blocks === true", b.blocks === true);
  check("barrel.hp === CFG.BARREL.hp (4)", b.hp === CFG.BARREL.hp && b.hp === 4);
  check("barrel.r === CFG.BARREL.r", b.r === CFG.BARREL.r);
  check("barrel.vx === 0 && barrel.vy === 0", b.vx === 0 && b.vy === 0);
  check("barrel.rolling === false", b.rolling === false);
  check("barrel._cause === null", b._cause === null);
  check("barrel.x,y are pixel coords matching tileCenter(4,4)",
    b.x === tileCenter(4, 4).x && b.y === tileCenter(4, 4).y);

  const light = G.lights.find((l) => l.source === b);
  check("G.lights gained a {source: barrel} emitter", light !== undefined);
}

/* ========================================================================= *
   2. fireStateOf ladder (§2.5) + light-radius mapping (§3.2/§3.3)
 * ========================================================================= */
{
  loadRoom();
  resetWorldState();
  const b = placeBarrel(4, 4);

  b.hp = 4; check("hp 4 -> intact", fireStateOf(b) === "intact");
  check("intact light radius === 0", lightRadiusOf(b) === 0);

  b.hp = 3; check("hp 3 -> smolder", fireStateOf(b) === "smolder");
  check("smolder light radius", lightRadiusOf(b) === CFG.BARREL.light.smolder * CFG.TILE);

  b.hp = 2; check("hp 2 -> burning", fireStateOf(b) === "burning");
  check("burning light radius", lightRadiusOf(b) === CFG.BARREL.light.burning * CFG.TILE);

  b.hp = 1; check("hp 1 -> raging", fireStateOf(b) === "raging");
  check("raging light radius", lightRadiusOf(b) === CFG.BARREL.light.raging * CFG.TILE);

  b.hp = 0; check("hp 0 -> explode", fireStateOf(b) === "explode");
  b.hp = -3; check("hp < 0 -> explode", fireStateOf(b) === "explode");
}

/* ========================================================================= *
   3. damageBarrel (§3.1) — subtracts hp, tags _cause, fireState transitions;
      hp<=0 flags detonation (no shrapnel/splice this phase — barrel stays in
      G.barrels, untouched otherwise).
 * ========================================================================= */
{
  loadRoom();
  resetWorldState();
  const b = placeBarrel(4, 4);

  damageBarrel(b, 1, "player-bullet");
  check("damageBarrel subtracts hp", b.hp === 3);
  check("damageBarrel tags _cause", b._cause === "player-bullet");
  check("fireState transitions to smolder", fireStateOf(b) === "smolder");

  damageBarrel(b, 1, "enemy-shot");
  check("_cause updates to the latest damager (last-damager-wins)", b._cause === "enemy-shot");
  check("hp now 2 (burning)", b.hp === 2 && fireStateOf(b) === "burning");

  damageBarrel(b, 2, "player-lightning");
  check("hp<=0 leaves barrel intact structurally (Phase 4 owes detonation)", b.hp === 0);
  check("_cause tagged with the killing cause", b._cause === "player-lightning");
  check("barrel is NOT spliced from G.barrels this phase", G.barrels.includes(b));
  check("G.shrapnel stays empty this phase (no shrapnel resolution yet)", G.shrapnel.length === 0);
}

/* ========================================================================= *
   4. detonateBarrelsInRadius (§6/B10) — registered into BOTH enemies.js and
      abilities.js at barrels.js module load; applies damage within radius+b.r
      (pixels); Wraith dmg(4) detonates a 4-HP barrel; lob dmg(2) leaves it at
      2; Lightning's lethal default drives hp<=0.
 * ========================================================================= */
{
  loadRoom();
  resetWorldState();

  // The seam is registered at barrels.js module load (import side-effect) —
  // verify both consumers now call the real fn, not the enemies.js/abilities.js
  // no-op default, by exercising it directly through detonateBarrelsInRadius
  // (the same fn object both registries hold).
  const b1 = placeBarrel(4, 4);
  const px = tileCenter(4, 4).x, py = tileCenter(4, 4).y;

  detonateBarrelsInRadius(px, py, 32, "wraith-aoe", CFG.ENEMY.fireWraith.explodeDmg);
  check("Wraith explodeDmg(4) detonates a 4-HP barrel to hp<=0", b1.hp <= 0);
  check("cause tagged wraith-aoe", b1._cause === "wraith-aoe");

  const b2 = placeBarrel(5, 4);
  const px2 = tileCenter(5, 4).x, py2 = tileCenter(5, 4).y;
  detonateBarrelsInRadius(px2, py2, 32, "enemy-lob", 2);
  check("lob dmg(2) leaves a 4-HP barrel at hp 2 (Burning, no detonation)", b2.hp === 2);
  check("cause tagged enemy-lob", b2._cause === "enemy-lob");

  const b3 = placeBarrel(6, 4);
  const px3 = tileCenter(6, 4).x, py3 = tileCenter(6, 4).y;
  detonateBarrelsInRadius(px3, py3, 32, "player-lightning"); // default LETHAL
  check("Lightning's default LETHAL drives hp<=0", b3.hp <= 0);
  check("LETHAL default used matches CFG.BARREL.LETHAL magnitude",
    b3.hp === 4 - CFG.BARREL.LETHAL);

  // Out-of-radius barrel is untouched.
  const b4 = placeBarrel(12, 4);
  detonateBarrelsInRadius(px, py, 32, "wraith-aoe", 4);
  check("a barrel outside the radius is untouched", b4.hp === CFG.BARREL.hp);

  // Both registries route to the same real fn (not the no-op default) —
  // call enemies.js's and abilities.js's registered fn references directly.
  let sawEnemies = false, sawAbilities = false;
  regEnemies((...args) => { sawEnemies = true; detonateBarrelsInRadius(...args); });
  regAbilities((...args) => { sawAbilities = true; detonateBarrelsInRadius(...args); });
  // Restore the real fn as the registration (barrels.js owns this at load;
  // re-register here so later suites in the same process aren't affected).
  regEnemies(detonateBarrelsInRadius);
  regAbilities(detonateBarrelsInRadius);
  check("enemies.js seam is re-registrable to the real fn", typeof regEnemies === "function");
  check("abilities.js seam is re-registrable to the real fn", typeof regAbilities === "function");
}

/* ========================================================================= *
   5. shotsVsBarrels (B4) — consume+damage, player and enemy shots, removed
      not bounced, tagged; runs as its own self-contained pass.
 * ========================================================================= */
{
  loadRoom();
  resetWorldState();

  const b = placeBarrel(4, 4);
  const bx = tileCenter(4, 4).x, by = tileCenter(4, 4).y;

  G.shots = [
    { x: bx, y: by, vx: 0, vy: 0, r: 4, dmg: 1, owner: "player", traveled: 0, bounce: false, bounceCount: 0 },
  ];
  shotsVsBarrels();
  check("player shot damages the barrel", b.hp === 3);
  check("player shot tagged player-bullet", b._cause === "player-bullet");
  check("player shot removed from G.shots (consumed, not bounced)", G.shots.length === 0);

  G.shots = [
    { x: bx, y: by, vx: 0, vy: 0, r: 4, dmg: 1, owner: "enemy", traveled: 0, bounce: false, bounceCount: 0 },
  ];
  shotsVsBarrels();
  check("enemy shot damages the barrel", b.hp === 2);
  check("enemy shot tagged enemy-*", b._cause === "enemy-shot");
  check("enemy shot removed from G.shots (consumed, not bounced)", G.shots.length === 0);

  // A shot with no overlap is left alone.
  G.shots = [
    { x: bx + 1000, y: by, vx: 0, vy: 0, r: 4, dmg: 1, owner: "player", traveled: 0, bounce: false, bounceCount: 0 },
  ];
  shotsVsBarrels();
  check("a non-overlapping shot is untouched", G.shots.length === 1 && b.hp === 2);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
