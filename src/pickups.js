// pickups.js — SPEC-PICKUPS Phase 2: factory-decoration only.
// Wraps the loader's inert food/treasure/powerup placeholders (§0.4
// wrap-and-override, same pattern as enemies.js makeSpawner / barrels.js
// makeBarrel) to attach the one sink field each pickup's collect branch
// reads (D2). `key` is left as the loader's placeholder — no value field
// (§3). Correctness of these overrides depends on boot importing
// level-loader.js before pickups.js (R1) — deferred to the integration
// phase, not resolved here.

import { CFG } from "./config.js";
import { getEntityFactory, registerEntityFactory } from "./level-loader.js";

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
