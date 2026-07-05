/* =========================================================================
   input.js — device read, mode-lock FSM, pure snapshot derivation
   (SPEC-PLAYER §3). Owns raw device read, the title-screen mode-lock FSM,
   and deriveSnapshot(rawState, mode) -> InputSnapshot.

   Imports config + state ONLY. Never imports player/gameplay (one-way flow,
   §11 risks) — player.js imports this module's snapshot getter, not the
   reverse.
   ========================================================================= */
import { CFG } from "./config.js";
import { G } from "./state.js";

/* ---- Keybind map (remappable seam) --------------------------------------
   Starts as CFG.KEYS; setKeybinds(map) lets a later Options remap UI (#6)
   install a runtime override. Nothing else in this file writes it. */
let keybinds = CFG.KEYS;
export function setKeybinds(map) {
  keybinds = map;
}

/* ---- Pure snapshot derivation --------------------------------------------
   deriveSnapshot is a pure function of (rawState, mode): no reads of
   document/window/performance in here — that's the device-listener glue's
   job. rawState shape (all in world/screen space the caller already
   resolved):
     {
       keys: Set<string> of currently-held KeyboardEvent.code values,
       cursorWorld: {x,y},   // mouse cursor position in world space (cursor + camera)
       playerPos: {x,y},     // world position to aim from
       mouseDown: bool,
       gamepad: null | {
         axes: number[],           // [moveX, moveY, aimX, aimY, ...]
         buttons: boolean[],       // pressed state per index
       },
     }
*/
export function deriveSnapshot(rawState, mode) {
  const deadzone = keybinds.deadzone;
  const useGamepad = mode === "gamepad" && rawState.gamepad;

  const move = useGamepad
    ? gamepadMove(rawState.gamepad, deadzone)
    : keyboardMove(rawState.keys);

  const aim = useGamepad
    ? gamepadAim(rawState.gamepad, deadzone)
    : keyboardAim(rawState);

  const fireHeld = useGamepad
    ? gamepadFireHeld(rawState.gamepad, deadzone)
    : !!rawState.mouseDown;

  const held = useGamepad
    ? padHeld(rawState.gamepad, keybinds.gamepad)
    : kbHeld(rawState.keys, keybinds);

  return {
    move,
    aim,
    fireHeld,
    nova: held.nova,
    lightning: held.lightning,
    pause: held.pause,
    confirm: held.confirm,
    back: held.back,
    mute: held.mute,
    mode,
  };
}

// Keyboard diagonals: two-adjacent-key sum, normalized to unit length
// (ADD §4.1 rule) — magnitude is always 0 or 1, never √2.
function keyboardMove(keys) {
  const m = keybinds.move;
  let x = 0, y = 0;
  if (keys.has(m.left)) x -= 1;
  if (keys.has(m.right)) x += 1;
  if (keys.has(m.up)) y -= 1;
  if (keys.has(m.down)) y += 1;
  const mag = Math.hypot(x, y);
  if (mag === 0) return { x: 0, y: 0 };
  return { x: x / mag, y: y / mag };
}

// Gamepad move: full speed beyond deadzone regardless of stick depth (ADD §4.6).
function gamepadMove(pad, deadzone) {
  const ax = pad.axes[0] || 0, ay = pad.axes[1] || 0;
  const mag = Math.hypot(ax, ay);
  if (mag <= deadzone) return { x: 0, y: 0 };
  return { x: ax / mag, y: ay / mag };
}

// Aim is always present (divergence from ADD's getFireAngle-returns-null):
// keyboard aims toward the cursor (already resolved to world space by the
// caller); falls back to {x:1,y:0} when cursor coincides with the player so
// the vector never carries NaN.
function keyboardAim(rawState) {
  const dx = rawState.cursorWorld.x - rawState.playerPos.x;
  const dy = rawState.cursorWorld.y - rawState.playerPos.y;
  const mag = Math.hypot(dx, dy);
  if (mag === 0) return { x: 1, y: 0 };
  return { x: dx / mag, y: dy / mag };
}

// Gamepad aim: right stick direction past deadzone; holds last-known unit
// vector is the caller's business (player.js), not this pure function's —
// idle stick within the deadzone still returns a unit vector so aim is
// ALWAYS present per the spec (default to facing +x).
function gamepadAim(pad, deadzone) {
  const ax = pad.axes[2] || 0, ay = pad.axes[3] || 0;
  const mag = Math.hypot(ax, ay);
  if (mag <= deadzone) return { x: 1, y: 0 };
  return { x: ax / mag, y: ay / mag };
}

function gamepadFireHeld(pad, deadzone) {
  const ax = pad.axes[2] || 0, ay = pad.axes[3] || 0;
  return Math.hypot(ax, ay) > deadzone;
}

function kbHeld(keys, binds) {
  const asArray = (v) => (Array.isArray(v) ? v : [v]);
  const any = (v) => asArray(v).some((code) => keys.has(code));
  return {
    nova: any(binds.nova),
    lightning: any(binds.lightning),
    pause: any(binds.pause),
    confirm: any(binds.confirm),
    back: any(binds.back),
    mute: any(binds.mute),
  };
}

function padHeld(pad, gamepadBinds) {
  const pressed = (idx) => idx != null && !!pad.buttons[idx];
  const any = (v) => (Array.isArray(v) ? v.some(pressed) : pressed(v));
  const b = gamepadBinds || {};
  return {
    nova: any(b.nova),
    lightning: any(b.lightning),
    pause: any(b.pause),
    confirm: any(b.confirm),
    back: any(b.back),
    mute: any(b.mute),
  };
}

/* ---- Mode-lock FSM (§4.2, reused) ----------------------------------------
   Title screen: Space -> "keyboard" session; A/Start -> "gamepad"; the
   opposing device is ignored until the run returns to the title. newGame()
   clears G.inputMode. Kept as an explicit small FSM, testable without real
   devices — callers drive it with raw title-phase events, not DOM listeners. */
export function lockInputMode(device) {
  G.inputMode = device;
}

export function clearInputMode() {
  G.inputMode = null;
}

export function currentInputMode() {
  return G.inputMode;
}

// A title-phase key/button press only locks a mode when none is locked yet;
// once locked, the opposing device's events are ignored until clearInputMode
// (i.e. a return to the title / newGame()) runs.
export function handleTitleDeviceEvent(device) {
  if (G.inputMode) return;
  lockInputMode(device);
}

/* ---- Device-listener glue (thin, browser-coupled) ------------------------
   Keeps deriveSnapshot fully headless-testable: this section owns the only
   reads of document/window/navigator and writes the internal rawState that
   getSnapshot() feeds through the pure core above. */
const rawState = {
  keys: new Set(),
  cursorWorld: { x: 0, y: 0 },
  playerPos: { x: 0, y: 0 },
  mouseDown: false,
  gamepad: null,
};

export function setPlayerPos(x, y) {
  rawState.playerPos.x = x;
  rawState.playerPos.y = y;
}

export function setCamera(cameraX, cameraY) {
  rawState._cameraX = cameraX;
  rawState._cameraY = cameraY;
}

export function getSnapshot() {
  return deriveSnapshot(rawState, G.inputMode);
}

let _listenersInstalled = false;
export function installDeviceListeners(canvas) {
  if (_listenersInstalled) return;
  _listenersInstalled = true;

  window.addEventListener("keydown", (e) => {
    rawState.keys.add(e.code);
    if (G.inputMode == null) handleTitleDeviceEvent("keyboard");
  });
  window.addEventListener("keyup", (e) => {
    rawState.keys.delete(e.code);
  });

  const target = canvas || window;
  target.addEventListener("mousemove", (e) => {
    const rect = target.getBoundingClientRect ? target.getBoundingClientRect() : { left: 0, top: 0 };
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    rawState.cursorWorld.x = screenX + (rawState._cameraX || 0);
    rawState.cursorWorld.y = screenY + (rawState._cameraY || 0);
  });
  target.addEventListener("mousedown", () => {
    rawState.mouseDown = true;
    if (G.inputMode == null) handleTitleDeviceEvent("keyboard");
  });
  window.addEventListener("mouseup", () => {
    rawState.mouseDown = false;
  });
}

export function pollGamepad() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  const pad = pads && pads[0];
  if (!pad) {
    rawState.gamepad = null;
    return;
  }
  rawState.gamepad = { axes: pad.axes, buttons: pad.buttons.map((b) => b.pressed) };
  if (G.inputMode == null) {
    const anyPressed = rawState.gamepad.buttons.some(Boolean);
    if (anyPressed) handleTitleDeviceEvent("gamepad");
  }
}
