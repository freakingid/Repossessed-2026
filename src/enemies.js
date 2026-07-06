/* =========================================================================
   enemies.js — the ENEMY COMBAT SPINE + the load-bearing frame order
   (SPEC-ENEMIES §2, §3.5, §6.2, §6.3, §6.5, §6.6, E6/E8/E11, R2/R3/R6).

   This phase builds the combat spine end-to-end and proves it with the
   simplest roster member, the Ghost (§6.1.1). Per-type AI for the other eight
   types lands in later phases; the dispatch table + the 7-step tick are shaped
   to admit them without reordering.

   ---- tickEnemies(dt): THE 7-STEP FRAME ORDER (§3.5 / E11) ----------------
   The order is a CONTRACT, not a convenience — damage/death MUST resolve before
   the AI's EXPLODE decision or a Wraith shot down the frame its FLASH completes
   wrongly detonates (R2). Exactly, in order:
     1. spawners emit            (Phase 4 — hook only, no-op here)
     2. nav scheduler tick       (enemies-ai.scheduleRepaths — the Phase-2 layer)
     3. player-shot → enemy damage pass (§6.5)   // marks hp; tags deaths
     4. melee exchange (§6.2)
     5. death sweep (§6.3)        // an APPROACH/FLASH Wraith removed here is DEFUSED
     6. enemy AI tick over survivors: emergence gate → move/steer → per-type
        attack. A surviving Wraith whose FLASH completes EXPLODEs HERE (Phase 6).
     7. ordnance update: updateEbolts (arced lobs, Phase 7) + enemy-shot → player hit-test.

   ---- R6: ONE-WAY IMPORT FLOW --------------------------------------------
   enemies.js imports config/state/world, the player SINKS
   (applyDamageToPlayer / applyKnockbackToPlayer / applyEntangle /
   isCarryingCrate), level-loader seams (emit / registerEntityFactory), and the
   update* fns from enemies-ai.js. It is NEVER imported by player / projectiles /
   nav / enemies-ai — the flow is enemies → {player-sinks, enemies-ai}, never
   back. Factory registration is a loader→enemies CALLBACK (registerEntityFactory),
   not a loader import of enemies.
   ========================================================================= */
import { CFG } from "./config.js";
import { G } from "./state.js";
import { tileCenter } from "./world.js";
import {
  applyDamageToPlayer, applyKnockbackToPlayer, applyEntangle, isCarryingCrate,
} from "./player.js";
import { emit, registerEntityFactory, getEntityFactory, markNavDirty } from "./level-loader.js";
import { makeShot } from "./projectiles.js";
import {
  scheduleRepaths, groundMover, phantomMover, updateGhost, updateSkeleton, updateSpider,
  updateBat, updateZombie, updateSkeletonShooter, updateFireWraith, updateLobber, updateReaper,
  registerSpiderWebFire, registerShooterFire, registerLobberFire,
  registerReaperSummon, registerReaperBlast, removeNavigator,
} from "./enemies-ai.js";

// Spider web-fire seam (§6.1.6) — enemies-ai.js's updateSpider calls this to
// mint the entangle shot; kept here (not in enemies-ai.js) so that layer never
// needs to import projectiles/G.shots (R6 — it stays the nav/steer layer).
registerSpiderWebFire((e, ux, uy) => {
  const cfg = CFG.ENEMY.spider.web;
  G.shots.push(makeShot({
    x: e.x, y: e.y,
    vx: ux * cfg.speedMul * CFG.PLAYER.speed,
    vy: uy * cfg.speedMul * CFG.PLAYER.speed,
    r: 6, dmg: cfg.dmg, owner: "enemy",
    maxTravel: cfg.range * CFG.TILE, effect: "entangle",
  }));
});

// Skeleton Shooter arrow-fire seam (§6.1.3) — same register-callback shape as
// the Spider's web (enemies-ai.js never imports projectiles/G.shots, R6).
registerShooterFire((e, ux, uy) => {
  const cfg = CFG.ENEMY.skeletonShooter.arrow;
  G.shots.push(makeShot({
    x: e.x, y: e.y,
    vx: ux * cfg.speedMul * CFG.PLAYER.speed,
    vy: uy * cfg.speedMul * CFG.PLAYER.speed,
    r: 6, dmg: cfg.dmg, owner: "enemy",
    maxTravel: cfg.range * CFG.TILE, effect: "damage",
  }));
});

// Lobber lob-fire seam (§6.1.4/E1) — enemies-ai.js's updateLobber calls this
// to mint the arced G.ebolts entry; kept here (not in enemies-ai.js) so that
// layer never needs to import G.ebolts (R6). tx,ty is the player's position at
// fire time, PERTURBED by a random offset within G.ramp.lobberErrorRadius —
// the net-new accuracy-error mechanic vs ADD's exact-target fireEnemyArc. The
// perturbation is a uniform random point inside the error-radius disc (angle +
// radius via sqrt(rand), so it's uniform over the disc area, not biased to the
// center).
registerLobberFire((e, tx, ty) => {
  const cfg = CFG.ENEMY.lobber;
  const errR = ((G.ramp && G.ramp.lobberErrorRadius) || 0) * CFG.TILE;
  const ang = Math.random() * Math.PI * 2;
  const rad = Math.sqrt(Math.random()) * errR;
  const lx = tx + Math.cos(ang) * rad;
  const ly = ty + Math.sin(ang) * rad;
  if (!G.ebolts) G.ebolts = [];
  G.ebolts.push({
    kind: "arc",
    x: e.x, y: e.y, x0: e.x, y0: e.y,
    tx: lx, ty: ly,
    t: 0, dur: cfg.airtime,
    height: 0,
    dmg: cfg.lobDmg, blast: cfg.blast * CFG.TILE,
    owner: "enemy",
  });
});

// Reaper summon seam (§6.1.9/E4/R5) — enemies-ai.js's updateReaper calls this on
// the ramped interval; the mint lives here (needs the loose-enemy factories +
// G.enemies), so enemies-ai.js never imports them (R6). Pick one of
// ["ghost","ghost","skeleton"]: "ghost" spawns 2 Ghosts, "skeleton" spawns 1
// Skeleton, at the Reaper's tile, tagged originSpawner = this Reaper's id. The
// live cap (minionCap 6) is a SCAN of G.enemies for the tag at the emit decision
// (E4 — no mutable counter), COUNTING emergence-window children (R5 — the scan is
// state-agnostic, and freshly-added minions increment the running count so a
// single summon can never overshoot the cap). Minions emerge via the shared 0.5 s
// spawn gate (spawner.emerge).
registerReaperSummon((reaper) => {
  const cfg = CFG.ENEMY.reaper;
  const pick = cfg.summon.pick[(Math.random() * cfg.summon.pick.length) | 0];
  const make = pick === "ghost" ? makeGhost : makeSkeleton;
  const count = pick === "ghost" ? 2 : 1;
  const tx = (reaper.x / CFG.TILE) | 0, ty = (reaper.y / CFG.TILE) | 0;
  // Live tagged minions, INCLUDING those still in their emergence window (R5).
  let live = 0;
  for (const en of G.enemies) if (en.originSpawner === reaper.id) live++;
  for (let k = 0; k < count && live < cfg.summon.minionCap; k++) {
    const minion = make({ type: pick, x: tx, y: ty, originSpawner: reaper.id });
    minion.spawn = CFG.ENEMY.spawner.emerge;   // 0.5 s emergence gate (E4)
    G.enemies.push(minion);
    live++;
  }
});

// Reaper dark-blast seam (§6.1.9/R3/R7) — a straight makeShot at the player.
// owner:"enemy" (R3), dmg blastDmg(3), speed blastSpeedMul×player-speed (=224 px/s
// = 7 t/s), maxTravel blastRange (the R7 dial, already in px), effect "damage". It
// joins G.shots and rides player.js updateShots like any straight shot (crate
// ricochet + non-bounce wall fizzle); enemyShotPlayerPass applies its damage.
registerReaperBlast((e, ux, uy) => {
  const cfg = CFG.ENEMY.reaper;
  G.shots.push(makeShot({
    x: e.x, y: e.y,
    vx: ux * cfg.blastSpeedMul * CFG.PLAYER.speed,
    vy: uy * cfg.blastSpeedMul * CFG.PLAYER.speed,
    r: 6, dmg: cfg.blastDmg, owner: "enemy",
    maxTravel: cfg.blastRange, effect: "damage",
  }));
});

// Barrel-detonation seam (§7) — barrels don't exist yet (SPEC-BARRELS is
// post-#4); mirrors the loader's registered-sink pattern (registerBlockerSink)
// so the Wraith's EXPLODE (and later the Lobber's lob) can call into barrel
// damage without enemies.js importing a module that doesn't exist. No-op
// default; SPEC-BARRELS registers the real fn.
let detonateBarrelsInRadius = () => {};
export function registerBarrelDetonation(fn) { detonateBarrelsInRadius = fn; }

/* ---- Per-type AI dispatch (step 6) -------------------------------------- *
   Keyed by entity type. Later phases add their updater here; this phase ships
   only the Ghost. Each handler is (e, player, dt) => void and does the type's
   move/steer + attack. Unknown types no-op. */
const aiByType = new Map([
  ["ghost", updateGhost],
  ["skeleton", updateSkeleton],
  ["spider", updateSpider],
  ["bat", updateBat],
  ["zombie", updateZombie],
  ["skeletonShooter", updateSkeletonShooter],
  ["fireWraith", fireWraithAI],
  ["lobber", updateLobber],
  ["reaper", updateReaper],
]);

// Test seam (structural R2 frame-order proof): inject a synthetic type's AI so a
// headless test can flag an entity "would explode this frame" and assert its AI
// branch never runs when it was killed in the pre-AI death sweep. Test-only.
export function __setEnemyAI(type, fn) { aiByType.set(type, fn); }

/* =========================================================================
   FACTORY REGISTRATION (E5) — enemies.js registers real factories for the
   loose element types; the loader's ENTITY_ARRAY already routes them to
   G.enemies. This phase ships the Ghost; later phases register the rest.
   ========================================================================= */

// Build a base enemy (§2) from a placement (p.x,p.y are TILE coords). Positions
// on the entity are PIXEL centers (the reconciled coord space, SPEC-PLAYER Ph6).
// speed is stored EFFECTIVE: base speedMul×player-speed×enemySpeedMult — E10's
// single ramp application (ramp is snapshotted before placements, so it is live
// here; it never changes mid-level). This reconciles §2's "speed = BASE" comment
// with the enemies-ai layer's read-time contract (e.speed is effective there).
function makeEnemy(type, p) {
  const cfg = CFG.ENEMY[type];
  const tc = tileCenter(p.x, p.y);
  const mult = (G.ramp && G.ramp.enemySpeedMult) || 1;
  return {
    type,
    x: tc.x, y: tc.y, r: cfg.r,
    hp: cfg.hp,
    // EFFECTIVE px/s (E10). Spider has no base speedMul (Phase-3 decision,
    // STATUS.md) — its FSM (updateSpider) computes its own burst/pause/retreat
    // speed from CFG.ENEMY.spider.burstMul directly and never reads e.speed.
    speed: cfg.speedMul != null ? cfg.speedMul * CFG.PLAYER.speed * mult : 0,
    face: 0,
    kvx: 0, kvy: 0,          // knockback velocity (decays; shared ADD model, §6.6)
    contact: false,          // melee pair-lockout with the player (E6)
    spawn: 0,                // placed enemies emerge immediately (spawner-emitted set >0)
    originSpawner: p.originSpawner ?? null,
    boss: !!cfg.boss,
    points: cfg.points,      // denormalized for the death sweep / awardKill (§6.3)
    gems: cfg.gems,
  };
}

export function makeGhost(p) { return makeEnemy("ghost", p); }
registerEntityFactory("ghost", makeGhost);

export function makeSkeleton(p) { return makeEnemy("skeleton", p); }
registerEntityFactory("skeleton", makeSkeleton);

export function makeSpider(p) { return makeEnemy("spider", p); }
registerEntityFactory("spider", makeSpider);

export function makeBat(p) { return makeEnemy("bat", p); }
registerEntityFactory("bat", makeBat);

export function makeZombie(p) { return makeEnemy("zombie", p); }
registerEntityFactory("zombie", makeZombie);

export function makeSkeletonShooter(p) { return makeEnemy("skeletonShooter", p); }
registerEntityFactory("skeletonShooter", makeSkeletonShooter);

export function makeLobber(p) { return makeEnemy("lobber", p); }
registerEntityFactory("lobber", makeLobber);

// Stable per-Reaper id — the summon tags each minion originSpawner = this id, and
// the cap scan matches on it (E4). Monotonic; unique per spawned Reaper.
let nextReaperId = 1;

// The Reaper (§6.1.9, E9) — PHANTOM A* mini-boss summoner, placed by level defs
// only (the loader ships an inert blocks:false placeholder this override
// replaces). Beyond the base enemy it carries: a stable `id` (for minion
// originSpawner tagging + the cap scan), and the #5 flags — `boss` (already set
// by makeEnemy from cfg.boss) plus `resist`, an ability-resist MARKER Nova/
// Lightning read INSTEAD of a hardcoded type check (E9). This phase only EXPOSES
// the flag; #5 applies the 10/20 (Nova) and 5 (Lightning) magnitudes.
export function makeReaper(p) {
  const e = makeEnemy("reaper", p);
  e.id = nextReaperId++;
  e.resist = { nova: true, lightning: true };
  return e;
}
registerEntityFactory("reaper", makeReaper);

// Fire Wraith self-glow (§8.4, dark levels) — a seam to #7: register the light
// emitter here (no draw code). G.lights is the loader's already-reserved
// light-emitter registry array (cleared with the other transients on load).
export function makeFireWraith(p) {
  const e = makeEnemy("fireWraith", p);
  if (!G.lights) G.lights = [];
  // source: e (not a copied x/y) — #7 reads the live entity position each
  // frame so the glow tracks the Wraith without this seam re-syncing coords.
  G.lights.push({ source: e, radius: CFG.ENEMY.fireWraith.glowRadius * CFG.TILE });
  return e;
}
registerEntityFactory("fireWraith", makeFireWraith);

// Stable per-spawner id — spawned children are tagged originSpawner = this id,
// and the live-cap scan (E4) matches on it (same chain-of-custody shape as the
// Reaper's minion tag). Monotonic; unique per placed spawner.
let nextSpawnerId = 1;

// The spawner (§6.3, E4/R5, §0.4 spawner-as-target) — DECORATES rather than
// replaces the loader's placeholder factory (level-loader.js mkPlaceholder(true,
// ...)), which already computes { type, x, y, tc, blocks:true, variant, table,
// interval, liveCap } (the Plan-filtered table + ramped interval/liveCap the
// eligibility logic that would be a correctness hazard to re-derive here, per
// the evalRampTable precedent in STATUS's decision log). getEntityFactory reads
// back that CURRENT registration (still the loader's at this point in module
// load) and this factory calls through it, then adds the combat/emission
// fields spawners need to act as destructible, emitting statics: hp/points/
// gems from CFG.ENEMY.spawner (§0.4 — hp 6/300 pts/3 gems, same death-sweep
// path as any other enemy), a stable `id` for the live-cap tag, and `emitT`
// seeded at `firstDelay` (2 s) so the first emit fires 2 s after level start
// (E4) rather than immediately.
const loaderSpawnerFactory = getEntityFactory("spawner");
function makeSpawner(p) {
  const e = loaderSpawnerFactory(p);
  const cfg = CFG.ENEMY.spawner;
  e.id = nextSpawnerId++;
  e.hp = cfg.hp;
  e.points = cfg.points;
  e.gems = cfg.gems;
  e.r = cfg.r;
  e.emitT = cfg.firstDelay;
  return e;
}
registerEntityFactory("spawner", makeSpawner);

// Factory lookup for spawner emission (E4) — the 8 loose element types a
// spawner's Plan-filtered table can name (never "reaper", never "spawner"
// itself — reaper is level-def-only, §6.1.9). Built after every factory above
// is defined so the map is complete at first use.
const factoryByType = new Map([
  ["ghost", makeGhost], ["skeleton", makeSkeleton], ["spider", makeSpider],
  ["bat", makeBat], ["zombie", makeZombie],
  ["skeletonShooter", makeSkeletonShooter], ["lobber", makeLobber],
  ["fireWraith", makeFireWraith],
]);

// Weighted pick (E4) — table is { type: weight, ... } (already Plan-filtered
// on the placeholder, so a Night-2 Bone Pile only ever offers "skeleton" until
// Shooters unlock). Empty table (nothing eligible yet) → null, no emit.
function weightedPick(table) {
  const entries = Object.entries(table);
  if (entries.length === 0) return null;
  let total = 0;
  for (const [, w] of entries) total += w;
  let r = Math.random() * total;
  for (const [type, w] of entries) {
    r -= w;
    if (r <= 0) return type;
  }
  return entries[entries.length - 1][0];
}

// Step 1 (§6.3, E4) — spawner emission. First emit at `firstDelay` (2 s) after
// level start, then every `e.interval` (both ramped onto the placeholder by
// the loader, E10 — read once, never mid-level). A spawner may emit only while
// its live TAGGED children (originSpawner === e.id) < e.liveCap; the count is
// a SCAN of G.enemies at the emit decision (no mutable counter to desync on
// child death, E4) that counts children still in their spawn>0 emergence
// window (R5 — otherwise a spawner over-spawns in the first 0.5 s because an
// emerging child doesn't "look" alive to a naive filter). A newly-spawned
// child appears with the shared 0.5 s emergence telegraph (spawner.emerge),
// reusing the existing spawn>0 grow-in gate (step 6 skips it until spawn≤0).
function spawnerEmit(sp) {
  let live = 0;
  for (const en of G.enemies) if (en.originSpawner === sp.id) live++;
  if (live >= sp.liveCap) return;
  const type = weightedPick(sp.table);
  if (!type) return;
  const make = factoryByType.get(type);
  if (!make) return;
  const tx = (sp.x / CFG.TILE) | 0, ty = (sp.y / CFG.TILE) | 0;
  const child = make({ type, x: tx, y: ty, originSpawner: sp.id });
  child.spawn = CFG.ENEMY.spawner.emerge;   // 0.5 s emergence gate (E4)
  G.enemies.push(child);
}

function spawnerTick(dt) {
  const spawners = G.spawners;
  if (!spawners) return;
  for (const sp of spawners) {
    sp.emitT -= dt;
    if (sp.emitT <= 0) {
      spawnerEmit(sp);
      sp.emitT = sp.interval;
    }
  }
}

/* =========================================================================
   THE SPINE
   ========================================================================= */

const KNOCKBACK_ZERO = 1;   // px/s below which enemy knockback snaps to rest

// Enemy knockback receive (§6.6) — SETS kv = unit(dir)×impulse, mirroring the
// player's model (a fresh impulse overwrites, it does not accumulate).
export function applyKnockbackToEnemy(e, dirX, dirY, impulse) {
  const mag = Math.hypot(dirX, dirY);
  if (mag === 0) return;
  e.kvx = (dirX / mag) * impulse;
  e.kvy = (dirY / mag) * impulse;
}

// Integrate + decay one enemy's knockback (§6.6). Ground/A* types route through
// moveBody (a knocked enemy still can't tunnel a wall); flight (Bat, Phase 4)
// takes it as a RAW position nudge — the fn is shaped to admit that now (R8).
function integrateEnemyKnockback(e, dt) {
  if (!e.kvx && !e.kvy) return;
  const dx = e.kvx * dt, dy = e.kvy * dt;
  const cfg = CFG.ENEMY[e.type];
  if (cfg && cfg.nav === "flight") {
    e.x += dx; e.y += dy;              // raw nudge, no collision (R8)
  } else if (cfg && cfg.nav === "phantom") {
    phantomMover(e, dx, dy);           // Reaper: crates+barrels only, never bodyHitsWall (R4)
  } else {
    groundMover(e, dx, dy);            // moveBody vs walls+movables — no tunneling
  }
  const decay = Math.exp(-CFG.ENEMY.knockbackFriction * dt);
  e.kvx *= decay; e.kvy *= decay;
  if (Math.hypot(e.kvx, e.kvy) < KNOCKBACK_ZERO) { e.kvx = 0; e.kvy = 0; }
}

/* ---- The player↔enemy melee pair registry (E6) -------------------------- *
   The re-trigger lockout (a pair cannot re-exchange until contact breaks) is
   held BOTH on e.contact (the gate) and G.player.meleeState (the player-side
   view, reserved by initPlayer as null). A Set of enemy refs is the pair set —
   single player, so the enemy identifies the pair. */
function meleeSet() {
  const p = G.player;
  if (!(p.meleeState instanceof Set)) p.meleeState = new Set();
  return p.meleeState;
}
function clearMeleePair(e) {
  const p = G.player;
  if (p && p.meleeState instanceof Set) p.meleeState.delete(e);
}

// Step 3 (§6.5) — player-shot → enemy damage pass. Each player-owned shot is
// circle-vs-circle tested against every (non-emerging) enemy; on hit e.hp -=
// s.dmg and the shot is CONSUMED (Q2: a Bounce shot is consumed on enemy hit
// like any other — Bounce is a wall ricochet, not a pierce). A lethal hit tags
// the enemy's cause for the death sweep. Also tests G.spawners (§0.4,
// spawner-as-target) — spawners are tile-aligned statics with no `spawn` gate
// (they're never mid-emergence themselves), so no emergence check applies.
function playerShotEnemyPass() {
  const shots = G.shots, enemies = G.enemies, spawners = G.spawners;
  if (!shots) return;
  for (let i = shots.length - 1; i >= 0; i--) {
    const s = shots[i];
    if (s.owner !== "player") continue;
    let hit = false;
    if (enemies) {
      for (const e of enemies) {
        if (e.spawn > 0) continue;                 // emerging enemies don't collide (E4)
        const dx = s.x - e.x, dy = s.y - e.y;
        const rr = s.r + e.r;
        if (dx * dx + dy * dy > rr * rr) continue;
        e.hp -= s.dmg;
        if (e.hp <= 0) e._cause = "player-bullet";
        hit = true;
        break;
      }
    }
    if (!hit && spawners) {
      for (const sp of spawners) {
        const dx = s.x - sp.x, dy = s.y - sp.y;
        const rr = s.r + sp.r;
        if (dx * dx + dy * dy > rr * rr) continue;
        sp.hp -= s.dmg;
        if (sp.hp <= 0) sp._cause = "player-bullet";
        hit = true;
        break;
      }
    }
    if (hit) shots.splice(i, 1);                   // consumed on hit (Q2)
  }
}

// Step 4 (§6.2) — melee exchange. For every enemy overlapping the player:
//  · carrying a crate AND not a bat → push the enemy back 1.5 t, SKIP damage;
//  · else, if the pair is unlocked → player deals 2, enemy deals its melee (null-
//    guarded — the Fire Wraith has none), knock BOTH back, lock the pair;
//  · on separation → clear the lock.
// Bats deal melee 2 on contact but ignore the crate bumper (they fly over).
function meleeExchange() {
  const p = G.player, enemies = G.enemies;
  if (!p || p.loco === "DEAD") return;
  const carrying = isCarryingCrate();
  if (enemies) for (const e of enemies) {
    if (e.spawn > 0) continue;                   // emerging enemies don't collide (E4)
    const dx = e.x - p.x, dy = e.y - p.y;        // player → enemy
    const dist = Math.hypot(dx, dy);
    if (dist > e.r + p.r) {                       // separated → clear the pair lock
      if (e.contact) { e.contact = false; clearMeleePair(e); }
      continue;
    }
    // Unit direction player→enemy (enemy is pushed this way; player the opposite).
    const nx = dist > 1e-6 ? dx / dist : 1, ny = dist > 1e-6 ? dy / dist : 0;

    if (carrying && e.type !== "bat") {           // crate bumper (§6.4) — no damage
      applyKnockbackToEnemy(e, nx, ny, CFG.ENEMY.knockbackPush);
      continue;                                   // do NOT lock — no exchange happened
    }
    if (!e.contact) {                             // pair unlocked → one exchange
      e.hp -= CFG.PLAYER.meleeDamageToEnemy;      // player deals 2 (ADD mop value)
      const m = CFG.ENEMY[e.type]?.melee;         // MELEE NULL-GUARD (meleeless types deal 0)
      if (m != null) applyDamageToPlayer(m, e.type);
      applyKnockbackToPlayer(-nx, -ny, CFG.PLAYER.knockbackImpulse);   // player away from enemy
      applyKnockbackToEnemy(e, nx, ny, CFG.ENEMY.knockbackImpulse);    // enemy away from player
      e.contact = true;
      meleeSet().add(e);
      if (e.hp <= 0 && !e._cause) e._cause = "player-melee";
    }
  }
  // Spawners (§0.4, spawner-as-target) — tile-aligned statics: player melee
  // damages them on contact, but they never move, never deal melee back, and
  // never take the crate-bumper push (there's nothing to push away from — the
  // spawner is immobile terrain, not a steered enemy).
  const spawners = G.spawners;
  if (spawners) for (const sp of spawners) {
    const dx = sp.x - p.x, dy = sp.y - p.y;
    if (Math.hypot(dx, dy) > sp.r + p.r) continue;
    sp.hp -= CFG.PLAYER.meleeDamageToEnemy;
    if (sp.hp <= 0 && !sp._cause) sp._cause = "player-melee";
  }
}

// Drop e.gems gem pickups at the enemy's position (§6.3) — ALWAYS, regardless of
// killer (gems are position loot, not a score award; Q3 baked-in: friendly-fire
// kills still drop gems).
function dropGems(e) {
  if (!G.pickups) G.pickups = [];
  const n = e.gems || 0;
  for (let k = 0; k < n; k++)
    G.pickups.push({ type: "gem", x: e.x, y: e.y, value: CFG.GEM.energy });
}

// Drop a dead entity's registered light emitter (§8.4 seam — Wraith self-glow
// today; harmless no-op for any type that never registered one).
function removeLight(e) {
  if (!G.lights || G.lights.length === 0) return;
  const i = G.lights.findIndex((l) => l.source === e);
  if (i >= 0) G.lights.splice(i, 1);
}

// Step 5 (§6.3) — death sweep. Each hp≤0 enemy: drop gems (always), awardKill,
// emit enemy:killed, splice out. A mid-FLASH Wraith removed here is DEFUSED (its
// EXPLODE branch in step 6 never runs) — the R2/E11 invariant.
function deathSweep() {
  const enemies = G.enemies;
  if (!enemies) return;
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    if (e.hp > 0) continue;
    const cause = e._cause || "unknown";
    dropGems(e);
    awardKill(e, cause);
    emit("enemy:killed", { type: e.type, x: e.x, y: e.y, points: e.points, cause });
    // Reaper death → the boss-kill FX event (screen-shake + hit-stop, #7/#10, §6.3).
    // Keyed on e.boss so it fires for any boss, not a hardcoded type check.
    if (e.boss) emit("boss:killed", { type: e.type, x: e.x, y: e.y, shake: true, hitStop: true });
    if (e.contact) clearMeleePair(e);
    if (e.nav) removeNavigator(e);   // drop the A* registry entry (Zombie/Shooter/Wraith/Reaper)
    removeLight(e);
    enemies.splice(i, 1);
  }
}

// Spawner death sweep (§0.4, mirrors §6.3) — same gems/awardKill/emit shape as
// the enemy death sweep, plus markNavDirty (a destroyed spawner was a nav
// blocker — SPEC-PATHFINDING's occupancy rebuilds lazily off G.spawners, so
// clearing the tile just needs the invalidation signal, not a rebuild here).
// No removeNavigator/removeLight — spawners never register either (static,
// non-A*, no light-emitter seam).
function spawnerDeathSweep() {
  const spawners = G.spawners;
  if (!spawners) return;
  for (let i = spawners.length - 1; i >= 0; i--) {
    const sp = spawners[i];
    if (sp.hp > 0) continue;
    const cause = sp._cause || "unknown";
    dropGems(sp);
    awardKill(sp, cause);
    emit("enemy:killed", { type: "spawner", x: sp.x, y: sp.y, points: sp.points, cause });
    markNavDirty({ tx: (sp.x / CFG.TILE) | 0, ty: (sp.y / CFG.TILE) | 0 });
    spawners.splice(i, 1);
  }
}

// awardKill seam (§6.3 / E8) — THIN direct impl. player-* causes ("player-bullet",
// "player-melee") award e.points; wraith-aoe / enemy-* / unknown award 0. The full
// chain-of-custody (barrel tags, shrapnel adoption, Nova/Lightning) is SPEC-SCORING,
// which replaces this seam and receives the same `cause` string.
export function awardKill(e, cause) {
  if (typeof cause === "string" && cause.startsWith("player-")) G.score += e.points;
}

// Fire Wraith EXPLODE (§6.1.8) — AoE radius explodeRadius at the Wraith's own
// position: explodeDmg to the player, friendly-fire damage to every OTHER
// enemy in radius (those deaths score 0 via "wraith-aoe", E8; Q3 baked-in:
// they still drop gems — dropGems/awardKill both live in the shared death
// sweep, called once after this whole pass), triggers the barrel seam, and
// does NOT damage crates (§13.16 crate indestructibility wins — this AoE
// simply never touches G.crates). The Wraith itself is tagged to die in its
// own blast. Deaths are NOT spliced here — hp/_cause are set and the shared
// deathSweep() (§6.3, already imported-in-scope) runs once after the whole
// AI tick, reusing the one gem/awardKill/emit/nav/light cleanup path rather
// than duplicating it inline.
function explodeFireWraith(wraith) {
  const cfg = CFG.ENEMY.fireWraith;
  const r = cfg.explodeRadius * CFG.TILE;
  const p = G.player;
  if (p && p.loco !== "DEAD") {
    const dx = p.x - wraith.x, dy = p.y - wraith.y;
    if (dx * dx + dy * dy <= r * r) applyDamageToPlayer(cfg.explodeDmg, "wraith-aoe");
  }
  for (const other of G.enemies) {
    if (other === wraith) continue;
    const dx = other.x - wraith.x, dy = other.y - wraith.y;
    if (dx * dx + dy * dy > r * r) continue;
    other.hp -= cfg.explodeDmg;
    if (other.hp <= 0 && !other._cause) other._cause = "wraith-aoe";
  }
  detonateBarrelsInRadius(wraith.x, wraith.y, r, "wraith-aoe");
  wraith.hp = 0;
  wraith._cause = "wraith-aoe";   // dies in its own blast
}

// Fire Wraith AI dispatch entry (step 6) — runs the FSM/steer updater, then
// checks the explode flag it may have set THIS frame (FLASH timer completing
// only ever happens here, in step 6, after step 5's death sweep already ran —
// R2/E11: a Wraith shot down before FLASH completes was already removed in
// step 5 and never reaches this function at all this frame).
const pendingWraithExplosions = [];
function fireWraithAI(e, player, dt) {
  updateFireWraith(e, player, dt);
  if (e.wraith && e.wraith.explode) pendingWraithExplosions.push(e);
}

// Step 6 (§6) — AI tick over survivors. Emergence gate first (spawn>0 ⇒ decrement
// and skip — the enemy exists but does not act or collide, E4), then knockback
// integration (§6.6), then the per-type move/steer + attack. A synthetic entity
// killed in step 5 is already gone from G.enemies, so its handler never runs here
// (the death-sweep-before-AI invariant, R2).
function enemyAITick(dt) {
  const enemies = G.enemies, player = G.player;
  if (!enemies) return;
  pendingWraithExplosions.length = 0;
  for (const e of enemies) {
    if (e.spawn > 0) { e.spawn -= dt; continue; }   // emergence gate (E4)
    integrateEnemyKnockback(e, dt);
    const ai = aiByType.get(e.type);
    if (ai) ai(e, player, dt);
  }
  // EXPLODE resolution: apply AoE damage for every Wraith that finished FLASH
  // this frame, then run ONE death sweep for any resulting deaths (self +
  // friendly-fire) — reuses the shared gem/awardKill/emit/nav/light cleanup.
  if (pendingWraithExplosions.length > 0) {
    for (const w of pendingWraithExplosions) explodeFireWraith(w);
    pendingWraithExplosions.length = 0;
    deathSweep();
  }
}

// Step 7 (§6.4, E1) — arced ordnance. ADD updateArc verbatim (§11/§12): each
// G.ebolts entry interpolates its ground position launch->landing over `dur`
// (parabolic `height` for the renderer), wall-agnostic the whole flight (the
// lob never collides in transit — only the landing splat is tested). At
// t >= dur: splat + AoE vs the player only (§9 — arced ordnance never hits
// enemies) at `blast + player.r`, `applyDamageToPlayer(dmg, "enemy-lob")` +
// the barrel-detonation seam (registered in Phase 6), then the entry is
// removed. Self-contained (not moved by player.js's updateShots — arced
// ordnance is a distinct timed kind, E1), so no cross-file ordering
// assumption applies here unlike the straight-shot passes.
function updateEbolts(dt) {
  const ebolts = G.ebolts, p = G.player;
  if (!ebolts) return;
  for (let i = ebolts.length - 1; i >= 0; i--) {
    const b = ebolts[i];
    b.t += dt;
    const k = Math.min(b.t / b.dur, 1);
    b.x = b.x0 + (b.tx - b.x0) * k;
    b.y = b.y0 + (b.ty - b.y0) * k;
    b.height = Math.sin(k * Math.PI) * 24;
    if (k >= 1) {
      if (p && p.loco !== "DEAD") {
        const dx = p.x - b.tx, dy = p.y - b.ty;
        if (dx * dx + dy * dy <= (b.blast + p.r) * (b.blast + p.r)) {
          applyDamageToPlayer(b.dmg, "enemy-lob");
        }
      }
      detonateBarrelsInRadius(b.tx, b.ty, b.blast, "enemy-lob");
      ebolts.splice(i, 1);
    }
  }
}

// Step 7 (§6.4) — enemy-shot → player hit-test. Player-ONLY (enemy shots never
// hit enemies, R3): only owner==="enemy" shots are tested; player-owned shots are
// never touched here. entangle → applyEntangle (0 dmg, no iframe); else damage.
// SEQUENCING ASSUMPTION (main loop, not fixed here): player.js updateShots(dt)
// already advanced enemy shots this frame, so a shot that reached the player
// connects. No enemy shots exist until Phase 4/5 — this runs on an empty set now.
function enemyShotPlayerPass() {
  const shots = G.shots, p = G.player;
  if (!shots || !p) return;
  for (let i = shots.length - 1; i >= 0; i--) {
    const s = shots[i];
    if (s.owner !== "enemy") continue;           // R3: never touch player-owned shots
    const dx = s.x - p.x, dy = s.y - p.y;
    const rr = s.r + p.r;
    if (dx * dx + dy * dy > rr * rr) continue;
    if (s.effect === "entangle") applyEntangle(CFG.ENEMY.spider.web.entangle);  // §6.4
    else applyDamageToPlayer(s.dmg, "enemy-shot");
    shots.splice(i, 1);
  }
}

/* ---- tickEnemies: the 7-step contract (§3.5, E11) ----------------------- */
export function tickEnemies(dt) {
  const player = G.player;
  // 1. spawners emit (§6.3, E4) — may append to G.enemies; new ones start
  //    with spawn>0 (emergence telegraph).
  spawnerTick(dt);
  // 2. nav scheduler tick (drains consumeDirtyTiles once; repaths A* navigators).
  scheduleRepaths(player, dt);
  // 3. player-shot → enemy damage pass (marks hp; tags deaths). Also tests
  //    G.spawners (§0.4 spawner-as-target).
  playerShotEnemyPass();
  // 4. melee exchange. Also tests G.spawners (§0.4).
  meleeExchange();
  // 5. death sweep (a mid-FLASH Wraith removed here is DEFUSED — R2/E11).
  deathSweep();
  spawnerDeathSweep();   // §0.4 — same shape, separate array
  // 6. enemy AI tick over survivors (a surviving Wraith EXPLODEs HERE, Phase 6).
  enemyAITick(dt);
  // 7. ordnance update: arced lobs + the enemy-shot → player hit-test.
  updateEbolts(dt);
  enemyShotPlayerPass();
}

/* ---- Test seams (headless, per-step) ------------------------------------ *
   The spine's individual passes, exposed __-prefixed so a headless test can
   "set fields, run one step, assert" without the side effects of a full tick
   (e.g. exercise the melee exchange without the AI moving the enemy after).
   Test-only; production drives the whole `tickEnemies` order. */
export {
  playerShotEnemyPass as __playerShotEnemyPass,
  meleeExchange as __meleeExchange,
  deathSweep as __deathSweep,
  enemyAITick as __enemyAITick,
  enemyShotPlayerPass as __enemyShotPlayerPass,
  spawnerTick as __spawnerTick,
  spawnerDeathSweep as __spawnerDeathSweep,
};
