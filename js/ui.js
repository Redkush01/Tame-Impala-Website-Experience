/**
 * ui.js — Minimal immersive UI controller
 * Manages curtain, tutorial overlay, and HUD without touching audio/visual logic.
 */

/* ── DOM References ── */
var dom = {
  curtain:      null,
  tutorial:     null,
  hud:          null,
  tameLogo:     null,
  playerContainer: null,
  trackName:    null,
  timeDisplay:  null,
  easterEggHint: null,
  volumeRing:   null,
  notification: null,
  songSelector: null,
  steps:        []
};

/* ── State ── */
var tutorialActive  = false;
var currentStepIdx  = 0;
var stepTimeout     = null;
var notifyTimeout   = null;

var TUTORIAL_STEPS = [
  { icon: '🤏', text: 'pinch to control volume' },
  { icon: '🖐️', text: 'rotate left hand for reverb' },
  { icon: '👉', text: 'hold & swipe to switch track' },
  { icon: '🙌', text: 'explore with both hands' }
];

var STEP_DURATION = 6000; /* ms per step */

/* ── Init ── */
export function init() {
  /* We assume index.html contains these IDs based on style.css */
  dom.curtain      = document.getElementById('curtain');
  dom.tutorial     = document.getElementById('tutorial');
  dom.hud          = document.getElementById('hud');
  dom.tameLogo     = document.getElementById('tame-logo');
  dom.trackName    = document.getElementById('track-name');
  dom.timeDisplay  = document.getElementById('time-display');
  dom.easterEggHint = document.getElementById('easter-egg-hint');
  dom.volumeRing   = document.getElementById('volume-ring');
  dom.notification = document.getElementById('notification');
  dom.songSelector = document.getElementById('song-selector');
  
  if (dom.tutorial) {
    /* Cache step elements if pre-rendered, or build them once */
    dom.steps = Array.from(dom.tutorial.querySelectorAll('.step'));
  }
}

/* ── Curtain (Start Screen) ── */
export function hideCurtain() {
  if (dom.curtain) {
    dom.curtain.classList.add('fade-out');
    setTimeout(function () {
      dom.curtain.style.display = 'none';
    }, 1500);
  }
}

export function showHUD() {
  if (dom.hud) dom.hud.classList.add('visible');
  if (dom.songSelector) dom.songSelector.classList.add('visible');
}

/* ── HUD Updates ── */
export function setTrackName(name) {
  if (dom.trackName) {
    dom.trackName.textContent = name;
  }
}

function formatTime(seconds) {
  if (isNaN(seconds)) return "00:00";
  var m = Math.floor(seconds / 60);
  var s = Math.floor(seconds % 60);
  return (m < 10 ? "0" + m : m) + ":" + (s < 10 ? "0" + s : s);
}

var lastTimeText = "";
export function updateTime(currentTime, duration) {
  if (!dom.timeDisplay) return;
  var txt = formatTime(currentTime) + " / " + formatTime(duration);
  if (txt !== lastTimeText) {
    dom.timeDisplay.textContent = txt;
    lastTimeText = txt;
  }
}

export function updateVolumeVisuals(volumeNorm) {
  if (dom.volumeRing && volumeNorm !== undefined) {
    /* volumeNorm is 0.0 to 1.0 */
    var scale = 0.5 + (volumeNorm * 0.5);
    var op    = 0.3 + (volumeNorm * 0.7);
    dom.volumeRing.style.transform = 'scale(' + scale + ')';
    dom.volumeRing.style.opacity   = op.toFixed(2);
    /* Color shift based on volume */
    var r = 255 - Math.round(volumeNorm * 55);
    var g = 255;
    var b = 255 - Math.round(volumeNorm * 55);
    dom.volumeRing.style.backgroundColor = 'rgba(' + r + ',' + g + ',' + b + ',' + op + ')';
    dom.volumeRing.style.boxShadow = '0 0 ' + Math.round(volumeNorm * 30) + 'px rgba(180,255,255,' + op + ')';
  }
  
  if (dom.tameLogo && volumeNorm !== undefined) {
    var logoScale = 1.0 + (volumeNorm * 0.08);
    var logoOp = 0.65 + (volumeNorm * 0.35);
    dom.tameLogo.style.transform = 'translateX(-50%) scale(' + logoScale + ')';
    dom.tameLogo.style.opacity = logoOp.toFixed(2);
  }
}

export function showNotification(text) {
  if (!dom.notification) return;
  
  clearTimeout(notifyTimeout);
  
  /* Reset animation by cloning and replacing */
  var newNotif = dom.notification.cloneNode(true);
  dom.notification.parentNode.replaceChild(newNotif, dom.notification);
  dom.notification = newNotif;
  
  dom.notification.textContent = text;
  dom.notification.classList.add('show');
  
  notifyTimeout = setTimeout(function () {
    dom.notification.classList.remove('show');
  }, 2500);
}

/* ── Tutorial System ── */
export function startTutorial() {
  if (!dom.tutorial || dom.steps.length === 0) return;
  
  tutorialActive = true;
  currentStepIdx = 0;
  
  dom.tutorial.classList.add('visible');
  showStep(currentStepIdx);
}

function showStep(idx) {
  if (!tutorialActive) return;
  
  /* Hide all steps */
  for (var i = 0; i < dom.steps.length; i++) {
    dom.steps[i].className = 'step';
  }
  
  if (idx < dom.steps.length) {
    /* Show current step */
    dom.steps[idx].classList.add('active');
    
    /* Mark previous step as exit */
    if (idx > 0) {
      dom.steps[idx - 1].classList.add('exit');
    }
    
    clearTimeout(stepTimeout);
    stepTimeout = setTimeout(nextTutorialStep, STEP_DURATION);
  } else {
    endTutorial();
  }
}

export function nextTutorialStep() {
  if (!tutorialActive) return;
  currentStepIdx++;
  showStep(currentStepIdx);
}

export function skipTutorial() {
  if (!tutorialActive) return;
  endTutorial();
}

function endTutorial() {
  tutorialActive = false;
  clearTimeout(stepTimeout);
  
  if (dom.tutorial) {
    dom.tutorial.classList.remove('visible');
    setTimeout(function () {
      dom.tutorial.style.display = 'none';
    }, 1000);
  }
  
  showHUD();
}

export function showEasterEggHint() {
  if (dom.easterEggHint) {
    dom.easterEggHint.classList.add('visible');
  }
}

export function hideEasterEggHint() {
  if (dom.easterEggHint) {
    dom.easterEggHint.classList.remove('visible');
  }
}

export function isTutorialActive() {
  return tutorialActive;
}

export function updateSongSelector(activeIdx) {
  if (!dom.songSelector) return;
  var btns = dom.songSelector.querySelectorAll('button');
  for (var i = 0; i < btns.length; i++) {
    if (i === activeIdx) {
      btns[i].classList.add('active');
    } else {
      btns[i].classList.remove('active');
    }
  }
}
