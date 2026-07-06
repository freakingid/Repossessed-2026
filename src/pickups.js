// pickups.js — SPEC-PICKUPS Phase 2+3.
// Phase 2: factory-decoration. Wraps the loader's inert food/treasure/powerup
// placeholders (§0.4 wrap-and-override, same pattern as enemies.js
// makeSpawner / barrels.js makeBarrel) to attach the one sink field each
// pickup's collect branch reads (D2). `key` is left as the loader's
// placeholder — no value field (§3). Correctness of these overrides depends
// on boot importing level-loader.js before pickups.js (R1) — deferred to the
// integration phase, not resolved here.
// Phase 3: updatePickups(dt) — Magnet pull -> gem age/despawn -> contact
// collection ordered pass (§4), routing each collected pickup into an
// existing sink (addGemEnergy / healPlayer / G.score / G.keys / G.powerups /
// G.magnet) and emitting one pickup:collected event per collect.

import { CFG } from "./config.js";
import { G } from "./state.js";
import { getEntityFactory, registerEntityFactory, emit } from "./level-loader.js";
import { addGemEnergy } from "./abilities.js";
import { healPlayer } from "./player.js";

const loaderFood = getEntityFactory("food");
function makeFood(p) {
  const e = loaderFood(p);
  e.heal = CFG.FOOD[e.kind];
  return e;
}
registerEntityFactory("food", makeFood);

const loaderTreasure = getEntityFactory("treasure");
function makeTreasure(p) {
  const e = loaderTreasure(p);
  e.points = CFG.TREASURE[e.kind];
  return e;
}
registerEntityFactory("treasure", makeTreasure);

const loaderPowerup = getEntityFactory("powerup");
function makePowerup(p) {
  const e = loaderPowerup(p);
  e.power = e.kind;
  return e;
}
registerEntityFactory("powerup", makePowerup);

// --- Phase 3: updatePickups(dt) — Magnet pull -> gem age/despawn -> contact
// collection, single ordered pass (SPEC-PICKUPS §4, R3). Order is load-
// bearing: pull-before-despawn lets an active Magnet win the race against
// the 12s gem clock; despawn-before-contact (within the same reverse pass)
// means an expired gem is spliced silently before it can be collected.

export function updatePickups(dt) {
  if (!G.pickups) return;
  const p = G.player;

  // 1. Magnet pull (gems only, D7).
  if (G.magnet > 0) {
    G.magnet = Math.max(0, G.magnet - dt);
    const range = CFG.PICKUP.magnet.radius * CFG.TILE;
    const step = CFG.PICKUP.magnet.pullSpeed * CFG.TILE * dt;
    for (const g of G.pickups) {
      if (g.type !== "gem") continue;
      const dx = p.x - g.x, dy = p.y - g.y;
      const d = Math.hypot(dx, dy);
      if (d > 0 && d <= range) {
        const move = Math.min(step, d);
        g.x += (dx / d) * move;
        g.y += (dy / d) * move;
      }
    }
  }

  // 2. Contact + despawn, single reverse pass (splices don't skip, R3).
  const rr = p.r + CFG.PICKUP.grab * CFG.TILE;
  for (let i = G.pickups.length - 1; i >= 0; i--) {
    const g = G.pickups[i];

    if (g.type === "gem") {
      if (g.life == null) g.life = 0;   // R2 — lazy seed, dropGems stays untouched
      g.life += dt;
      if (g.life >= CFG.PICKUP.gemDespawn) {
        G.pickups.splice(i, 1);
        continue;
      }
    }

    const dx = p.x - g.x, dy = p.y - g.y;
    if (dx * dx + dy * dy < rr * rr) {
      collectPickup(g);
      G.pickups.splice(i, 1);
    }
  }
}

function collectPickup(g) {
  let amount;
  switch (g.type) {
    case "gem":
      amount = g.value;
      addGemEnergy(amount);
      break;
    case "food":
      amount = g.heal;
      healPlayer(amount);
      break;
    case "treasure":
      amount = g.points;
      G.score += amount;
      break;
    case "key":
      G.keys++;
      break;
    case "powerup":
      if (g.power === "magnet") {           // R5 — branch before the +75 grant
        amount = CFG.PICKUP.magnet.duration;
        G.magnet += amount;
      } else {
        amount = CFG.PICKUP.powerupShots;
        G.powerups[g.power] = (G.powerups[g.power] || 0) + amount;
      }
      break;
  }
  emit("pickup:collected", { type: g.type, kind: g.kind, x: g.x, y: g.y, amount });
}
