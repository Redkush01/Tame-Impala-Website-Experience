/**
 * gestures.js — Gesture recognition with single-user lock
 *
 * Exports processHands(results) → gesture data object
 * Handles: pinch volume, fist pause, reverb, swipe, horns, wave
 */

function clamp(v, lo, hi) { return Math.min(Math.max(v, lo), hi); }

var DEBUG_MODE = false;

/* ═══════════════════════════════════════════════════════════
   FINGER DETECTION
   ═══════════════════════════════════════════════════════════ */
var TIPS = [4, 8, 12, 16, 20];
var PIPS = [3, 6, 10, 14, 18];

function extendedFingers(lm) {
  var out = [];
  var wrist = lm[0];
  
  /* Thumb (0) */
  var dThumbTip = Math.hypot(lm[4].x - wrist.x, lm[4].y - wrist.y, lm[4].z - wrist.z);
  var dThumbPip = Math.hypot(lm[2].x - wrist.x, lm[2].y - wrist.y, lm[2].z - wrist.z);
  out.push(dThumbTip > dThumbPip * 1.2);

  /* Other fingers (1-4) */
  for (var i = 1; i < 5; i++) {
    var tip = lm[TIPS[i]], pip = lm[PIPS[i]];
    var dTip = Math.hypot(tip.x - wrist.x, tip.y - wrist.y, tip.z - wrist.z);
    var dPip = Math.hypot(pip.x - wrist.x, pip.y - wrist.y, pip.z - wrist.z);
    out.push(dTip > dPip * 1.25);
  }
  return out;
}

function isHornGesture(lm) {
  var e = extendedFingers(lm);
  var score = 0;
  if (e[1]) score++;      /* Index extended */
  if (e[4]) score++;      /* Pinky extended */
  if (!e[2]) score++;     /* Middle closed */
  if (!e[3]) score++;     /* Ring closed */
  
  var isHorns = score >= 3; /* Fuzzy match: 3 out of 4 conditions is enough */
  if (DEBUG_MODE && isHorns) {
    console.log("🤘 Horns Detected (Score " + score + "):", e);
  }
  return isHorns;
}

/* ═══════════════════════════════════════════════════════════
   SINGLE-USER WRIST LOCK (Separated by Left/Right)
   ═══════════════════════════════════════════════════════════ */
var lockedRightWrist = null;
var lockedLeftWrist  = null;
var LOCK_RADIUS      = 0.35;
var LOCK_GRACE_FRAMES = 35;
var lostRightFrames  = 0;
var lostLeftFrames   = 0;

function filterLockedHands(multiLandmarks, multiHandedness) {
  var filteredLm = [];
  var filteredHd = [];
  var rightCandidates = [];
  var leftCandidates = [];

  for (var i = 0; i < multiLandmarks.length; i++) {
    var label = multiHandedness && multiHandedness[i] ? multiHandedness[i].label : null;
    if (label === 'Right') {
      rightCandidates.push({lm: multiLandmarks[i], hd: multiHandedness[i]});
    } else if (label === 'Left') {
      leftCandidates.push({lm: multiLandmarks[i], hd: multiHandedness[i]});
    }
  }

  /* Right Hand Lock */
  var bestRight = null;
  if (rightCandidates.length > 0) {
    if (!lockedRightWrist) {
      bestRight = rightCandidates[0]; /* acquire lock */
    } else {
      var minDistR = Infinity;
      for (var j = 0; j < rightCandidates.length; j++) {
        var wr = rightCandidates[j].lm[0];
        var distR = Math.hypot(wr.x - lockedRightWrist.x, wr.y - lockedRightWrist.y);
        if (distR < minDistR && distR < LOCK_RADIUS) {
          minDistR = distR;
          bestRight = rightCandidates[j];
        }
      }
    }
  }

  if (bestRight) {
    filteredLm.push(bestRight.lm);
    filteredHd.push(bestRight.hd);
    var targetR = bestRight.lm[0];
    if (!lockedRightWrist) lockedRightWrist = {x: targetR.x, y: targetR.y};
    else {
      lockedRightWrist.x += (targetR.x - lockedRightWrist.x) * 0.2;
      lockedRightWrist.y += (targetR.y - lockedRightWrist.y) * 0.2;
    }
    lostRightFrames = 0;
  } else {
    lostRightFrames++;
    if (lostRightFrames > LOCK_GRACE_FRAMES) lockedRightWrist = null;
  }

  /* Left Hand Lock */
  var bestLeft = null;
  if (leftCandidates.length > 0) {
    if (!lockedLeftWrist) {
      bestLeft = leftCandidates[0]; /* acquire lock */
    } else {
      var minDistL = Infinity;
      for (var k = 0; k < leftCandidates.length; k++) {
        var wl = leftCandidates[k].lm[0];
        var distL = Math.hypot(wl.x - lockedLeftWrist.x, wl.y - lockedLeftWrist.y);
        if (distL < minDistL && distL < LOCK_RADIUS) {
          minDistL = distL;
          bestLeft = leftCandidates[k];
        }
      }
    }
  }

  if (bestLeft) {
    filteredLm.push(bestLeft.lm);
    filteredHd.push(bestLeft.hd);
    var targetL = bestLeft.lm[0];
    if (!lockedLeftWrist) lockedLeftWrist = {x: targetL.x, y: targetL.y};
    else {
      lockedLeftWrist.x += (targetL.x - lockedLeftWrist.x) * 0.2;
      lockedLeftWrist.y += (targetL.y - lockedLeftWrist.y) * 0.2;
    }
    lostLeftFrames = 0;
  } else {
    lostLeftFrames++;
    if (lostLeftFrames > LOCK_GRACE_FRAMES) lockedLeftWrist = null;
  }

  return { landmarks: filteredLm, handedness: filteredHd };
}

/* ═══════════════════════════════════════════════════════════
   STATE
   ═══════════════════════════════════════════════════════════ */
var prevRightPos  = null;
var prevLeftPos   = null;
var lastValidRightY = 0.5;
var lastValidLeftY  = 0.5;
var currentVolume = 0;
var fistStopped   = false;

/* Hold+Swipe state machine */
var swipeState        = 'idle';   /* idle → holding → ready → (trigger) */
var holdStartTime     = 0;
var holdStartPos      = null;
var HOLD_DURATION     = 300;      /* ms of stillness before ready */
var HOLD_TOLERANCE    = 0.025;
var SWIPE_THRESHOLD   = 0.10;
var SWIPE_COOLDOWN    = 2000;     /* ms cooldown after swipe */
var swipeCooldownUntil = 0;

/* Wave gesture detection (for easter egg) */
var waveHistory     = [];
var WAVE_WINDOW     = 3500;       /* ms of history to analyze */
var WAVE_MIN_AMP    = 0.05;       /* minimum wrist travel in X */

function detectWaveGesture(leftWristX, rightWristX) {
  var now = performance.now();
  waveHistory.push({ lx: leftWristX, rx: rightWristX, t: now });

  /* Trim old entries (in-place — no new array) */
  var trimIdx = 0;
  while (trimIdx < waveHistory.length && now - waveHistory[trimIdx].t >= WAVE_WINDOW) trimIdx++;
  if (trimIdx > 0) waveHistory.splice(0, trimIdx);
  if (waveHistory.length < 18) return false;

  /* Count direction reversals (peaks) and synchronization */
  var dirChanges   = 0;
  var prevDir      = 0;
  var syncCount    = 0;
  var totalChecked = 0;

  for (var i = 1; i < waveHistory.length; i++) {
    var dlx = waveHistory[i].lx - waveHistory[i - 1].lx;
    var drx = waveHistory[i].rx - waveHistory[i - 1].rx;

    if (Math.abs(dlx) < 0.002) continue;  /* skip noise */
    totalChecked++;

    /* Both hands same direction = sync */
    if (Math.sign(dlx) === Math.sign(drx) && Math.abs(drx) > 0.002) {
      syncCount++;
    }

    var dir = Math.sign(dlx);
    if (dir !== 0 && dir !== prevDir && prevDir !== 0) {
      dirChanges++;
    }
    if (dir !== 0) prevDir = dir;
  }

  var syncRatio = totalChecked > 0 ? syncCount / totalChecked : 0;

  /* Calculate amplitude (total X range of left wrist) */
  var minX = Infinity, maxX = -Infinity;
  for (var j = 0; j < waveHistory.length; j++) {
    if (waveHistory[j].lx < minX) minX = waveHistory[j].lx;
    if (waveHistory[j].lx > maxX) maxX = waveHistory[j].lx;
  }
  var amplitude = maxX - minX;

  /* Need ≥4 direction changes (≥2 full cycles), ≥50% sync, sufficient amplitude */
  return dirChanges >= 4 && syncRatio > 0.45 && amplitude > WAVE_MIN_AMP;
}

/* ═══════════════════════════════════════════════════════════
   MAIN PROCESSING
   ═══════════════════════════════════════════════════════════ */
export function processHands(results) {
  var output = {
    hasHands:       false,
    rightHand:      null,
    leftHand:       null,
    volume:         currentVolume,
    reverbAmount:   0,
    motionSpeed:    0,
    leftSpeed:      0,
    rightSpeed:     0,
    emotion:        0,
    stereoWidth:    0,
    isFist:         false,
    fistJustClosed: false,
    fistJustOpened: false,
    burst:          false,
    isHorns:        false,
    swipeAction:    null,     /* 'reverse' | 'remix' | null */
    swipeState:     'idle',
    swipeReady:     false,
    holdStartPos:   null,
    waveDetected:   false,
    leftY:          lastValidLeftY,
    rightY:         lastValidRightY,
    landmarks:      [],
    openAmount:     0
  };

  /* Apply single-user lock */
  var filtered = filterLockedHands(
    results.multiHandLandmarks,
    results.multiHandedness
  );
  var landmarks  = filtered.landmarks;
  var handedness = filtered.handedness;

  if (landmarks.length === 0) {
    prevRightPos = null;
    prevLeftPos  = null;
    swipeState   = 'idle';
    
    /* Graceful state degradation when no hands detected */
    currentVolume += (0.5 - currentVolume) * 0.05;
    output.volume = currentVolume;
    
    return output;
  }

  output.hasHands  = true;
  output.landmarks = landmarks;

  var rightLand = null, leftLand = null;
  var rightSpeed = 0, leftSpeed = 0;
  var openAmount = 0;

  /* Identify hands */
  for (var i = 0; i < landmarks.length; i++) {
    var label = handedness[i] ? handedness[i].label : 'Right';
    if (label === 'Right') { rightLand = landmarks[i]; output.rightHand = landmarks[i]; }
    else                   { leftLand  = landmarks[i]; output.leftHand  = landmarks[i]; }
  }

  /* ── RIGHT HAND ──────────────────────────────────────── */
  if (rightLand) {
    var wrist    = rightLand[0];
    lastValidRightY = clamp(wrist.y, 0, 1);
    output.rightY = lastValidRightY;
    var thumbTip = rightLand[4];
    var indexTip = rightLand[8];

    /* Fuzzy Fist / Open Hand detection */
    var fingers = extendedFingers(rightLand);
    var closedCount = 0;
    var openCount = 0;
    for (var i = 0; i < 5; i++) {
      if (fingers[i]) openCount++;
      else closedCount++;
    }
    
    var isFist = closedCount >= 3;
    var isOpen = openCount >= 3;

    if (isFist) {
      if (!fistStopped) {
        output.fistJustClosed = true;
        fistStopped = true;
      }
    } else if (isOpen) {
      if (fistStopped) {
        output.fistJustOpened = true;
        fistStopped = false;
      }
    }
    output.isFist = isFist;

    /* Pinch volume (thumb ↔ index distance only) */
    if (!isFist) {
      var pinchDist   = Math.hypot(thumbTip.x - indexTip.x, thumbTip.y - indexTip.y);
      var pinchNorm   = clamp((pinchDist - 0.025) / 0.12, 0, 1);
      var smoothF     = 0.06 + Math.abs(pinchNorm - currentVolume) * 0.14;
      currentVolume  += (pinchNorm - currentVolume) * Math.min(smoothF, 0.25);
    } else {
      currentVolume = 0;
    }
    output.volume = clamp(currentVolume, 0, 1);

    /* Open amount (for burst) */
    /* Inline tip-distance average — no temp arrays */
    var avgTip = (
      Math.hypot(rightLand[4].x - wrist.x, rightLand[4].y - wrist.y) +
      Math.hypot(rightLand[8].x - wrist.x, rightLand[8].y - wrist.y) +
      Math.hypot(rightLand[12].x - wrist.x, rightLand[12].y - wrist.y) +
      Math.hypot(rightLand[16].x - wrist.x, rightLand[16].y - wrist.y) +
      Math.hypot(rightLand[20].x - wrist.x, rightLand[20].y - wrist.y)
    ) / 5;
    openAmount += clamp((avgTip - 0.08) / 0.3, 0, 1);

    /* Speed */
    var rW = { x: wrist.x, y: wrist.y };
    if (prevRightPos) {
      rightSpeed = clamp(Math.hypot(rW.x - prevRightPos.x, rW.y - prevRightPos.y) * 20, 0, 1);
    }
    prevRightPos = rW;

    /* Horns */
    output.isHorns = isHornGesture(rightLand);

    /* ── Hold + Swipe state machine ── */
    var now = performance.now();
    if (now < swipeCooldownUntil) {
      swipeState = 'idle';
    } else if (swipeState === 'idle') {
      if (rightSpeed < 0.05) {
        swipeState    = 'holding';
        holdStartTime = now;
        holdStartPos  = { x: wrist.x, y: wrist.y };
      }
    } else if (swipeState === 'holding') {
      if (rightSpeed > 0.08) {
        swipeState = 'idle';
      } else if (now - holdStartTime > HOLD_DURATION) {
        swipeState   = 'ready';
        holdStartPos = { x: wrist.x, y: wrist.y };
      }
    } else if (swipeState === 'ready') {
      output.swipeReady = true;
      if (holdStartPos && rightSpeed > 0.12) {
        var dx = wrist.x - holdStartPos.x;
        if (Math.abs(dx) > SWIPE_THRESHOLD) {
          output.swipeAction = dx < 0 ? 'reverse' : 'remix';
          swipeState = 'idle';
          swipeCooldownUntil = now + SWIPE_COOLDOWN;
        }
      }
      /* Timeout: if in ready too long, reset */
      if (now - holdStartTime > HOLD_DURATION + 2500) {
        swipeState = 'idle';
      }
    }
  } else {
    // DO NOT wipe prevRightPos immediately, let it persist for a few frames?
    // User requested: "MAI reset al centro, MAI fallback spaziale".
    // We already keep lastValidRightY. But we should also not reset swipeState instantly if it's just a 1-frame drop.
    // However, for simplicity and safety against stuck hold, we can just clear prevRightPos and swipeState when completely lost.
    prevRightPos = null;
    swipeState   = 'idle';
  }

  /* ── LEFT HAND ───────────────────────────────────────── */
  if (leftLand) {
    var lWrist = leftLand[0];
    lastValidLeftY = clamp(lWrist.y, 0, 1);
    output.leftY = lastValidLeftY;
    /* Inline tip-distance average — no temp arrays */
    var spread = (
      Math.hypot(leftLand[8].x - lWrist.x, leftLand[8].y - lWrist.y) +
      Math.hypot(leftLand[12].x - lWrist.x, leftLand[12].y - lWrist.y) +
      Math.hypot(leftLand[16].x - lWrist.x, leftLand[16].y - lWrist.y) +
      Math.hypot(leftLand[20].x - lWrist.x, leftLand[20].y - lWrist.y)
    ) / 4;
    openAmount += clamp((spread - 0.1) / 0.35, 0, 1);

    var lW = { x: lWrist.x, y: lWrist.y };
    if (prevLeftPos) {
      leftSpeed = clamp(Math.hypot(lW.x - prevLeftPos.x, lW.y - prevLeftPos.y) * 20, 0, 1);
    }
    prevLeftPos = lW;

    output.reverbAmount = clamp((leftLand[5].x - leftLand[17].x + 0.18) * 2.6, 0, 1);
  } else {
    prevLeftPos = null;
  }

  /* ── BOTH HANDS ──────────────────────────────────────── */
  if (rightLand && leftLand) {
    if (prevRightPos && prevLeftPos) {
      var wid = clamp(Math.abs(prevLeftPos.x - prevRightPos.x) * 3, 0, 1);
      output.stereoWidth = (prevLeftPos.x - prevRightPos.x) * 0.5 * wid;
    }

    output.burst = (openAmount > 0.9) && (rightSpeed + leftSpeed) / 2 > 0.35;

    /* Wave gesture (easter egg) */
    output.waveDetected = detectWaveGesture(leftLand[0].x, rightLand[0].x);
  }

  output.openAmount  = openAmount;
  output.rightSpeed  = rightSpeed;
  output.leftSpeed   = leftSpeed;
  output.motionSpeed = clamp((rightSpeed + leftSpeed * 1.2) / 2, 0, 1);
  output.emotion     = clamp((output.volume + output.reverbAmount + output.motionSpeed * 1.1) / 3, 0, 1);
  output.swipeState  = swipeState;
  output.holdStartPos = holdStartPos;

  return output;
}
