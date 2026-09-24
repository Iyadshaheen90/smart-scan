// Press-and-hold ticket scanner for the app pages (raw-scanner.html is the standalone test bench).
// Decodes only while the button is held, and takes at most one scan per press.
// Needs barcode.js loaded first (for parseTicketBarcode).
//
//   startScanner({ video, viewport, holdBtn, onStatus, onScan })
//   onScan(ticket) gets the parsed ticket; a barcode that isn't a ticket goes to onStatus instead.

import { readBarcodes, prepareZXingModule } from 'https://cdn.jsdelivr.net/npm/zxing-wasm@3.1.4/dist/es/reader/index.js';

// Ticket barcodes are 26-digit ITF; see barcode.js for the layout.
const READER_OPTIONS = { formats: ['ITF'], tryHarder: true, tryRotate: true, maxNumberOfSymbols: 1 };

export async function startScanner({ video, viewport, holdBtn, onStatus, onScan }) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let holding = false;
  let done = false;

  holdBtn.addEventListener('pointerdown', (e) => {
    holdBtn.setPointerCapture(e.pointerId);
    holding = true;
    done = false;
    holdBtn.classList.add('holding');
    holdBtn.textContent = 'Scanning…';
  });
  const release = () => {
    holding = false;
    holdBtn.classList.remove('holding');
    holdBtn.textContent = 'Press and hold to scan';
  };
  holdBtn.addEventListener('pointerup', release);
  holdBtn.addEventListener('pointercancel', release);
  holdBtn.addEventListener('contextmenu', (e) => e.preventDefault());

  function handle(text, format) {
    if (!holding || done) return; // a decode can finish after release
    done = true;
    holdBtn.textContent = 'Got it — release';
    viewport.classList.add('hit');
    setTimeout(() => viewport.classList.remove('hit'), 400);
    if (navigator.vibrate) navigator.vibrate(80);
    try {
      onScan(parseTicketBarcode(text, format));
    } catch (err) {
      onStatus(err.message);
    }
  }

  async function loop() {
    viewport.classList.toggle('paused', !holding || done);
    if (holding && !done && video.readyState >= 2 && video.videoWidth > 0) {
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

  try {
    await prepareZXingModule({ fireImmediately: true });
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
    onStatus('');
    loop();
  } catch (err) {
    onStatus('Camera not available (' + err + '). Type the ticket number instead.');
  }
}
