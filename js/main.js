import * as audio from './audio.js';
import * as camera from './camera.js';
import * as gestures from './gestures.js';
import * as visuals from './visuals.js';
import * as ui from './ui.js';
import * as easterEgg from './easter-egg.js';

/* ── DOM Elements ── */
var video  = document.getElementById('video');
var canvas = document.getElementById('canvas');
var trackA = document.getElementById('trackA');
var trackB = document.getElementById('trackB');

/* ── Global State ── */
var hasStarted         = false;
var latestGestureData = {};
var lastHornsState = false;
var hintHidden = false;
var easterEggState     = null;
var previousHornsState = false;
var lastFrameTime = 0;
var lowFpsFrames = 0;
var isDegraded = false;
var isPageHidden = false;

/* ── Initialization ── */
window.addEventListener('DOMContentLoaded', function () {
  ui.init();
  audio.init(trackA, trackB);
  
  document.getElementById('curtain').addEventListener('click', startExperience);

  var tutorialEl = document.getElementById('tutorial');
  if (tutorialEl) {
    tutorialEl.addEventListener('click', function() {
      if (ui.isTutorialActive()) ui.skipTutorial();
    });
  }

  window.addEventListener('keydown', function (e) {
    if (e.code === 'Space' || e.key === ' ') {
      e.preventDefault();
      if (!hasStarted) {
        startExperience();
      } else if (ui.isTutorialActive()) {
        ui.skipTutorial();
      } else {
        audio.togglePlayPause().then(function (isPlaying) {
          ui.showNotification(isPlaying ? 'PLAYING' : 'PAUSED');
        });
      }
    }

    if (hasStarted && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      var pl = audio.getPlaylist();
      var currentIdx = audio.getCurrentTrackIdx();
      var nextIdx;

      if (e.key === 'ArrowUp') {
        nextIdx = (currentIdx - 1 + pl.length) % pl.length;
      } else {
        nextIdx = (currentIdx + 1) % pl.length;
      }

      var name = audio.changeTrack(nextIdx);
      if (name) {
        ui.updateSongSelector(nextIdx);
        ui.setTrackName(name);
      }
    }
  });

  var songBtns = document.querySelectorAll('#song-selector button');
  songBtns.forEach(function (btn, index) {
    btn.addEventListener('click', function () {
      var name = audio.changeTrack(index);
      if (name) {
        ui.updateSongSelector(index);
        ui.setTrackName(name);
      }
    });
  });
});

/* ── waitForVideoReady ────────────────────────────────────────────────────── */
function waitForVideoReady(videoEl) {
  return new Promise(function (resolve) {
    if (videoEl.videoWidth > 0 && videoEl.videoHeight > 0) { resolve(); return; }

    function done() {
      videoEl.removeEventListener('loadedmetadata', done);
      videoEl.removeEventListener('canplay', done);
      resolve();
    }

    videoEl.addEventListener('loadedmetadata', done);
    videoEl.addEventListener('canplay', done);
    setTimeout(resolve, 4000);
  });
}

/* ── Boot Flow ── */
async function startExperience() {
  if (hasStarted) return;
  hasStarted = true;

  ui.hideCurtain();

  var isMobile = window.innerWidth <= 768;
  var overlayVid = document.getElementById('overlayVideo');

  if (overlayVid) {
    if (isMobile) {
      overlayVid.style.display = 'none';
      overlayVid.src = "";
    } else {
      overlayVid.muted = true;
      overlayVid.loop = true;
      overlayVid.playsInline = true;
      overlayVid.width = 640;
      overlayVid.height = 360;
      overlayVid.src = "./assets_loop.mp4";

      overlayVid.play().catch(function(err) {
        console.warn("Overlay video play failed:", err);
      });
    }
  }

  try {
    await camera.startCamera(video);

    var _resolveFirstResult;

    var firstResolved = false;

    var firstResultReady = new Promise(function (resolve) {
      _resolveFirstResult = resolve;
      setTimeout(resolve, 5000);
    });

    await camera.startMediaPipe(function (results) {
      onMediaPipeResults(results);

      if (!firstResolved && results && results.multiHandLandmarks) {
        firstResolved = true;
        _resolveFirstResult();
      }
    });

    await Promise.all([
      waitForVideoReady(video),
      firstResultReady
    ]);

    visuals.init(canvas, video);
    audio.initGraph();
    await audio.play();

    var pl = audio.getPlaylist();
    ui.setTrackName(pl[0].name);
    ui.updateSongSelector(0);

    easterEgg.init(
      function () {
        ui.showNotification("GLITCH EVENT DETECTED");
      },
      function (key, value) {
        if (key === "easterEggState") {
          easterEggState = value;

          if (value.active) {
            audio.setEasterEggEffects(value.phase >= 2 ? value.fade : 0);
          } else {
            audio.setEasterEggEffects(0);
          }
        }
      }
    );

    ui.startTutorial();
    ui.showEasterEggHint();
    requestAnimationFrame(frameLoop);

    document.addEventListener('visibilitychange', function() {
      var overlayVid = document.getElementById('overlayVideo');

      if (document.hidden) {
        isPageHidden = true;

        if (overlayVid && !overlayVid.paused) {
          overlayVid.pause();
          overlayVid._wasPlayingBeforeHide = true;
        }
      } else {
        isPageHidden = false;
        lastFrameTime = 0;

        if (overlayVid && overlayVid._wasPlayingBeforeHide) {
          overlayVid.play().catch(function() {});
          overlayVid._wasPlayingBeforeHide = false;
        }
      }
    });

  } catch (err) {
    ui.showNotification("Error: " + err.message);
  }
}

/* ── MediaPipe Callbacks ── */
function onMediaPipeResults(results) {
  latestGestureData = gestures.processHands(results);

  if (latestGestureData.fistJustClosed) {
    audio.pause();
    ui.showNotification("PAUSED");
  } else if (latestGestureData.fistJustOpened) {
    audio.resumeAfterFist();
    ui.showNotification("PLAYING");
  }

  if (audio.isStarted()) {
    audio.setVolume(latestGestureData.volume);

    var burst = (latestGestureData.swipeAction !== null);

    audio.updateEffects(
      latestGestureData.emotion,
      latestGestureData.reverbAmount,
      latestGestureData.leftSpeed,
      burst,
      latestGestureData.stereoWidth,
      latestGestureData.leftY
    );

    if (latestGestureData.isHorns && !lastHornsState) {
      if (!hintHidden) {
        ui.hideEasterEggHint();
        hintHidden = true;
      }

      audio.playHornsFeedback();

      var pos = {x: 0.5, y: 0.5};

      if (latestGestureData.landmarks && latestGestureData.landmarks.length > 0) {
        pos = latestGestureData.landmarks[0];
      }

      visuals.triggerHornsShockwave(pos.x, pos.y);
      easterEgg.registerHornsGesture();
    }

    lastHornsState = latestGestureData.isHorns;
  }

  if (latestGestureData.swipeAction === 'reverse') {
    if (audio.triggerReverse()) {
      visuals.triggerFlash("REWIND");
      ui.showNotification("REVERSE TAPE");
    }
  } else if (latestGestureData.swipeAction === 'remix') {
    var newTrackName = audio.triggerRemix();

    if (newTrackName) {
      visuals.triggerFlash("REMIX");
      ui.showNotification("REMIX → " + newTrackName);
      ui.updateSongSelector(audio.getCurrentTrackIdx());
      ui.setTrackName(newTrackName);
    }
  }

  if (latestGestureData.isHorns && !previousHornsState) {
    easterEgg.registerHornsGesture();
  } else if (latestGestureData.waveDetected) {
    easterEgg.registerHornsGesture();
  }

  previousHornsState = latestGestureData.isHorns;

  ui.updateVolumeVisuals(latestGestureData.volume);
}

/* ── Frame Loop ── */
function frameLoop(now) {
  requestAnimationFrame(frameLoop);

  if (isPageHidden) return;

  easterEgg.update(now);
  visuals.render(latestGestureData, easterEggState);

  if (audio.isStarted()) {
    var track = audio.getActiveTrack();
    if (track) ui.updateTime(track.currentTime, track.duration);
  }
}