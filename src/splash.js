// Launch screen (owner 2026-10-26): SMART types across in white and SCAN types down in green, sharing the first S;
// a barcode fills the corner between them and grows with each letter. After the last letter it stretches out to full
// width and a green scanner beam sweeps back and forth across it. The tagline and the Loading bar sit at the bottom.
// Shown once each time the app is opened (sessionStorage), on Home and Sign In only. Load it as the first thing in
// <body> so the page never shows under it. data-wait: stay up until the page calls splashReady() (Home, until its
// numbers arrive). data-needs-session: skip it with no sign-in (Home sends you on to Sign In, which shows it).
(function () {
  window.splashReady = () => {};
  const script = document.currentScript;
  const KEY = 'smartScanSplash';
  try {
    if (sessionStorage.getItem(KEY)) return;
    if (script.hasAttribute('data-needs-session') && !localStorage.getItem('smartScanSession')) return;
    sessionStorage.setItem(KEY, '1');
  } catch (e) {
    return; // No storage (private mode): never risk showing it on every page.
  }

  const STEP = 170;         // ms between letters
  const FIRST = 150;        // ms before the S
  const STRETCH = 520;      // ms the barcode takes to stretch out
  const MIN_SWEEPS = 1;     // full passes of the beam before it may close (one pass = SWEEP ms)
  const SWEEP = 900;        // ms for the beam to cross once (matches style.css)
  const LONGEST = 8000;     // never stay up longer than this, even with no answer from the server
  const still = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Bars and gaps in units, left to right (a made-up pattern, not a real ticket's).
  const PATTERN = [3, 1, 1, 2, 2, 1, 1, 1, 4, 2, 1, 1, 2, 1, 1, 3, 3, 1, 1, 2, 2, 1, 1, 1, 4, 1, 1, 2, 2, 1, 3, 1, 1, 2, 1, 1, 2, 2, 4, 1, 1, 1, 2, 1, 3];
  const total = PATTERN.reduce((a, b) => a + b, 0);
  const bars = PATTERN.map((units, i) => `<span class="${i % 2 ? 'gap' : 'bar'}" style="width:${(units / total) * 100}%"></span>`).join('');

  // A 5 × 4 grid: S M A R T across the top row, C A N down the first column, the barcode in the corner.
  const across = ['M', 'A', 'R', 'T'].map((ch, i) => `<span class="splash-letter across" data-step="${i + 1}" style="grid-area:1/${i + 2}">${ch}</span>`).join('');
  const down = ['C', 'A', 'N'].map((ch, i) => `<span class="splash-letter down" data-step="${i + 1}" style="grid-area:${i + 2}/1">${ch}</span>`).join('');
  const el = document.createElement('div');
  el.className = 'splash';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-label', 'Loading Smart Scan');
  el.innerHTML = `
    <div class="splash-logo" aria-hidden="true">
      <span class="splash-letter shared" data-step="0" style="grid-area:1/1">S</span>${across}${down}
      <div class="splash-code" style="grid-area:2/2/5/6"><div class="splash-bars">${bars}</div><div class="splash-beam"></div></div>
    </div>
    <div class="splash-foot">
      <div class="splash-tagline">Scratcher Inventory and Sales Tracking</div>
      <div class="splash-loading">Loading…</div>
      <div class="splash-track"><div class="splash-fill"></div></div>
    </div>`;
  document.body.append(el);

  const started = Date.now();
  const letters = (step) => el.querySelectorAll(`.splash-letter[data-step="${step}"]`);
  const code = el.querySelector('.splash-code');
  // The barcode fills more of the corner with each letter, then stretches to full width.
  const grow = (part) => code.style.setProperty('--grow', part);
  let typedAt;
  if (still) {
    el.querySelectorAll('.splash-letter').forEach((l) => l.classList.add('on'));
    grow(1);
    typedAt = 0;
  } else {
    grow(0.15);
    for (let step = 0; step <= 4; step += 1) {
      setTimeout(() => {
        el.querySelectorAll('.caret-across, .caret-down').forEach((l) => l.classList.remove('caret-across', 'caret-down'));
        letters(step).forEach((l) => {
          l.classList.add('on');
          // A caret after the newest letter of each word: beside it across, under it down (the S has both).
          if (step < 4) l.classList.add(l.classList.contains('across') ? 'caret-across' : l.classList.contains('down') ? 'caret-down' : 'caret-across');
          if (l.classList.contains('shared')) l.classList.add('caret-down');
        });
        if (step < 4) grow(0.15 + step * 0.12);
      }, FIRST + step * STEP);
    }
    typedAt = FIRST + 4 * STEP;
    setTimeout(() => { code.classList.add('stretched'); grow(1); }, typedAt + 120);
    setTimeout(() => code.classList.add('scanning'), typedAt + 120 + STRETCH);
  }
  const earliest = still ? 600 : typedAt + 120 + STRETCH + MIN_SWEEPS * SWEEP;
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
