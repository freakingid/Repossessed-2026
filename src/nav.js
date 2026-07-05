/* =========================================================================
   nav.js — pathfinding infrastructure (SPEC-PATHFINDING). LEAF module: only
   config.js, state.js, world.js, and the blocker-sink seam from
   level-loader.js. Never imports enemies/player/combat/abilities/projectiles
   (D1). findPath (grid A*) is Phase 2 — this phase ships the mask
   predicates, the mask-split occupancy grid, and the dirty/version seam.
   ========================================================================= */
import { CFG } from "./config.js";
import { G } from "./state.js";
import { isWall } from "./world.js";
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
