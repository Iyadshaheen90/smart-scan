// Close Day: once a day, every live pack's top ticket is recorded (the phone collects the scans
// and sends them in one submitClose call). Tickets sold = last recorded top ticket - today's
// top ticket; a pack activated today counts from the ticket it was activated at.
//
// Anyone signed in can close. The owner can reopen today's close to fix it, which puts every
// slot's top ticket back and removes the summary; packs marked sold out during the close stay
// ended (the owner can put them back with undoEndPack).
//
// A missed day (owner 2026-10-26: a broken or forgotten phone): a close counts every sales line logged since the
// previous close, so a day nobody closed has its sold outs, returns and full pack sales counted by the next close
// (its scanned sales already are: tickets count from the last close). And **Close Yesterday**: the next morning,
// before 12:00 PM and before anything changed today, anyone can close yesterday late (submitClose with late: true),
// recorded under yesterday's date; the owner can reopen that late close on the same terms.

// Every live slot must be scanned (an unchanged top ticket means 0 sold) or marked sold out.
// There is deliberately no "no sales" shortcut: it let a slot be skipped without checking it.
const CLOSE_ENTRY_TYPES = ['scan', 'sold_out'];
// A slot selling more than this many tickets in a day is flagged on the phone before submitting.
const LARGE_SALE_TICKETS = 50;

// The log tab, with any columns added since the month's spreadsheet was made.
function closeLogSheet() {
  const sheet = monthSheet('DailyCloseLog');
  ensureHeaders(sheet, MONTHLY_TABS.DailyCloseLog);
  return sheet;
}

// The pack's last close before `row` was logged, for putting it back when the row is undone.
// Rows logged before previous_close_date was kept fall back to this month's log.
function closeBefore(row, log) {
  return dateLabel(row.previous_close_date) || log
    .filter((r) => r.pack_key === row.pack_key && r.close_type === 'close')
    .map((r) => dateLabel(r.close_date)).sort().pop() || '';
}

function dailySummarySheet() {
  const sheet = monthSheet('DailySummary');
  ensureHeaders(sheet, MONTHLY_TABS.DailySummary);
  return sheet;
}

function todaysSummary() {
  return summaryOn(todayLabel());
}

function summaryOn(date) {
  return readTable(monthSheet('DailySummary')).find((d) => dateLabel(d.close_date) === date) || null;
}

// A day's sales lines are counted once a close on that day or a later one is saved (a missed day's by the next close).
function coveredByClose(date) {
  return readTable(monthSheet('DailySummary')).some((d) => dateLabel(d.close_date) >= date);
}

// The newest close before `date` in this month's spreadsheet, '' if none: a close counts the lines after it.
function lastCloseBefore(date) {
  return readTable(monthSheet('DailySummary')).map((d) => dateLabel(d.close_date)).filter((d) => d < date).sort().pop() || '';
}

function dayBefore(label) {
  const d = new Date(`${label}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd');
}

// Close Yesterday is open until this time of day (owner's choice: noon), while scratchers are unlikely to have sold yet.
const CLOSE_YESTERDAY_UNTIL = '12:00';
const CLOSE_YESTERDAY_UNTIL_LABEL = '12:00 PM';

// Why yesterday can't be closed late any more although it's still morning: something already changed today, so a
// late close would mix today's sales into yesterday's. null when nothing has.
function changedToday(today) {
  const putIn = readTable(slotStateSheet())
    .some((s) => s.pack_key && dateLabel(s.activation_date) === today && !dateLabel(s.last_close_date));
  if (putIn) return 'A pack was already put in a slot today';
  if (readTable(monthSheet('DailyCloseLog')).some((r) => dateLabel(r.close_date) === today)) {
    return 'A pack was already sold out, returned or sold whole today';
  }
  if (shiftsOn(today).length) return 'A shift was already closed today';
  return null;
}

// What stops a late close of yesterday (or reopening one), as the error to throw; null when it's allowed.
// Sheets only: yesterday's close goes in this month's spreadsheet, so not once a new month has been started over it.
function closeYesterdayRefusal(today) {
  if (summaryOn(today)) return new ApiError('too_late', "Today is already closed, so yesterday's sales are counted in today's close.");
  if (nowStamp().slice(11, 16) >= CLOSE_YESTERDAY_UNTIL) {
    return new ApiError('too_late', `Yesterday can only be closed before ${CLOSE_YESTERDAY_UNTIL_LABEL}. Its sales will count in tonight's close.`);
  }
  if (getCurrentMonth().label !== dayBefore(today).slice(0, 7)) {
    return new ApiError('too_late', "Yesterday is in last month, which is already finished. Its sales will count in tonight's close.");
  }
  return null;
}

// For Home and Close Day: { date, until, closed? , blocked? } while Close Yesterday applies, else null.
// closed: yesterday's late close made this morning (it can be reopened). blocked: why it can't be closed now.
function closeYesterdayStatus(user, today) {
  const yesterday = dayBefore(today);
  if (closeYesterdayRefusal(today)) return null;
  const summary = summaryOn(yesterday);
  if (summary) return isLateClose(summary) ? { date: yesterday, until: CLOSE_YESTERDAY_UNTIL_LABEL, closed: summaryFor(user, summary) } : null;
  const changed = changedToday(today);
  return { date: yesterday, until: CLOSE_YESTERDAY_UNTIL_LABEL, blocked: changed ? `${changed}, so yesterday can't be closed now. Its sales will count in tonight's close.` : null };
}

// A close saved on a later day than the one it closes (Close Yesterday).
function isLateClose(summary) {
  return Boolean(summary.closed_at) && closedAtDay(summary.closed_at) > dateLabel(summary.close_date);
}
function closedAtDay(value) {
  if (value instanceof Date) return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return String(value).slice(0, 10);
}

// Sales logged outside Close Day (a pack sold out or returned) belong to today, unless today is
// already closed — then they count toward tomorrow's close.
function salesDate() {
  const today = todayLabel();
  if (!todaysSummary()) return today;
  const next = new Date(`${today}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return Utilities.formatDate(next, 'UTC', 'yyyy-MM-dd');
}

// What the Close Day screen needs: every slot (in order) and whether today is already closed.
// myShiftToday: an employee's own shift close today, for the home page (they get one a day).
function closeStatus(user) {
  const summary = todaysSummary();
  const today = todayLabel();
  const mine = user.role === 'owner' ? null : shiftsOn(today).filter((s) => s.closed_by === user.username).pop();
  return {
    today,
    largeSaleTickets: LARGE_SALE_TICKETS,
    closed: summary ? summaryFor(user, summary) : null,
    myShiftToday: mine ? shiftFor(user, mine) : null,
    closeYesterday: closeYesterdayStatus(user, today),
    // So the employee's home shows what the owner turned on since they signed in.
    permissions: user.permissions,
    slots: listSlots(),
  };
}

// entries: [{ box, slot, packKey, type: 'scan' | 'sold_out', ticketNumber? }],
// one for every slot with a live pack.
// closeId: made by the phone once per close. If the connection drops after the close was saved, the
// phone sends it again with the same closeId and gets the saved close back instead of an error.
// date: the day the phone started the close. A close still unsent at midnight is refused rather than
// recorded as the next day's (which would block that night's close); its sales count in the next close.
// late: Close Yesterday — the close is yesterday's (date is yesterday), while closeYesterdayRefusal allows it.
function submitClose(user, entries, closeId, date, late) {
  if (!Array.isArray(entries)) throw new ApiError('bad_request', 'Nothing to submit.');
  return withLock(() => {
    const summarySheet = dailySummarySheet();
    const sent = closeId && readTable(summarySheet).find((d) => d.close_id === closeId);
    if (sent) return { ...summaryFor(user, sent), alreadySent: true };
    const today = todayLabel();
    // The day this close is for: today, or yesterday for Close Yesterday.
    const day = late ? dayBefore(today) : today;
    if (date && date !== day) {
      throw new ApiError('wrong_day', `This close was scanned on ${date} and couldn't be sent that day, so it wasn't saved. `
        + "Those sales will count in today's close. Open Close Day and scan again.");
    }
    if (late) {
      if (summaryOn(day)) throw new ApiError('already_closed', 'Yesterday has already been closed.');
      const refusal = closeYesterdayRefusal(today);
      if (refusal) throw refusal;
      const changed = changedToday(today);
      if (changed) throw new ApiError('too_late', `${changed}, so yesterday can't be closed now. Its sales will count in tonight's close.`);
    } else if (todaysSummary()) {
      throw new ApiError('already_closed', 'Today has already been closed.');
    }
    const stateSheet = slotStateSheet();
    const live = readTable(stateSheet).filter((s) => s.pack_key);

    const findSize = packSizeFinder();

    // Check everything before writing anything.
    const plan = live.map((state) => {
      const entry = entries.find((e) => isSlot(e.box, e.slot)(state));
      const where = `Box ${state.box}, slot ${state.slot_number}`;
      if (!entry) throw new ApiError('incomplete', `${where} hasn't been scanned.`);
      if (entry.packKey !== state.pack_key) {
        throw new ApiError('slots_changed', `${where} now holds pack ${state.pack_key}, not ${entry.packKey}. Reload Close Day.`);
      }
      if (!CLOSE_ENTRY_TYPES.includes(entry.type)) throw new ApiError('bad_request', `${where}: unknown entry.`);
      const exposed = Number(state.current_exposed_ticket_number);
      const order = orderOf(state);
      const size = sizeFor(order, state, findSize);
      let ticket = exposed;
      if (entry.type === 'scan') {
        ticket = Number(entry.ticketNumber);
        if (!Number.isInteger(ticket) || ticket < 0 || alreadySold(order, exposed, ticket) || (size && ticket >= size)) {
          throw new ApiError('bad_ticket', `${where}: ticket ${entry.ticketNumber} is ${soldSide(order)} the last top ticket (${exposed}). Rescan it.`);
        }
      }
      return { state, entry, exposed, ticket, order, size };
    });
    const extra = entries.find((e) => !live.some(isSlot(e.box, e.slot)));
    if (extra) throw new ApiError('slots_changed', `Box ${extra.box}, slot ${extra.slot} has no pack now. Reload Close Day.`);

    for (const { state, entry, exposed, ticket, order, size } of plan) {
      if (entry.type === 'sold_out') {
        endPackInSlot(user, state, 'sold_out', undefined, late ? day : undefined);
        continue;
      }
      const sold = ticketsSold(order, exposed, ticket);
      const price = Number(state.price_per_ticket);
      appendObject(closeLogSheet(), {
        close_date: day,
        box: Number(state.box),
        slot_number: Number(state.slot_number),
        pack_key: state.pack_key,
        previous_exposed_ticket_number: exposed,
        current_exposed_ticket_number: ticket,
        tickets_sold: sold,
        price_per_ticket: price,
        dollars_sold: sold * price,
        remaining_after_close: ticketsLeft(order, ticket, size),
        close_type: 'close',
        late_activation: dateLabel(state.activation_date) === day,
        performed_by: user.username,
        previous_close_date: dateLabel(state.last_close_date) || '',
      });
      updateRowsWhere(stateSheet, isSlot(state.box, state.slot_number), {
        current_exposed_ticket_number: ticket,
        last_close_date: day,
      });
    }

    const summary = {
      ...buildSummary(day, user),
      close_id: closeId || '',
      closed_by: user.username,
      closed_at: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm'),
    };
    appendObject(summarySheet, summary);
    return summaryFor(user, summary);
  });
}

// Today's totals include packs sold out or returned earlier in the day. Inventory value is every
// live pack's remaining tickets plus everything in back stock.
// Sales = every line logged after the previous close up to this day, so a missed day's sold outs, returns and full pack
// sales count in the next close.
function buildSummary(today, user) {
  const since = lastCloseBefore(today);
  const todays = readTable(monthSheet('DailyCloseLog')).filter((r) => {
    const d = dateLabel(r.close_date);
    return d <= today && d > since;
  });
  // (Called before today's summary row is written, so salesDate() is still today.)
  const live = readTable(monthSheet('SlotState')).filter((s) => s.pack_key);
  const reserve = readTable(monthSheet('ReserveInventory'));
  const findSize = packSizeFinder(reserve);
  const liveValue = live.reduce((sum, s) => {
    const order = orderOf(s);
    const left = ticketsLeft(order, Number(s.current_exposed_ticket_number), sizeFor(order, s, findSize));
    return sum + left * Number(s.price_per_ticket);
  }, 0);
  const backValue = reserve.reduce((sum, r) => sum + (Number(r.tickets_in_reserve) || 0) * Number(r.price_per_ticket), 0);
  return {
    close_date: today,
    total_tickets_sold: todays.reduce((sum, r) => sum + Number(r.tickets_sold), 0),
    total_dollars_sold: todays.reduce((sum, r) => sum + Number(r.dollars_sold), 0),
    occupied_slot_count: live.length,
    total_inventory_value: liveValue + backValue,
  };
}

// Employees don't see dollar totals. closedBy/closedAt are missing for closes saved before they were kept.
function summaryFor(user, summary) {
  const result = {
    date: dateLabel(summary.close_date),
    ticketsSold: Number(summary.total_tickets_sold),
    liveSlots: Number(summary.occupied_slot_count),
  };
  if (summary.closed_by) result.closedBy = String(summary.closed_by);
  if (summary.closed_at) result.closedAt = closedAtLabel(summary.closed_at);
  if (isLateClose(summary)) result.closedLate = true;
  if (user.role === 'owner') {
    result.dollarsSold = Number(summary.total_dollars_sold);
    result.inventoryValue = Number(summary.total_inventory_value);
  }
  return result;
}

// "2026-09-27 22:52" -> "10:52 PM". Sheets may hand the cell back as a Date if it was retyped.
function closedAtLabel(value) {
  if (value instanceof Date) return Utilities.formatDate(value, Session.getScriptTimeZone(), 'h:mm a');
  const m = String(value).match(/(\d{1,2}):(\d{2})/);
  if (!m) return String(value);
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
}

// Owner only: undoes today's close so it can be done again — or, with date = yesterday, this morning's Close Yesterday
// (on the same terms as making it: before noon, today not closed).
function reopenClose(req) {
  return withLock(() => {
    const now = todayLabel();
    const late = Boolean(req && req.date) && req.date !== now;
    const today = late ? dayBefore(now) : now;
    if (late) {
      if (req.date !== today) throw new ApiError('bad_request', "Only today's close, or yesterday's closed this morning, can be reopened.");
      const summary = summaryOn(today);
      if (!summary) throw new ApiError('not_closed', "Yesterday hasn't been closed.");
      if (!isLateClose(summary)) throw new ApiError('too_late', "Yesterday was closed on time, so it can't be reopened now.");
      const refusal = closeYesterdayRefusal(now);
      if (refusal) throw refusal;
    } else if (!todaysSummary()) {
      throw new ApiError('not_closed', "Today hasn't been closed.");
    }
    const logSheet = closeLogSheet();
    const isTodaysClose = (r) => r.close_type === 'close' && dateLabel(r.close_date) === today;
    const closes = readTable(logSheet).filter(isTodaysClose);
    deleteRowsWhere(logSheet, isTodaysClose);

    const log = readTable(logSheet);
    const stateSheet = slotStateSheet();
    for (const row of closes) {
      // Found by pack, since it may have been moved since the close. An ended pack stays ended.
      const state = readTable(stateSheet).find((s) => s.pack_key === row.pack_key);
      if (!state) continue;
      updateRowsWhere(stateSheet, isSlot(state.box, state.slot_number), {
        current_exposed_ticket_number: Number(row.previous_exposed_ticket_number),
        last_close_date: closeBefore(row, log),
      });
    }
    deleteRowsWhere(monthSheet('DailySummary'), (d) => dateLabel(d.close_date) === today);
    return { reopened: today, slotsRestored: closes.length };
  });
}
