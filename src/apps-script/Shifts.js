// Shift closes (optional; owner's request 2026-09-30). Whoever ends a shift scans every live slot, the same
// walk as Close Day. The shift's sales, who closed it and when are saved, and the owner compares them with the
// register by hand. The app doesn't judge errors; it only records the numbers.
//
// - A shift close never closes the day and never changes anything Close Day uses: it writes only to
//   ShiftCloses and ShiftCloseLog, never SlotState, DailyCloseLog or DailySummary. Close Day still counts the
//   whole day from last night's close, and Slots keeps showing last night's top tickets (owner's choice).
// - A slot's shift start ticket is the pack's ticket at today's last shift close, else its top ticket from
//   the last Close Day (SlotState), which for a pack activated today is its activation ticket.
// - Sold out at a shift close: every ticket left counts as sold this shift, but the pack stays in the slot
//   (it's ended by Close Day or the owner). Later shift closes that day show it "sold out · 0" with no scan.
// - Packs the owner ends and full packs sold during the shift (DailyCloseLog rows logged since the previous
//   shift close, by logged_at) count in that shift, less anything an earlier shift close already counted.
// - Employees may close one shift a day; the owner deleting it lets them close it again. The owner has no limit.
// - No shift closes after the day is closed: its sales are already in the night close.
// - This month's spreadsheet may not have the two tabs yet: reads see none, the first write creates them.

// ('full_pack' is FULL_PACK_TYPE, written out: Apps Script may load this file before FullPacks.js.)
const SHIFT_ENDED_TYPES = ['sold_out', 'returned', 'full_pack'];

// "2026-09-30 15:02:11", script time zone. Sorts in time order as text.
function nowStamp() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
}

// A stamp as text, even if Sheets handed the cell back as a Date.
function stampLabel(value) {
  if (value instanceof Date) return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
  return value == null ? '' : String(value);
}

// Rows of a shift tab, or none when this month's spreadsheet doesn't have it yet.
function shiftRows(name) {
  const sheet = monthSheet(name);
  return sheet ? readTable(sheet) : [];
}

// A shift tab for writing, created the first time it's needed.
function shiftSheet(name) {
  let sheet = monthSheet(name);
  if (!sheet) {
    ensureTabs(openCurrentMonth(), { [name]: MONTHLY_TABS[name] });
    sheet = monthSheet(name);
  }
  ensureHeaders(sheet, MONTHLY_TABS[name]);
  return sheet;
}

// The day's shift closes, oldest first.
function shiftsOn(date) {
  return shiftRows('ShiftCloses')
    .filter((r) => dateLabel(r.shift_date) === date)
    .sort((a, b) => stampLabel(a.closed_at).localeCompare(stampLabel(b.closed_at)));
}

// pack_key -> { ticket, soldOut, closedAt } from the day's last shift close that counted the pack.
// The log is appended in time order, so the last row for a pack is the latest.
function shiftStarts(date) {
  const starts = {};
  const closedAt = Object.fromEntries(shiftsOn(date).map((s) => [s.shift_id, stampLabel(s.closed_at)]));
  for (const row of shiftRows('ShiftCloseLog')) {
    if (dateLabel(row.shift_date) !== date || !(row.shift_id in closedAt)) continue;
    const soldOut = row.entry_type === 'sold_out' || row.entry_type === 'sold_out_earlier';
    if (!soldOut && row.entry_type !== 'scan') continue;
    starts[row.pack_key] = { ticket: soldOut ? null : Number(row.end_ticket), soldOut, closedAt: closedAt[row.shift_id] };
  }
  return starts;
}

// What the Close shift screen needs: the live slots with each pack's shift start ticket in place of the
// last close's (exposedTicket / remaining), whether the day is closed, the previous shift close today,
// and for an employee their own shift close today (they get one a day).
function shiftStatus(user) {
  const today = todayLabel();
  const shifts = shiftsOn(today);
  const last = shifts[shifts.length - 1];
  const starts = shiftStarts(today);
  const slots = listSlots().map((s) => {
    const start = s.pack && starts[`${s.pack.gameNumber}-${s.pack.packNumber}`];
    if (!start) return s;
    const pack = start.soldOut
      ? { ...s.pack, exposedTicket: -1, remaining: 0, soldOutAtShift: closedAtLabel(start.closedAt) }
      : { ...s.pack, exposedTicket: start.ticket, remaining: start.ticket + 1 };
    return { ...s, pack };
  });
  const mine = user.role === 'owner' ? null : shifts.filter((s) => s.closed_by === user.username).pop();
  return {
    today,
    largeSaleTickets: LARGE_SALE_TICKETS,
    dayClosed: Boolean(todaysSummary()),
    since: last ? { closedAt: closedAtLabel(last.closed_at), closedBy: String(last.closed_by) } : null,
    myShiftToday: mine ? shiftFor(user, mine) : null,
    slots,
  };
}

// entries: [{ box, slot, packKey, type: 'scan' | 'sold_out', ticketNumber? }], one for every live slot
// except those already sold out at an earlier shift close today (no scan needed; any entry is ignored).
// shiftId: made by the phone, so a shift close sent twice (the answer got lost) is saved once.
// date: the day the phone scanned it.
function submitShiftClose(user, entries, shiftId, date) {
  if (!Array.isArray(entries)) throw new ApiError('bad_request', 'Nothing to submit.');
  return withLock(() => {
    const closes = shiftRows('ShiftCloses');
    const sent = shiftId && closes.find((r) => r.shift_id === shiftId);
    if (sent) return { ...shiftFor(user, sent), alreadySent: true };
    const today = todayLabel();
    if (date && date !== today) {
      throw new ApiError('wrong_day', `This shift close was scanned on ${date} and wasn't sent that day, so it wasn't saved.`);
    }
    if (todaysSummary()) throw new ApiError('already_closed', "Today has already been closed, so there's no shift left to close.");
    if (user.role !== 'owner') {
      const mine = closes.find((r) => r.closed_by === user.username && dateLabel(r.shift_date) === today);
      if (mine) {
        throw new ApiError('already_closed_shift', `You already closed your shift today at ${closedAtLabel(mine.closed_at)}. `
          + 'Only the owner can delete it so you can close it again.');
      }
    }
    const shifts = shiftsOn(today);
    const since = shifts.length ? stampLabel(shifts[shifts.length - 1].closed_at) : null;
    const starts = shiftStarts(today);
    const live = readTable(monthSheet('SlotState')).filter((s) => s.pack_key);

    // Check everything before writing anything.
    const plan = live.map((state) => {
      const start = starts[state.pack_key];
      const price = Number(state.price_per_ticket);
      const row = { box: Number(state.box), slot: Number(state.slot_number), packKey: state.pack_key, price };
      if (start && start.soldOut) return { ...row, type: 'sold_out_earlier', start: '', end: '', sold: 0 };
      const entry = entries.find((e) => isSlot(e.box, e.slot)(state));
      const where = `Box ${state.box}, slot ${state.slot_number}`;
      if (!entry) throw new ApiError('incomplete', `${where} hasn't been scanned.`);
      if (entry.packKey !== state.pack_key) {
        throw new ApiError('slots_changed', `${where} now holds pack ${state.pack_key}, not ${entry.packKey}. Reload Close shift.`);
      }
      if (!CLOSE_ENTRY_TYPES.includes(entry.type)) throw new ApiError('bad_request', `${where}: unknown entry.`);
      const exposed = start ? start.ticket : Number(state.current_exposed_ticket_number);
      if (entry.type === 'sold_out') return { ...row, type: 'sold_out', start: exposed, end: '', sold: exposed + 1 };
      const ticket = Number(entry.ticketNumber);
      if (!Number.isInteger(ticket) || ticket < 0 || ticket > exposed) {
        throw new ApiError('bad_ticket', `${where}: ticket ${entry.ticketNumber} is above the shift's start ticket (${exposed}). Rescan it.`);
      }
      return { ...row, type: 'scan', start: exposed, end: ticket, sold: exposed - ticket };
    });
    const extra = entries.find((e) => !live.some(isSlot(e.box, e.slot)));
    if (extra) throw new ApiError('slots_changed', `Box ${extra.box}, slot ${extra.slot} has no pack now. Reload Close shift.`);

    const closedAt = nowStamp();
    const ended = endedInShift(today, since, closedAt, starts);
    const id = shiftId || `${today}-${closedAt}-${user.username}`;
    const logSheet = shiftSheet('ShiftCloseLog');
    for (const r of [...plan, ...ended]) {
      appendObject(logSheet, {
        shift_id: id,
        shift_date: today,
        box: r.box,
        slot_number: r.slot,
        pack_key: r.packKey,
        start_ticket: r.start,
        end_ticket: r.end,
        tickets_sold: r.sold,
        price_per_ticket: r.price,
        dollars_sold: r.sold * r.price,
        entry_type: r.type,
      });
    }
    const sum = (rows, f) => rows.reduce((total, r) => total + f(r), 0);
    const all = [...plan, ...ended];
    const shift = {
      shift_id: id,
      shift_date: today,
      closed_by: user.username,
      started_at: since || '',
      closed_at: closedAt,
      tickets_sold: sum(all, (r) => r.sold),
      dollars_sold: sum(all, (r) => r.sold * r.price),
      slots_scanned: plan.filter((r) => r.type !== 'sold_out_earlier').length,
      ended_tickets: sum(ended, (r) => r.sold),
      ended_dollars: sum(ended, (r) => r.sold * r.price),
    };
    appendObject(shiftSheet('ShiftCloses'), shift);
    return shiftFor(user, shift);
  });
}

// Packs ended (owner's Sold out / Returned, or replaced) and full packs sold during the shift: DailyCloseLog
// rows dated `date` logged after `since` (the previous shift close; null = the first shift today) up to
// `until`. Rows from before logged_at existed have none and count in the day's first shift. A pack an earlier
// shift close already counted is counted from that shift's ticket.
function endedInShift(date, since, until, starts) {
  return readTable(monthSheet('DailyCloseLog'))
    .filter((r) => dateLabel(r.close_date) === date && SHIFT_ENDED_TYPES.includes(r.close_type))
    .filter((r) => {
      const at = r.logged_at ? stampLabel(r.logged_at) : '';
      if (!at) return !since;
      return (!since || at > since) && at <= until;
    })
    .map((r) => {
      const price = Number(r.price_per_ticket);
      const row = { box: r.box === '' ? '' : Number(r.box), slot: r.slot_number === '' ? '' : Number(r.slot_number),
        packKey: String(r.pack_key), price, type: r.close_type === FULL_PACK_TYPE ? FULL_PACK_TYPE : `ended_${r.close_type}` };
      const counted = r.close_type === FULL_PACK_TYPE ? null : starts[r.pack_key];
      if (!counted) {
        return { ...row, start: Number(r.previous_exposed_ticket_number), end: r.close_type === 'returned' ? Number(r.current_exposed_ticket_number) : '',
          sold: Number(r.tickets_sold) };
      }
      if (counted.soldOut) return { ...row, start: '', end: '', sold: 0 };
      const end = r.close_type === 'returned' ? Number(r.current_exposed_ticket_number) : '';
      return { ...row, start: counted.ticket, end, sold: r.close_type === 'returned' ? counted.ticket - end : counted.ticket + 1 };
    });
}

// A shift close as the pages show it. Employees don't see dollars.
function shiftFor(user, shift) {
  const result = {
    shiftId: String(shift.shift_id),
    date: dateLabel(shift.shift_date),
    closedBy: String(shift.closed_by),
    closedAt: closedAtLabel(shift.closed_at),
    since: shift.started_at ? closedAtLabel(shift.started_at) : null,
    ticketsSold: Number(shift.tickets_sold),
    slotsScanned: Number(shift.slots_scanned),
  };
  if (user.role === 'owner') {
    result.dollarsSold = Number(shift.dollars_sold);
    result.endedTickets = Number(shift.ended_tickets) || 0;
    result.endedDollars = Number(shift.ended_dollars) || 0;
  }
  return result;
}

// Owner: this month's shift closes, newest first, each with its slots and the packs ended during it.
function listShiftCloses(user) {
  const log = shiftRows('ShiftCloseLog');
  const shifts = shiftRows('ShiftCloses')
    .sort((a, b) => stampLabel(b.closed_at).localeCompare(stampLabel(a.closed_at)))
    .map((s) => ({
      ...shiftFor(user, s),
      rows: log.filter((r) => r.shift_id === s.shift_id).map((r) => ({
        box: r.box === '' ? null : Number(r.box),
        slot: r.slot_number === '' ? null : Number(r.slot_number),
        packKey: String(r.pack_key),
        start: r.start_ticket === '' ? null : Number(r.start_ticket),
        end: r.end_ticket === '' ? null : Number(r.end_ticket),
        sold: Number(r.tickets_sold),
        price: Number(r.price_per_ticket),
        dollars: Number(r.dollars_sold),
        type: String(r.entry_type),
      })),
    }));
  return { count: shifts.length, shifts };
}

// Owner: removes a shift close made by mistake. A wrong scan would otherwise be every later shift's start
// ticket that day, and an employee can close their shift again once theirs is deleted.
function deleteShiftClose(user, req) {
  const shiftId = String(req.shiftId || '');
  return withLock(() => {
    const isShift = (r) => r.shift_id === shiftId;
    if (!shiftRows('ShiftCloses').some(isShift)) throw new ApiError('nothing_to_delete', "That shift close isn't saved any more.");
    deleteRowsWhere(shiftSheet('ShiftCloseLog'), isShift);
    deleteRowsWhere(shiftSheet('ShiftCloses'), isShift);
    return listShiftCloses(user);
  });
}

// For the owner home's Shift Closure card: this month's count and the latest one.
function shiftHomeSummary() {
  const shifts = shiftRows('ShiftCloses').sort((a, b) => stampLabel(a.closed_at).localeCompare(stampLabel(b.closed_at)));
  const last = shifts[shifts.length - 1];
  return {
    count: shifts.length,
    last: last ? { date: dateLabel(last.shift_date), closedAt: closedAtLabel(last.closed_at), closedBy: String(last.closed_by) } : null,
  };
}
