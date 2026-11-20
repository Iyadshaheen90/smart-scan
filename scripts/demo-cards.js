// Printable demo cards for in-store demos and App Store review (owner 2026-11-20; ~/.claude/plans/smart-scan-demo-design.md).
// Made-up games (9001-9004) and packs in the real 26-digit ITF layout (src/barcode.js), so the app scans them like
// tickets. No real tickets, game names or logos (third-party rule). Page 1 is the demo script, then cut-out cards.
//   node scripts/demo-cards.js [out.pdf]     writes the PDF (default ~/Desktop/Smart Scan Demo Cards.pdf)
//   node scripts/demo-cards.js --check       only checks every barcode reads back right (same reader + options as the app)
// The PDF is always checked before it is written. Needs Google Chrome + puppeteer-core (like the browser tests).
const fs = require('fs'); const os = require('os'); const path = require('path');
const puppeteer = require('puppeteer-core');
const { parseTicketBarcode } = require('../src/barcode.js');

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
// Same reader and options as src/scanner.js (READER_OPTIONS).
const ZXING = 'https://cdn.jsdelivr.net/npm/zxing-wasm@3.1.4/dist/es/reader/index.js';
const READER_OPTIONS = { formats: ['ITF'], tryHarder: true, tryRotate: true, maxNumberOfSymbols: 1 };

// Pack sizes follow STANDARD_PACK_SIZES. Ticket order is descending (the default): a full pack's top ticket is the
// last one (size - 1), and tickets sold = last top - new top. "shift" / "day" are the top after those sales.
const GAMES = [
  { game: '9001', price: 20, size: 30, packs: ['0100001', '0100002'], sold: [8, 9] },
  { game: '9002', price: 10, size: 50, packs: ['0200001', '0200002'], sold: [8, 9] },
  { game: '9003', price: 5, size: 80, packs: ['0300001'], sold: [14, 15] },
  { game: '9004', price: 2, size: 100, packs: ['0400001'], sold: [19, 20] },
];
const pad3 = (n) => String(n).padStart(3, '0');

function cards() {
  const out = [];
  for (const g of GAMES) {
    g.packs.forEach((pack, i) => {
      const letter = String.fromCharCode(65 + i);
      const full = g.size - 1; const shift = full - g.sold[0]; const day = shift - g.sold[1];
      for (const [use, ticket, note] of [
        ['Receive · Activate', full, 'Full pack'],
        ['Close Shift', shift, `${g.sold[0]} sold`],
        ['Close Day', day, `${g.sold[1]} more sold`],
      ]) {
        const digits = `${g.game}${pack}${pad3(ticket)}000000000000`;
        out.push({ ...g, pack, letter, use, ticket, note, digits, printed: `${g.game}-${pack}-${pad3(ticket)}` });
      }
    });
  }
  return out;
}

// ITF (Interleaved 2 of 5): digit pairs, first digit in the bars, second in the spaces; N = 1 module, W = 3.
const ITF = ['NNWWN', 'WNNNW', 'NWNNW', 'WWNNN', 'NNWNW', 'WNWNN', 'NWWNN', 'NNNWW', 'WNNWN', 'NWNWN'];
function itfSvg(digits) {
  const widths = [1, 1, 1, 1]; // start: bar space bar space
  for (let i = 0; i < digits.length; i += 2) {
    const a = ITF[digits[i]]; const b = ITF[digits[i + 1]];
    for (let k = 0; k < 5; k++) widths.push(a[k] === 'W' ? 3 : 1, b[k] === 'W' ? 3 : 1);
  }
  widths.push(3, 1, 1); // stop: wide bar, space, bar
  const quiet = 12; let x = quiet; let rects = '';
  widths.forEach((w, i) => { if (i % 2 === 0) rects += `<rect x="${x}" y="0" width="${w}" height="40"/>`; x += w; });
  const total = x + quiet;
  return `<svg class="bars" viewBox="0 0 ${total} 40" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges"><rect width="${total}" height="40" fill="#fff"/><g fill="#000">${rects}</g></svg>`;
}

function html(list) {
  const card = (c) => `
    <div class="card" data-digits="${c.digits}">
      <div class="top"><span class="demo">Demo card · not a lottery ticket</span><span class="use">${c.use}</span></div>
      <div class="name"><b>$${c.price}</b> · Game ${c.game} · Pack ${c.letter}<span class="note">${c.note}</span></div>
      ${itfSvg(c.digits)}
      <div class="num">${c.printed}</div>
    </div>`;
  const step = (n, t, d) => `<li><span class="n">${n}</span><div><b>${t}</b><p>${d}</p></div></li>`;
  const games = GAMES.map((g) => `<tr><td>Game ${g.game}</td><td>$${g.price}</td><td>${g.size}</td><td>${g.packs.length === 2 ? 'A, B' : 'A'}</td></tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Smart Scan Demo Cards</title><style>
    @page { size: Letter; margin: 10mm; }
    * { box-sizing: border-box; }
    body { margin: 0; font: 10pt/1.4 -apple-system, "Helvetica Neue", Arial, sans-serif; color: #1a1d1d; }
    .guide { page-break-after: always; padding: 4mm 6mm; }
    h1 { font-size: 20pt; margin: 0 0 1mm; letter-spacing: -0.3px; }
    .sub { color: #5b6363; margin: 0 0 7mm; }
    h2 { font-size: 9pt; text-transform: uppercase; letter-spacing: 1px; color: #5b6363; margin: 7mm 0 3mm; }
    ol { list-style: none; padding: 0; margin: 0; }
    li { display: flex; gap: 4mm; padding: 3mm 0; border-top: 0.3mm solid #e3e7e7; }
    li p { margin: 0.5mm 0 0; color: #3d4444; }
    .n { flex: none; width: 6.5mm; height: 6.5mm; border-radius: 50%; background: #1a1d1d; color: #fff;
         font-weight: 600; font-size: 9pt; display: flex; align-items: center; justify-content: center; }
    table { border-collapse: collapse; width: 60%; }
    td, th { text-align: left; padding: 1.5mm 3mm 1.5mm 0; border-bottom: 0.3mm solid #e3e7e7; }
    th { font-weight: 600; color: #5b6363; font-size: 8.5pt; }
    .foot { margin-top: 8mm; color: #5b6363; font-size: 8.5pt; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; }
    .card { height: 50.5mm; padding: 4mm 5mm; border: 0.3mm dashed #b8c0c0; margin: -0.15mm; break-inside: avoid;
            display: flex; flex-direction: column; }
    .top { display: flex; justify-content: space-between; font-size: 7pt; text-transform: uppercase; letter-spacing: 0.6px; }
    .demo { color: #5b6363; }
    .use { font-weight: 700; }
    .name { font-size: 11pt; margin: 2mm 0 2.5mm; }
    .note { float: right; color: #5b6363; font-size: 9pt; }
    .bars { width: 80mm; height: 17mm; display: block; margin: 0 auto; }
    .num { text-align: center; font: 10pt/1 "SF Mono", Menlo, monospace; letter-spacing: 1px; margin-top: 2mm; }
  </style></head><body>
  <section class="guide">
    <h1>Smart Scan demo</h1>
    <p class="sub">Made-up games and packs for showing the app. These cards are not lottery tickets.</p>
    <h2>Demo games</h2>
    <table><tr><th>Game</th><th>Price</th><th>Tickets / pack</th><th>Packs</th></tr>${games}</table>
    <h2>Demo steps</h2>
    <ol>
      ${step(1, 'Set up the store', 'Store name, hours, boxes and slots with their prices. Keep the ticket order ↓ (the default).')}
      ${step(2, 'Shipment Received', 'Stock → Scan → Shipment Received. Scan the <b>Receive · Activate</b> card of every pack (6 packs). For a new game, pick its price.')}
      ${step(3, 'Activate', 'Activate Several: scan the <b>Receive · Activate</b> card of Pack A of each game. Pack B of 9001 and 9002 stays in the back.')}
      ${step(4, 'Close Shift', 'Scan the <b>Close Shift</b> card of each live pack. The app shows the tickets sold and the money.')}
      ${step(5, 'Close Day', 'Scan the <b>Close Day</b> cards. Then open the day’s report and download the Excel or PDF.')}
      ${step(6, 'Restock from the back', 'Sold Out Pack A of 9001. Home shows Pack B to restock. Scan Pack B of 9002 to see the Wrong Game warning, then Pack B of 9001.')}
    </ol>
    <p class="foot">Cut along the dashed lines. Cards assume ticket order ↓; you can also type the number under a barcode. Print at 100% (no “fit to page”).</p>
  </section>
  <div class="grid">${list.map(card).join('')}</div>
  </body></html>`;
}

// Draws each card's barcode onto a canvas (2× print size) and reads it with zxing-wasm, like the app's scanner.
async function check(page, list) {
  const read = await page.evaluate(async (zxing, options) => {
    const { readBarcodes, prepareZXingModule } = await import(zxing);
    await prepareZXingModule({ fireImmediately: true });
    const out = [];
    for (const el of document.querySelectorAll('.card')) {
      const svg = el.querySelector('svg'); const box = svg.getBoundingClientRect();
      const img = new Image(); img.src = 'data:image/svg+xml;base64,' + btoa(new XMLSerializer().serializeToString(svg));
      await img.decode();
      const canvas = document.createElement('canvas'); canvas.width = box.width * 2 + 40; canvas.height = box.height * 2 + 40;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 20, 20, box.width * 2, box.height * 2);
      const r = await readBarcodes(ctx.getImageData(0, 0, canvas.width, canvas.height), options);
      out.push({ want: el.dataset.digits, got: r[0] ? r[0].text : null, format: r[0] ? r[0].format : null });
    }
    return out;
  }, ZXING, READER_OPTIONS);
  let bad = 0;
  read.forEach((r, i) => {
    let parsed = null;
    try { parsed = parseTicketBarcode(r.got, r.format); } catch (e) { /* counted below */ }
    const c = list[i];
    const ok = r.got === r.want && parsed && parsed.gameNumber === c.game && parsed.packNumber === c.pack && parsed.ticketNumber === c.ticket;
    if (!ok) { bad++; console.log(`FAIL ${c.printed}: read ${r.got} (${r.format})`); }
  });
  console.log(`${read.length - bad} of ${read.length} barcodes read back right (zxing-wasm, app's options, app's parser).`);
  return bad === 0;
}

(async () => {
  const onlyCheck = process.argv.includes('--check');
  const out = process.argv.slice(2).find((a) => !a.startsWith('--')) || path.join(os.homedir(), 'Desktop', 'Smart Scan Demo Cards.pdf');
  const list = cards();
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
  try {
    const page = await browser.newPage();
    await page.goto('about:blank');
    await page.setContent(html(list), { waitUntil: 'load' });
    if (!(await check(page, list))) { process.exitCode = 1; return; }
    if (onlyCheck) return;
    await page.pdf({ path: out, format: 'Letter', printBackground: true, preferCSSPageSize: true });
    console.log(`Wrote ${out}`);
  } finally { await browser.close(); }
})();
