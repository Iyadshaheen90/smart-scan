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

// --- Theft Report (owner, or an employee with theft_report; owner's request 2026-10-23) ---
// After a theft the store tells CA Lottery which tickets to stop: every pack's game, pack number and the
// range of tickets still unsold at the last known close. Nothing here writes, and it's always read fresh.
// - live: each pack in a slot, by box and slot. Its unsold tickets run from 000 to its top ticket when
//   descending (top + 1 tickets), or from the top ticket to the last one when ascending. SlotState holds the
//   top ticket of the last Close Day, or the activation ticket for a pack put in since (newSinceClose).
// - back (full: true only): sealed packs in back stock, per game. Back stock keeps no pack numbers yet
//   (they come with the database move), so only game, packs and tickets.
// Employees get it without any dollar amounts.
function theftReport(user, req) {
  const full = Boolean(req.full);
  const reserve = readTable(monthSheet('ReserveInventory'));
  const findSize = packSizeFinder(reserve);
  const lastClose = lastKnownClose();
  const live = readTable(monthSheet('SlotState'))
    .filter((s) => s.pack_key)
    .map((s) => {
      const order = orderOf(s);
      const top = Number(s.current_exposed_ticket_number);
      const price = Number(s.price_per_ticket);
      // Ascending packs need the pack size for their last ticket; descending ones always end at 000.
      const size = order === 'ascending' ? findSize(s.game_number, price) : null;
      const tickets = ticketsLeft(order, top, size);
      const lastCloseDate = dateLabel(s.last_close_date);
      return {
        box: Number(s.box), slot: Number(s.slot_number), gameNumber: String(s.game_number),
        packNumber: String(s.pack_number), order, price,
        fromTicket: order === 'ascending' ? top : 0,
        toTicket: order === 'ascending' ? (size ? size - 1 : null) : top,
        tickets, dollars: tickets * price,
        // Put in after the last close: its range starts at the activation ticket, not a closing count.
        newSinceClose: !lastCloseDate,
      };
    })
    .sort((a, b) => a.box - b.box || a.slot - b.slot);
  const back = !full ? null : reserve
    .filter((r) => packsInBack(r) > 0 && !r.ended_date)
    .map((r) => {
      const packs = packsInBack(r);
      const ticketsPerPack = Number(r.tickets_per_pack) || 0;
      const price = Number(r.price_per_ticket) || 0;
      return { gameNumber: String(r.game_number), price, ticketsPerPack, packs, tickets: packs * ticketsPerPack,
        dollars: packs * ticketsPerPack * price };
    })
    .sort((a, b) => a.gameNumber.localeCompare(b.gameNumber));
  const totals = (lines) => ({ packs: lines.reduce((sum, l) => sum + (l.packs || 1), 0),
    tickets: lines.reduce((sum, l) => sum + l.tickets, 0), dollars: lines.reduce((sum, l) => sum + l.dollars, 0) });
  const report = {
    full,
    madeAt: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm'),
    lastClose,
    live: { lines: live, ...totals(live) },
    back: back && { lines: back, ...totals(back) },
  };
  return user.role === 'owner' ? report : theftReportWithoutDollars(report);
}

// The last Close Day the store made: { date, closedAt?, closedBy? }, from this month's DailySummary, or the
// month before's when this month has none yet (e.g. the morning of the 1st). null when there's none at all.
function lastKnownClose() {
  const latest = (rows) => rows.slice().sort((a, b) => dateLabel(a.close_date).localeCompare(dateLabel(b.close_date))).pop();
  const row = latest(readTable(monthSheet('DailySummary'))) || lastCloseBeforeThisMonth(latest);
  if (!row) return null;
  const close = { date: dateLabel(row.close_date) };
  if (row.closed_at) close.closedAt = closedAtLabel(row.closed_at);
  if (row.closed_by) close.closedBy = String(row.closed_by);
  return close;
}

// The newest DailySummary row of the latest month before the current one (undefined when none).
function lastCloseBeforeThisMonth(latest) {
  const current = getCurrentMonth().label;
  const earlier = readTable(getControlSpreadsheet().getSheetByName('Months'))
    .filter((m) => normalizeMonthLabel(m.month_label) < current)
    .sort((a, b) => normalizeMonthLabel(b.month_label).localeCompare(normalizeMonthLabel(a.month_label)))[0];
  if (!earlier) return undefined;
  return latest(readTable(SpreadsheetApp.openById(earlier.spreadsheet_id).getSheetByName('DailySummary')));
}

// An employee's Theft Report: the same packs and ticket ranges, with every dollar amount taken out.
function theftReportWithoutDollars(report) {
  const strip = ({ dollars, ...rest }) => rest;
  const section = (s) => s && { ...strip(s), lines: s.lines.map(strip) };
  return { ...report, live: section(report.live), back: section(report.back) };
}
