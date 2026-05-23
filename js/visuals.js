
/* ── Grid Constants ── */
var CELL_SIZE = 18;
var COLS = 0;
var ROWS = 0;

/* ── Canvas State ── */
var canvas = null;
var ctx    = null;
var video  = null;

/* ── Field Arrays (pre-allocated, zero GC) ── */
var fieldVx = null;
var fieldVy = null;
var fieldDensity = null;
var tmpVx = null;
var tmpVy = null;
var tmpDensity = null;

/* ── Smoothed Audio ── */
var smoothedVolume = 0;
var smoothedReverb = 0;
var noiseTime = 0;

/* ── UI Overlay State ── */
var flashText = "";
var flashAlpha = 0;

/* ── Vortex Disturbances (horns / shockwaves) ── */
var vortices = [];
var MAX_VORTICES = 6;

/* ── Body Presence State ── */
var bodyState = {
  right: { x: null, y: null, vx: 0, vy: 0, alpha: 0, holdCharge: 0 },
  left:  { x: null, y: null, vx: 0, vy: 0, alpha: 0, holdCharge: 0 }
};

/* ═══════════════════════════════════════════════════════
   INIT & RESIZE
   ═══════════════════════════════════════════════════════ */

export function init(canvasElement, videoElement) {
  canvas = canvasElement;
  ctx    = canvas.getContext('2d');
  video  = videoElement;
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
}

export function resizeCanvas() {
  if (!canvas || !video) return;
  canvas.width  = video.videoWidth  || window.innerWidth;
  canvas.height = video.videoHeight || window.innerHeight;
  allocateField();
}

function allocateField() {
  COLS = Math.ceil(canvas.width / CELL_SIZE);
  ROWS = Math.ceil(canvas.height / CELL_SIZE);
  var size = COLS * ROWS;
  fieldVx      = new Float32Array(size);
  fieldVy      = new Float32Array(size);
  fieldDensity = new Float32Array(size);
  tmpVx        = new Float32Array(size);
  tmpVy        = new Float32Array(size);
  tmpDensity   = new Float32Array(size);
}

/* ═══════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════ */

function I(col, row) { return row * COLS + col; }

/* Cheap layered-sine noise (Perlin approximation) */
function noise2d(x, y, t) {
  return Math.sin(x * 0.31 + t) * Math.cos(y * 0.37 + t * 0.71) * 0.45
       + Math.sin(x * 0.73 - t * 0.53) * Math.cos(y * 0.19 + t * 1.07) * 0.3
       + Math.sin(x * 1.17 + y * 0.83 + t * 0.29) * 0.15;
}

/* ═══════════════════════════════════════════════════════
   FORCE INJECTION
   ═══════════════════════════════════════════════════════ */

function injectForce(cx, cy, fx, fy, radius, densAmt) {
  var r = Math.ceil(radius);
  var r2 = radius * radius;
  var c0 = Math.max(0, Math.round(cx) - r);
  var c1 = Math.min(COLS - 1, Math.round(cx) + r);
  var r0y = Math.max(0, Math.round(cy) - r);
  var r1y = Math.min(ROWS - 1, Math.round(cy) + r);

  for (var gy = r0y; gy <= r1y; gy++) {
    var dy = gy - cy;
    for (var gx = c0; gx <= c1; gx++) {
      var dx = gx - cx;
      var d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      var falloff = 1.0 - d2 / r2;
      falloff *= falloff;
      var i = I(gx, gy);
      fieldVx[i] += fx * falloff;
      fieldVy[i] += fy * falloff;
      fieldDensity[i] += densAmt * falloff;
    }
  }
}

function injectVortex(cx, cy, strength, radius) {
  var r = Math.ceil(radius);
  var r2 = radius * radius;
  var c0 = Math.max(0, Math.round(cx) - r);
  var c1 = Math.min(COLS - 1, Math.round(cx) + r);
  var r0y = Math.max(0, Math.round(cy) - r);
  var r1y = Math.min(ROWS - 1, Math.round(cy) + r);

  for (var gy = r0y; gy <= r1y; gy++) {
    var dy = gy - cy;
    for (var gx = c0; gx <= c1; gx++) {
      var dx = gx - cx;
      var d2 = dx * dx + dy * dy;
      if (d2 > r2 || d2 < 0.5) continue;
      var dist = Math.sqrt(d2);
      var falloff = 1.0 - dist / radius;
      var i = I(gx, gy);
      fieldVx[i] += (-dy / dist) * strength * falloff;
      fieldVy[i] += ( dx / dist) * strength * falloff;
      fieldDensity[i] += Math.abs(strength) * falloff * 0.4;
    }
  }
}

/* ═══════════════════════════════════════════════════════
   PUBLIC: SHOCKWAVE / VORTEX TRIGGER
   ═══════════════════════════════════════════════════════ */

export function triggerHornsShockwave(x, y) {
  if (vortices.length >= MAX_VORTICES) vortices.shift();
  vortices.push({ x: x, y: y, strength: 4.0, radius: 4, life: 1.0 });
}

/* ═══════════════════════════════════════════════════════
   SIMULATION STEP
   ═══════════════════════════════════════════════════════ */

function stepSimulation(gestureData) {
  var size = COLS * ROWS;
  var vol = gestureData.volume || 0;
  var reverb = gestureData.reverbAmount || 0;
  smoothedVolume += (vol - smoothedVolume) * 0.12;
  smoothedReverb += (reverb - smoothedReverb) * 0.1;
  noiseTime += 0.018;

  /* ── 1. Base noise (ambient ocean) ── */
  var nStr = 0.08 + smoothedVolume * 0.15;
  for (var row = 0; row < ROWS; row++) {
    for (var col = 0; col < COLS; col++) {
      var i = I(col, row);
      var nx = noise2d(col * 0.14, row * 0.14, noiseTime);
      var ny = noise2d(col * 0.14 + 97, row * 0.14 + 97, noiseTime * 0.83);
      fieldVx[i] += nx * nStr;
      fieldVy[i] += ny * nStr;
      fieldDensity[i] += (Math.abs(nx) + Math.abs(ny)) * 0.003;
    }
  }

  /* ── 2. Hand forces ── */
  var activeHands = [];
  if (gestureData.rightHand) activeHands.push({ lm: gestureData.rightHand, isRight: true, speed: gestureData.rightSpeed || 0 });
  if (gestureData.leftHand) activeHands.push({ lm: gestureData.leftHand, isRight: false, speed: gestureData.leftSpeed || 0 });

  if (activeHands.length > 0) {
    for (var h = 0; h < activeHands.length; h++) {
      var lm = activeHands[h].lm;
      var isRight = activeHands[h].isRight;
      var speed = activeHands[h].speed;

      /* Palm center → grid coords */
      var px = lm[9].x * canvas.width / CELL_SIZE;
      var py = lm[9].y * canvas.height / CELL_SIZE;

      /* Direction from wrist(0) to palm(9) */
      var wx = lm[0].x * canvas.width / CELL_SIZE;
      var wy = lm[0].y * canvas.height / CELL_SIZE;
      var dx = px - wx;
      var dy = py - wy;
      var dLen = Math.hypot(dx, dy);
      if (dLen > 0.01) { dx /= dLen; dy /= dLen; }

      /* Force magnitude: presence + motion */
      var fMag = 0.3 + speed * 6;
      var fx = dx * fMag;
      var fy = dy * fMag;

      /* L/R differentiation:
         Right = tight radius, strong transients
         Left  = wide radius, smooth diffusion */
      var fRadius = isRight ? 5 : 9;
      var dInject = isRight ? (0.2 + speed * 1.5) : (0.4 + speed * 0.6);

      injectForce(px, py, fx, fy, fRadius, dInject);

      /* Fast swipe → shockwave blast */
      if (speed > 0.18) {
        injectForce(px, py, fx * 2.5, fy * 2.5, fRadius + 3, speed * 2);
      }

      /* Hold Gesture → Fluid Compression / Magnetize */
      if (isRight && (gestureData.swipeState === 'holding' || gestureData.swipeState === 'ready')) {
        /* Inject negative divergence (pulling fluid inward) or just high density to simulate compression */
        injectForce(px, py, 0, 0, fRadius * 1.5, 0.4);
      }

      /* Pinch → local density increase */
      var openAmt = gestureData.openAmount || 0.5;
      if (openAmt < 0.35) {
        injectForce(px, py, 0, 0, 3, (1 - openAmt) * 0.6);
      }
    }
  }

  /* ── 3. Vortex disturbances (horns) ── */
  for (var v = vortices.length - 1; v >= 0; v--) {
    var vt = vortices[v];
    var vgx = vt.x * canvas.width / CELL_SIZE;
    var vgy = vt.y * canvas.height / CELL_SIZE;
    injectVortex(vgx, vgy, vt.strength * vt.life, vt.radius);
    vt.radius += 0.8;
    vt.life -= 0.025;
    if (vt.life <= 0) vortices.splice(v, 1);
  }

  /* ── 4. Diffusion (1 pass, 4-neighbor average) ── */
  var diffRate = 0.12 + smoothedReverb * 0.18;
  for (var row = 0; row < ROWS; row++) {
    for (var col = 0; col < COLS; col++) {
      var i = I(col, row);
      var svx = fieldVx[i], svy = fieldVy[i], sd = fieldDensity[i];
      var cnt = 1;

      if (col > 0)        { var n = I(col-1, row); svx += fieldVx[n]; svy += fieldVy[n]; sd += fieldDensity[n]; cnt++; }
      if (col < COLS - 1) { var n = I(col+1, row); svx += fieldVx[n]; svy += fieldVy[n]; sd += fieldDensity[n]; cnt++; }
      if (row > 0)        { var n = I(col, row-1); svx += fieldVx[n]; svy += fieldVy[n]; sd += fieldDensity[n]; cnt++; }
      if (row < ROWS - 1) { var n = I(col, row+1); svx += fieldVx[n]; svy += fieldVy[n]; sd += fieldDensity[n]; cnt++; }

      tmpVx[i]      = fieldVx[i]      + (svx / cnt - fieldVx[i])      * diffRate;
      tmpVy[i]      = fieldVy[i]      + (svy / cnt - fieldVy[i])      * diffRate;
      tmpDensity[i] = fieldDensity[i]  + (sd  / cnt - fieldDensity[i]) * diffRate;
    }
  }
  /* Swap */
  var s; s = fieldVx; fieldVx = tmpVx; tmpVx = s;
        s = fieldVy; fieldVy = tmpVy; tmpVy = s;
        s = fieldDensity; fieldDensity = tmpDensity; tmpDensity = s;

  /* ── 5. Advection (semi-Lagrangian) ── */
  for (var row = 0; row < ROWS; row++) {
    for (var col = 0; col < COLS; col++) {
      var i = I(col, row);
      var sc = col - fieldVx[i] * 0.45;
      var sr = row - fieldVy[i] * 0.45;

      sc = Math.max(0.5, Math.min(COLS - 1.5, sc));
      sr = Math.max(0.5, Math.min(ROWS - 1.5, sr));

      var c0 = sc | 0, r0 = sr | 0;
      var c1 = c0 + 1, r1 = r0 + 1;
      var fc = sc - c0, fr = sr - r0;
      var w00 = (1 - fc) * (1 - fr), w10 = fc * (1 - fr);
      var w01 = (1 - fc) * fr,       w11 = fc * fr;

      var i00 = I(c0, r0), i10 = I(c1, r0);
      var i01 = I(c0, r1), i11 = I(c1, r1);

      tmpVx[i]      = w00*fieldVx[i00] + w10*fieldVx[i10] + w01*fieldVx[i01] + w11*fieldVx[i11];
      tmpVy[i]      = w00*fieldVy[i00] + w10*fieldVy[i10] + w01*fieldVy[i01] + w11*fieldVy[i11];
      tmpDensity[i] = w00*fieldDensity[i00] + w10*fieldDensity[i10] + w01*fieldDensity[i01] + w11*fieldDensity[i11];
    }
  }
  s = fieldVx; fieldVx = tmpVx; tmpVx = s;
  s = fieldVy; fieldVy = tmpVy; tmpVy = s;
  s = fieldDensity; fieldDensity = tmpDensity; tmpDensity = s;

  /* ── 6. Damping ── */
  for (var i = 0; i < size; i++) {
    fieldVx[i] *= 0.965;
    fieldVy[i] *= 0.965;
    fieldDensity[i] *= 0.975;
    if (fieldDensity[i] > 2.5) fieldDensity[i] = 2.5;
  }
}

/* ═══════════════════════════════════════════════════════
   RENDER: BODY PRESENCE LAYER
   ═══════════════════════════════════════════════════════ */

function drawBodyPresence(gestureData) {
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  var volExp = smoothedVolume * 15;
  
  /* Gradual degrade of presence alpha (no snap to center/invisible) */
  bodyState.right.alpha = Math.max(0, bodyState.right.alpha - 0.05);
  bodyState.left.alpha = Math.max(0, bodyState.left.alpha - 0.05);
  
  var activeHands = [];
  if (gestureData.rightHand) activeHands.push({ lm: gestureData.rightHand, isRight: true });
  if (gestureData.leftHand) activeHands.push({ lm: gestureData.leftHand, isRight: false });

  if (activeHands.length > 0) {
    for (var i = 0; i < activeHands.length; i++) {
      var lm = activeHands[i].lm;
      var isRight = activeHands[i].isRight;
      var state = isRight ? bodyState.right : bodyState.left;
      
      state.alpha = Math.min(1.0, state.alpha + 0.2);
      
      /* Anchored to Palm (Landmark 9) */
      var tx = lm[9].x * canvas.width;
      var ty = lm[9].y * canvas.height;
      
      /* Lerp for spatial mass illusion (delay) */
      var lerpSpeed = isRight ? 0.35 : 0.2; /* Destra più reattiva, Sinistra più fluida */
      
      if (state.x === null) {
        state.x = tx;
        state.y = ty;
      } else {
        state.vx = (tx - state.x) * lerpSpeed;
        state.vy = (ty - state.y) * lerpSpeed;
        state.x += state.vx;
        state.y += state.vy;
      }
    }
  }
  
  /* Update and render both hands if they have any opacity */
  var sides = ['left', 'right'];
  for (var s = 0; s < sides.length; s++) {
    var side = sides[s];
    var state = bodyState[side];
    var isRight = side === 'right';
    
    if (state.x === null || state.alpha <= 0.01) continue;
    
    /* Hold state tracking */
    var isHolding = isRight && (gestureData.swipeState === 'holding' || gestureData.swipeState === 'ready');
    state.holdCharge += ((isHolding ? 1.0 : 0.0) - state.holdCharge) * 0.1;
    
    /* Velocity deformation */
    var velMag = Math.hypot(state.vx, state.vy);
    var stretch = 1.0 + Math.min(0.5, velMag * 0.03);
    var angle = Math.atan2(state.vy, state.vx);
    
    /* Palette */
    var rColor = { r: 0, g: 190, b: 230 };
    var lColor = { r: 210, g: 0, b: 140 };
    var baseColor = isRight ? rColor : lColor;
    var cStr = baseColor.r + ',' + baseColor.g + ',' + baseColor.b;
    
    /* Hold Viscous Pulsing */
    var hc = state.holdCharge;
    var pulse = hc > 0.01 ? Math.sin(performance.now() * 0.002) * 0.15 * hc : 0;
    
    var radius = 60 + volExp + (isRight ? 0 : 20);
    radius += hc * 30 + pulse * 20;
    
    ctx.save();
    ctx.translate(state.x, state.y);
    if (velMag > 2) ctx.rotate(angle);
    ctx.scale(stretch, 1.0);
    
    /* Energetic Presence Mask (Soft Gaussian Blob) */
    var grad = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
    
    var lerp = function(a, b, t) { return a + (b - a) * t; };
    
    /* Color Interpolation: Idle -> Psychedelic Liquid Hold */
    var coreR = lerp(255, 88, hc) | 0;
    var coreG = lerp(255, 42, hc) | 0;
    var coreB = lerp(255, 140, hc) | 0;
    
    var midR = lerp(baseColor.r, 140, hc) | 0;
    var midG = lerp(baseColor.g, 70, hc) | 0;
    var midB = lerp(baseColor.b, 220, hc) | 0;
    
    var edgeR = lerp(0, 210, hc) | 0;
    var edgeG = lerp(0, 120, hc) | 0;
    var edgeB = lerp(0, 255, hc) | 0;
    
    /* Intensity / Viscosity */
    var coreA = lerp(0.5, 0.85 + pulse, hc) * state.alpha;
    var midA  = lerp(0.35, 0.55 + pulse * 0.8, hc) * state.alpha;
    var accentA = lerp(0, 0.25 + pulse * 0.5, hc) * state.alpha;
    var edgeA = lerp(0, 0.15, hc) * state.alpha;
    
    grad.addColorStop(0, 'rgba(' + coreR + ',' + coreG + ',' + coreB + ',' + coreA + ')');
    grad.addColorStop(0.3, 'rgba(' + midR + ',' + midG + ',' + midB + ',' + midA + ')');
    
    if (hc > 0.05) {
      grad.addColorStop(0.65, 'rgba(255, 120, 220, ' + accentA + ')');
    }
    
    grad.addColorStop(1, 'rgba(' + edgeR + ',' + edgeG + ',' + edgeB + ',' + edgeA + ')');
    
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(0, 0, radius, radius * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  
  ctx.restore();
}

/* ═══════════════════════════════════════════════════════
   RENDER: FIELD LAYER
   ═══════════════════════════════════════════════════════ */

function renderField() {
  /* Background clearing is now handled in the main render loop */
  
  /* Flow streaks — additive blend */
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';

  var half = CELL_SIZE * 0.5;
  var volBoost = smoothedVolume * 0.25;

  for (var row = 0; row < ROWS; row++) {
    var baseY = row * CELL_SIZE + half;
    for (var col = 0; col < COLS; col++) {
      var i = I(col, row);
      var vx = fieldVx[i];
      var vy = fieldVy[i];
      var d  = fieldDensity[i];

      var spd = Math.sqrt(vx * vx + vy * vy);
      var intensity = d * 0.4 + spd * 0.25;
      if (intensity < 0.015) continue;

      var baseX = col * CELL_SIZE + half;

      /* Streak length ∝ velocity */
      var sLen = 2 + spd * CELL_SIZE * 0.35;
      if (sLen > CELL_SIZE * 1.6) sLen = CELL_SIZE * 1.6;

      /* Direction */
      var nx = spd > 0.02 ? vx / spd : 0;
      var ny = spd > 0.02 ? vy / spd : 0;

      /* Color: deep purple → magenta → cyan */
      var t = intensity + volBoost;
      if (t > 1.0) t = 1.0;
      var r, g, b;
      if (t < 0.4) {
        /* deep purple zone */
        var f = t * 2.5;
        r = 30 + 140 * f | 0;
        g = 8  |  0;
        b = 50 + 110 * f | 0;
      } else if (t < 0.7) {
        /* magenta zone */
        var f = (t - 0.4) * 3.33;
        r = 170 + 50 * f  | 0;
        g = 8  + 40 * f   | 0;
        b = 160 - 20 * f  | 0;
      } else {
        /* cyan zone */
        var f = (t - 0.7) * 3.33;
        r = 220 - 200 * f | 0;
        g = 48  + 180 * f | 0;
        b = 140 + 90 * f  | 0;
      }

      var alpha = intensity * 0.55 + 0.04;
      if (alpha > 0.75) alpha = 0.75;

      ctx.strokeStyle = 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
      ctx.lineWidth = 1.2 + intensity * 2.8;

      ctx.beginPath();
      ctx.moveTo(baseX - nx * sLen * 0.5, baseY - ny * sLen * 0.5);
      ctx.lineTo(baseX + nx * sLen * 0.5, baseY + ny * sLen * 0.5);
      ctx.stroke();
    }
  }

  ctx.restore();
}

/* ═══════════════════════════════════════════════════════
   SCAN LINES (subtle cinematic texture)
   ═══════════════════════════════════════════════════════ */

function drawScanLines(intensity) {
  var alpha = 0.015 + intensity * 0.03;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#000';
  for (var y = 0; y < canvas.height; y += 4) {
    ctx.fillRect(0, y, canvas.width, 2);
  }
  ctx.restore();
}

/* ═══════════════════════════════════════════════════════
   EASTER EGG TEXT
   ═══════════════════════════════════════════════════════ */

function drawGlitchText(text, x, y, size) {
  ctx.save();
  ctx.font = 'bold ' + size + 'vw "Arial", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  var offX = (Math.random() - 0.5) * 10;
  var offY = (Math.random() - 0.5) * 10;

  ctx.globalCompositeOperation = 'screen';

  ctx.fillStyle = 'rgba(255, 0, 0, 0.7)';
  ctx.fillText(text, x + offX - 5, y + offY);

  ctx.fillStyle = 'rgba(0, 255, 255, 0.7)';
  ctx.fillText(text, x + offX + 5, y + offY);

  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.fillText(text, x + offX, y + offY);

  ctx.restore();
}

/* ═══════════════════════════════════════════════════════
   PUBLIC API
   ═══════════════════════════════════════════════════════ */

export function triggerFlash(text) {
  flashText = text;
  flashAlpha = 1.0;
}

/* ═══════════════════════════════════════════════════════
   MAIN RENDER LOOP
   ═══════════════════════════════════════════════════════ */

export function render(gestureData, easterEggState) {
  if (!ctx || !canvas || !fieldVx) return;

  var emotion = gestureData.emotion || 0;
  var isGlitch = easterEggState && easterEggState.phase >= 2;

  /* Simulate */
  stepSimulation(gestureData);

  /* LAYER 1: The CSS <video> is physically behind the canvas.
     We just draw a translucent dark veil so the video shines through but text stays readable. */
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'rgba(10, 5, 24, 0.45)'; 
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  /* LAYER 2: Body Presence Layer */
  drawBodyPresence(gestureData);

  /* LAYER 3: Field Layer (streaks) */
  renderField();

  /* Scan lines */
  drawScanLines(isGlitch ? 1.0 : emotion);

  /* Flash feedback */
  if (flashAlpha > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = flashAlpha * 0.7;
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 6vw "Arial", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(flashText, canvas.width / 2, canvas.height / 2);
    ctx.restore();
    flashAlpha -= 0.025;
  }

  /* Easter egg overlays — SYNCHRONOUS */
  if (easterEggState && easterEggState.phase >= 2) {
    var eeAlpha = easterEggState.phase === 4 ? easterEggState.fade : 1.0;
    ctx.globalAlpha = eeAlpha;

    drawGlitchText("6", canvas.width * 0.35, canvas.height * 0.5, 20);

    if (easterEggState.phase >= 3) {
      drawGlitchText("7", canvas.width * 0.65, canvas.height * 0.5, 20);
    }

    ctx.globalAlpha = 1.0;
  }
}
