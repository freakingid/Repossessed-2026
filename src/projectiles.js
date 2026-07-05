/* =========================================================================
   projectiles.js — player shots (motion, range, ricochet). First occupant of
   this file; enemy arrows + shrapnel join later behind the same owner-tagged
   Shot shape (SPEC-PLAYER §2, §8). Damage-to-targets is DEFERRED (#4/combat) —
   enemies/barrels don't exist yet; only motion, expiry, and ricochet live here.

   IMPORT DISCIPLINE (§11): imports config/state/world ONLY. It NEVER imports
   player.js — the shot's shooter is a string tag (`owner`), not a back-
   reference. player.js imports the makeShot factory from here (one-way flow).
   ========================================================================= */
import { CFG } from "./config.js";
import { G } from "./state.js";
import { isWall } from "./world.js";

/* ---- Shot factory (§2 shape) ---------------------------------------------
   Produces the canonical Shot: {x,y,vx,vy,r,dmg,traveled,owner,bounce,
   bounceCount}. No ADD extras (wob/danPosAtFire/spawnTime/chainCount/wallsHit).
   Callers (player.js fire hook) supply the resolved velocity, radius, damage,
   owner tag, and Bounce flag. */
export function makeShot({ x, y, vx, vy, r, dmg, owner = "player", bounce = false }) {
  return { x, y, vx, vy, r, dmg, traveled: 0, owner, bounce, bounceCount: 0 };
}

// Does a resting crate occupy tile (tx,ty)? Crates are tile-aligned movable
// blockers (pixel center = tile center). Crates ALWAYS ricochet straight
// projectiles (§7.1.1/§13.23) — barrels do not (they're deferred combat
// objects), so only G.crates is consulted here.
function crateAt(tx, ty) {
  const arr = G.crates;
  if (!arr) return false;
  for (const e of arr)
    if (((e.x / CFG.TILE) | 0) === tx && ((e.y / CFG.TILE) | 0) === ty) return true;
  return false;
}

/* ---- updateShots (§8) ----------------------------------------------------
   Per frame, per shot: integrate, accumulate traveled, ricochet (two sources),
   expire. Owner-agnostic motion (enemy shots will share this loop later); the
   `owner` tag only matters to the fire cap (player.js) and future damage
   attribution.

   Ricochet has TWO sources (§7.1.1):
   - CRATES always ricochet ALL straight projectiles, even a non-bounce shot
     (§13.23). Reflection is per-axis (ADD pattern); owner + dmg retained; range
     is NOT reset. (bounceCount is a Bounce-power-up wall tally — a crate
     ricochet does not increment it, per §8's explicit asymmetry.)
   - The BOUNCE power-up ADDITIONALLY ricochets off walls/tombstones/pillars/
     closed doors (all isWall-solid tiles). Per-axis; range NOT reset;
     bounceCount++.

   A NON-bounce shot reflects off crates but EXPIRES on first wall contact. */
export function updateShots(dt) {
  const shots = G.shots;
  if (!shots) return;
  const TILE = CFG.TILE;
  for (let i = shots.length - 1; i >= 0; i--) {
    const s = shots[i];
    const stepX = s.vx * dt, stepY = s.vy * dt;

    let nx = s.x + stepX, ny = s.y + stepY;
    const tx0 = (s.x / TILE) | 0, ty0 = (s.y / TILE) | 0;
    let bounced = false;

    // x-axis: crate reflects always; wall reflects only under Bounce.
    const nxt = (nx / TILE) | 0;
    if (crateAt(nxt, ty0)) {
      s.vx = -s.vx; nx = s.x + s.vx * dt; bounced = true;
    } else if (s.bounce && isWall(nxt, ty0)) {
      s.vx = -s.vx; nx = s.x + s.vx * dt; bounced = true; s.bounceCount++;
    }

    // y-axis: same policy.
    const nyt = (ny / TILE) | 0;
    if (crateAt(tx0, nyt)) {
      s.vy = -s.vy; ny = s.y + s.vy * dt; bounced = true;
    } else if (s.bounce && isWall(tx0, nyt)) {
      s.vy = -s.vy; ny = s.y + s.vy * dt; bounced = true; s.bounceCount++;
    }

    // Corner case: still inside a reflector after the axis checks — reflect both.
    if (!bounced) {
      const cx = (nx / TILE) | 0, cy = (ny / TILE) | 0;
      if (crateAt(cx, cy)) {
        s.vx = -s.vx; s.vy = -s.vy; nx = s.x + s.vx * dt; ny = s.y + s.vy * dt;
        bounced = true;
      } else if (s.bounce && isWall(cx, cy)) {
        s.vx = -s.vx; s.vy = -s.vy; nx = s.x + s.vx * dt; ny = s.y + s.vy * dt;
        bounced = true; s.bounceCount++;
      }
    }

    s.x = nx; s.y = ny;
    // traveled accumulates the INTENDED step magnitude (range not reset by a
    // bounce — ADD rule); expires at CFG.SHOT.range regardless of source.
    s.traveled += Math.hypot(stepX, stepY);

    // A non-bounce shot ALSO fizzles on first wall/obstacle contact. (Crate
    // contact was already resolved as a ricochet above, so a non-bounce shot
    // never "dies on a crate" — crate tiles aren't isWall-solid anyway.)
    const inWall = isWall((s.x / TILE) | 0, (s.y / TILE) | 0);
    if (s.traveled >= CFG.SHOT.range || (!s.bounce && inWall)) {
      shots.splice(i, 1);
      continue;
    }
  }
}
