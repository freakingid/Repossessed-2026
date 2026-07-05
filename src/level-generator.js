/* =========================================================================
   level-generator.js — the GEOMETRY half of the endless generator and the
   top-level entry `generateLevel(n, rng)` (SPEC-LEVEL §5.3/§5.4).

   Produces DATA ONLY — a Level Definition the loader accepts. It never touches
   G entities (the loader is the sole world-builder); the single G field it
   reads/writes is the unsaved Q3 dark-guard `G._prevDark`. Content (roster,
   budget, ramp) is imported from level-plan.js as a pure fn of n (D2); geometry
   and placement consume the injected `rng` — fresh seed in production (layout
   varies per visit), fixed seed in tests (deterministic). No seed is persisted.

   Contract (§5.4): generateLevel ALWAYS returns a loadable, solvable def. It
   re-rolls geometry with a fresh sub-rng up to CFG.GEN.maxAttempts; if every
   attempt fails the solvability checks it emits a guaranteed-valid open-`arena`
   fallback (no locked/plate doors) and warns. loadLevel therefore never has to
   defend against an unsolvable generated level.
   ========================================================================= */
import { CFG } from "./config.js";
import { G } from "./state.js";
import { buildRoster, eligible } from "./level-plan.js";

/* =========================================================================
   RNG (D2) — mulberry32: a tiny deterministic PRNG. makeRng(seed) returns a
   fn → float in [0,1). Fresh seed in production, fixed seed in tests.
   ========================================================================= */
export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const randInt = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1)); // inclusive
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
function shuffle(rng, arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/* =========================================================================
   Grid helpers. A working grid is an array of char rows (`grid[y][x]`); the
   def's `tiles` is the row-joined string form. Border is always solid `#`.
   ========================================================================= */
const SOLID = new Set(["#", "o", "T"]);
const isSolidChar = (c) => SOLID.has(c);
const isDoorChar = (c) => c === "d" || c === "D";

function makeGrid(cols, rows, interior) {
  const g = [];
  for (let y = 0; y < rows; y++) {
    const row = new Array(cols);
    for (let x = 0; x < cols; x++) {
      row[x] = (x === 0 || y === 0 || x === cols - 1 || y === rows - 1) ? "#" : interior;
    }
    g.push(row);
  }
  return g;
}
const gridToTiles = (g) => g.map((row) => row.join(""));
const inInterior = (cols, rows, x, y) => x > 0 && y > 0 && x < cols - 1 && y < rows - 1;

// Footprint interpolates min→max over footprintGrowNights, then caps (§5.3).
function footprint(n) {
  const { footprintMin: mn, footprintMax: mx, footprintGrowNights: span } = CFG.GEN;
  const t = Math.min(Math.max((n - 1) / span, 0), 1);
  return {
    cols: Math.round(mn[0] + (mx[0] - mn[0]) * t),
    rows: Math.round(mn[1] + (mx[1] - mn[1]) * t),
  };
}

/* =========================================================================
   Archetypes (§5.3). Each returns { grid, player:{x,y}, exit:{x,y},
   placements:[], links:[] }. Connectivity is guaranteed BY CONSTRUCTION and
   RE-CHECKED by solvability (§5.4) — construction bugs surface as flood-fill
   failures (a re-roll), never crashes. Only `halls` emits door set-pieces;
   the others emit no placements/links.
   ========================================================================= */

// arena — open field; single-tile o/T obstacles by rejection sampling, each
// kept isolated by a clearance radius so no cluster can seal a region.
function genArena(cols, rows, n, rng) {
  const g = makeGrid(cols, rows, ".");
  const player = { x: 2, y: 2 };
  const exit = { x: cols - 3, y: rows - 3 };
  const area = (cols - 2) * (rows - 2);
  const k = Math.max(3, Math.round(area * CFG.GEN.arenaClusterDensity));
  const clr = CFG.GEN.arenaClearance;
  const near = (x, y, p, r) => Math.abs(x - p.x) < r && Math.abs(y - p.y) < r;
  const clearAround = (x, y) => {
    for (let dy = -clr; dy <= clr; dy++)
      for (let dx = -clr; dx <= clr; dx++) {
        const nx = x + dx, ny = y + dy;
        if (!inInterior(cols, rows, nx, ny)) continue;
        if (g[ny][nx] !== ".") return false;
      }
    return true;
  };
  let placed = 0;
  for (let tries = 0; placed < k && tries < k * 40; tries++) {
    const x = randInt(rng, 2, cols - 3), y = randInt(rng, 2, rows - 3);
    if (near(x, y, player, 4) || near(x, y, exit, 4)) continue;
    if (!clearAround(x, y)) continue;
    g[y][x] = rng() < 0.5 ? "o" : "T";
    placed++;
  }
  return { grid: g, player, exit, placements: [], links: [] };
}

// warrens — randomized-DFS maze on a pitch-3 cell grid with 2-tile corridors,
// then knock extra walls for flanking loops. Connected by construction.
function genWarrens(cols, rows, n, rng) {
  const g = makeGrid(cols, rows, "#");
  const cw = CFG.GEN.warrensCorridorW, p = cw + 1;
  const cellsX = Math.max(2, Math.floor((cols - 1) / p));
  const cellsY = Math.max(2, Math.floor((rows - 1) / p));
  const origin = (cx, cy) => ({ x: 1 + cx * p, y: 1 + cy * p });
  const carveCell = (cx, cy) => {
    const o = origin(cx, cy);
    for (let dy = 0; dy < cw; dy++) for (let dx = 0; dx < cw; dx++) g[o.y + dy][o.x + dx] = ".";
  };
  const carvePassage = (ax, ay, bx, by) => {
    const a = origin(ax, ay), b = origin(bx, by);
    if (bx > ax) for (let dy = 0; dy < cw; dy++) g[a.y + dy][a.x + cw] = ".";
    else if (bx < ax) for (let dy = 0; dy < cw; dy++) g[b.y + dy][b.x + cw] = ".";
    else if (by > ay) for (let dx = 0; dx < cw; dx++) g[a.y + cw][a.x + dx] = ".";
    else for (let dx = 0; dx < cw; dx++) g[b.y + cw][b.x + dx] = ".";
  };
  const visited = Array.from({ length: cellsY }, () => new Array(cellsX).fill(false));
  const stack = [[0, 0]];
  visited[0][0] = true; carveCell(0, 0);
  while (stack.length) {
    const [cx, cy] = stack[stack.length - 1];
    const nbrs = shuffle(rng, [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]
      .filter(([nx, ny]) => nx >= 0 && ny >= 0 && nx < cellsX && ny < cellsY && !visited[ny][nx]));
    if (!nbrs.length) { stack.pop(); continue; }
    const [nx, ny] = nbrs[0];
    visited[ny][nx] = true; carveCell(nx, ny); carvePassage(cx, cy, nx, ny);
    stack.push([nx, ny]);
  }
  const m = Math.round(cellsX * cellsY * CFG.GEN.warrensLoopFactor);
  for (let i = 0; i < m; i++) {
    const cx = randInt(rng, 0, cellsX - 1), cy = randInt(rng, 0, cellsY - 1);
    const dirs = [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]
      .filter(([nx, ny]) => nx >= 0 && ny >= 0 && nx < cellsX && ny < cellsY);
    if (dirs.length) { const [nx, ny] = pick(rng, dirs); carvePassage(cx, cy, nx, ny); }
  }
  const po = origin(0, 0), eo = origin(cellsX - 1, cellsY - 1);
  return {
    grid: g, player: { x: po.x, y: po.y },
    exit: { x: eo.x + cw - 1, y: eo.y + cw - 1 }, placements: [], links: [],
  };
}

// halls — BSP rooms connected by corridors between sibling centers (connected
// by construction), plus optional plate/locked-door set pieces built as
// isolated alcoves carved out of solid space so they can never sit on the
// player→exit path (see addDoorAlcove).
function genHalls(cols, rows, n, rng) {
  const g = makeGrid(cols, rows, "#");
  const { hallsMinLeaf: minLeaf, hallsMaxDepth: maxDepth, hallsCorridorW: cwd } = CFG.GEN;
  const leaves = [];
  const carveRect = (x, y, w, h) => {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++)
      if (inInterior(cols, rows, xx, yy)) g[yy][xx] = ".";
  };
  const carveCorridor = (ax, ay, bx, by) => {                 // L-shaped, cwd wide
    const hx0 = Math.min(ax, bx), hx1 = Math.max(ax, bx);
    for (let x = hx0; x <= hx1; x++) for (let w = 0; w < cwd; w++) carveRect(x, ay + w, 1, 1);
    const vy0 = Math.min(ay, by), vy1 = Math.max(ay, by);
    for (let y = vy0; y <= vy1; y++) for (let w = 0; w < cwd; w++) carveRect(bx + w, y, 1, 1);
  };
  function build(x, y, w, h, depth) {
    const canH = h >= minLeaf * 2 + 1, canV = w >= minLeaf * 2 + 1;
    if (depth >= maxDepth || (!canH && !canV)) {
      const mw = Math.max(3, w - 2), mh = Math.max(3, h - 2);          // room margin
      const rx = x + 1, ry = y + 1;
      carveRect(rx, ry, mw, mh);
      const node = { center: { x: rx + (mw >> 1), y: ry + (mh >> 1) } };
      leaves.push(node);
      return node;
    }
    const horiz = canH && canV ? rng() < 0.5 : canH;
    let a, b;
    if (horiz) {
      const cut = randInt(rng, minLeaf, h - minLeaf);
      a = build(x, y, w, cut, depth + 1); b = build(x, y + cut, w, h - cut, depth + 1);
    } else {
      const cut = randInt(rng, minLeaf, w - minLeaf);
      a = build(x, y, cut, h, depth + 1); b = build(x + cut, y, w - cut, h, depth + 1);
    }
    carveCorridor(a.center.x, a.center.y, b.center.x, b.center.y);
    return { center: a.center };
  }
  build(1, 1, cols - 2, rows - 2, 0);

  // player = first leaf, exit = farthest leaf from it.
  const player = { ...leaves[0].center };
  let exit = { ...leaves[0].center }, best = -1;
  for (const lf of leaves) {
    const d = Math.abs(lf.center.x - player.x) + Math.abs(lf.center.y - player.y);
    if (d > best) { best = d; exit = { ...lf.center }; }
  }

  const placements = [], links = [];
  const occupied = new Set([player.y * cols + player.x, exit.y * cols + exit.x]);
  // plate-door (d) — eligible n>=3; locked-door (D) — eligible n>=2 (§5.3).
  if (eligible(n).has("plateDoor")) addPlateDoor(g, cols, rows, rng, occupied, placements, links);
  if (eligible(n).has("lockedDoor")) addLockedDoor(g, cols, rows, rng, occupied, placements);

  return { grid: g, player, exit, placements, links };
}

// ring — solid centered core, perimeter loop >=2 wide, carved spokes (chords)
// across the core connecting opposite arcs. Start/exit on opposite arcs.
function genRing(cols, rows, n, rng) {
  const g = makeGrid(cols, rows, ".");
  const lw = CFG.GEN.ringLoopWidth;
  const cx0 = 1 + lw, cy0 = 1 + lw, cx1 = cols - 2 - lw, cy1 = rows - 2 - lw;
  if (cx1 >= cx0 && cy1 >= cy0) {
    for (let y = cy0; y <= cy1; y++) for (let x = cx0; x <= cx1; x++) g[y][x] = "#";
    const sw = 2, midY = rows >> 1, midX = cols >> 1;
    for (let y = midY; y < midY + sw && y <= cy1; y++)                 // horizontal spoke
      for (let x = cx0; x <= cx1; x++) g[y][x] = ".";
    if (rng() < CFG.GEN.ringSpokeChance)                              // optional vertical spoke
      for (let x = midX; x < midX + sw && x <= cx1; x++)
        for (let y = cy0; y <= cy1; y++) g[y][x] = ".";
  }
  const midY = rows >> 1;
  return {
    grid: g, player: { x: 1, y: midY }, exit: { x: cols - 2, y: midY },
    placements: [], links: [],
  };
}

const ARCHETYPES = { arena: genArena, warrens: genWarrens, halls: genHalls, ring: genRing };
const ARCH_NAMES = Object.keys(ARCHETYPES);

/* -------------------------------------------------------------------------
   Door alcoves (§5.3 halls set pieces). An alcove is a single pocket cell
   carved out of solid space, reachable ONLY through one door cell — so the
   door is provably never on the player→exit path, and closing/locking it can
   only isolate the pocket reward, never the exit. This is what keeps halls'
   doors solvable by construction (checked again in §5.4).
   ------------------------------------------------------------------------- */
function findAlcove(g, cols, rows, rng, occupied) {
  const key = (x, y) => y * cols + x;
  const cands = [];
  for (let dy = 2; dy < rows - 2; dy++)
    for (let dx = 2; dx < cols - 2; dx++) {
      if (!isSolidChar(g[dy][dx]) || g[dy][dx] !== "#") continue;      // door goes on plain wall
      const arms = [[dx - 1, dy, dx + 1, dy], [dx + 1, dy, dx - 1, dy],
                    [dx, dy - 1, dx, dy + 1], [dx, dy + 1, dx, dy - 1]];
      for (const [ox, oy, px, py] of arms) {
        if (g[oy][ox] !== "." || occupied.has(key(ox, oy))) continue;  // out = free main floor
        if (g[py][px] !== "#") continue;                              // pocket currently solid wall
        // pocket isolated: every pocket neighbour except the door is solid.
        let isolated = true;
        for (const [qx, qy] of [[px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]]) {
          if (qx === dx && qy === dy) continue;
          if (!isSolidChar(g[qy][qx])) { isolated = false; break; }
        }
        if (isolated) cands.push({ dx, dy, ox, oy, px, py });
      }
    }
  return cands.length ? cands[randInt(rng, 0, cands.length - 1)] : null;
}
function addPlateDoor(g, cols, rows, rng, occupied, placements, links) {
  const a = findAlcove(g, cols, rows, rng, occupied);
  if (!a) return;
  const key = (x, y) => y * cols + x;
  g[a.dy][a.dx] = "d"; g[a.py][a.px] = ".";                            // door + pocket floor
  const doorId = "pdoor", plateId = "pplate";
  placements.push({ type: "door", x: a.dx, y: a.dy, id: doorId });
  placements.push({ type: "treasure", x: a.px, y: a.py });            // reward behind the door
  g[a.oy][a.ox] = "_";                                                // plate on the approach floor
  placements.push({ type: "plate", x: a.ox, y: a.oy, id: plateId });
  links.push({ plate: plateId, door: doorId });
  occupied.add(key(a.dx, a.dy)); occupied.add(key(a.px, a.py)); occupied.add(key(a.ox, a.oy));
  // a crate reachable without the door open (§5.4 check 3) — adjacent main floor.
  const crate = nearestFreeFloor(g, cols, rows, a.ox, a.oy, occupied);
  if (crate) { placements.push({ type: "crate", x: crate.x, y: crate.y }); occupied.add(key(crate.x, crate.y)); }
}
function addLockedDoor(g, cols, rows, rng, occupied, placements) {
  const a = findAlcove(g, cols, rows, rng, occupied);
  if (!a) return;
  const key = (x, y) => y * cols + x;
  g[a.dy][a.dx] = "D"; g[a.py][a.px] = ".";                            // locked door + pocket
  // D is a pure key-driven tile (D3): no id, no placement, no link.
  placements.push({ type: "treasure", x: a.px, y: a.py });
  occupied.add(key(a.dx, a.dy)); occupied.add(key(a.px, a.py));
  // key placed pre-door in the reachable region (§5.4 check 2).
  const kc = nearestFreeFloor(g, cols, rows, a.ox, a.oy, occupied);
  if (kc) { placements.push({ type: "key", x: kc.x, y: kc.y }); occupied.add(key(kc.x, kc.y)); }
}
// Nearest plain-floor `.` cell to (cx,cy) not already occupied (spiral scan).
function nearestFreeFloor(g, cols, rows, cx, cy, occupied) {
  const key = (x, y) => y * cols + x;
  for (let r = 0; r < Math.max(cols, rows); r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = cx + dx, y = cy + dy;
        if (!inInterior(cols, rows, x, y)) continue;
        if (g[y][x] === "." && !occupied.has(key(x, y))) return { x, y };
      }
  return null;
}

/* =========================================================================
   Zones (§2) — blanket the interior with combat/danger/cover (roles overlap)
   and carve a small `spawn` rect at the player so spawner rules can `avoid` it.
   ========================================================================= */
function buildZones(cols, rows, player) {
  const interior = { x: 1, y: 1, w: cols - 2, h: rows - 2 };
  const sx = Math.max(1, player.x - 1), sy = Math.max(1, player.y - 1);
  const spawn = { x: sx, y: sy, w: Math.min(3, cols - 1 - sx), h: Math.min(3, rows - 1 - sy) };
  return [
    { role: "combat", ...interior },
    { role: "danger", ...interior },
    { role: "cover", ...interior },
    { role: "spawn", ...spawn },
  ];
}

/* =========================================================================
   Roster → placements (§5.2). buildRoster is a pure fn of n; the generator
   turns it into (a) zone-scattered spawner rules for eligible spawner variants
   and (b) a bounded set of fixed loose-enemy/Reaper placements. Elements whose
   spawner variant is not yet unlocked (e.g. a Night-1 skeleton, whose Bone Pile
   unlocks Night 2) are placed as loose enemies (§5.1/§5.2).
   ========================================================================= */
function variantForElement(element) {
  for (const [v, s] of Object.entries(CFG.SPAWNER)) if (s.table[element] != null) return v;
  return null;
}
function placeRoster(n, rng, openFloor) {
  const { roster, reaper } = buildRoster(n);
  const elig = eligible(n);
  const variantPicks = {};
  const loose = [];
  for (const item of roster) {
    const v = variantForElement(item.element);
    if (item.asSpawner && v && elig.has(v)) variantPicks[v] = (variantPicks[v] || 0) + 1;
    else loose.push(item.element);
  }
  const spawnRules = [];
  for (const [v, picks] of Object.entries(variantPicks)) {
    const count = Math.min(1 + Math.floor(picks / CFG.GEN.spawnerPickDivisor), CFG.GEN.maxSpawnersPerVariant);
    spawnRules.push({ type: "spawner", variant: v, count, zone: rng() < 0.5 ? "danger" : "combat", avoid: "spawn" });
  }
  // Loose enemies + Reaper as fixed placements drawn from reachable main floor.
  const placements = [];
  const pool = shuffle(rng, openFloor.slice());
  let pi = 0;
  const take = () => (pi < pool.length ? pool[pi++] : null);
  const cap = Math.min(loose.length, CFG.GEN.maxLoosePerLevel, pool.length);
  for (let i = 0; i < cap; i++) { const t = take(); placements.push({ type: loose[i], x: t.x, y: t.y }); }
  if (reaper) { const t = take(); if (t) placements.push({ type: "reaper", x: t.x, y: t.y }); }
  return { spawnRules, placements };
}

/* =========================================================================
   Solvability (§5.4) — run on a candidate BEFORE returning it. Iterative
   flood-fill from the player: a closed plate-door counts passable once a crate
   AND its linked plate are reachable (the crate can be pushed onto it); a
   locked door counts passable once a key is reachable. Then:
     check 1 — exit + every placement tile reachable;
     check 2 — every locked (D) door's key reachable WITHOUT any door (base);
     check 3 — every plate-door has a crate + plate reachable in the base flood.
   ========================================================================= */
export function isSolvable(def) {
  const grid = def.tiles.map((r) => r.split(""));
  const rows = grid.length, cols = grid[0].length;
  const idx = (x, y) => y * cols + x;
  const inB = (x, y) => x >= 0 && y >= 0 && x < cols && y < rows;
  const player = def.placements.find((p) => p.type === "player");
  if (!player || !inB(player.x, player.y)) return false;

  const links = def.links || [];
  const plateAt = new Map();      // plate id -> {x,y}
  const doorAt = new Map();       // door id  -> {x,y}
  for (const p of def.placements) {
    if (p.type === "plate") plateAt.set(p.id, p);
    if (p.type === "door") doorAt.set(p.id, p);
  }
  const crates = def.placements.filter((p) => p.type === "crate");
  const keys = def.placements.filter((p) => p.type === "key");

  const flood = (openDoors) => {
    const seen = new Uint8Array(cols * rows);
    const stack = [[player.x, player.y]];
    seen[idx(player.x, player.y)] = 1;
    while (stack.length) {
      const [x, y] = stack.pop();
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (!inB(nx, ny) || seen[idx(nx, ny)]) continue;
        const c = grid[ny][nx];
        if (isSolidChar(c)) continue;
        if (isDoorChar(c) && !openDoors.has(idx(nx, ny))) continue;
        seen[idx(nx, ny)] = 1; stack.push([nx, ny]);
      }
    }
    return seen;
  };
  const R = (seen, x, y) => seen[idx(x, y)] === 1;

  const base = flood(new Set());
  const openDoors = new Set();
  let seen = base;
  let changed = true;
  while (changed) {
    changed = false;
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        const c = grid[y][x];
        if (!isDoorChar(c) || openDoors.has(idx(x, y))) continue;
        if (c === "D") {
          if (keys.some((k) => R(seen, k.x, k.y))) { openDoors.add(idx(x, y)); changed = true; }
        } else {                                     // d: crate can be pushed onto a linked plate
          let doorId = null;
          for (const [id, p] of doorAt) if (p.x === x && p.y === y) { doorId = id; break; }
          if (doorId == null) continue;
          const plates = links.filter((l) => l.door === doorId).map((l) => plateAt.get(l.plate)).filter(Boolean);
          const plateReach = plates.some((pl) => R(seen, pl.x, pl.y));
          const crateReach = crates.some((cr) => R(seen, cr.x, cr.y));
          if (plateReach && crateReach) { openDoors.add(idx(x, y)); changed = true; }
        }
      }
    if (changed) seen = flood(openDoors);
  }

  // check 1 — exit + every placement reachable.
  for (const p of def.placements) {
    if (p.type === "player") continue;
    if (!inB(p.x, p.y) || !R(seen, p.x, p.y)) return false;
  }
  // check 2 — every locked (D) door's key reachable in the base flood.
  let hasLocked = false;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (grid[y][x] === "D") hasLocked = true;
  if (hasLocked && !keys.some((k) => R(base, k.x, k.y))) return false;
  // check 3 — every plate-door has crate + plate reachable in the base flood.
  for (const [id, dp] of doorAt) {
    if (grid[dp.y][dp.x] !== "d") continue;
    const plates = links.filter((l) => l.door === id).map((l) => plateAt.get(l.plate)).filter(Boolean);
    if (!crates.some((cr) => R(base, cr.x, cr.y))) return false;
    if (!plates.some((pl) => R(base, pl.x, pl.y))) return false;
  }
  return true;
}

/* =========================================================================
   Assembly + generateLevel (§5.3/§5.4).
   ========================================================================= */
// Interior main-floor cells (`.`) not already occupied by a set piece, minus
// the spawn pocket — the reachable pool loose enemies/Reaper draw from.
function openFloorCells(grid, cols, rows, occupied, spawn) {
  const key = (x, y) => y * cols + x;
  const inSpawn = (x, y) => x >= spawn.x && x < spawn.x + spawn.w && y >= spawn.y && y < spawn.y + spawn.h;
  const out = [];
  for (let y = 1; y < rows - 1; y++)
    for (let x = 1; x < cols - 1; x++)
      if (grid[y][x] === "." && !occupied.has(key(x, y)) && !inSpawn(x, y)) out.push({ x, y });
  return out;
}

function assembleCandidate(n, rng, archetype, dark) {
  const { cols, rows } = footprint(n);
  const geo = ARCHETYPES[archetype](cols, rows, n, rng);
  const zones = buildZones(cols, rows, geo.player);
  const spawn = zones.find((z) => z.role === "spawn");

  const occupied = new Set();
  const key = (x, y) => y * cols + x;
  occupied.add(key(geo.player.x, geo.player.y));
  occupied.add(key(geo.exit.x, geo.exit.y));
  for (const p of geo.placements) occupied.add(key(p.x, p.y));

  const openFloor = openFloorCells(geo.grid, cols, rows, occupied, spawn);
  const { spawnRules, placements: rosterPlacements } = placeRoster(n, rng, openFloor);

  const placements = [
    { type: "player", x: geo.player.x, y: geo.player.y },
    { type: "exit", x: geo.exit.x, y: geo.exit.y },
    ...geo.placements,
    ...rosterPlacements,
  ];
  const pool = CFG.GEN.music[archetype] || [archetype];
  return {
    id: `night-${n}`, name: `Night ${n} — ${archetype}`,
    props: { dark, music: pick(rng, pool) },
    tiles: gridToTiles(geo.grid),
    zones, placements, links: geo.links, spawnRules,
    cols, rows,
  };
}

// Guaranteed-valid fallback (§5.4): a fully-open arena (no obstacles, no
// doors) so flood-fill trivially reaches everything. Built with a deterministic
// rng so it is reproducible; marked props.fallback for telemetry/tests.
function assembleFallback(n, dark) {
  const rng = makeRng(0x1a11bac0 ^ n);
  const { cols, rows } = footprint(n);
  const grid = makeGrid(cols, rows, ".");
  const player = { x: 2, y: 2 }, exit = { x: cols - 3, y: rows - 3 };
  const zones = buildZones(cols, rows, player);
  const spawn = zones.find((z) => z.role === "spawn");
  const occupied = new Set([player.y * cols + player.x, exit.y * cols + exit.x]);
  const openFloor = openFloorCells(grid, cols, rows, occupied, spawn);
  const { spawnRules, placements: rosterPlacements } = placeRoster(n, rng, openFloor);
  const placements = [
    { type: "player", x: player.x, y: player.y },
    { type: "exit", x: exit.x, y: exit.y },
    ...rosterPlacements,
  ];
  return {
    id: `night-${n}`, name: `Night ${n} — arena (fallback)`,
    props: { dark, music: pick(rng, CFG.GEN.music.arena), fallback: true },
    tiles: gridToTiles(grid), zones, placements, links: [], spawnRules,
    cols, rows,
  };
}

// Test seam (§8.7): force the candidate assembler to return an unsolvable def
// so the fallback path is exercised. Null in production.
let _candidateOverride = null;
export function __setCandidateOverride(fn) { _candidateOverride = fn || null; }

export function generateLevel(n, rng) {
  const dark = pickDark(n, rng);                    // consume rng once, before geometry
  let candidate = null;
  for (let attempt = 0; attempt < CFG.GEN.maxAttempts; attempt++) {
    const sub = makeRng((rng() * 4294967296) >>> 0);            // fresh sub-rng per re-roll
    const archetype = pick(sub, ARCH_NAMES);
    const def = _candidateOverride
      ? _candidateOverride(n, sub, archetype, dark)
      : assembleCandidate(n, sub, archetype, dark);
    if (isSolvable(def)) { candidate = def; break; }
  }
  if (!candidate) {
    candidate = assembleFallback(n, dark);
    console.warn(`[level-generator] night ${n}: no solvable candidate in ${CFG.GEN.maxAttempts} attempts — using arena fallback`);
  }
  G._prevDark = !!candidate.props.dark;             // Q3 guard, unsaved (do NOT serialize)
  return candidate;
}

// props.dark (§5.3, Q3): eligible only from CFG.PLAN.darkProb.beforeNight on,
// never two dark Nights consecutively (reads the unsaved G._prevDark).
function pickDark(n, rng) {
  const dp = CFG.PLAN.darkProb;
  if (n < dp.beforeNight) return false;
  if (dp.noConsecutive && G._prevDark) return false;
  return rng() < dp.prob;
}
