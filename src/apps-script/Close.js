// Close Day: once a day, every live pack's top ticket is recorded (the phone collects the scans
// and sends them in one submitClose call). Tickets sold = last recorded top ticket - today's
// top ticket; a pack activated today counts from the ticket it was activated at.
//
// Anyone signed in can close. The owner can reopen today's close to fix it, which puts every
// slot's top ticket back and removes the summary; packs marked sold out during the close stay
// ended (the owner can put them back with undoEndPack).

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

function todaysSummary() {
  return summaryOn(todayLabel());
}

function summaryOn(date) {
  return readTable(monthSheet('DailySummary')).find((d) => dateLabel(d.close_date) === date) || null;
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
function closeStatus(user) {
  const summary = todaysSummary();
  return {
    today: todayLabel(),
    largeSaleTickets: LARGE_SALE_TICKETS,
    closed: summary ? summaryFor(user, summary) : null,
    slots: listSlots(),
  };
}

// entries: [{ box, slot, packKey, type: 'scan' | 'sold_out', ticketNumber? }],
// one for every slot with a live pack.
function submitClose(user, entries) {
  if (!Array.isArray(entries)) throw new ApiError('bad_request', 'Nothing to submit.');
  return withLock(() => {
    if (todaysSummary()) throw new ApiError('already_closed', 'Today has already been closed.');
    const today = todayLabel();
    const stateSheet = slotStateSheet();
    const live = readTable(stateSheet).filter((s) => s.pack_key);

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
      let ticket = exposed;
      if (entry.type === 'scan') {
        ticket = Number(entry.ticketNumber);
        if (!Number.isInteger(ticket) || ticket < 0 || ticket > exposed) {
          throw new ApiError('bad_ticket', `${where}: ticket ${entry.ticketNumber} is above the last top ticket (${exposed}). Rescan it.`);
        }
      }
      return { state, entry, exposed, ticket };
    });
    const extra = entries.find((e) => !live.some(isSlot(e.box, e.slot)));
    if (extra) throw new ApiError('slots_changed', `Box ${extra.box}, slot ${extra.slot} has no pack now. Reload Close Day.`);

    for (const { state, entry, exposed, ticket } of plan) {
      if (entry.type === 'sold_out') {
        endPackInSlot(user, state, 'sold_out');
        continue;
      }
      const sold = exposed - ticket;
      const price = Number(state.price_per_ticket);
      appendObject(closeLogSheet(), {
        close_date: today,
        box: Number(state.box),
        slot_number: Number(state.slot_number),
        pack_key: state.pack_key,
        previous_exposed_ticket_number: exposed,
        current_exposed_ticket_number: ticket,
        tickets_sold: sold,
        price_per_ticket: price,
        dollars_sold: sold * price,
        remaining_after_close: ticket + 1,
        close_type: 'close',
        late_activation: dateLabel(state.activation_date) === today,
        performed_by: user.username,
        previous_close_date: dateLabel(state.last_close_date) || '',
      });
      updateRowsWhere(stateSheet, isSlot(state.box, state.slot_number), {
        current_exposed_ticket_number: ticket,
        last_close_date: today,
      });
    }

    const summary = buildSummary(today, user);
    appendObject(monthSheet('DailySummary'), summary);
    return summaryFor(user, summary);
  });
}

// Today's totals include packs sold out or returned earlier in the day. Inventory value is every
// live pack's remaining tickets plus everything in back stock.
function buildSummary(today, user) {
  const todays = readTable(monthSheet('DailyCloseLog')).filter((r) => dateLabel(r.close_date) === today);
  // (Called before today's summary row is written, so salesDate() is still today.)
  const live = readTable(monthSheet('SlotState')).filter((s) => s.pack_key);
  const liveValue = live.reduce((sum, s) => sum + (Number(s.current_exposed_ticket_number) + 1) * Number(s.price_per_ticket), 0);
  const backValue = readTable(monthSheet('ReserveInventory'))
    .reduce((sum, r) => sum + (Number(r.tickets_in_reserve) || 0) * Number(r.price_per_ticket), 0);
  return {
    close_date: today,
    total_tickets_sold: todays.reduce((sum, r) => sum + Number(r.tickets_sold), 0),
    total_dollars_sold: todays.reduce((sum, r) => sum + Number(r.dollars_sold), 0),
    occupied_slot_count: live.length,
    total_inventory_value: liveValue + backValue,
  };
}

// Employees don't see dollar totals.
function summaryFor(user, summary) {
  const result = {
    date: dateLabel(summary.close_date),
    ticketsSold: Number(summary.total_tickets_sold),
    liveSlots: Number(summary.occupied_slot_count),
  };
  if (user.role === 'owner') {
    result.dollarsSold = Number(summary.total_dollars_sold);
    result.inventoryValue = Number(summary.total_inventory_value);
  }
  return result;
}

// Owner only: undoes today's close so it can be done again.
function reopenClose() {
  return withLock(() => {
    const today = todayLabel();
    if (!todaysSummary()) throw new ApiError('not_closed', "Today hasn't been closed.");
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
