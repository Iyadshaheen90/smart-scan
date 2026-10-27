// The move to the database: turns the monthly spreadsheets (as exportMonth hands them over, oldest month first) into the
// database's rows for one store. Pure: no network, so it's tested on its own (test/import-map.js).
//
//   const { rows, problems } = buildImport(months, members);
//
// - Setup rows come from the newest month (the tabs carried forward: Users, SlotConfig, SlotState, ReserveInventory).
// - The logs (closes, day totals, pack endings, shifts, shipments, back stock removals) come from every month, in order.
// - A pack is one row: live from the newest SlotState, ended from any month's PackHistory (sold out, returned, full pack
//   sale). Its close lines point at it by game and pack number (the database links them by id on the way in).
// - members: [{ username, email }] (kept outside the repo); each user in the sheets needs an email.
// Anything that doesn't fit the database (a pack ended twice, a close line for an unknown pack, a user with no email)
// is listed in `problems` and nothing should be imported until it's sorted out.

const blank = (v) => v === '' || v === null || v === undefined;
const text = (v) => (blank(v) ? null : String(v));
const num = (v) => (blank(v) ? null : Number(v));
const int = (v) => (blank(v) ? null : Math.round(Number(v)));
const bool = (v) => v === true || String(v).toUpperCase() === 'TRUE';
const date = (v) => (blank(v) ? null : String(v).slice(0, 10));
// "2026-09-27 22:52:10" store time (seconds optional); a bare date stays a date.
const stamp = (v) => {
  if (blank(v)) return null;
  const s = String(v);
  return s.length === 16 ? `${s}:00` : s;
};
const order = (v) => (String(v) === 'ascending' ? 'ascending' : 'descending');

// A tab's rows as objects keyed by its header row.
function table(month, name) {
  const t = month.tabs[name];
  if (!t || t.length === 0) return [];
  const [headers, ...rows] = t;
  return rows.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ''])));
}

// "1234-0012345" -> { game: '1234', pack: '0012345' }.
function splitKey(key) {
  const s = String(key);
  const at = s.indexOf('-');
  return at < 0 ? null : { game: s.slice(0, at), pack: s.slice(at + 1) };
}

const END_TYPES = ['sold_out', 'returned', 'full_pack'];

function buildImport(months, members) {
  const problems = [];
  if (!months.length) return { rows: null, problems: ['No months to import.'] };
  const newest = months[months.length - 1];
  const all = (name) => months.flatMap((m) => table(m, name).map((r) => ({ ...r, _month: m.label })));

  // A log row dated outside its month's spreadsheet (Start New Month moves those across; one left behind would be
  // imported twice or in the wrong month).
  for (const [tab, col] of Object.entries({ DailyCloseLog: 'close_date', DailySummary: 'close_date', Shipments: 'shipment_date',
    ReserveAdjustments: 'adjustment_date', PackHistory: 'end_date', ShiftCloses: 'shift_date' })) {
    for (const r of all(tab)) {
      if (date(r[col]) && date(r[col]).slice(0, 7) !== r._month) {
        problems.push(`${tab} in ${r._month} has a row dated ${date(r[col])}.`);
      }
    }
  }

  // ---------- People ----------
  const emailOf = Object.fromEntries(members.map((m) => [String(m.username).toLowerCase(), m.email]));
  const people = table(newest, 'Users').map((u) => {
    const username = String(u.username);
    const email = emailOf[username.toLowerCase()];
    if (!email) problems.push(`No email for user "${username}".`);
    return { username, role: u.role === 'owner' ? 'owner' : 'employee', active: bool(u.active),
      permissions: String(u.permissions || '').split(',').map((p) => p.trim()).filter(Boolean),
      createdOn: date(u.created_date), email: email ? String(email).trim().toLowerCase() : null };
  });
  for (const m of members) {
    if (!people.some((p) => p.username.toLowerCase() === String(m.username).toLowerCase())) {
      problems.push(`"${m.username}" is in the email list but not a user in the sheets.`);
    }
  }
  if (people.filter((p) => p.role === 'owner').length !== 1) problems.push('There should be exactly one owner.');

  // ---------- Slots ----------
  const state = table(newest, 'SlotState');
  const stateAt = (box, slot) => state.find((s) => Number(s.box) === box && Number(s.slot_number) === slot);
  const slots = table(newest, 'SlotConfig').map((c) => {
    const box = int(c.box); const slot = int(c.slot_number);
    const s = stateAt(box, slot);
    return { box, slot, price: num(c.price_per_ticket), order: order(c.ticket_order), lastGame: s ? text(s.last_game_number) : null };
  });

  // ---------- Games ----------
  // Every game the store has seen: newest back stock first (its price, pack size, packs in the back and ended date),
  // then any game only met in an older month or in the logs.
  const games = new Map();
  for (const g of table(newest, 'ReserveInventory')) {
    const size = int(g.tickets_per_pack);
    const inBack = int(g.packs_in_reserve) || 0;
    if (!blank(g.tickets_in_reserve) && int(g.tickets_in_reserve) !== inBack * size) {
      problems.push(`Game ${g.game_number}: ${g.tickets_in_reserve} tickets in the back isn't ${inBack} whole packs of ${size}.`);
    }
    games.set(String(g.game_number), { game: String(g.game_number), price: num(g.price_per_ticket), size, inBack,
      endedOn: date(g.ended_date) });
  }
  const meet = (game, price, size) => {
    if (!game || games.has(game)) return;
    games.set(game, { game, price, size, inBack: 0, endedOn: null });
  };
  for (const m of [...months].reverse()) {
    for (const g of table(m, 'ReserveInventory')) meet(String(g.game_number), num(g.price_per_ticket), int(g.tickets_per_pack));
  }
  for (const s of all('Shipments')) meet(String(s.game_number), num(s.price_per_ticket), int(s.tickets_per_pack));

  // ---------- Close lines (every month) ----------
  const closeRows = all('DailyCloseLog').map((r, i) => ({ ...r, _n: i }));
  const linesOf = (key) => closeRows.filter((r) => String(r.pack_key) === key);

  // ---------- Packs ----------
  const packs = new Map(); // key -> pack
  const add = (key, pack, where) => {
    if (packs.has(key)) {
      problems.push(`Pack ${key} is ${packs.get(key)._where} and also ${where}: the database keeps one row per pack.`);
      return;
    }
    packs.set(key, { ...pack, _where: where });
  };
  for (const m of months) {
    for (const h of table(m, 'PackHistory')) {
      const key = `${h.game_number}-${h.pack_number}`;
      const reason = String(h.end_reason);
      if (!['sold_out', 'returned', 'full_pack_sale'].includes(reason)) {
        problems.push(`Pack ${key} in ${m.label} ended with an unknown reason "${reason}".`);
        continue;
      }
      // The close line that ended it: its top ticket before the end, and when it happened.
      const ending = linesOf(key).filter((r) => END_TYPES.includes(String(r.close_type))).pop();
      const g = games.get(String(h.game_number));
      meet(String(h.game_number), num(h.price_per_ticket), g ? g.size : null);
      add(key, { game: String(h.game_number), pack: String(h.pack_number), status: reason,
        box: int(h.box), slot: int(h.slot_number), price: num(h.price_per_ticket), order: order(h.ticket_order),
        top: ending && reason !== 'full_pack_sale' ? int(ending.previous_exposed_ticket_number) : null,
        activationTicket: firstTop(linesOf(key)), activatedOn: date(h.activation_date),
        lastCloseOn: lastCloseOn(linesOf(key)), endedOn: date(h.end_date),
        endedAt: (ending && stamp(ending.logged_at)) || (date(h.end_date) && `${date(h.end_date)} 12:00:00`),
        endReason: reason, remainingAtEnd: int(h.remaining_at_return), performedBy: text(h.performed_by) },
      `ended (${reason}) in ${m.label}`);
    }
  }
  for (const s of state.filter((x) => !blank(x.pack_key))) {
    const key = String(s.pack_key);
    const top = int(s.current_exposed_ticket_number);
    add(key, { game: String(s.game_number), pack: String(s.pack_number), status: 'live', box: int(s.box), slot: int(s.slot_number),
      price: num(s.price_per_ticket), order: order(s.ticket_order), top,
      activationTicket: firstTop(linesOf(key)) ?? top, activatedOn: date(s.activation_date), lastCloseOn: date(s.last_close_date),
      priceBefore: num(s.price_before_activation), tookFromBack: blank(s.took_from_reserve) ? null : bool(s.took_from_reserve) },
    `live in box ${s.box}, slot ${s.slot_number}`);
    meet(String(s.game_number), num(s.price_per_ticket), null);
  }

  const summaries = all('DailySummary');
  const closeEntries = closeRows.map((r) => {
    const key = String(r.pack_key);
    if (!packs.has(key)) problems.push(`A close line on ${date(r.close_date)} is for pack ${key}, which isn't live or ended anywhere.`);
    const type = String(r.close_type);
    if (!['close', ...END_TYPES].includes(type)) problems.push(`A close line for pack ${key} has an unknown type "${type}".`);
    const parts = splitKey(key) || {};
    return { date: date(r.close_date), box: int(r.box), slot: int(r.slot_number), game: parts.game, pack: parts.pack,
      previous: int(r.previous_exposed_ticket_number), current: int(r.current_exposed_ticket_number),
      tickets: int(r.tickets_sold), price: num(r.price_per_ticket), dollars: num(r.dollars_sold),
      remainingAfter: int(r.remaining_after_close), type, late: bool(r.late_activation), performedBy: text(r.performed_by),
      previousCloseOn: date(r.previous_close_date),
      loggedAt: stamp(r.logged_at) || closedAtOf(summaries, date(r.close_date)) || `${date(r.close_date)} 23:00:00` };
  });

  const dailyCloses = summaries.map((d) => ({ date: date(d.close_date), tickets: int(d.total_tickets_sold),
    dollars: num(d.total_dollars_sold), liveSlots: int(d.occupied_slot_count), inventory: num(d.total_inventory_value),
    closeId: text(d.close_id), closedBy: text(d.closed_by), closedAt: stamp(d.closed_at) }));
  const days = dailyCloses.map((d) => d.date);
  for (const d of days.filter((x, i) => days.indexOf(x) !== i)) problems.push(`Two day totals for ${d}.`);

  const shiftCloses = all('ShiftCloses').map((s) => ({ id: String(s.shift_id), date: date(s.shift_date),
    closedBy: String(s.closed_by), startedAt: stamp(s.started_at), closedAt: stamp(s.closed_at), tickets: int(s.tickets_sold),
    dollars: num(s.dollars_sold), slotsScanned: int(s.slots_scanned), endedTickets: int(s.ended_tickets) || 0,
    endedDollars: num(s.ended_dollars) || 0 }));
  const shiftEntries = all('ShiftCloseLog').map((e) => {
    const key = text(e.pack_key);
    const parts = key ? splitKey(key) : null;
    return { shiftId: String(e.shift_id), box: int(e.box), slot: int(e.slot_number), packKey: key,
      game: parts && packs.has(key) ? parts.game : null, pack: parts && packs.has(key) ? parts.pack : null,
      start: int(e.start_ticket), end: int(e.end_ticket), tickets: int(e.tickets_sold), price: num(e.price_per_ticket),
      dollars: num(e.dollars_sold), type: String(e.entry_type) };
  });
  for (const e of shiftEntries) {
    if (!shiftCloses.some((s) => s.id === e.shiftId)) problems.push(`A shift line belongs to shift ${e.shiftId}, which isn't there.`);
  }

  const shipments = all('Shipments').map((s) => {
    const source = String(s.source || 'delivery');
    if (!['delivery', 'add pack'].includes(source)) problems.push(`A shipment on ${date(s.shipment_date)} has source "${source}".`);
    if (!(int(s.packs_received) > 0)) problems.push(`A shipment on ${date(s.shipment_date)} of game ${s.game_number} has ${s.packs_received} packs.`);
    return { date: date(s.shipment_date), game: String(s.game_number), price: num(s.price_per_ticket), size: int(s.tickets_per_pack),
      packs: int(s.packs_received), source, notes: text(s.notes), performedBy: text(s.performed_by) };
  });
  const REASONS = ['count', 'returned', 'game expired', 'damaged', 'stolen', 'other', 'adjust'];
  const adjustments = all('ReserveAdjustments').map((a) => {
    if (!REASONS.includes(String(a.reason))) problems.push(`A back stock change on ${date(a.adjustment_date)} has reason "${a.reason}".`);
    meet(String(a.game_number), null, null);
    return { date: date(a.adjustment_date), game: String(a.game_number), packs: int(a.packs_removed),
      tickets: int(a.tickets_removed), reason: String(a.reason), notes: text(a.notes), performedBy: text(a.performed_by) };
  });

  for (const g of games.values()) {
    if (!g.price || !g.size) problems.push(`Game ${g.game}: no price or pack size to import it with.`);
  }
  const packList = [...packs.values()].map(({ _where, ...p }) => p);
  return {
    rows: { slots, games: [...games.values()], packs: packList, closeEntries, dailyCloses, shiftCloses, shiftEntries, shipments,
      adjustments, people },
    problems: [...new Set(problems)],
  };
}

// The pack's top ticket before its first close line (where it started), or null with none.
function firstTop(lines) {
  const first = lines[0];
  return first && !blank(first.previous_exposed_ticket_number) ? int(first.previous_exposed_ticket_number) : null;
}

// The last nightly close it was counted in.
function lastCloseOn(lines) {
  const closes = lines.filter((r) => String(r.close_type) === 'close').map((r) => date(r.close_date)).sort();
  return closes.length ? closes[closes.length - 1] : null;
}

// When that day's close was saved (a close line made before logged_at existed takes it).
function closedAtOf(summaries, day) {
  const d = summaries.find((s) => date(s.close_date) === day);
  return d ? stamp(d.closed_at) : null;
}

module.exports = { buildImport, table, splitKey };
