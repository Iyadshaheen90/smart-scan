// The Reports tab (owner only): this month's shipments received and packs returned, read from the
// month's log tabs. Nothing here writes; each list starts empty with each new month's spreadsheet.

const ADDED_BY_HAND_SOURCE = 'add pack'; // Manage packs + (adjustBackStock); scanned-in deliveries are 'delivery'

// This month's Shipments rows as report lines, newest day first, then by game. The same game received
// more than once on a day is one line; packs added by hand stay apart from scanned ones (their own tag).
// Total value = tickets × price, as in Months & totals "Shipments in".
function listShipments() {
  const byLine = {};
  readTable(monthSheet('Shipments')).forEach((s) => {
    const date = dateLabel(s.shipment_date);
    const gameNumber = String(s.game_number);
    const addedByHand = s.source === ADDED_BY_HAND_SOURCE;
    const key = `${date}|${gameNumber}|${addedByHand}`;
    const line = byLine[key] || (byLine[key] = { date, gameNumber, packs: 0, price: Number(s.price_per_ticket),
      ticketsPerPack: Number(s.tickets_per_pack), dollars: 0, addedByHand });
    line.packs += Number(s.packs_received) || 0;
    line.dollars += (Number(s.tickets_received) || 0) * (Number(s.price_per_ticket) || 0);
  });
  const lines = Object.values(byLine).sort((a, b) => b.date.localeCompare(a.date) || a.gameNumber.localeCompare(b.gameNumber));
  return { ...reportTotals(lines), lines };
}

// This month's returns to the lottery, newest day first:
// - kind 'slot': a partial pack returned from a slot (PackHistory, end_reason 'returned'), one line per pack;
//   its value is the tickets that went back × price. An undone return has no row, so it isn't listed.
// - kind 'back': sealed packs removed from back stock with the reason "returned" (ReserveAdjustments),
//   the same game on the same day as one line; price from the game's back stock row.
function listReturns() {
  const prices = {};
  const sizes = {};
  readTable(monthSheet('ReserveInventory')).forEach((r) => {
    prices[String(r.game_number)] = Number(r.price_per_ticket) || 0;
    sizes[String(r.game_number)] = Number(r.tickets_per_pack) || 0;
  });
  const slotLines = readTable(monthSheet('PackHistory'))
    .filter((p) => p.end_reason === 'returned')
    .map((p) => {
      const ticketsReturned = Number(p.remaining_at_return) || 0;
      const price = Number(p.price_per_ticket) || 0;
      const gameNumber = String(p.game_number);
      return { date: dateLabel(p.end_date), kind: 'slot', gameNumber, packNumber: String(p.pack_number),
        box: Number(p.box), slot: Number(p.slot_number), packs: 1, ticketsReturned, price,
        ticketsPerPack: sizes[gameNumber] || STANDARD_PACK_SIZES[price] || 0, dollars: ticketsReturned * price };
    });
  const byLine = {};
  readTable(monthSheet('ReserveAdjustments')).filter((a) => a.reason === 'returned').forEach((a) => {
    const date = dateLabel(a.adjustment_date);
    const gameNumber = String(a.game_number);
    const key = `${date}|${gameNumber}`;
    const line = byLine[key] || (byLine[key] = { date, kind: 'back', gameNumber, packs: 0, tickets: 0,
      price: prices[gameNumber] || 0, dollars: 0 });
    line.packs += Number(a.packs_removed) || 0;
    line.tickets += Number(a.tickets_removed) || 0;
  });
  const backLines = Object.values(byLine).map(({ tickets, ...line }) => ({ ...line,
    ticketsPerPack: line.packs ? tickets / line.packs : 0, dollars: tickets * line.price }));
  const lines = [...slotLines, ...backLines].sort((a, b) => b.date.localeCompare(a.date) || a.gameNumber.localeCompare(b.gameNumber));
  return { ...reportTotals(lines), lines };
}

// { packs, dollars } of a report's lines.
function reportTotals(lines) {
  return { packs: lines.reduce((sum, l) => sum + l.packs, 0), dollars: lines.reduce((sum, l) => sum + l.dollars, 0) };
}

// The numbers on the Reports list, in one request: sold this month (sum of the month's closed days,
// as Months & totals adds them), and the totals of the two reports.
function reportsPage() {
  const monthDollars = readTable(monthSheet('DailySummary')).reduce((sum, d) => sum + (Number(d.total_dollars_sold) || 0), 0);
  const total = ({ packs, dollars }) => ({ packs, dollars });
  return { monthDollars, shipments: total(listShipments()), returns: total(listReturns()) };
}
