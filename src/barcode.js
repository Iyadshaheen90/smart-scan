// Parses the barcode on the back of a California Lottery scratcher ticket
// (under "SCAN FRONT BARCODE FOR VALIDATION AND 2ND CHANCE ENTRY").
//
// Printed:  GGGG-PPPPPPP-C-TTT          e.g. 1747-1263622-4-075
// Barcode:  GGGG PPPPPPP TTT 000000000 XXX  (ITF, 26 digits)
//           e.g. 17471263622075000000000478
//
// The printed check digit C is not encoded in the barcode. The nine zeros are where the
// front (scratch-off) barcode carries the hidden validation number, so a non-zero value
// there means the wrong barcode was scanned. The trailing XXX is not yet understood.

const TICKET_BARCODE_LENGTH = 26;

const FIELDS = {
  gameNumber: [0, 4],
  packNumber: [4, 11],
  ticketNumber: [11, 14],
  reserved: [14, 23],
  trailer: [23, 26],
};

class BarcodeParseError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'BarcodeParseError';
    this.code = code;
  }
}

// Returns { gameNumber, packNumber, ticketNumber, raw } or throws BarcodeParseError.
// gameNumber and packNumber stay strings (leading zeros matter); ticketNumber is a number.
function parseTicketBarcode(raw, format) {
  if (format && format !== 'ITF') {
    throw new BarcodeParseError('wrong_format', `Not a ticket barcode (got ${format}, expected ITF).`);
  }
  const text = String(raw ?? '').trim();
  if (!/^\d+$/.test(text)) {
    throw new BarcodeParseError('not_numeric', 'Barcode should contain only digits.');
  }
  if (text.length !== TICKET_BARCODE_LENGTH) {
    throw new BarcodeParseError('wrong_length', `Barcode has ${text.length} digits, expected ${TICKET_BARCODE_LENGTH}.`);
  }

  const field = (name) => text.slice(...FIELDS[name]);

  if (!/^0+$/.test(field('reserved'))) {
    throw new BarcodeParseError('front_barcode', 'This looks like the front validation barcode — scan the barcode on the back of the ticket.');
  }

  return {
    gameNumber: field('gameNumber'),
    packNumber: field('packNumber'),
    ticketNumber: Number(field('ticketNumber')),
    raw: text,
  };
}

// Human-readable form matching what's printed on the ticket, minus the check digit.
function formatTicket({ gameNumber, packNumber, ticketNumber }) {
  return `${gameNumber}-${packNumber}-${String(ticketNumber).padStart(3, '0')}`;
}

if (typeof module !== 'undefined') {
  module.exports = { parseTicketBarcode, formatTicket, BarcodeParseError, TICKET_BARCODE_LENGTH };
}
