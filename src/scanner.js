// Ticket scanner for the app pages (raw-scanner.html is the standalone test bench).
// Needs barcode.js loaded first (for parseTicketBarcode).
//
// Two modes. 'hold' (the default): decodes only while the button is held, one scan per press,
// so nothing is picked up by accident. 'auto': scans whatever comes into view, then pauses, and
// won't count the same ticket again until it has left the view.
//
//   const scanner = await startScanner({ video, viewport, holdBtn, onStatus, onScan, mode })
//   scanner.setMode('auto' | 'hold')
//   onScan(ticket) gets the parsed ticket; a barcode that isn't a ticket goes to onStatus instead.

import { readBarcodes, prepareZXingModule } from 'https://cdn.jsdelivr.net/npm/zxing-wasm@3.1.4/dist/es/reader/index.js';

// Ticket barcodes are 26-digit ITF; see barcode.js for the layout.
const READER_OPTIONS = { formats: ['ITF'], tryHarder: true, tryRotate: true, maxNumberOfSymbols: 1 };
const AUTO_COOLDOWN_MS = 1500;
const SAME_TICKET_GONE_MS = 1000;

// Feedback when a ticket is scanned (owner 2026-09-29): a saved scan buzzes and gives one short high beep; one
// that wasn't saved ('error') buzzes and gives two low beeps (Android: a double buzz). The scanner reports every
// read as 'ok' and the page may then report 'error' for the same scan, so the two are merged into one.
//
// iPhones have no navigator.vibrate, and Safari buzzes only when a finger itself flips a switch-style
// checkbox (the app flipping one does nothing; tested on the owner's iPhone, iOS 18, 2026-09-29). So the
// "Press and hold" button is a <label> around a hidden switch, and the finger lifting flips it — that's the
// buzz. The switch must already be on (enabled) when the finger goes down: turning it on mid-hold, or a click
// handler on the label, stopped the buzz (owner's tests A–G). So it stays enabled, and a release with no scan
// turns it off just for that lift, so nothing flips. With no held button (Auto scan, a typed number) an iPhone
// gets the beeps only.
let holdSwitch = null;     // the hidden switch in the button being held, or null
let pendingKind = null;    // 'ok' / 'error' for the scan being reported (merged until played)
let flushTimer = null;

export function haptic(kind = 'ok') {
  if (kind === 'error' || !pendingKind) pendingKind = kind;
  // While held, it plays when the finger lifts; otherwise once this scan's reports are all in.
  if (!holdSwitch && !flushTimer) flushTimer = setTimeout(() => { flushTimer = null; playFeedback(); }, 0);
}

function playFeedback() {
  const kind = pendingKind;
  pendingKind = null;
  if (!kind) return;
  if (navigator.vibrate) navigator.vibrate(kind === 'error' ? [120, 60, 120] : 80);
  beep(kind);
}

// Runs as the finger lifts, just before the label's click flips the switch (the buzz). No scan: the switch is
// off for this click and back on right after, well before the next press.
function finishHold() {
  if (holdSwitch && !pendingKind) {
    const input = holdSwitch;
    input.disabled = true;
    setTimeout(() => { input.disabled = false; }, 100);
  }
  playFeedback();
  holdSwitch = null;
}

// Web Audio beeps. iOS lets sound start only after a tap (unlocked on the first press), and the silent switch
// mutes web sound unless the page asks for "playback" (Safari 16.4+).
let audio = null;
function unlockAudio() {
  try {
    if (!audio) {
      audio = new (window.AudioContext || window.webkitAudioContext)();
      if (navigator.audioSession) navigator.audioSession.type = 'playback';
    }
    if (audio.state === 'suspended') audio.resume();
  } catch (e) {}
}
document.addEventListener('pointerdown', unlockAudio, { capture: true });

function tone(freq, ms, at) {
  const t = audio.currentTime + at;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.25, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + ms / 1000);
  osc.connect(gain).connect(audio.destination);
  osc.start(t);
  osc.stop(t + ms / 1000);
}

function beep(kind) {
  try {
    unlockAudio();
    if (kind === 'error') { tone(300, 160, 0); tone(300, 160, 0.22); } else tone(1800, 90, 0);
  } catch (e) {}
}

// Puts the hidden switch in a <label> hold button (see above) and keeps its text in a span, since setting
// the label's text would remove the switch. Returns a function that sets the text.
function prepareHoldButton(holdBtn) {
  if (holdBtn.tagName !== 'LABEL') return { setText: (t) => { holdBtn.textContent = t; }, input: null };
  const text = document.createElement('span');
  text.textContent = holdBtn.textContent;
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.setAttribute('switch', '');
  input.className = 'hold-switch';
  input.tabIndex = -1;
  input.setAttribute('aria-hidden', 'true');
  holdBtn.replaceChildren(input, text);
  return { setText: (t) => { text.textContent = t; }, input };
}

// The buzz wiring for a Press and hold <label> (hidden switch, and which scan the lift plays). Used by
// startScanner, and by Scanner test's K button so the phone can check this exact code on its own.
export function holdFeedback(holdBtn) {
  const hold = prepareHoldButton(holdBtn);
  holdBtn.addEventListener('pointerdown', (e) => {
    holdBtn.setPointerCapture(e.pointerId);
    holdSwitch = hold.input;
    pendingKind = null;
  });
  holdBtn.addEventListener('pointerup', finishHold);
  holdBtn.addEventListener('pointercancel', finishHold);
  holdBtn.addEventListener('contextmenu', (e) => e.preventDefault());
  return hold;
}

export async function startScanner({ video, viewport, holdBtn, onStatus, onScan, mode = 'hold' }) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let holding = false;
  let done = false;
  let pausedUntil = 0;
  let lastText = null;
  let lastSeenAt = 0;

  const hold = holdFeedback(holdBtn);

  const controller = {
    setMode(next) {
      mode = next === 'auto' ? 'auto' : 'hold';
      holding = false;
      done = false;
      holdBtn.classList.add('hidden');
      if (mode === 'hold') holdBtn.classList.remove('hidden');
    },
  };
  controller.setMode(mode);

  holdBtn.addEventListener('pointerdown', () => {
    holding = true;
    done = false;
    holdBtn.classList.add('holding');
    hold.setText('Scanning…');
  });
  const release = () => {
    holding = false;
    holdBtn.classList.remove('holding');
    hold.setText('Press and hold to scan');
  };
  holdBtn.addEventListener('pointerup', release);
  holdBtn.addEventListener('pointercancel', release);

  const decoding = () => (mode === 'hold' ? holding && !done : Date.now() >= pausedUntil);

  function handle(text, format) {
    const now = Date.now();
    if (mode === 'hold') {
      if (!holding || done) return; // a decode can finish after release
      done = true;
      hold.setText('Got it — release');
    } else {
      const stillInView = text === lastText && now - lastSeenAt < SAME_TICKET_GONE_MS;
      if (text === lastText) lastSeenAt = now;
      if (now < pausedUntil || stillInView) return;
      pausedUntil = now + AUTO_COOLDOWN_MS;
      lastText = text;
      lastSeenAt = now;
    }
    viewport.classList.add('hit');
    setTimeout(() => viewport.classList.remove('hit'), 400);
    haptic();
    try {
      onScan(parseTicketBarcode(text, format));
    } catch (err) {
      onStatus(err.message);
    }
  }

  async function loop() {
    viewport.classList.toggle('paused', !decoding());
    // In auto mode keep decoding during the pause, just to notice when the last ticket leaves view.
    if ((decoding() || mode === 'auto') && video.readyState >= 2 && video.videoWidth > 0) {
      // Decode only the middle band of the frame, around the on-screen guide box.
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const sy = Math.round(vh * 0.2);
      const sh = Math.round(vh * 0.6);
      const scale = Math.min(1, 1600 / Math.max(vw, sh));
      canvas.width = Math.round(vw * scale);
      canvas.height = Math.round(sh * scale);
      ctx.drawImage(video, 0, sy, vw, sh, 0, 0, canvas.width, canvas.height);
      try {
        const results = await readBarcodes(ctx.getImageData(0, 0, canvas.width, canvas.height), READER_OPTIONS);
        if (results.length > 0) handle(results[0].text, results[0].format);
      } catch (err) {
        onStatus('Decode error: ' + err);
      }
    }
    requestAnimationFrame(loop);
  }

  // Opens the camera into the video (again, if iOS has stopped it).
  async function openCamera() {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    });
    video.srcObject = stream;
    await video.play();
    // Continuous autofocus helps a lot with small 1D barcodes, where supported.
    const track = stream.getVideoTracks()[0];
    const caps = track.getCapabilities ? track.getCapabilities() : {};
    if (caps.focusMode && caps.focusMode.includes('continuous')) {
      track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
    }
  }

  // iOS pauses the camera video while a pop-up (confirm, e.g. "Clear all scans?" or Sold out) is open or the
  // app is in the background, and doesn't start it again, so the picture froze. This restarts it — or reopens
  // the camera if it was shut — whenever the scanner is on screen. A page that closes the camera for good hides
  // it first (e.g. Close Day once closed), so it isn't reopened.
  let reviving = false;
  async function keepCameraRunning() {
    if (reviving || document.hidden || !video.isConnected || !video.offsetParent) return;
    const stream = video.srcObject;
    const live = stream && stream.getVideoTracks().some((t) => t.readyState === 'live');
    if (live && !video.paused) return;
    reviving = true;
    try {
      if (live) await video.play();
      else await openCamera();
    } catch (e) {
      // Tried again on the next check or tap.
    } finally {
      reviving = false;
    }
  }

  try {
    await prepareZXingModule({ fireImmediately: true });
    await openCamera();
    onStatus('');
    video.addEventListener('pause', () => setTimeout(keepCameraRunning, 300));
    document.addEventListener('visibilitychange', keepCameraRunning);
    window.addEventListener('focus', keepCameraRunning);
    window.addEventListener('pageshow', keepCameraRunning);
    holdBtn.addEventListener('pointerdown', keepCameraRunning);
    setInterval(keepCameraRunning, 1000);
    loop();
  } catch (err) {
    onStatus('Camera not available (' + err + '). Type the ticket number instead.');
  }
  return controller;
}
