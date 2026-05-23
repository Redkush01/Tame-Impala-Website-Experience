/**
 * audio.js — WebAudio graph, effects, playlist management
 * Simplified chain: volumeGain → dry/wet reverb → wobble → stereo → master
 */

/* ── Playlist ── */
const playlist = [
  { src: 'thelessiknowthebetter.flac', name: 'The Less I Know The Better' },
  { src: 'borderline.flac',            name: 'Borderline' },
  { src: 'dracula.flac',               name: 'Dracula' }
];

/* ── State ── */
let audioContext = null;
let trackA = null;
let trackB = null;
let audioStarted = false;

let sourceNode  = null;
let sourceNodeB = null;
let crossGainA, crossGainB, mixNode;
let volumeGain, masterGain, dryGain, wetGain;
let preDelay, reverbFilter;
let smallRoomConv, dreamSpaceConv, cathedralConv;
let convGainSmall, convGainDream, convGainCathedral, convSum;
let stereoPanner;
let wobbleDelay, wobbleLFO, wobbleLFOGain, wobbleWet;
let lowpassFilter;

let reverseBuffer  = null;
let reverseSource  = null;
let isReversePlaying = false;

let activeTrackIsA     = true;
let inRemixTransition  = false;
let remixCooldownUntil = 0;
let currentTrackIdx    = 0;

/* ── Helpers ── */
function clamp(v, lo, hi) { return Math.min(Math.max(v, lo), hi); }

function createIRBuffer(ctx, decay, tone) {
  var sr  = ctx.sampleRate;
  var len = Math.floor(sr * decay);
  var buf = ctx.createBuffer(2, len, sr);
  for (var c = 0; c < 2; c++) {
    var d = buf.getChannelData(c);
    for (var i = 0; i < len; i++) {
      var t = i / len;
      d[i] = ((Math.random() * 2 - 1) * Math.pow(1 - t, 2.2) *
               (1 + 0.3 * Math.sin(t * Math.PI * 10)) * Math.exp(-t * tone)) * 2.2;
    }
  }
  return buf;
}

function createReverseBuffer(buf) {
  var rev = audioContext.createBuffer(buf.numberOfChannels, buf.length, buf.sampleRate);
  for (var c = 0; c < buf.numberOfChannels; c++) {
    var orig = buf.getChannelData(c);
    var r    = rev.getChannelData(c);
    for (var i = 0; i < buf.length; i++) r[i] = orig[buf.length - 1 - i];
  }
  return rev;
}

function loadReverseBuffer(srcUrl) {
  if (!audioContext) return;
  reverseBuffer = null;
  fetch(srcUrl)
    .then(function (r) { return r.arrayBuffer(); })
    .then(function (ab) { return audioContext.decodeAudioData(ab); })
    .then(function (dec) { reverseBuffer = createReverseBuffer(dec); })
    .catch(function () { /* silently fail — reverse just won't be available */ });
}

/* ══════════════════════════════════════════════════════════
   PUBLIC API
   ══════════════════════════════════════════════════════════ */

export function init(audioA, audioB) {
  trackA = audioA;
  trackB = audioB;
}

export function getActiveTrack()    { return activeTrackIsA ? trackA : trackB; }
export function isStarted()         { return audioStarted; }
export function getCurrentTrackIdx() { return currentTrackIdx; }
export function getPlaylist()       { return playlist; }
export function isRemixing()        { return inRemixTransition; }

/* ── Build the audio graph ── */
export function initGraph() {
  if (audioContext) return;
  audioContext = new (window.AudioContext || window.webkitAudioContext)();

  /* Sources → cross-fade mixer */
  sourceNode  = audioContext.createMediaElementSource(trackA);
  sourceNodeB = audioContext.createMediaElementSource(trackB);

  crossGainA = audioContext.createGain(); crossGainA.gain.value = 1;
  crossGainB = audioContext.createGain(); crossGainB.gain.value = 0;
  sourceNode.connect(crossGainA);
  sourceNodeB.connect(crossGainB);

  mixNode = audioContext.createGain(); mixNode.gain.value = 1;
  crossGainA.connect(mixNode);
  crossGainB.connect(mixNode);

  /* Volume (pinch-controlled, Safari-safe) */
  volumeGain = audioContext.createGain();
  volumeGain.gain.value = 1;
  mixNode.connect(volumeGain);

  /* Master + dry/wet + lowpass */
  masterGain = audioContext.createGain();
  dryGain    = audioContext.createGain();
  wetGain    = audioContext.createGain();
  preDelay   = audioContext.createDelay();
  reverbFilter = audioContext.createBiquadFilter();
  stereoPanner = audioContext.createStereoPanner();
  lowpassFilter = audioContext.createBiquadFilter();
  lowpassFilter.type = 'lowpass';
  lowpassFilter.frequency.value = 22000;
  lowpassFilter.Q.value = 1.0;

  /* 3-layer convolution reverb */
  smallRoomConv  = audioContext.createConvolver();
  dreamSpaceConv = audioContext.createConvolver();
  cathedralConv  = audioContext.createConvolver();
  convGainSmall    = audioContext.createGain();
  convGainDream    = audioContext.createGain();
  convGainCathedral = audioContext.createGain();
  convSum          = audioContext.createGain();

  smallRoomConv.buffer  = createIRBuffer(audioContext, 0.6,  0.5);
  dreamSpaceConv.buffer = createIRBuffer(audioContext, 1.1,  0.35);
  cathedralConv.buffer  = createIRBuffer(audioContext, 1.8,  0.25);

  /* Initial values */
  preDelay.delayTime.value     = 0.008;
  reverbFilter.type            = 'bandpass';
  reverbFilter.frequency.value = 2800;
  reverbFilter.Q.value         = 3.5;
  wetGain.gain.value           = 0;
  dryGain.gain.value           = 1;
  masterGain.gain.value        = 1;
  convGainSmall.gain.value     = 1;
  convGainDream.gain.value     = 0;
  convGainCathedral.gain.value = 0;
  convSum.gain.value           = 1;
  stereoPanner.pan.value       = 0;

  /* ── Signal routing ── */

  /* Dry path */
  volumeGain.connect(dryGain);
  dryGain.connect(masterGain);
  
  /* Output routing */
  masterGain.connect(lowpassFilter);
  lowpassFilter.connect(audioContext.destination);

  /* Wet path (3 parallel convolvers → filter → panner → master) */
  volumeGain.connect(preDelay);
  preDelay.connect(smallRoomConv);   smallRoomConv.connect(convGainSmall);     convGainSmall.connect(convSum);
  preDelay.connect(dreamSpaceConv);  dreamSpaceConv.connect(convGainDream);    convGainDream.connect(convSum);
  preDelay.connect(cathedralConv);   cathedralConv.connect(convGainCathedral); convGainCathedral.connect(convSum);
  convSum.connect(reverbFilter);
  reverbFilter.connect(wetGain);
  wetGain.connect(stereoPanner);
  stereoPanner.connect(masterGain);

  /* ── Wobble (liquid vibrato — controlled by left hand speed) ── */
  wobbleDelay   = audioContext.createDelay(0.05);
  wobbleLFO     = audioContext.createOscillator();
  wobbleLFOGain = audioContext.createGain();
  wobbleWet     = audioContext.createGain();

  wobbleDelay.delayTime.value = 0.006;
  wobbleLFO.type              = 'sine';
  wobbleLFO.frequency.value   = 4;
  wobbleLFOGain.gain.value    = 0;
  wobbleWet.gain.value        = 0;

  wobbleLFO.connect(wobbleLFOGain);
  wobbleLFOGain.connect(wobbleDelay.delayTime);
  wobbleLFO.start();

  volumeGain.connect(wobbleDelay);
  wobbleDelay.connect(wobbleWet);
  wobbleWet.connect(masterGain);

  loadReverseBuffer(playlist[currentTrackIdx].src);
}

/* ── Volume control (pinch gesture) ── */
export function setVolume(value) {
  if (volumeGain) volumeGain.gain.value = clamp(value, 0, 1);
}

/* ── Per-frame effect updates ── */
export function updateEffects(emotion, reverbAmt, leftSpeed, burst, stereoWidth, leftY) {
  var emo = clamp(emotion, 0, 1);

  if (reverbFilter)  reverbFilter.frequency.value = 2200 + emo * 1500 + (Math.random() - 0.5) * 80;
  if (wetGain)       wetGain.gain.value   = burst ? Math.min(1, 0.35 + emo * 0.6 + 0.2) : 0.35 + emo * 0.55;
  if (dryGain)       dryGain.gain.value   = burst ? Math.max(0.1, 0.6 - emo * 0.45 - 0.15) : 0.6 - emo * 0.45;
  if (masterGain)    masterGain.gain.value = 0.4 + emo * 0.6;
  if (preDelay)      preDelay.delayTime.value = 0.02 + emo * 0.08 + (Math.random() - 0.5) * 0.004;

  if (convGainSmall)     convGainSmall.gain.value     = clamp(1 - emo * 0.55 - (burst ? 0.1 : 0), 0.08, 1);
  if (convGainDream)     convGainDream.gain.value     = clamp(emo * 0.7, 0, 1);
  if (convGainCathedral) convGainCathedral.gain.value = clamp((emo - 0.5) * 2, 0, 1);

  if (stereoPanner && stereoWidth !== undefined) {
    stereoPanner.pan.value = clamp(stereoWidth, -1, 1);
  }

  /* Lowpass Filter Modulation (Left Hand Y) */
  if (lowpassFilter && leftY !== undefined) {
    var minFreq = 400;
    var maxFreq = 22000;
    var targetFreq = minFreq * Math.pow(maxFreq / minFreq, clamp(1.0 - leftY, 0, 1));
    lowpassFilter.frequency.value += (targetFreq - lowpassFilter.frequency.value) * 0.15;
  }

  /* Wobble: scales with left-hand speed */
  if (wobbleLFO && wobbleLFOGain && wobbleWet) {
    var ws = clamp(leftSpeed * 1.4, 0, 1);
    wobbleLFO.frequency.value = 2 + ws * 5;
    wobbleLFOGain.gain.value  = ws * 0.004;
    wobbleWet.gain.value     += (ws * 0.6 - wobbleWet.gain.value) * 0.12;
  }
}

/* ── Play / Pause ── */
export async function play() {
  if (!audioContext) initGraph();
  await audioContext.resume();
  var t = getActiveTrack();
  await t.play();
  audioStarted = true;
}

export function pause() {
  var t = getActiveTrack();
  if (!t.paused) t.pause();
  audioStarted = false;
}

export async function togglePlayPause() {
  var t = getActiveTrack();
  if (t.paused) {
    await play();
    return true;
  } else {
    pause();
    return false;
  }
}

export async function resumeAfterFist() {
  if (!audioContext) return;
  await audioContext.resume();
  var t = getActiveTrack();
  await t.play();
  audioStarted = true;
}

/* ── Reverse tape swipe ── */
export function triggerReverse() {
  if (!reverseBuffer || isReversePlaying) return false;
  var now = performance.now();
  if (now < remixCooldownUntil) return false;

  var actT       = getActiveTrack();
  var scratchLen = 0.9;
  var cpt        = actT.currentTime || 0;
  var revStart   = Math.max(0, reverseBuffer.duration - cpt - scratchLen);

  if (reverseSource) {
    try { reverseSource.stop(); } catch (e) { /* already stopped */ }
    reverseSource.disconnect();
  }

  isReversePlaying = true;
  if (!actT.paused) actT.pause();

  reverseSource = audioContext.createBufferSource();
  reverseSource.buffer = reverseBuffer;
  reverseSource.connect(preDelay);
  reverseSource.start(0, revStart, scratchLen);

  reverseSource.onended = function () {
    isReversePlaying = false;
    if (reverseSource) { reverseSource.disconnect(); reverseSource = null; }
    if (audioStarted) {
      actT.currentTime = Math.max(0, cpt - scratchLen);
      actT.play().catch(function () {});
    }
  };
  return true;
}

/* ── Remix crossfade ── */
export function triggerRemix() {
  if (inRemixTransition || !audioStarted) return null;
  var now = performance.now();
  if (now < remixCooldownUntil) return null;

  remixCooldownUntil = now + 3000;
  inRemixTransition  = true;
  currentTrackIdx    = (currentTrackIdx + 1) % playlist.length;

  var nextSong  = playlist[currentTrackIdx];
  var nextTrack = activeTrackIsA ? trackB  : trackA;
  var nextGain  = activeTrackIsA ? crossGainB : crossGainA;
  var oldTrack  = activeTrackIsA ? trackA  : trackB;
  var oldGain   = activeTrackIsA ? crossGainA : crossGainB;

  nextTrack.src = nextSong.src;
  loadReverseBuffer(nextSong.src);

  var onMeta = function () {
    nextTrack.removeEventListener('loadedmetadata', onMeta);
    nextTrack.currentTime = nextTrack.duration / 2;
    nextTrack.play().then(function () {
      var t = audioContext.currentTime;
      nextGain.gain.cancelScheduledValues(t);
      oldGain.gain.cancelScheduledValues(t);
      nextGain.gain.setValueAtTime(0, t);
      nextGain.gain.linearRampToValueAtTime(1, t + 1.5);
      oldGain.gain.setValueAtTime(1, t);
      oldGain.gain.linearRampToValueAtTime(0, t + 1.5);
      setTimeout(function () {
        oldTrack.pause();
        activeTrackIsA    = !activeTrackIsA;
        inRemixTransition = false;
      }, 1600);
    }).catch(function () { inRemixTransition = false; });
  };
  nextTrack.addEventListener('loadedmetadata', onMeta);
  return nextSong.name;
}

/* ── Direct track change (from song selector buttons) ── */
export function changeTrack(index) {
  if (index < 0 || index >= playlist.length) return null;
  currentTrackIdx = index;
  var song = playlist[index];
  var actT = getActiveTrack();
  actT.src = song.src;
  if (audioContext) loadReverseBuffer(song.src);
  if (!audioContext) initGraph();
  audioContext.resume()
    .then(function () { return actT.play(); })
    .then(function () { audioStarted = true; })
    .catch(function () {});
  return song.name;
}

/* ── Synthesize Horns Feedback (Chime/Glitch) ── */
var lastHornsFeedbackTime = 0;
export function playHornsFeedback() {
  if (!audioContext || !masterGain || !preDelay) return;
  
  /* Cooldown: max 1 chime per 500ms to prevent node spam */
  var now = audioContext.currentTime;
  if (now - lastHornsFeedbackTime < 0.5) return;
  lastHornsFeedbackTime = now;
  
  var osc = audioContext.createOscillator();
  var gain = audioContext.createGain();
  var t = now;
  
  osc.type = 'sine';
  osc.frequency.setValueAtTime(880, t); 
  osc.frequency.exponentialRampToValueAtTime(1760, t + 0.05); 
  osc.frequency.exponentialRampToValueAtTime(220, t + 0.3); 
  
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(0.3, t + 0.05);
  gain.gain.exponentialRampToValueAtTime(0.01, t + 0.3);
  
  osc.connect(gain);
  gain.connect(masterGain); 
  gain.connect(preDelay); 
  
  osc.start(t);
  osc.stop(t + 0.4);
  
  /* Cleanup: disconnect nodes after they finish to prevent memory leak */
  osc.onended = function() {
    osc.disconnect();
    gain.disconnect();
  };
}

/* ── Easter egg audio effects (cathedral + wet boost) ── */
export function setEasterEggEffects(intensity) {
  if (!audioContext) return;
  if (convGainCathedral) convGainCathedral.gain.value = clamp(intensity * 1.5, 0, 1.5);
  if (wetGain)           wetGain.gain.value           = clamp(0.35 + intensity * 0.6, 0, 1);
  if (wobbleLFO)         wobbleLFO.frequency.value     = 4 + intensity * 6;
  if (wobbleLFOGain)     wobbleLFOGain.gain.value      = intensity * 0.005;
  if (wobbleWet)         wobbleWet.gain.value           = intensity * 0.7;
}

export function getAudioContext() { return audioContext; }
