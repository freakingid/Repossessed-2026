/* =========================================================================
   state.js — the single mutable game-state container `G`.

   Holds persistent run-state (carried across Nights/loads, SPEC-LEVEL §4.2)
   plus the G.ramp slot (snapshotted at load from CFG.RAMP, §5.5) and the
   unsaved G._prevDark flag (Q3). Transient per-level arrays (shots, enemies,
   spawners, …) are added by the loader in a later phase — not here.
   ========================================================================= */

export const G = {
  // persistent run-state (GDD §2.1, §3.6; SPEC-LEVEL §4.2 "preserved across nights")
  hp: 20,
  maxHp: 20,
  overhealCap: 30,
  gemEnergy: 0,
  storedCharges: 0,
  keys: 0,
  powerups: {},   // { triple: <shots remaining>, big: …, fast: …, bounce: … }  (SPEC-PLAYER §7, S1: spec keys canonical)
  score: 0,
  night: 1,

  // ramp snapshot — filled once per level load from CFG.RAMP (§5.5); never
  // re-read mid-level.
  ramp: {},

  // unsaved: "no two consecutive dark Nights" guard (Q3). Starts false on
  // resume; not serialized.
  _prevDark: false,
};

export function resetRunState() {
  G.hp = G.maxHp;
  G.gemEnergy = 0;
  G.storedCharges = 0;
  G.keys = 0;
  G.powerups = {};
  G.score = 0;
  G.night = 1;
  G._prevDark = false;
}
