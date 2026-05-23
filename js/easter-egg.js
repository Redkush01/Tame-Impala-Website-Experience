/**
 * easter-egg.js — Self-contained event system for the "67" event.
 * Decoupled from DOM, Audio, and Visuals.
 * Uses callbacks to communicate state changes to the orchestrator.
 */

/* ── Callbacks ── */
var onStartEvent  = null;
var onUpdateState = null;

/* ── State ── */
var sessionStartTime = 0;
var MIN_SESSION_TIME = 60000; /* 1 minute */
var HORNS_REQUIRED   = 1;
var hornsCount       = 0;
var triggerChance    = 1.0;
var hasTriggered     = false;
var lastCheckTime    = 0;

/* ── Constants ── */
var MIN_SESSION_MS   = 180 * 1000; /* 3 minutes */
var MIN_HORNS        = 1;
var CHECK_INTERVAL   = 1000;      /* 1 second */
var CHANCE_THRESHOLD = 1.0;       /* 100% chance */

/* ── Event Phases ── */
var eventActive   = false;
var eventPhase    = 0;
var eventFade     = 1.0;
var phaseTimeouts = [];

/**
 * Initialize the module with callbacks.
 * @param {Function} startEventCb - Called when event starts: startEvent("67")
 * @param {Function} updateStateCb - Called for state changes: updateState(key, value)
 */
export function init(startEventCb, updateStateCb) {
  onStartEvent     = startEventCb;
  onUpdateState    = updateStateCb;
  sessionStartTime = performance.now();
}

/**
 * Called by orchestrator when a distinct Horns gesture is detected.
 */
export function registerHornsGesture() {
  if (hasTriggered) return;
  hornsCount++;
  console.log("[EasterEgg] Horns registered. Count: " + hornsCount + "/" + MIN_HORNS);
}

/**
 * Orchestrator calls this per frame to evaluate time-based conditions.
 * @param {number} now - current timestamp from performance.now()
 */
export function update(now) {
  if (hasTriggered) {
    if (eventActive) updateEventSequence(now);
    return;
  }

  var elapsed = now - sessionStartTime;
  
  /* Condition 1: Session time >= 4 minutes */
  if (elapsed < MIN_SESSION_MS) return;
  
  /* Condition 2: Horns >= 3 */
  if (hornsCount < MIN_HORNS) return;

  /* Condition 3: Random chance 15% every 30 seconds */
  if (now - lastCheckTime > CHECK_INTERVAL) {
    lastCheckTime = now;
    if (Math.random() <= CHANCE_THRESHOLD) {
      triggerEvent(now);
    }
  }
}

/**
 * Internal trigger logic.
 */
function triggerEvent(now) {
  hasTriggered = true;
  eventActive  = true;
  eventPhase   = 1;
  eventFade    = 1.0;
  console.log("[EasterEgg] ★ EVENT TRIGGERED ★ Phase 1");

  if (onStartEvent)  onStartEvent("67");
  if (onUpdateState) onUpdateState("easterEggActive", true);
  
  emitState();

  /* Phase 2: Revelation after 1s */
  phaseTimeouts.push(setTimeout(function () {
    eventPhase = 2;
    console.log("[EasterEgg] Phase 2 (show 6)");
    emitState();
  }, 1000));

  /* Phase 3: Glitch after 3s */
  phaseTimeouts.push(setTimeout(function () {
    eventPhase = 3;
    console.log("[EasterEgg] Phase 3 (show 6+7)");
    emitState();
  }, 3000));

  /* Phase 4: Fade out after 6s */
  phaseTimeouts.push(setTimeout(function () {
    eventPhase = 4;
    console.log("[EasterEgg] Phase 4 (fade out)");
    emitState();
  }, 6000));

  /* End event after 8s */
  phaseTimeouts.push(setTimeout(function () {
    eventActive = false;
    eventPhase  = 0;
    console.log("[EasterEgg] Event ended.");
    if (onUpdateState) onUpdateState("easterEggActive", false);
    emitState();
    phaseTimeouts = []; /* Release memory */
  }, 8000));
}

/**
 * Handle per-frame updates during the active event.
 * (Used for fading out Phase 4).
 */
function updateEventSequence(now) {
  if (eventPhase === 4) {
    eventFade -= 0.016; /* Roughly fades out in ~1s at 60fps */
    if (eventFade < 0) eventFade = 0;
    emitState();
  }
}

function emitState() {
  if (onUpdateState) {
    onUpdateState("easterEggState", {
      active: eventActive,
      phase: eventPhase,
      fade: eventFade
    });
  }
}
