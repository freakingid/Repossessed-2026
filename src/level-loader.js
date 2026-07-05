/* =========================================================================
   level-loader.js — the single entry to a playable level (SPEC-LEVEL §4).

   Owns: Level Definition v2 validation, the ordered loadLevel contract, the
   mutable tile-state store (doors/plates) + plate→door link graph, and the
   extended spawn-rule placement. The generator (level-generator.js, a later
   phase) is the only *producer* of defs; this loader is their sole *consumer*
   and never branches on a def's origin (generated vs hand-authored).

   Import discipline (SPEC-LEVEL §7, acceptance): imports ONLY config / state /
   world. Everything a later subsystem owns is reached through a register-
   callbacks seam, never a direct import:
     - nav (#3)              → registerBlockerSink / markNavDirty  (no-op default)
     - entity factories (#2/#4) → registerEntityFactory            (placeholder default)
     - events (#11/meta)     → registerEmit                        (no-op default)
   world.js's mutable-tile resolver is registered from here (register-callbacks;
   world.js never imports this module — see STATUS.md).
   ========================================================================= */
import { CFG } from "./config.js";
import { G } from "./state.js";
import {
  map, loadTileGrid, isWall, tileCenter, registerTileStateResolver,
} from "./world.js";

/* ---- Seam: nav-blocker sink (#3, SPEC-LEVEL §6.1) ------------------------
   nav registers itself as the blocker sink at boot; until then a no-op object
   satisfies the interface so the loader runs standalone. The loader calls
   sink.registerBlocker(entity) for movable entities and markNavDirty(tile) on
   door open/close. level-loader.js never imports nav. */
const NOOP_NAV = { registerBlocker() {}, markDirty() {} };
let navSink = NOOP_NAV;
export function registerBlockerSink(sink) { navSink = sink || NOOP_NAV; }
export function markNavDirty(tile) { navSink.markDirty(tile); }
function registerBlocker(entity) { navSink.registerBlocker(entity); }

/* ---- Seam: event emit (events.js not built yet) -------------------------
   step 9 emits 'level:start'. events.js is a later subsystem; importing it
   would break the config/state/world-only rule and doesn't exist. Route emit
   through a registerable sink (register-callbacks); events.js registers its
   emit when it lands. Payload is a snapshot (one-way flow — subscribers read
   the payload, never reach back into G). */
let emitFn = null;
export function registerEmit(fn) { emitFn = fn; }
export function emit(type, payload) { if (emitFn) emitFn(type, payload); }

/* ---- Seam: entity-factory registry (#2/#4, SPEC-LEVEL §6.2/§6.3) ---------
   The loader must not import player.js/enemies.js (they don't exist and would
   be a forward/circular hazard). It calls registered factories; real entity
   modules override the placeholders below when they land. A placeholder is a
   minimal inert object { type, x, y, tc, blocks } where x,y are the PIXEL world
   position (tile center) and tc the same pixel center; the spawner placeholder
   additionally carries its variant, its eligible(n)-filtered enemy table, and
   ramped interval/live-cap for #4.

   COORD RECONCILIATION (SPEC-PLAYER Phase 6, was flagged in STATUS.md): entity
   x,y are PIXELS (not tile indices). world.bodyHitsBlocker measures dx=x-e.x in
   pixels, the player lives in pixels, and the carry system re-positions dropped
   crates in pixels — so all dynamic entities share one pixel coordinate space.
   Tile-keyed lookups (nav-dirty, plate press) derive the tile via (x/TILE)|0. */
const entityFactories = new Map();
export function registerEntityFactory(type, fn) { entityFactories.set(type, fn); }

// Which G array each placed entity type is pushed onto.
const ENTITY_ARRAY = {
  spawner: "spawners", crate: "crates", barrel: "barrels", reaper: "enemies",
  food: "pickups", treasure: "pickups", key: "pickups", powerup: "pickups",
};

function mkPlaceholder(blocks, extra) {
  return (p) => {
    const tc = tileCenter(p.x, p.y);            // p.x,p.y are placement TILE coords
    const e = { type: p.type, x: tc.x, y: tc.y, tc, blocks };   // x,y = PIXEL world pos (see coord note above)
    if (p.kind != null) e.kind = p.kind;
    return extra ? extra(e, p) : e;
  };
}

// eligible(n) = union of CFG.PLAN.introductions elements for all nights ≤ n
// (SPEC-LEVEL §5.1). The spawner's variant table is intersected with this so a
// Bone Pile on Night 2 emits only skeletons until shooters unlock on Night 3.
function eligibleElements(n) {
  const out = new Set();
  for (const intro of CFG.PLAN.introductions)
    if (intro.night <= n) for (const el of intro.elements) out.add(el);
  return out;
}

// Placeholder factories. Movable ones (crate/barrel/spawner) report blocks:true
// so they register as nav blockers; enemies (reaper) and pickups do not.
registerEntityFactory("crate",    mkPlaceholder(true));
registerEntityFactory("barrel",   mkPlaceholder(true));
registerEntityFactory("reaper",   mkPlaceholder(false));
registerEntityFactory("food",     mkPlaceholder(false));
registerEntityFactory("treasure", mkPlaceholder(false));
registerEntityFactory("key",      mkPlaceholder(false));
registerEntityFactory("powerup",  mkPlaceholder(false));
registerEntityFactory("spawner",  mkPlaceholder(true, (e, p) => {
  const variant = CFG.SPAWNER[p.variant];
  e.variant = p.variant;
  const elig = eligibleElements(G.night);
  const table = {};
  for (const [enemy, w] of Object.entries(variant.table)) if (elig.has(enemy)) table[enemy] = w;
  e.table = table;                                            // Plan-filtered, inert data for #4
  e.interval = G.ramp.spawnerInterval != null ? G.ramp.spawnerInterval : variant.interval;
  e.liveCap  = G.ramp.spawnerLiveCap  != null ? G.ramp.spawnerLiveCap  : variant.liveCap;
  return e;
}));

/* =========================================================================
   Mutable tile-state store + link graph (SPEC-LEVEL §3.2–3.3).
   Rebuilt fresh every load. Keyed by packed tile coord ty*cols+tx.
   ========================================================================= */
let tileState = new Map();                 // key -> DoorState | PlateState
let platesById = new Map();                // plate id -> PlateState
let doorsById = new Map();                 // door id  -> { tx, ty, state:DoorState }
let links = [];                            // [{ plate, door }]
let exitTileSet = new Set();               // packed keys of exit tiles (spawn avoid)

const packKey = (tx, ty) => ty * CFG.COLS + tx;

// world.js consults this for every d/D cell before the static flag. Only door
// states carry `.open`; plates return null so world falls back to the static
// '_' flag (non-solid floor). The closure reads the live module `tileState`
// (reassigned each load), so it always sees the current level's store.
registerTileStateResolver((tx, ty) => {
  const s = tileState.get(packKey(tx, ty));
  return (s && s.kind === "door") ? s : null;
});

// recomputeDoor (pure, §3.3): a plate-door is open iff ANY linked plate is
// pressed. On change, flip `open` and dirty the nav tile. Locked (D) doors have
// no linked plate and are untouched by this — they open only via a key.
export function recomputeDoor(doorId) {
  const door = doorsById.get(doorId);
  if (!door) return;
  let open = false;
  for (const l of links)
    if (l.door === doorId) {
      const p = platesById.get(l.plate);
      if (p && p.pressed) { open = true; break; }
    }
  if (door.state.open !== open) {
    door.state.open = open;
    markNavDirty({ tx: door.tx, ty: door.ty });
  }
}

// Setter exposed for #2 (carry/entity systems decide WHAT presses a plate).
export function setPlatePressed(id, pressed) {
  const p = platesById.get(id);
  if (!p) return;
  p.pressed = !!pressed;
  for (const l of links) if (l.plate === id) recomputeDoor(l.door);
}

// Coord-keyed plate press for #2's carry/interact seam (SPEC-LEVEL §4.3).
// Delegates to setPlatePressed so recomputeDoor stays the single link-recompute
// path — no reimplementation here. An unlinked '_' plate (id null) is a
// harmless no-op: nothing reads it.
export function setPlatePressedAt(tx, ty, pressed) {
  const s = tileState.get(packKey(tx, ty));
  if (s && s.kind === "plate" && s.id != null) setPlatePressed(s.id, pressed);
}

// Setter exposed for #2 (key-spend). Opens a locked (D) door permanently — a
// boolean, no sentinel needed (nothing here is serialized as a numeric).
export function openLockedDoor(tx, ty) {
  const s = tileState.get(packKey(tx, ty));
  if (s && s.kind === "door") { s.open = true; markNavDirty({ tx, ty }); }
}

// step 3: build tileState from d/D/_ tiles + door/plate placements + links,
// then recompute every door once so any pre-pressed plate resolves.
function buildTileState(def) {
  tileState = new Map();
  platesById = new Map();
  doorsById = new Map();
  links = (def.links || []).slice();

  for (let ty = 0; ty < CFG.ROWS; ty++)
    for (let tx = 0; tx < CFG.COLS; tx++) {
      const ch = map[ty][tx];
      if (ch === "d" || ch === "D")
        tileState.set(packKey(tx, ty), { kind: "door", id: null, char: ch, open: false });
      else if (ch === "_")
        tileState.set(packKey(tx, ty), { kind: "plate", id: null, pressed: false });
    }

  for (const p of def.placements) {
    if (p.type === "door") {
      const s = tileState.get(packKey(p.x, p.y));
      if (s && s.kind === "door") { s.id = p.id; doorsById.set(p.id, { tx: p.x, ty: p.y, state: s }); }
    } else if (p.type === "plate") {
      const s = tileState.get(packKey(p.x, p.y));
      if (s && s.kind === "plate") { s.id = p.id; platesById.set(p.id, s); }
    }
  }

  for (const id of doorsById.keys()) recomputeDoor(id);
}

/* =========================================================================
   Difficulty-ramp snapshot (SPEC-LEVEL §5.5). Evaluated once at load into
   G.ramp; nothing re-reads CFG.RAMP mid-level (§8.6). tier steps every 8 Nights.
   clampToward clamps toward the limit regardless of step sign (some steps are
   negative, e.g. lobberErrorRadius).
   ========================================================================= */
export function rampValue(param, tier) {
  const raw = param.mode === "mul"
    ? param.base * Math.pow(param.step, tier)
    : param.base + param.step * tier;
  return param.base <= param.limit ? Math.min(raw, param.limit) : Math.max(raw, param.limit);
}
// Pure eval of the full CFG.RAMP table for Night n — shared with
// level-generator.js's evalRamp so there is one implementation of §5.5, not
// two. Exported; does not itself touch G (snapshotRamp below does that).
export function evalRampTable(n) {
  const tier = Math.floor((n - 1) / 8);
  const out = {};
  for (const [k, param] of Object.entries(CFG.RAMP)) out[k] = rampValue(param, tier);
  return out;
}
function snapshotRamp(n) {
  G.ramp = evalRampTable(n);
}

/* =========================================================================
   Validation (SPEC-LEVEL §4.3). Structural only — solvability is a generator
   guarantee (§5.4), never a loader check. Runs BEFORE loadTileGrid, so it reads
   the raw def.tiles strings (grid not parsed yet). Throws on the first failure.
   ========================================================================= */
export function validateLevelDef(def) {
  if (!def || !Array.isArray(def.tiles) || def.tiles.length === 0)
    throw new Error("level def: missing or empty tile grid");
  for (const row of def.tiles)
    if (typeof row !== "string") throw new Error("level def: tile rows must be strings");

  const placements = def.placements || [];
  const players = placements.filter(p => p.type === "player").length;
  if (players !== 1) throw new Error(`level def: must have exactly one player placement (found ${players})`);
  if (placements.filter(p => p.type === "exit").length < 1)
    throw new Error("level def: must have at least one exit placement");

  const roles = new Set((def.zones || []).map(z => z.role));
  for (const rule of (def.spawnRules || [])) {
    if (rule.zone && rule.zone !== "any" && !roles.has(rule.zone))
      throw new Error(`level def: spawn rule '${rule.type}' references unknown zone role '${rule.zone}'`);
    if (rule.avoid && rule.avoid !== "any" && !roles.has(rule.avoid))          // ★
      throw new Error(`level def: spawn rule '${rule.type}' references unknown avoid role '${rule.avoid}'`);
  }

  // ★ every link references an existing plate id AND door id (both as placements)
  const plateIds = new Set(placements.filter(p => p.type === "plate").map(p => p.id));
  const doorIds  = new Set(placements.filter(p => p.type === "door").map(p => p.id));
  for (const l of (def.links || [])) {
    if (!plateIds.has(l.plate)) throw new Error(`level def: link references unknown plate id '${l.plate}'`);
    if (!doorIds.has(l.door))   throw new Error(`level def: link references unknown door id '${l.door}'`);
  }

  // ★ every door/plate placement sits on its matching char (D3 reconciliation)
  const rows = def.tiles.length, cols = def.tiles[0].length;
  const charAt = (x, y) => (y >= 0 && y < rows && x >= 0 && x < cols) ? def.tiles[y][x] : undefined;
  for (const p of placements) {
    if (p.type === "door") {
      const ch = charAt(p.x, p.y);
      if (ch !== "d" && ch !== "D")
        throw new Error(`level def: door '${p.id}' at ${p.x},${p.y} is not on a 'd'/'D' tile (found '${ch}')`);
    } else if (p.type === "plate") {
      const ch = charAt(p.x, p.y);
      if (ch !== "_")
        throw new Error(`level def: plate '${p.id}' at ${p.x},${p.y} is not on a '_' tile (found '${ch}')`);
    }
  }

  // ★ every spawner variant (placement or rule) exists in CFG.SPAWNER
  for (const p of placements)
    if (p.type === "spawner" && !CFG.SPAWNER[p.variant])
      throw new Error(`level def: spawner placement has unknown variant '${p.variant}'`);
  for (const rule of (def.spawnRules || []))
    if (rule.type === "spawner" && !CFG.SPAWNER[rule.variant])
      throw new Error(`level def: spawn rule has unknown spawner variant '${rule.variant}'`);

  // ★ script-actor check — no-op until a script registry exists (seam left open).
}

/* =========================================================================
   Spawn-rule placement (SPEC-LEVEL §4.4, extends ADD pickTile/runSpawnRule).
   400-try loop + guaranteed-floor fallback, rejecting solid / avoid / ★plate /
   ★exit tiles so a rule always places on a legal tile.
   ========================================================================= */
function zonesWithRole(def, role) {
  if (!role || role === "any") return null;
  return (def.zones || []).filter(z => z.role === role);
}
function inAnyRect(tx, ty, rects) {
  for (const r of rects) if (tx >= r.x && tx < r.x + r.w && ty >= r.y && ty < r.y + r.h) return true;
  return false;
}
function randomTC(rects) {
  if (rects && rects.length) {
    const r = rects[(Math.random() * rects.length) | 0];
    return { tx: r.x + ((Math.random() * r.w) | 0), ty: r.y + ((Math.random() * r.h) | 0) };
  }
  return { tx: 1 + ((Math.random() * (CFG.COLS - 2)) | 0), ty: 1 + ((Math.random() * (CFG.ROWS - 2)) | 0) };
}
// A legal scatter tile: interior, non-solid, not a plate, not the exit, not in
// an avoid zone. `legal` is reused by the guaranteed-floor fallback so the
// fallback can never return a plate/exit tile (plates are non-solid!).
function legalScatterTile(tx, ty, avoid) {
  if (tx <= 0 || ty <= 0 || tx >= CFG.COLS - 1 || ty >= CFG.ROWS - 1) return false;
  if (isWall(tx, ty)) return false;
  if (map[ty][tx] === "_") return false;                    // ★ never on a plate
  if (exitTileSet.has(packKey(tx, ty))) return false;       // ★ never on the exit
  if (avoid && inAnyRect(tx, ty, avoid)) return false;
  return true;
}
function pickTile(rule, def) {
  const rects = zonesWithRole(def, rule.zone), avoid = zonesWithRole(def, rule.avoid);
  for (let tries = 0; tries < 400; tries++) {
    const { tx, ty } = randomTC(rects);
    if (legalScatterTile(tx, ty, avoid)) return { tx, ty };
  }
  for (let ty = 1; ty < CFG.ROWS - 1; ty++)                 // guaranteed-floor fallback
    for (let tx = 1; tx < CFG.COLS - 1; tx++)
      if (legalScatterTile(tx, ty, null)) return { tx, ty };
  return { tx: 1, ty: 1 };
}

// Construct one placeholder entity from a placement, route it to its G array,
// and register movable ones as nav blockers (§4.5 — single dynamic collision
// source). Unknown type has no factory → ignored (forward-compatible).
function placeEntity(p) {
  const factory = entityFactories.get(p.type);
  if (!factory) return null;
  const e = factory(p);
  const arr = ENTITY_ARRAY[p.type];
  if (arr && G[arr]) G[arr].push(e);
  if (e.blocks) registerBlocker(e);
  return e;
}

function runSpawnRule(rule, def) {
  const n = rule.count || 0;
  for (let i = 0; i < n; i++) {
    const { tx, ty } = pickTile(rule, def);
    placeEntity({ type: rule.type, x: tx, y: ty, variant: rule.variant, kind: rule.kind });
  }
}

/* =========================================================================
   loadLevel — the ordered contract (SPEC-LEVEL §4.1). Order is load-bearing
   where noted. The RAMP snapshot (spec step 8) is hoisted ahead of placements
   because spawner entities built in steps 5–6 read G.ramp per §6.3; it is still
   read exactly once at load, never mid-level (§8.6). See STATUS.md.
   ========================================================================= */
export function loadLevel(def) {
  validateLevelDef(def);                                    // 1. fail loud on malformed input
  loadTileGrid(def.tiles);                                  // 2. parse grid (NO conveyor bake)
  buildTileState(def);                                      // 3. tile-state + link graph, doors recomputed
  clearTransient(def);                                      // 4. clear transient, preserve run state
  snapshotRamp(G.night);                                    // 8(hoisted). ramp → G.ramp, once

  // 5. Fixed placements — player FIRST (set-pieces may read player pos on spawn)…
  const player = def.placements.find(p => p.type === "player");
  const pc = tileCenter(player.x, player.y);
  G.player = { x: pc.x, y: pc.y, tx: player.x, ty: player.y };

  // …then exit(s) (collect every exit tile so scatter avoids them)…
  exitTileSet = new Set();
  let firstExit = null;
  for (const e of def.placements) {
    if (e.type !== "exit") continue;
    exitTileSet.add(packKey(e.x, e.y));
    if (!firstExit) firstExit = e;
  }
  const ec = tileCenter(firstExit.x, firstExit.y);
  G.exit = { x: ec.x, y: ec.y, tx: firstExit.x, ty: firstExit.y, r: 18 };

  // …then all other placements (plate/door already handled in step 3).
  for (const p of def.placements) {
    if (p.type === "player" || p.type === "exit" || p.type === "plate" || p.type === "door") continue;
    placeEntity(p);                                         // 7 folded in: blockers registered at placement (§4.5)
  }

  for (const rule of (def.spawnRules || [])) runSpawnRule(rule, def);   // 6. zone-scattered rules

  G.camera = { x: 0, y: 0 };                                // (part of step 8) reset camera
  emit("level:start", {                                     // 9. emit + arm the wipe-open
    night: G.night, id: def.id,
    spawners: G.spawners.length, enemies: G.enemies.length, dark: G.dark,
  });
  G._wipeOpenPending = true;
}

// step 4: clear per-level transients; preserve carried run state (§4.2). Player
// run-state (hp/overheal/gems/charges/keys/powerups/score/night) is NEVER touched
// here — newGame() owns that. Also stamps props.dark / props.music (loader only
// stamps; light selection is #7, music resolution is #11.3). tileState + link
// graph are cleared by buildTileState's fresh Maps (step 3); the nav grid is
// nav's to clear (#3) — a no-op sink until nav lands.
function clearTransient(def) {
  G.shots = []; G.enemies = []; G.spawners = []; G.pickups = [];
  G.crates = []; G.barrels = []; G.shrapnel = [];
  G.marks = []; G.floats = []; G.lights = [];               // lights = light-emitter registry
  G.spawnTimer = 0; G.pickupTimer = 0;
  G._levelEndEmitted = false; G._allEnemiesDeadEmitted = false;
  G._wipeOpenPending = false;

  const props = def.props || {};
  G.dark = !!props.dark;
  G.music = props.music != null ? props.music : null;
}
