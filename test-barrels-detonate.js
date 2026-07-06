/* test-barrels-detonate.js — headless smoke tests for SPEC-BARRELS Phase 4:
   DETONATION (B8), detonate-in-hand (B5), the chain-of-custody attribution
   (B9), and the chain-reaction callout (§5.3). Covers:
     · detonation: hp<=0 barrel -> 8 owner-tagged shrapnel, barrel:exploded emit
       with the FX payload, markNavDirty, barrel spliced, NO direct damage;
     · detonation is COLLECTED + resolved in updateBarrels AFTER the roll pass
       (never mid-iteration) — a non-rolling shot-killed barrel detonates too;
     · detonate-in-hand: shrapnel centred on the player, carry cleared via the
       sink, loco NORMAL, barrel NOT re-inserted, post-hit i-frames cap it;
     · attribution: owner derives from _cause (player-lightning/-bullet/-kick ->
       player; wraith-aoe/enemy-lob -> enemy); player-owned shrapnel scores its
       kills, enemy-owned scores 0; a barrel killed by player-owned shrapnel
       detonates player-owned (chain propagation);
     · chain reaction: a >=3-barrel wave emits chain:reaction {count, owner};
       a 2-barrel wave does NOT.
   Exercises the REAL modules, never inlined copies. Pure logic, no canvas.
   Run: node test-barrels-detonate.js
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
import {
  updateBarrels, updateShrapnel, damageBarrel, initBarrels,
} from "./src/barrels.js";

let passed = 0, failed = 0;
function check(name, ok) {
  if (ok) { passed++; } else { failed++; console.error(`FAIL: ${name}`); }
}

// Emit spy (level-loader routes every emit here once registered).
const emitted = [];
registerEmit((type, payload) => emitted.push({ type, payload }));
const sawEmit = (type) => emitted.some((e) => e.type === type);
const lastEmitOf = (type) => [...emitted].reverse().find((e) => e.type === type);
const countEmit = (type) => emitted.filter((e) => e.type === type).length;

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
    id: "barrels-detonate-room", name: "BarrelsDetonateRoom",
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
}

// A decorated barrel via the registered factory (barrels.js decorated it at load).
// The loader placeholder reads x,y as TILE indices (tileCenter'd internally).
function makeBarrel(tx = 0, ty = 0) {
  return getEntityFactory("barrel")({ type: "barrel", x: tx, y: ty });
}
function placeBarrel(tx, ty) {
  const b = makeBarrel(tx, ty);
  G.barrels.push(b);
  return b;
}
function mkEnemy(type, x, y, over = {}) {
  const cfg = CFG.ENEMY[type] || {};
  return {
    type, x, y, r: cfg.r ?? 12, hp: cfg.hp ?? 4,
    speed: 0, face: 0, kvx: 0, kvy: 0, contact: false, spawn: 0,
    originSpawner: null, boss: !!cfg.boss, points: cfg.points ?? 0, gems: cfg.gems ?? 0, ...over,
  };
}
// A shrapnel piece with the §2.4 shape, owner-tagged, at (x,y) stationary.
function mkShrapnel(x, y, owner, over = {}) {
  const shr = CFG.BARREL.shrapnel;
  return { x, y, vx: 0, vy: 0, r: CFG.SHOT.r, dmg: shr.dmg, health: shr.health, life: 0, owner, ...over };
}

loadRoom();

/* ========================================================================= *
   1. Detonation (B8) — an hp<=0 barrel spawns `count` owner-tagged shrapnel,
      emits barrel:exploded with the full FX payload, markNavDirty, splices out.
      NO direct damage (shrapnel-only) — an enemy on top of it is untouched.
 * ========================================================================= */
{
  resetWorldState();
  const b = placeBarrel(6, 4);
  const e = mkEnemy("zombie", b.x, b.y, { hp: 8 });         // sitting on the barrel
  G.enemies = [e];
  navDirtied.length = 0; emitted.length = 0;

  damageBarrel(b, CFG.BARREL.LETHAL, "player-bullet");      // drive hp<=0, player cause
  updateBarrels(0.016);                                     // detonation resolved here

  const ex = CFG.BARREL.explosion;
  check("detonate: spawns exactly shrapnel.count pieces", G.shrapnel.length === CFG.BARREL.shrapnel.count);
  check("detonate: every piece owner-tagged 'player'", G.shrapnel.every((s) => s.owner === "player"));
  check("detonate: pieces carry the §2.4 shape (dmg/health/life/r)",
    G.shrapnel.every((s) => s.dmg === CFG.BARREL.shrapnel.dmg && s.health === CFG.BARREL.shrapnel.health
      && s.life === 0 && s.r === CFG.SHOT.r));
  check("detonate: pieces launch at shrapnel.speed",
    G.shrapnel.every((s) => Math.abs(Math.hypot(s.vx, s.vy) - CFG.BARREL.shrapnel.speed) < 1e-6));
  const ex1 = lastEmitOf("barrel:exploded");
  check("detonate: emits barrel:exploded", !!ex1);
  check("detonate: barrel:exploded owner 'player'", ex1?.payload.owner === "player");
  check("detonate: barrel:exploded carries the FX payload",
    ex1?.payload.hitStopFrames === ex.hitStopFrames && ex1?.payload.shakeDur === ex.shakeDur
    && ex1?.payload.shakeFullTiles === ex.shakeFullTiles && ex1?.payload.shakeZeroTiles === ex.shakeZeroTiles);
  check("detonate: barrel:exploded at the barrel's position", ex1?.payload.x === b.x && ex1?.payload.y === b.y);
  check("detonate: markNavDirty at the barrel's tile (6,4)", navDirtied.some((t) => t.tx === 6 && t.ty === 4));
  check("detonate: barrel spliced from G.barrels", G.barrels.indexOf(b) === -1 && G.barrels.length === 0);
  check("detonate: NO direct damage — the overlapping enemy is untouched", e.hp === 8);
  check("detonate: light emitter dropped", G.lights.findIndex((l) => l.source === b) === -1);
}

/* ========================================================================= *
   2. Detonation is COLLECTED + resolved (not mid-iteration) — a NON-rolling
      barrel killed by an earlier pass (e.g. shotsVsBarrels) still detonates
      when updateBarrels runs. Two hp<=0 barrels both resolve in one call.
 * ========================================================================= */
{
  resetWorldState();
  const a = placeBarrel(4, 4), b = placeBarrel(9, 6);
  a.hp = 0; a._cause = "player-bullet";                     // pre-killed, still parked (not rolling)
  b.hp = -3; b._cause = "player-bullet";
  check("collect: both barrels are non-rolling", a.rolling === false && b.rolling === false);

  updateBarrels(0.016);

  check("collect: both non-rolling hp<=0 barrels detonated (spliced)", G.barrels.length === 0);
  check("collect: two waves' worth of shrapnel spawned", G.shrapnel.length === 2 * CFG.BARREL.shrapnel.count);
}

/* ========================================================================= *
   3. Detonate-in-hand (B5) — the carried barrel (spliced OUT of G.barrels)
      detonates on the player: shrapnel centred on the player, carry cleared
      via notifyCarriedBarrelDestroyed (loco NORMAL, NOT re-inserted). The
      centred shrapnel then strikes the player and post-hit i-frames CAP it.
 * ========================================================================= */
{
  resetWorldState();
  G.player.x = tileCenter(6, 4).x; G.player.y = tileCenter(6, 4).y;
  const held = makeBarrel(0, 0);                            // NOT in G.barrels (carried)
  G.player.loco = "CARRYING"; G.player.carry = { type: "barrel", entity: held };
  G.barrels = [];
  emitted.length = 0;

  damageBarrel(held, CFG.BARREL.LETHAL, "player-bullet");   // enemy could do this via the melee chip
  updateBarrels(0.016);                                     // detonate-in-hand resolved here

  check("in-hand: spawns shrapnel.count pieces", G.shrapnel.length === CFG.BARREL.shrapnel.count);
  check("in-hand: shrapnel centred on the player",
    G.shrapnel.every((s) => s.x === G.player.x && s.y === G.player.y));
  check("in-hand: carry cleared via the sink", G.player.carry === null);
  check("in-hand: loco -> NORMAL", G.player.loco === "NORMAL");
  check("in-hand: barrel NOT re-inserted into G.barrels", G.barrels.indexOf(held) === -1 && G.barrels.length === 0);
  check("in-hand: barrel:exploded at the PLAYER centre", lastEmitOf("barrel:exploded")?.payload.x === G.player.x);

  // The centred shrapnel strikes the player next updateShrapnel; i-frames cap it.
  const hp0 = G.hp;
  updateShrapnel(0.001);                                    // small step — pieces still overlap the player
  check("in-hand: post-hit i-frames armed", G.player.iframe > 0);
  check("in-hand: i-frames cap self-damage to ONE hit", G.hp === hp0 - CFG.BARREL.shrapnel.dmg);
}

/* ========================================================================= *
   4. Attribution — owner derivation (B9/§9). _cause startsWith("player-")
      -> player; everything else -> enemy. The adopted shrapnel owner mirrors it.
 * ========================================================================= */
function ownerFor(cause) {
  resetWorldState();
  const b = placeBarrel(6, 4);
  emitted.length = 0;
  damageBarrel(b, CFG.BARREL.LETHAL, cause);
  updateBarrels(0.016);
  const owner = lastEmitOf("barrel:exploded")?.payload.owner;
  const shrapnelOwner = G.shrapnel[0]?.owner;
  return { owner, shrapnelOwner };
}
{
  for (const cause of ["player-lightning", "player-bullet", "player-kick"]) {
    const { owner, shrapnelOwner } = ownerFor(cause);
    check(`attribution: '${cause}' -> owner 'player'`, owner === "player" && shrapnelOwner === "player");
  }
  for (const cause of ["wraith-aoe", "enemy-lob"]) {
    const { owner, shrapnelOwner } = ownerFor(cause);
    check(`attribution: '${cause}' -> owner 'enemy'`, owner === "enemy" && shrapnelOwner === "enemy");
  }
}

/* ========================================================================= *
   5. Attribution — scoring by owner. Player-owned shrapnel scores its kills
      (awardKill: player-* cause); enemy-owned scores 0. Deaths route through
      the shared sweep (gems drop regardless).
 * ========================================================================= */
{
  // Player-owned shrapnel kills a zombie -> score += points.
  resetWorldState();
  const e = mkEnemy("zombie", tileCenter(6, 4).x, tileCenter(6, 4).y, { hp: 1 });
  G.enemies = [e];
  G.shrapnel = [mkShrapnel(e.x, e.y, "player")];
  updateShrapnel(0.001);
  check("score: player-shrapnel kill removed the enemy (swept)", G.enemies.length === 0);
  check("score: player-shrapnel kill scores its points", G.score === CFG.ENEMY.zombie.points);
  check("score: killed enemy tagged 'player-shrapnel'", e._cause === "player-shrapnel");
  check("score: gems dropped on the kill", G.pickups.length === CFG.ENEMY.zombie.gems);

  // Enemy-owned shrapnel kills a zombie -> score stays 0 (gems still drop).
  resetWorldState();
  const e2 = mkEnemy("zombie", tileCenter(6, 4).x, tileCenter(6, 4).y, { hp: 1 });
  G.enemies = [e2];
  G.shrapnel = [mkShrapnel(e2.x, e2.y, "enemy")];
  updateShrapnel(0.001);
  check("score: enemy-shrapnel kill removed the enemy (swept)", G.enemies.length === 0);
  check("score: enemy-shrapnel kill scores 0", G.score === 0);
  check("score: killed enemy tagged 'enemy-shrapnel'", e2._cause === "enemy-shrapnel");
  check("score: gems drop even for a 0-score kill", G.pickups.length === CFG.ENEMY.zombie.gems);
}

/* ========================================================================= *
   6. Chain propagation (§5.3) — a barrel killed by player-owned shrapnel
      ADOPTS that owner (via damageBarrel _cause) and detonates player-owned;
      an enemy-owned shrapnel kill detonates enemy-owned.
 * ========================================================================= */
function propagate(shrapnelOwner) {
  resetWorldState();
  const b = placeBarrel(6, 4);
  b.hp = 1;                                                 // one shrapnel hit kills it
  G.shrapnel = [mkShrapnel(b.x, b.y, shrapnelOwner)];
  updateShrapnel(0.001);                                    // damages the barrel (adopts owner)
  const adopted = b._cause;
  emitted.length = 0;
  const before = G.shrapnel.length;
  updateBarrels(0.016);                                     // NOW the barrel detonates
  const ex = lastEmitOf("barrel:exploded");
  return { adopted, detonatedOwner: ex?.payload.owner, spliced: G.barrels.indexOf(b) === -1, before };
}
{
  const p = propagate("player");
  check("chain: barrel adopts 'player-shrapnel' _cause", p.adopted === "player-shrapnel");
  check("chain: adopted barrel detonates player-owned", p.detonatedOwner === "player");
  check("chain: propagating barrel spliced after its own detonation", p.spliced);

  const en = propagate("enemy");
  check("chain: barrel adopts 'enemy-shrapnel' _cause", en.adopted === "enemy-shrapnel");
  check("chain: adopted barrel detonates enemy-owned", en.detonatedOwner === "enemy");
}

/* ========================================================================= *
   7. Chain reaction (§5.3) — a >=chainCallout-barrel wave emits chain:reaction
      {count, owner}; a sub-threshold (2-barrel) wave does NOT.
 * ========================================================================= */
{
  resetWorldState();
  const n = CFG.BARREL.explosion.chainCallout;             // 3
  const bs = [];
  for (let i = 0; i < n; i++) { const b = placeBarrel(2 + i * 3, 4); b.hp = 0; b._cause = "player-bullet"; bs.push(b); }
  emitted.length = 0;

  updateBarrels(0.016);

  const cr = lastEmitOf("chain:reaction");
  check("chain-reaction: emits chain:reaction on a >=3 wave", !!cr);
  check("chain-reaction: count === wave size", cr?.payload.count === n);
  check("chain-reaction: owner 'player'", cr?.payload.owner === "player");
  check("chain-reaction: all barrels detonated", G.barrels.length === 0);

  // Sub-threshold: 2 barrels detonate but no callout.
  resetWorldState();
  const c1 = placeBarrel(4, 4), c2 = placeBarrel(9, 4);
  c1.hp = 0; c1._cause = "player-bullet"; c2.hp = 0; c2._cause = "player-bullet";
  emitted.length = 0;
  updateBarrels(0.016);
  check("chain-reaction: a 2-barrel wave does NOT emit chain:reaction", !sawEmit("chain:reaction"));
  check("chain-reaction: (both still detonated)", G.barrels.length === 0);
}

/* --- summary --------------------------------------------------------------- */
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
