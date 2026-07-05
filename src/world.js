/* =========================================================================
   world.js — tile-grid primitives: parse, isWall/blocksLOS, tileCenter, floor
   finders (SPEC-LEVEL §3.1, §4.1 step 2). Ported from add2026 src/world.js,
   with conveyor/destructible tiles removed (Repossessed has neither) and a
   mutable-tile-state resolver seam added for door/plate cells (§3.2).

   Must not import level-loader.js (register-callbacks, avoids the world <->
   level-loader circular import — see STATUS.md).
   ========================================================================= */
import { CFG } from "./config.js";

// map[y][x] holds a TILE CHAR (key into CFG.TILES); "." floor, "#" wall, etc.
// Reassigned only by loadTileGrid.
export let map = [];

// Runtime door-state resolver, registered by level-loader.js (register-
// callbacks pattern — world.js never imports level-loader.js). fn(tx,ty)
// returns the runtime door state for a d/D cell, or null/undefined if that
// cell isn't a door or no resolver is registered yet.
let tileStateResolver = null;
export function registerTileStateResolver(fn) {
  tileStateResolver = fn;
}

function tileDef(tx, ty) { return CFG.TILES[map[ty][tx]]; }

export function isWall(tx, ty) {
  if (tx < 0 || ty < 0 || tx >= CFG.COLS || ty >= CFG.ROWS) return true;
  const ch = map[ty][tx];
  if (tileStateResolver) {
    const state = tileStateResolver(tx, ty);
    if (state) return !state.open;
  }
  const t = CFG.TILES[ch];
  return t ? t.solid : false;
}
export function blocksLOS(tx, ty) {
  if (tx < 0 || ty < 0 || tx >= CFG.COLS || ty >= CFG.ROWS) return true;
  const ch = map[ty][tx];
  if (tileStateResolver) {
    const state = tileStateResolver(tx, ty);
    if (state) return !state.open;
  }
  const t = CFG.TILES[ch];
  return t ? t.blocksLOS : false;
}

// Parse a Level Definition's tile grid (row-major equal-length strings) into
// the runtime `map`, validating rectangularity + known chars, and adopting
// its dimensions as the live world size (CFG.COLS/ROWS). The sole way `map`
// is built. No conveyor bake (SPEC-LEVEL §4.1 step 2 — deleted, not stubbed).
export function loadTileGrid(tiles) {
  if (!Array.isArray(tiles) || tiles.length === 0) throw new Error("loadTileGrid: empty tile grid");
  const cols = tiles[0].length, rows = tiles.length;
  if (cols === 0) throw new Error("loadTileGrid: zero-width grid");
  const next = [];
  for (let y = 0; y < rows; y++) {
    const s = tiles[y];
    if (s.length !== cols) throw new Error(`loadTileGrid: ragged row ${y} (len ${s.length}, expected ${cols})`);
    const row = [];
    for (let x = 0; x < cols; x++) {
      const ch = s[x];
      if (!CFG.TILES[ch]) throw new Error(`loadTileGrid: unknown tile char '${ch}' at ${x},${y}`);
      row.push(ch);
    }
    next.push(row);
  }
  map = next;
  CFG.COLS = cols; CFG.ROWS = rows;
}

// A random interior non-solid tile (tile coords). Optionally at least
// `minDistFromCenter` tiles from the map centre. Falls back to a guaranteed
// interior corner tile so callers always get a placeable, non-wall tile.
export function randomFloorTileTC(minDistFromCenter) {
  const cx = CFG.COLS / 2, cy = CFG.ROWS / 2;
  for (let tries = 0; tries < 400; tries++) {
    const tx = 1 + ((Math.random() * (CFG.COLS - 2)) | 0);
    const ty = 1 + ((Math.random() * (CFG.ROWS - 2)) | 0);
    if (isWall(tx, ty)) continue;
    if (minDistFromCenter && Math.hypot(tx - cx, ty - cy) < minDistFromCenter) continue;
    return { tx, ty };
  }
  // Last resort: scan for any interior floor tile.
  for (let ty = 1; ty < CFG.ROWS - 1; ty++)
    for (let tx = 1; tx < CFG.COLS - 1; tx++)
      if (!isWall(tx, ty)) return { tx, ty };
  return { tx: 1, ty: 1 };
}
export function randomFloorTile(minDistFromCenter) {
  const t = randomFloorTileTC(minDistFromCenter);
  return { x: (t.tx + 0.5) * CFG.TILE, y: (t.ty + 0.5) * CFG.TILE };
}

// ---- Tile helpers used by enemy patrol routing ----
export function tileFloor(tx, ty) {
  return tx > 0 && ty > 0 && tx < CFG.COLS - 1 && ty < CFG.ROWS - 1 && !isWall(tx, ty);
}
export function tileCenter(tx, ty) { return { x: (tx + 0.5) * CFG.TILE, y: (ty + 0.5) * CFG.TILE }; }

/* ---- Collision helpers -------------------------------------------------- */
// Treat moving bodies as AABB (half = radius) for wall resolution.
export function bodyHitsWall(x, y, r) {
  const minX = ((x - r) / CFG.TILE) | 0, maxX = ((x + r) / CFG.TILE) | 0;
  const minY = ((y - r) / CFG.TILE) | 0, maxY = ((y + r) / CFG.TILE) | 0;
  for (let ty = minY; ty <= maxY; ty++)
    for (let tx = minX; tx <= maxX; tx++)
      if (isWall(tx, ty)) return true;
  return false;
}

// Sample along the segment; blocked if any LOS-blocking tile lies between.
export function hasLineOfSight(x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0;
  const steps = Math.ceil(Math.hypot(dx, dy) / (CFG.TILE * 0.4));
  for (let s = 1; s < steps; s++) {
    const t = s / steps;
    const px = x0 + dx * t, py = y0 + dy * t;
    if (blocksLOS((px / CFG.TILE) | 0, (py / CFG.TILE) | 0)) return false;
  }
  return true;
}
