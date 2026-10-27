// Launch screen (owner 2026-10-26): SMART across in white and SCAN down in green, sharing the first S. The letters come
// in one at a time, S M A R T then C A N, each with a quick fade, while a green cursor blinks in the next letter's place.
// Two beats after the N, a barcode slides open in the corner between them and a green scanner beam sweeps back and
// forth across it. The tagline and the Loading bar sit at the bottom. (Motion from the owner's smart-scan-splash.html,
// with the app's own colors, sizes, words and Loading bar.)
// Shown once each time the app is opened (sessionStorage), on Home and Sign In only. Load it as the first thing in
// <body> so the page never shows under it. data-wait: stay up until the page calls splashReady() (Home, until its
// numbers arrive). Home with no sign-in sends you on to Sign In first (html.leaving), which shows it.
(function () {
  window.splashReady = () => {};
  const script = document.currentScript;
  const KEY = 'smartScanSplash';
  if (document.documentElement.classList.contains('leaving')) return; // Home passing you on to Sign In.
  try {
    if (sessionStorage.getItem(KEY)) return;
    sessionStorage.setItem(KEY, '1');
  } catch (e) {
    return; // No storage (private mode): never risk showing it on every page.
  }

  const STEP = 140;         // ms between letters (one beat)
  const OPEN_AT = 10;       // beat the barcode opens on (the N comes on beat 8)
  const OPEN = 800;         // ms the barcode takes to slide open (matches style.css)
  const SWEEP = 1300;       // ms for the beam to cross once (matches style.css)
  const LONGEST = 8000;     // never stay up longer than this, even with no answer from the server
  const still = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Bars and gaps in units, left to right (a made-up pattern, not a real ticket's).
  const PATTERN = [3, 1, 1, 2, 2, 1, 1, 1, 4, 2, 1, 1, 2, 1, 1, 3, 3, 1, 1, 2, 2, 1, 1, 1, 4, 1, 1, 2, 2, 1, 3, 1, 1, 2, 1, 1, 2, 2, 4, 1, 1, 1, 2, 1, 3];
  const total = PATTERN.reduce((a, b) => a + b, 0);
  const bars = PATTERN.map((units, i) => `<span class="${i % 2 ? 'gap' : 'bar'}" style="width:${(units / total) * 100}%"></span>`).join('');

  // A 5 × 4 grid: S M A R T across the top row, C A N down the first column, the barcode in the corner.
  // [letter, column, row, kind], in the order they come in.
  const CELLS = [['S', 1, 1, 'shared'], ['M', 2, 1, 'across'], ['A', 3, 1, 'across'], ['R', 4, 1, 'across'], ['T', 5, 1, 'across'],
    ['C', 1, 2, 'down'], ['A', 1, 3, 'down'], ['N', 1, 4, 'down']];
  const letterHtml = CELLS.map(([ch, col, row, kind], i) => `<span class="splash-letter ${kind}" data-step="${i}" style="grid-area:${row}/${col}">${ch}</span>`).join('');
  const el = document.createElement('div');
  el.className = 'splash';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-label', 'Loading Smart Scan');
  el.innerHTML = `
    <div class="splash-logo" aria-hidden="true">
      ${letterHtml}<span class="splash-cursor"></span>
      <div class="splash-code" style="grid-area:2/2/5/6"><div class="splash-bars">${bars}<div class="splash-beam"></div></div></div>
    </div>
    <div class="splash-foot">
      <div class="splash-tagline">Scratcher Inventory and Sales Tracking</div>
      <div class="splash-loading">Loading…</div>
      <div class="splash-track"><div class="splash-fill"></div></div>
    </div>`;
  document.body.append(el);

  const started = Date.now();
  const code = el.querySelector('.splash-code');
  const cursor = el.querySelector('.splash-cursor');
  // The cursor sits under the place the next letter goes, and goes away after the last one.
  const placeCursor = (step) => {
    if (step >= CELLS.length) { cursor.remove(); return; }
    cursor.style.gridArea = `${CELLS[step][2]}/${CELLS[step][1]}`;
  };
  // The barcode opens and the beam starts sweeping at the same moment.
  const open = () => code.classList.add('stretched', 'scanning');
  if (still) {
    el.querySelectorAll('.splash-letter').forEach((l) => l.classList.add('on'));
    cursor.remove();
    open();
  } else {
    placeCursor(0);
    CELLS.forEach((cell, step) => setTimeout(() => {
      el.querySelector(`.splash-letter[data-step="${step}"]`).classList.add('on');
      placeCursor(step + 1);
    }, (step + 1) * STEP));
    setTimeout(open, OPEN_AT * STEP);
  }
  // Up at least until the barcode is open and the beam has crossed once.
  const earliest = still ? 600 : OPEN_AT * STEP + Math.max(OPEN, SWEEP);
  el.querySelector('.splash-fill').style.animationDuration = `${earliest}ms`;

  let ready = !script.hasAttribute('data-wait');
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    el.classList.add('done');
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 360);
    }, 180);
  }
  function closeWhenAllowed() {
    if (ready) setTimeout(close, Math.max(0, earliest - (Date.now() - started)));
  }
  window.splashReady = () => {
    if (ready) return;
    ready = true;
    closeWhenAllowed();
  };
  closeWhenAllowed();
  setTimeout(close, LONGEST);
})();
