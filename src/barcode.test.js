// Run with: node --test src/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseTicketBarcode, formatTicket } = require('./barcode.js');

// Real tickets, decoded from photos (printed text in comments).
test('parses real ticket 1747-1263622-4-075', () => {
  const t = parseTicketBarcode('17471263622075000000000478', 'ITF');
  assert.deepEqual(t, { gameNumber: '1747', packNumber: '1263622', ticketNumber: 75, raw: '17471263622075000000000478' });
  assert.equal(formatTicket(t), '1747-1263622-075');
});

test('parses real ticket 1718-1279742-6-028', () => {
  const t = parseTicketBarcode('17181279742028000000000879', 'ITF');
  assert.equal(t.gameNumber, '1718');
  assert.equal(t.packNumber, '1279742');
  assert.equal(t.ticketNumber, 28);
});

// Three consecutive live-camera scans from one pack (iPhone, 2026-09-23): only the ticket
// number (counting down) and the trailing 3 digits change.
test('parses consecutive tickets from one pack', () => {
  const scans = ['17181279742028000000000879', '17181279742027000000000712', '17181279742026000000000545'];
  const parsed = scans.map((s) => parseTicketBarcode(s, 'ITF'));
  assert.deepEqual(parsed.map((t) => t.ticketNumber), [28, 27, 26]);
  assert.ok(parsed.every((t) => t.gameNumber === '1718' && t.packNumber === '1279742'));
});

test('keeps leading zeros in game and pack, handles ticket 000', () => {
  const t = parseTicketBarcode('01230045678000000000000123');
  assert.equal(t.gameNumber, '0123');
  assert.equal(t.packNumber, '0045678');
  assert.equal(t.ticketNumber, 0);
});

test('trims surrounding whitespace', () => {
  assert.equal(parseTicketBarcode(' 17471263622075000000000478\n').ticketNumber, 75);
});

const rejects = (raw, format, code) => assert.throws(() => parseTicketBarcode(raw, format), (e) => e.code === code);

test('rejects non-ITF barcodes', () => rejects('17471263622075000000000478', 'Code128', 'wrong_format'));
test('rejects non-digits', () => rejects('1747-1263622-4-075', 'ITF', 'not_numeric'));
test('rejects empty input', () => rejects('', 'ITF', 'not_numeric'));
test('rejects wrong length', () => rejects('317020184796', 'ITF', 'wrong_length'));
test('rejects front validation barcode (non-zero reserved digits)', () => rejects('17471263622075123456789478', 'ITF', 'front_barcode'));
