/* test-level-content.js — headless smoke tests for the §8 content evaluators
   (SPEC-LEVEL items 3/9: eligible/budget/roster purity, RAMP eval).

   Exercises the REAL modules (config/level-loader/level-plan), not inlined
   copies. No browser-global stubs needed — this layer touches no
   canvas/audio/document. Run: node test-level-content.js

   (Content moved to level-plan.js at Phase 5 — the geometry/solvability half
   grew level-generator.js past the file-size seam; see STATUS.md.)
*/
import { CFG } from "./src/config.js";
import {
  eligible, budget, buildRoster, evalRamp,
} from "./src/level-plan.js";

let passed = 0, failed = 0;
function check(name, ok) {
  if (ok) { passed++; } else { failed++; console.error(`FAIL: ${name}`); }
}

/* ========================================================================= *
   §8.3 — content purity: for a fixed n, budget + eligible roster are
   identical regardless of any seed. This layer has no seed at all — assert
   it's a pure function of n (calling twice yields identical results).
 * ========================================================================= */
for (const n of [1, 2, 3, 4, 5, 9, 12, 30]) {
  const b1 = budget(n), b2 = budget(n);
  check(`budget(${n}) is pure`, b1 === b2);

  const e1 = [...eligible(n)].sort();
  const e2 = [...eligible(n)].sort();
  check(`eligible(${n}) is pure`, JSON.stringify(e1) === JSON.stringify(e2));

  const r1 = buildRoster(n);
  const r2 = buildRoster(n);
  check(`buildRoster(${n}) is pure`, JSON.stringify(r1) === JSON.stringify(r2));
}

/* ========================================================================= *
   Budget curve: budget(n) matches 24 + 6*(n-1), caps at 120.
 * ========================================================================= */
check("budget(1) == 24", budget(1) === 24);
check("budget(2) == 30", budget(2) === 30);
check("budget(5) == 48", budget(5) === 48);
{
  const { base, perNight, cap } = CFG.PLAN.budget;
  const nAtCap = Math.ceil((cap - base) / perNight) + 1;
  check("budget caps at 120", budget(nAtCap + 20) === cap);
  check("budget formula holds pre-cap", budget(3) === base + perNight * 2);
}

/* ========================================================================= *
   Gate: eligible(2) excludes skeletonShooter; eligible(3) includes it.
 * ========================================================================= */
check("eligible(2) excludes skeletonShooter", !eligible(2).has("skeletonShooter"));
check("eligible(3) includes skeletonShooter", eligible(3).has("skeletonShooter"));
check("eligible(1) includes ghost/skeleton/crate/barrel", (() => {
  const e = eligible(1);
  return e.has("ghost") && e.has("skeleton") && e.has("crate") && e.has("barrel");
})());
check("eligible(1) excludes night-2+ elements", !eligible(1).has("key") && !eligible(1).has("lobber"));
check("eligible(8) excludes reaper (night 9)", !eligible(8).has("reaper"));
check("eligible(9) includes reaper", eligible(9).has("reaper"));

/* ========================================================================= *
   Roster: budget-resolved, non-negative remainder, Reaper only n>=9 and at
   most one, and never exceeds the budget.
 * ========================================================================= */
for (const n of [1, 2, 3, 4, 9, 10, 20]) {
  const { roster, reaper, spentBudget, remaining } = buildRoster(n);
  check(`buildRoster(${n}) spentBudget <= budget(n)`, spentBudget <= budget(n));
  check(`buildRoster(${n}) remaining >= 0`, remaining >= 0);
  check(`buildRoster(${n}) remaining matches budget-spent`, Math.abs(remaining - (budget(n) - spentBudget)) < 1e-9);
  check(`buildRoster(${n}) roster entries have element+asSpawner`, roster.every((r) => typeof r.element === "string" && typeof r.asSpawner === "boolean"));
  if (n < 9) check(`buildRoster(${n}) no reaper before night 9`, reaper === false);
}
check("buildRoster(9)+ may include reaper", buildRoster(9).reaper === true || buildRoster(9).remaining < CFG.PLAN.costs.reaper);
check("buildRoster never emits reaper as a roster entry", buildRoster(20).roster.every((r) => r.element !== "reaper"));
check("buildRoster roster elements are all eligible", (() => {
  const n = 10;
  const elig = eligible(n);
  return buildRoster(n).roster.every((r) => elig.has(r.element));
})());

/* ========================================================================= *
   §8.9 — RAMP eval: steps on 8-Night tiers; mul and add modes; clamps toward
   the limit for negative steps.
 * ========================================================================= */
check("evalRamp(1) tier 0 == base values", (() => {
  const r = evalRamp(1);
  return Object.keys(CFG.RAMP).every((k) => Math.abs(r[k] - CFG.RAMP[k].base) < 1e-9);
})());

check("evalRamp add mode steps linearly within a tier", (() => {
  const r1 = evalRamp(1); // tier 0
  const r9 = evalRamp(9); // tier 1
  const p = CFG.RAMP.shooterStopToShoot; // add mode, positive step
  return Math.abs(r1.shooterStopToShoot - p.base) < 1e-9
    && Math.abs(r9.shooterStopToShoot - (p.base + p.step)) < 1e-9;
})());

check("evalRamp mul mode steps geometrically within a tier", (() => {
  const r1 = evalRamp(1);
  const r9 = evalRamp(9);
  const p = CFG.RAMP.spawnerInterval; // mul mode
  return Math.abs(r1.spawnerInterval - p.base) < 1e-9
    && Math.abs(r9.spawnerInterval - p.base * p.step) < 1e-9;
})());

check("evalRamp same tier (nights 1..8) yields identical values", (() => {
  const r1 = evalRamp(1);
  const r8 = evalRamp(8);
  return JSON.stringify(r1) === JSON.stringify(r8);
})());

check("evalRamp clamps toward limit for negative step (lobberErrorRadius)", (() => {
  const p = CFG.RAMP.lobberErrorRadius; // base 1.5, step -0.25, limit 0.25
  const farFuture = evalRamp(1000).lobberErrorRadius;
  return farFuture === p.limit;
})());

check("evalRamp clamps toward limit for positive add step (shooterStopToShoot)", (() => {
  const p = CFG.RAMP.shooterStopToShoot; // base 0.50, step 0.10, limit 0.90
  const farFuture = evalRamp(1000).shooterStopToShoot;
  return farFuture === p.limit;
})());

check("evalRamp clamps toward limit for mul mode (spawnerInterval)", (() => {
  const p = CFG.RAMP.spawnerInterval; // base 5.0, step 0.90 (shrinking), limit 2.0
  const farFuture = evalRamp(1000).spawnerInterval;
  return farFuture === p.limit;
})());

check("evalRamp never exceeds limit in either direction, across many nights", (() => {
  for (let n = 1; n <= 200; n += 7) {
    const r = evalRamp(n);
    for (const [k, p] of Object.entries(CFG.RAMP)) {
      const withinBound = p.base <= p.limit ? r[k] <= p.limit + 1e-9 : r[k] >= p.limit - 1e-9;
      if (!withinBound) return false;
    }
  }
  return true;
})());

/* ========================================================================= *
   Purity acceptance: no rng/Math.random/Date use in the content functions
   (grepped separately by the acceptance check; asserted here as a smoke
   check that repeated calls truly never diverge across a wide n sweep).
 * ========================================================================= */
check("content functions never diverge across repeated calls (wide n sweep)", (() => {
  for (let n = 1; n <= 50; n++) {
    if (JSON.stringify(buildRoster(n)) !== JSON.stringify(buildRoster(n))) return false;
    if (JSON.stringify(evalRamp(n)) !== JSON.stringify(evalRamp(n))) return false;
  }
  return true;
})());

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
