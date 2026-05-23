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

/* ── Initialization ── */
window.addEventListener('DOMContentLoaded', function () {
  ui.init();
  visuals.init(canvas, video);
  audio.init(trackA, trackB);
  
  /* Bind start events */
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
        /* ── Toggle play / pause ── */
        audio.togglePlayPause().then(function (isPlaying) {
          ui.showNotification(isPlaying ? 'PLAYING' : 'PAUSED');
        });
      }
    }

    /* ── Playlist navigation with Arrow Up / Down ── */
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

  /* Bind song selector */
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

/* ── Boot Flow ── */
async function startExperience() {
  if (hasStarted) return;
  hasStarted = true;

  ui.hideCurtain();

  /* Init overlay video (Autoplay Policy Safety) */
  var overlayVid = document.getElementById('overlayVideo');
  if (overlayVid) {
    overlayVid.muted = true;
    overlayVid.loop = true;
    overlayVid.playsInline = true;
    /* Reduce decode cost — hint lower internal resolution */
    overlayVid.width = 640;
    overlayVid.height = 360;
    overlayVid.src = "./assets_loop.mp4";
    overlayVid.play().catch(function(err) {
      console.warn("Overlay video play failed:", err);
    });
  }

  try {
    await camera.startCamera(video);
    
    /* Initialize audio context and graph */
    audio.initGraph();
    await audio.play();
    
    var pl = audio.getPlaylist();
    ui.setTrackName(pl[0].name);
    ui.updateSongSelector(0);

    /* Start MediaPipe and callbacks */
    await camera.startMediaPipe(onMediaPipeResults);
    
    /* Setup Easter Egg callbacks */
    easterEgg.init(
      function (eventName) {
        ui.showNotification("GLITCH EVENT DETECTED");
      },
      function (key, value) {
        if (key === "easterEggState") {
          easterEggState = value;
          /* Modulate audio based on glitch intensity */
          if (value.active) {
            audio.setEasterEggEffects(value.phase >= 2 ? value.fade : 0);
          } else {
            audio.setEasterEggEffects(0);
          }
        }
      }
    );

    /* Start UI tutorial and Frame Loop */
    ui.startTutorial();
    ui.showEasterEggHint();
    requestAnimationFrame(frameLoop);

  } catch (err) {
    ui.showNotification("Error: " + err.message);
  }
}

/* ── MediaPipe Callbacks (Data routing) ── */
function onMediaPipeResults(results) {
  /* 1. Process Raw Data */
  latestGestureData = gestures.processHands(results);

  /* 2. Route to Audio Engine */
  if (latestGestureData.fistJustClosed) {
    audio.pause();
    ui.showNotification("PAUSED");
  } else if (latestGestureData.fistJustOpened) {
    audio.resumeAfterFist();
    ui.showNotification("PLAYING");
  }

  if (audio.isStarted()) {
    audio.setVolume(latestGestureData.volume);
    /* 2. Audio Effects */
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
        pos = latestGestureData.landmarks[0]; /* Wrist pos */
      }
      visuals.triggerHornsShockwave(pos.x, pos.y);
      
      easterEgg.registerHornsGesture();
    }
    lastHornsState = latestGestureData.isHorns;
  }

  /* 3. Handle Actions & Swipe */
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

  /* 4. Easter Egg Input */
  if (latestGestureData.isHorns && !previousHornsState) {
    easterEgg.registerHornsGesture();
  } else if (latestGestureData.waveDetected) {
    /* Hybrid trigger accepts wave as input too */
    easterEgg.registerHornsGesture();
  }
  previousHornsState = latestGestureData.isHorns;

  /* 5. Route to UI */
  ui.updateVolumeVisuals(latestGestureData.volume);
}

/* ── Single Render Loop ── */
function frameLoop(now) {
  /* 1. Update Time-based systems */
  easterEgg.update(now);

  /* 2. Render visuals */
  visuals.render(latestGestureData, easterEggState);

  /* 3. Update Audio Time */
  if (audio.isStarted()) {
    var track = audio.getActiveTrack();
    if (track) ui.updateTime(track.currentTime, track.duration);
  }

  /* 4. Loop */
  requestAnimationFrame(frameLoop);
}
