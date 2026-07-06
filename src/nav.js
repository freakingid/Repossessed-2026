/* =========================================================================
   nav.js — pathfinding infrastructure (SPEC-PATHFINDING). LEAF module: only
   config.js, state.js, world.js, and the blocker-sink seam from
   level-loader.js. Never imports enemies/player/combat/abilities/projectiles
   (D1). Ships the mask predicates, the mask-split occupancy grid, and the
   dirty/version seam (Phase 1) plus the grid-A* findPath (Phase 2).
   ========================================================================= */
import { CFG } from "./config.js";
import { G } from "./state.js";
import { isWall, tileCenter } from "./world.js";
import { registerBlockerSink } from "./level-loader.js";

export const NAV_MASK = { GROUND: "ground", PHANTOM: "phantom" };

let occupancyDirty = true;
let navVersion = 0;
const dirtyTiles = new Set();
let occGround = new Set();
let occPhantom = new Set();

function pack(tx, ty) { return ty * CFG.COLS + tx; }

// Occupancy is DERIVED from the live G movable arrays on each rebuild (D3) —
// never an incremental list built from registerBlocker calls, which would go
// stale on crate-move/barrel-destroy (R2; no unregister/re-register exists).
function rebuild() {
  occGround = new Set();
  occPhantom = new Set();
  for (const e of (G.crates || [])) {
    if (!e.blocks) continue;
    const k = pack((e.x / CFG.TILE) | 0, (e.y / CFG.TILE) | 0);
    occGround.add(k);
    occPhantom.add(k);
  }
  for (const e of (G.barrels || [])) {
    if (!e.blocks) continue;
    const k = pack((e.x / CFG.TILE) | 0, (e.y / CFG.TILE) | 0);
    occGround.add(k);
    occPhantom.add(k);
  }
  for (const e of (G.spawners || [])) {
    if (!e.blocks) continue;
    // Spawner: GROUND only (Q2 baseline) — static like terrain to PHANTOM,
    // which passes through everything but movable objects.
    occGround.add(pack((e.x / CFG.TILE) | 0, (e.y / CFG.TILE) | 0));
  }
  occupancyDirty = false;
}

function outOfBounds(tx, ty) {
  return tx < 0 || ty < 0 || tx >= CFG.COLS || ty >= CFG.ROWS;
}

// The mask predicate (D2). GROUND reads doors/walls/OOB live from
// world.isWall (R3 — do not duplicate door state into occupancy); PHANTOM
// bypasses isWall entirely (walls/doors are passable to the Reaper) and so
// needs its own OOB guard (R4).
export function isNavBlocked(tx, ty, mask) {
  if (occupancyDirty) rebuild();
  if (mask === NAV_MASK.PHANTOM) {
    return outOfBounds(tx, ty) || occPhantom.has(pack(tx, ty));
  }
  return isWall(tx, ty) || occGround.has(pack(tx, ty));
}

function invalidate() {
  occupancyDirty = true;
  navVersion++;
}

export function getNavVersion() { return navVersion; }

export function consumeDirtyTiles() {
  const out = [];
  for (const k of dirtyTiles) out.push({ tx: k % CFG.COLS, ty: (k / CFG.COLS) | 0 });
  dirtyTiles.clear();
  return out;
}

// Seam fill (§4). registerBlocker/markDirty are consumed as invalidation
// signals ONLY (D3) — nav reads nothing off the entity handed to
// registerBlocker; it is already in its G array by the time this fires, so
// the next rebuild sees it.
const navBlockerSink = {
  registerBlocker(_entity) { invalidate(); },
  markDirty(tile) {
    dirtyTiles.add(pack(tile.tx, tile.ty));
    invalidate();
  },
};

export function installNav() { registerBlockerSink(navBlockerSink); }

// Grid A* (findPath) — Phase 2 (SPEC-PATHFINDING §5). 8-directional, octile
// heuristic, corner-cut prevention keyed to the STEP'S OWN mask (R1), and a
// total-order tie-break (D7) for deterministic paths. Built entirely on
// isNavBlocked — it never hardcodes world.isWall, which is what would silently
// make PHANTOM obey walls or let GROUND squeeze a wall corner.
const DIRS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],    // orthogonal (cost 1)
  [1, 1], [1, -1], [-1, 1], [-1, -1],  // diagonal   (cost CFG.NAV.diagonalCost)
];

// findPath(sx,sy,gx,gy,mask): pixels in. -> Path (>=1 waypoint) | [] (start
// tile === goal tile) | null (goal blocked, or no route). Each waypoint is
// { tx, ty, x, y } — tile identity AND pixel center (D5/R5), start-exclusive
// and goal-inclusive.
export function findPath(sx, sy, gx, gy, mask) {
  const T = CFG.TILE, COLS = CFG.COLS;
  const sTx = (sx / T) | 0, sTy = (sy / T) | 0;
  const gTx = (gx / T) | 0, gTy = (gy / T) | 0;

  if (sTx === gTx && sTy === gTy) return [];        // already on the goal tile
  if (isNavBlocked(gTx, gTy, mask)) return null;    // goal unreachable (#4 direct-steers, Q4)
  // The START tile is always expandable even if blocked (the navigator stands
  // there; a crate may have been dropped onto it) — never early-return on it.

  const diag = CFG.NAV.diagonalCost;
  const startKey = pack(sTx, sTy);
  const goalKey = pack(gTx, gTy);

  // Octile heuristic — admissible + consistent for the {1, √2} cost model.
  function heuristic(tx, ty) {
    const adx = Math.abs(gTx - tx), ady = Math.abs(gTy - ty);
    return (adx + ady) + (diag - 2) * Math.min(adx, ady);
  }

  const gScore = new Map([[startKey, 0]]);   // absent => the finite 1e9 sentinel (D6)
  const cameFrom = new Map();
  const open = [startKey];
  const inOpen = new Set([startKey]);
  const closed = new Set();

  while (open.length > 0) {
    // Pop min by (f, then h, then packed key) — a total order for reproducibility (D7).
    let bi = 0, bk = open[0];
    let bTx = bk % COLS, bTy = (bk / COLS) | 0;
    let bh = heuristic(bTx, bTy);
    let bf = gScore.get(bk) + bh;
    for (let i = 1; i < open.length; i++) {
      const k = open[i];
      const tx = k % COLS, ty = (k / COLS) | 0;
      const h = heuristic(tx, ty);
      const f = gScore.get(k) + h;
      if (f < bf || (f === bf && (h < bh || (h === bh && k < bk)))) {
        bi = i; bk = k; bTx = tx; bTy = ty; bh = h; bf = f;
      }
    }
    open[bi] = open[open.length - 1]; open.pop();
    inOpen.delete(bk);

    if (bk === goalKey) {
      const path = [];
      let cur = bk;
      while (cur !== startKey) {
        const tx = cur % COLS, ty = (cur / COLS) | 0;
        const c = tileCenter(tx, ty);
        path.push({ tx, ty, x: c.x, y: c.y });
        cur = cameFrom.get(cur);
      }
      path.reverse();
      return path;
    }
    closed.add(bk);

    const x = bTx, y = bTy;
    for (let d = 0; d < DIRS.length; d++) {
      const dx = DIRS[d][0], dy = DIRS[d][1];
      const nx = x + dx, ny = y + dy;
      const diagonal = dx !== 0 && dy !== 0;
      if (diagonal) {
        // Corner-cut prevention (R1): a diagonal is allowed only if BOTH shared
        // orthogonals AND the destination are passable UNDER THIS MASK. GROUND
        // tests wall+door+object; PHANTOM tests object-only.
        if (isNavBlocked(nx, y, mask)) continue;
        if (isNavBlocked(x, ny, mask)) continue;
        if (isNavBlocked(nx, ny, mask)) continue;
      } else if (isNavBlocked(nx, ny, mask)) {
        continue;
      }
      const nk = pack(nx, ny);
      if (closed.has(nk)) continue;
      const tentative = gScore.get(bk) + (diagonal ? diag : 1);
      const prev = gScore.has(nk) ? gScore.get(nk) : 1e9;
      if (tentative < prev) {
        cameFrom.set(nk, bk);
        gScore.set(nk, tentative);
        if (!inOpen.has(nk)) { open.push(nk); inOpen.add(nk); }
      }
    }
  }
  return null;   // open set exhausted, goal never reached
}
