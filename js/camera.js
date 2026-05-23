/**
 * camera.js — Webcam initialization and MediaPipe Hands setup
 */

var hands           = null;
var stream          = null;
var detectionActive = false;
var videoElement    = null;

var isProcessingFrame = false;
var lastResultsTime   = 0;
var onResultsCallback = null;
var watchdogInterval  = null;

/* ── Start webcam ── */
export async function startCamera(video) {
  videoElement = video;

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('getUserMedia not supported in this browser');
  }

  stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: 'user',
      width:     { ideal: 640, max: 640 },
      height:    { ideal: 480, max: 480 },
      frameRate: { ideal: 30,  max: 30 }
    }
  });

  video.srcObject = stream;
  await video.play();

  /* Wait for actual video data to be loaded */
  await new Promise(function (resolve) {
    if (video.readyState >= 3) resolve();
    else video.onloadeddata = resolve;
  });
}

export function startMediaPipe(onResults) {
  if (onResults) onResultsCallback = onResults;
  
  return new Promise(function (resolve, reject) {
    var check = function (n) {
      if (typeof Hands !== 'undefined') {
        if (hands) {
          try { hands.close(); } catch(e) {}
        }
        hands = new Hands({
          locateFile: function (f) {
            return 'https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4/' + f;
          }
        });
        hands.setOptions({
          selfieMode: true,
          maxNumHands: 2,
          modelComplexity: 1,
          minDetectionConfidence: 0.7,
          minTrackingConfidence: 0.7
        });
        hands.onResults(function(results) {
          lastResultsTime = performance.now();
          if (onResultsCallback) onResultsCallback(results);
        });
        detectionActive = true;
        isProcessingFrame = false;
        lastResultsTime = performance.now();
        startWatchdog();
        requestAnimationFrame(detectLoop);
        resolve();
      } else if (n < 80) {
        setTimeout(function () { check(n + 1); }, 200);
      } else {
        reject(new Error('MediaPipe failed to load — check your connection'));
      }
    };
    check(0);
  });
}

function startWatchdog() {
  if (watchdogInterval) clearInterval(watchdogInterval);
  watchdogInterval = setInterval(function() {
    if (!detectionActive) return;
    var now = performance.now();
    if (now - lastResultsTime > 1500) {
      console.warn("WASM WATCHDOG TRIGGERED: MediaPipe froze for >1.5s. Reinitializing...");
      restartMediaPipe();
    }
  }, 500);
}

function restartMediaPipe() {
  detectionActive = false;
  isProcessingFrame = false;
  startMediaPipe(onResultsCallback).catch(function(e) { console.error("Recovery failed:", e); });
}

/* ── Detection loop ── */
function detectLoop() {
  if (!detectionActive || !videoElement) return;
  requestAnimationFrame(detectLoop);

  if (isProcessingFrame) return;   /* drop frame — previous still in-flight */

  isProcessingFrame = true;
  hands.send({ image: videoElement })
    .then(function ()  { isProcessingFrame = false; })
    .catch(function () { isProcessingFrame = false; });
}

/* ── Stop ── */
export function stopDetection() {
  detectionActive = false;
  if (watchdogInterval) clearInterval(watchdogInterval);
}
