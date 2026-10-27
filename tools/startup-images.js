// iPhone launch pictures (owner 2026-10-26: a black flash on opening the home-screen app). Until the first page draws,
// iOS shows the page's apple-touch-startup-image, or a plain black screen when none fits the phone; black then the app's
// near-black --bg looked like a flash. So each picture is pure black (--launch-bg in style.css), one per iPhone screen
// size, linked from index.html and login.html (the start pages). Black, not --bg (owner 2026-10-27: still a flash; the
// screen recording showed iOS zooms the app open in pure black whatever the picture says, then the gray --bg came in),
// so the whole launch stays black until the launch screen fades into the page. Re-run after adding a screen size, then
// paste the printed <link> lines into both pages. The file name changes with the color, since iOS keeps old pictures.
// Run: node tools/startup-images.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const BG = [0x00, 0x00, 0x00]; // --launch-bg in style.css
// Screen size in points (portrait) and pixels per point, newest phones last.
const SCREENS = [
  [375, 667, 2], // SE (2nd/3rd), 8
  [414, 736, 3], // 8 Plus
  [375, 812, 3], // X, XS, 11 Pro, 12 mini, 13 mini
  [414, 896, 2], // XR, 11
  [414, 896, 3], // XS Max, 11 Pro Max
  [390, 844, 3], // 12, 13, 14, 16e
  [428, 926, 3], // 12/13 Pro Max, 14 Plus
  [393, 852, 3], // 14 Pro, 15, 15 Pro, 16
  [430, 932, 3], // 14 Pro Max, 15 Plus, 15 Pro Max, 16 Plus
  [402, 874, 3], // 16 Pro, 17, 17 Pro
  [420, 912, 3], // Air
  [440, 956, 3], // 16 Pro Max, 17 Pro Max
];

// One solid-color PNG: 8-bit RGB, every row the same.
function solidPng(width, height, [r, g, b]) {
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x += 1) row.set([r, g, b], 1 + x * 3);
  const raw = Buffer.concat(Array(height).fill(row));
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 2; // 8 bits, RGB
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const dir = path.join(__dirname, '..', 'src', 'icons', 'startup');
fs.mkdirSync(dir, { recursive: true });
const links = SCREENS.map(([w, h, dpr]) => {
  const file = `launch-black-${w * dpr}x${h * dpr}.png`;
  fs.writeFileSync(path.join(dir, file), solidPng(w * dpr, h * dpr, BG));
  return `<link rel="apple-touch-startup-image" href="icons/startup/${file}" media="(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${dpr}) and (orientation: portrait)">`;
});
console.log(links.join('\n'));
