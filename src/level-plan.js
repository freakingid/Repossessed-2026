/* =========================================================================
   level-plan.js — the CONTENT half of the endless generator (SPEC-LEVEL §5.1/
   §5.2/§5.5). Pure functions of the Night index `n`: eligible(n), budget(n),
   the spawn-budget roster builder, the Plan-filtered spawner table, and
   evalRamp(n). D2: content is a pure function of n — nothing here touches an
   `rng` parameter, wall-clock, or `G`.

   Split from level-generator.js at Phase 5: geometry/placement/solvability
   (level-generator.js, rng-driven) grew past the file-size seam, so the two
   axes now live apart — content (this file, fn of n) vs geometry (the
   generator, fn of rng). See STATUS.md Phase 5.

   evalRamp delegates to level-loader.js's evalRampTable so there is ONE
   implementation of §5.5, not two (one-way import: plan → loader; the loader
   never imports back).
   ========================================================================= */
import { CFG } from "./config.js";
import { evalRampTable } from "./level-loader.js";

/* -------------------------------------------------------------------------
   eligible(n) — union of CFG.PLAN.introductions.elements for every
   introduction with night <= n (SPEC-LEVEL §5.1).
   ------------------------------------------------------------------------- */
export function eligible(n) {
  const out = new Set();
  for (const intro of CFG.PLAN.introductions) {
    if (intro.night <= n) for (const el of intro.elements) out.add(el);
  }
  return out;
}

/* -------------------------------------------------------------------------
   budget(n) — B(n) = min(base + perNight*(n-1), cap) (SPEC-LEVEL §5.1/§5.2).
   ------------------------------------------------------------------------- */
export function budget(n) {
  const { base, perNight, cap } = CFG.PLAN.budget;
  return Math.min(base + perNight * (n - 1), cap);
}

/* -------------------------------------------------------------------------
   Newest tier — elements introduced on the highest `introductions.night`
   that is <= n (SPEC-LEVEL §5.2 "newestTier" weighting). Elements introduced
   on any earlier night share `weights.earlierMix`.
   ------------------------------------------------------------------------- */
function newestTierElements(n) {
  let newestNight = -1;
  for (const intro of CFG.PLAN.introductions) {
    if (intro.night <= n && intro.night > newestNight) newestNight = intro.night;
  }
  const out = new Set();
  if (newestNight >= 0) {
    for (const intro of CFG.PLAN.introductions) {
      if (intro.night === newestNight) for (const el of intro.elements) out.add(el);
    }
  }
  return out;
}

/* -------------------------------------------------------------------------
   buildRoster(n) — abstract, budget-resolved composition (SPEC-LEVEL §5.2).
   Pure function of n: no rng, no zone placement, no coordinates (that is the
   generator's job). Only elements with a CFG.PLAN.costs entry are spawnable
   roster elements (Reaper is a fixed set-piece flag, not part of the costed
   loop — kept separate below to keep its "at most one, n>=9" rule explicit).

   Newest-tier elements are weighted `weights.newestTier` of the mass and all
   earlier-eligible elements share `weights.earlierMix`; within each tier,
   mass is split evenly (a play-feel weighting curve is (proposed) §14.2 —
   this pins the pure-content contract: total remains a fn of n only).
   ------------------------------------------------------------------------- */
export function buildRoster(n) {
  const elig = eligible(n);
  const newest = newestTierElements(n);
  const { costs, weights } = CFG.PLAN;

  // Spawnable roster elements: eligible, costed, and not the Reaper set-piece.
  const spawnable = [...elig].filter((el) => el !== "reaper" && costs[el] !== undefined);
  const newestSpawnable = spawnable.filter((el) => newest.has(el));
  const earlierSpawnable = spawnable.filter((el) => !newest.has(el));

  let remaining = budget(n);
  const roster = [];

  const cheapestCost = (list) => list.reduce(
    (min, el) => Math.min(min, costs[el]), Infinity,
  );

  while (spawnable.length > 0) {
    const cheapest = Math.min(
      cheapestCost(newestSpawnable), cheapestCost(earlierSpawnable),
    );
    if (!Number.isFinite(cheapest) || remaining < cheapest) break;

    const useNewest = newestSpawnable.length > 0
      && (earlierSpawnable.length === 0 || weights.newestTier >= weights.earlierMix);
    const pool = useNewest && newestSpawnable.length > 0 ? newestSpawnable : earlierSpawnable;
    const fallbackPool = pool.length > 0 ? pool : (pool === newestSpawnable ? earlierSpawnable : newestSpawnable);
    const affordable = fallbackPool.filter((el) => costs[el] <= remaining);
    if (affordable.length === 0) break;

    const element = affordable[0];
    const asSpawner = CFG.SPAWNER[element] !== undefined
      || Object.values(CFG.SPAWNER).some((s) => s.table[element] !== undefined);
    roster.push({ element, asSpawner: !!asSpawner });
    remaining -= costs[element];
  }

  const reaper = n >= 9 && remaining >= costs.reaper;
  if (reaper) remaining -= costs.reaper;

  return { roster, reaper, spentBudget: budget(n) - remaining, remaining };
}

/* -------------------------------------------------------------------------
   Spawner enemy tables filtered by eligible(n) (SPEC-LEVEL §5.1) — so a
   spawner's per-frame emit loop (#4) reads a pre-filtered table (e.g. a Bone
   Pile on Night 2 emits only skeletons until skeletonShooter unlocks Night 3).
   ------------------------------------------------------------------------- */
export function eligibleSpawnerTable(variant, n) {
  const spawner = CFG.SPAWNER[variant];
  if (!spawner) return {};
  const elig = eligible(n);
  const out = {};
  for (const [enemy, weight] of Object.entries(spawner.table)) {
    if (elig.has(enemy)) out[enemy] = weight;
  }
  return out;
}

/* -------------------------------------------------------------------------
   evalRamp(n) — the G.ramp snapshot object (SPEC-LEVEL §5.5). Delegates to
   level-loader.js's evalRampTable: one implementation of clampToward/tier,
   not two. Pure — does not touch G itself (the loader's snapshotRamp does).
   ------------------------------------------------------------------------- */
export function evalRamp(n) {
  return evalRampTable(n);
}
