/* test-input.js — headless smoke tests for the §3 INPUT layer
   (SPEC-PLAYER §3, §12 item 1).

   Stubs the browser globals input.js's device-listener glue touches
   (window/navigator), then dynamically imports the real module — never an
   inlined copy of deriveSnapshot. The pure core (deriveSnapshot, the
   mode-lock FSM) needs no canvas/document, only window/navigator for the
   listener-glue functions this file also exercises minimally.
   Run: node test-input.js
*/
let passed = 0, failed = 0;
function check(name, ok) {
  if (ok) { passed++; } else { failed++; console.error(`FAIL: ${name}`); }
}

if (!globalThis.window) {
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
}
if (!globalThis.navigator || !globalThis.navigator.getGamepads) {
  Object.defineProperty(globalThis, "navigator", {
    value: { getGamepads: () => [] },
    configurable: true,
  });
}

const { CFG } = await import("./src/config.js");
const { G } = await import("./src/state.js");
const {
  deriveSnapshot, handleTitleDeviceEvent, lockInputMode, clearInputMode,
  currentInputMode,
} = await import("./src/input.js");

const KEYS = CFG.KEYS.move; // { up:"KeyW", down:"KeyS", left:"KeyA", right:"KeyD" }

function rawKeyboard(heldCodes, extra = {}) {
  return {
    keys: new Set(heldCodes),
    cursorWorld: { x: 0, y: 0 },
    playerPos: { x: 0, y: 0 },
    mouseDown: false,
    gamepad: null,
    ...extra,
  };
}

// --- Diagonal normalize: up+right raw -> move magnitude 1 (not sqrt(2)) ----
{
  const snap = deriveSnapshot(rawKeyboard([KEYS.up, KEYS.right]), "keyboard");
  const mag = Math.hypot(snap.move.x, snap.move.y);
  check("diagonal up+right normalizes to magnitude 1", Math.abs(mag - 1) < 1e-9);
  check("diagonal up+right is NE unit vector", Math.abs(snap.move.x - Math.SQRT1_2) < 1e-9 && Math.abs(snap.move.y + Math.SQRT1_2) < 1e-9);
}

// --- No keys held -> move is exactly {0,0} ---------------------------------
{
  const snap = deriveSnapshot(rawKeyboard([]), "keyboard");
  check("no keys held -> move {0,0}", snap.move.x === 0 && snap.move.y === 0);
}

// --- Opposing keys cancel ---------------------------------------------------
{
  const snap = deriveSnapshot(rawKeyboard([KEYS.left, KEYS.right]), "keyboard");
  check("opposing left+right cancels to {0,0}", snap.move.x === 0 && snap.move.y === 0);
}

// --- Aim always present: idle keyboard still yields a unit aim ------------
{
  const raw = rawKeyboard([], { cursorWorld: { x: 5, y: 0 }, playerPos: { x: 0, y: 0 } });
  const snap = deriveSnapshot(raw, "keyboard");
  const aimMag = Math.hypot(snap.aim.x, snap.aim.y);
  check("aim present while idle", Math.abs(aimMag - 1) < 1e-9);
  check("aim points toward cursor", snap.aim.x > 0.99 && Math.abs(snap.aim.y) < 1e-9);
}

// --- fireHeld false when LMB up, true when down ---------------------------
{
  const rawUp = rawKeyboard([], { mouseDown: false });
  const rawDown = rawKeyboard([], { mouseDown: true });
  check("fireHeld false on LMB up", deriveSnapshot(rawUp, "keyboard").fireHeld === false);
  check("fireHeld true on LMB down", deriveSnapshot(rawDown, "keyboard").fireHeld === true);
}

// --- Gamepad deadzone: |v| < 0.2 -> move {0,0} and fireHeld false ----------
{
  const dz = CFG.KEYS.deadzone;
  const rawBelow = {
    keys: new Set(), cursorWorld: { x: 0, y: 0 }, playerPos: { x: 0, y: 0 }, mouseDown: false,
    gamepad: { axes: [dz * 0.5, 0, dz * 0.5, 0], buttons: [] },
  };
  const snapBelow = deriveSnapshot(rawBelow, "gamepad");
  check("gamepad move below deadzone -> {0,0}", snapBelow.move.x === 0 && snapBelow.move.y === 0);
  check("gamepad fireHeld below deadzone -> false", snapBelow.fireHeld === false);
}

// --- Gamepad >= deadzone -> full-speed move and correct fire gate ----------
{
  const dz = CFG.KEYS.deadzone;
  const rawAbove = {
    keys: new Set(), cursorWorld: { x: 0, y: 0 }, playerPos: { x: 0, y: 0 }, mouseDown: false,
    gamepad: { axes: [0.05, 0.99, 0.9, 0], buttons: [] },
  };
  const snapAbove = deriveSnapshot(rawAbove, "gamepad");
  const mag = Math.hypot(snapAbove.move.x, snapAbove.move.y);
  check("gamepad move at/above deadzone -> unit magnitude regardless of stick depth", Math.abs(mag - 1) < 1e-9);
  check("gamepad fireHeld true when aim stick beyond deadzone", snapAbove.fireHeld === true);
}

// --- Mode lock: gamepad button presses ignored by deriveSnapshot when mode
// is "keyboard" (deriveSnapshot only reads the gamepad branch under
// mode==="gamepad"; verify keyboard mode never touches gamepad state). ------
{
  const raw = {
    keys: new Set([KEYS.up]),
    cursorWorld: { x: 0, y: 0 }, playerPos: { x: 0, y: 0 }, mouseDown: false,
    gamepad: { axes: [1, 1, 1, 1], buttons: [true, true, true] },
  };
  const snap = deriveSnapshot(raw, "keyboard");
  check("mode lock: keyboard mode ignores gamepad axes for move", snap.move.y === -1 && snap.move.x === 0);
  check("mode lock: keyboard mode ignores gamepad for fireHeld", snap.fireHeld === false);
}

// --- Mode-lock FSM: title device event only locks once; newGame() clears --
{
  clearInputMode();
  check("mode starts unlocked", currentInputMode() == null);
  handleTitleDeviceEvent("keyboard");
  check("first device event locks keyboard", currentInputMode() === "keyboard");
  handleTitleDeviceEvent("gamepad");
  check("opposing device ignored once locked", currentInputMode() === "keyboard");
  clearInputMode();
  check("clearInputMode (newGame seam) clears the lock", currentInputMode() == null);
  handleTitleDeviceEvent("gamepad");
  check("gamepad can lock after a clear", currentInputMode() === "gamepad");
  clearInputMode();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
