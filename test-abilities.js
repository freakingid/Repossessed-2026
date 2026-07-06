/* test-abilities.js — headless smoke tests for SPEC-ABILITIES Phase 2, the
   abilities.js FOUNDATION (no Nova/Lightning behaviour yet):
     - addGemEnergy (A6/§3): bar fill / charge banking / discard+clamp
     - updateAbilities(dt): cooldown floor + G.novas lazy-init
     - initAbilities(): cooldown reset + G.novas cleared
     - handler registration side-effect (onNova/onLightning are no-op stubs)
   Exercises the REAL modules, never inlined copies. Pure logic, no canvas.
   abilities.js transitively imports player.js (whose graph touches window only
   inside input.js device glue these tests never call); a minimal defensive
   browser stub is installed anyway, same posture as test-abilities-seams.js.
   Run: node test-abilities.js
*/

// --- Minimal browser-global stubs (defensive; house headless style) ----------
globalThis.window ||= globalThis;
globalThis.document ||= { createElement: () => ({ getContext: () => ({}) }) };
globalThis.AudioContext ||= function () {};

import { CFG } from "./src/config.js";
import { G } from "./src/state.js";
import {
  addGemEnergy,
  initAbilities,
  updateAbilities,
  getCooldowns,
} from "./src/abilities.js";

let passed = 0, failed = 0;
function check(name, ok) {
  if (ok) { passed++; } else { failed++; console.error(`FAIL: ${name}`); }
}

const { barCap, chargeCap } = CFG.ABILITY.nova;   // 100, 2

/* ========================================================================= *
   1. Gem economy — addGemEnergy (A6/§3)
 * ========================================================================= */
{
  // --- credit below cap fills the bar (no charge banked) -------------------
  G.gemEnergy = 0; G.storedCharges = 0;
  addGemEnergy(40);
  check("below cap: bar fills to the credited amount", G.gemEnergy === 40);
  check("below cap: no charge banked", G.storedCharges === 0);

  // exactly-at-cap stays in the bar (algorithm uses > , not >=) ------------
  G.gemEnergy = 0; G.storedCharges = 0;
  addGemEnergy(barCap);                      // → exactly 100
  check("exactly at cap: bar holds barCap, no charge banked",
    G.gemEnergy === barCap && G.storedCharges === 0);

  // --- a credit crossing 100 banks ONE charge, remainder left in the bar ---
  G.gemEnergy = 80; G.storedCharges = 0;
  addGemEnergy(30);                          // 110 → bank 1, remainder 10
  check("crossing cap banks exactly one charge", G.storedCharges === 1);
  check("crossing cap leaves the remainder in the bar", G.gemEnergy === 10);

  // multi-charge in one credit (fill bar + bank both charges) --------------
  G.gemEnergy = 50; G.storedCharges = 0;
  addGemEnergy(165);                         // 215 → bank 2 (−200), remainder 15
  check("large credit banks up to two charges", G.storedCharges === 2);
  check("large credit leaves remainder after banking", G.gemEnergy === 15);

  // --- credits past a full bar + 2 charges are discarded, bar clamps to 100 -
  G.gemEnergy = 90; G.storedCharges = 2;     // already at charge cap
  addGemEnergy(50);                          // 140, cannot bank (charges full) → clamp
  check("overflow past full charges clamps the bar to barCap", G.gemEnergy === barCap);
  check("overflow does not exceed the charge cap", G.storedCharges === chargeCap);

  // a credit that fills the last available charge AND overflows the bar ------
  G.gemEnergy = 60; G.storedCharges = 1;
  addGemEnergy(300);                         // 360 → bank 1 more (=2), 260 left → clamp 100
  check("fills last charge then clamps the overflowing bar",
    G.storedCharges === chargeCap && G.gemEnergy === barCap);

  // pure function of G state: fields untouched except gemEnergy/storedCharges
  G.gemEnergy = 10; G.storedCharges = 0;
  const scoreBefore = G.score;
  addGemEnergy(5);
  check("addGemEnergy touches only the two fuel fields",
    G.gemEnergy === 15 && G.storedCharges === 0 && G.score === scoreBefore);
}

/* ========================================================================= *
   2. initAbilities — cooldowns reset to 0, G.novas cleared
 * ========================================================================= */
{
  G.novas = [{ stale: true }];
  initAbilities();
  check("initAbilities clears G.novas to an empty array",
    Array.isArray(G.novas) && G.novas.length === 0);
  const cd = getCooldowns();
  check("initAbilities resets novaCd to 0", cd.nova === 0);
  check("initAbilities resets lightningCd to 0", cd.lightning === 0);
}

/* ========================================================================= *
   3. updateAbilities(dt) — cooldown tick (floored at 0) + G.novas lazy-init
 * ========================================================================= */
{
  initAbilities();

  // Phase 2: handlers are no-ops so cooldowns cannot be driven non-zero here;
  // the observable contract is that the tick floors at 0 and never goes
  // negative/NaN. The decrement-from-non-zero path is exercised in the Phase
  // 3/4 tests, once onNova/onLightning set the cooldowns.
  updateAbilities(0.5);
  let cd = getCooldowns();
  check("updateAbilities floors novaCd at 0 (stays 0, not negative)", cd.nova === 0);
  check("updateAbilities floors lightningCd at 0 (stays 0, not negative)", cd.lightning === 0);

  // repeated large ticks never underflow past 0
  for (let i = 0; i < 100; i++) updateAbilities(1);
  cd = getCooldowns();
  check("cooldowns never underflow below 0 across many ticks",
    cd.nova === 0 && cd.lightning === 0);

  // lazy-init: updateAbilities restores G.novas if something nulled it
  delete G.novas;
  updateAbilities(0.016);
  check("updateAbilities lazy-inits G.novas to []",
    Array.isArray(G.novas) && G.novas.length === 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
