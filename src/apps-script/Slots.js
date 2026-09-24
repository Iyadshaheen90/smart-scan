// The 48 slots on the counter: listing them, activating a pack into one, and ending a pack.
//
// Who does what: employees can only mark a pack sold out (the slot shows out of stock). Putting
// packs in, returns, and undoing an activation are the owner's, since they touch back stock.
//
// Inventory rules:
// - Activating a pack takes one pack of its game out of back stock (ReserveInventory). The pack
//   is still store inventory — it's now live in the slot instead of in the back.
// - Ending a pack (sold out, or returned to the lottery) logs any sales since the last close
//   and records the pack in PackHistory. A slot with no pack is "out of stock": it adds
//   nothing to sales or inventory, and back stock is untouched.
// - A pack activated into the wrong slot can be undone until that slot's first close: the slot
//   empties, its old price comes back, and the pack goes back to back stock if it came from there.
// - A pack marked sold out or returned by mistake can be put back the same day (owner only),
//   as long as the slot is still empty and the day hasn't been closed.
// - Tickets count down to 0, so a pack whose exposed ticket is N has N + 1 tickets left.

const END_REASONS = ['sold_out', 'returned'];

function todayLabel() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

// Dates typed or copied into the sheet can come back as Date objects; everything else is text.
function dateLabel(value) {
  if (value instanceof Date) return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return value === '' ? null : String(value);
}

function isSlot(box, slot) {
  return (row) => Number(row.box) === Number(box) && Number(row.slot_number) === Number(slot);
}

function slotStateSheet() {
  const sheet = monthSheet('SlotState');
  ensureHeaders(sheet, MONTHLY_TABS.SlotState);
  return sheet;
}

function findReserve(gameNumber) {
  return readTable(monthSheet('ReserveInventory')).find((r) => String(r.game_number) === String(gameNumber)) || null;
}

function packsInBack(reserve) {
  return reserve ? Number(reserve.packs_in_reserve) || 0 : 0;
}

// --- Listing ---

function listSlots() {
  const config = readTable(monthSheet('SlotConfig'));
  const state = readTable(monthSheet('SlotState'));
  const reserve = readTable(monthSheet('ReserveInventory'));
  const today = todayLabel();
  const endedToday = readTable(monthSheet('PackHistory')).filter((p) => dateLabel(p.end_date) === today);
  return config.map((c) => {
    const s = state.find(isSlot(c.box, c.slot_number)) || {};
    const hasPack = Boolean(s.pack_key);
    const inBack = reserve.find((r) => String(r.game_number) === String(s.game_number));
    const ended = hasPack ? null : endedToday.filter(isSlot(c.box, c.slot_number)).pop();
    return {
      box: Number(c.box),
      slot: Number(c.slot_number),
      slotPrice: Number(c.price_per_ticket),
      pack: hasPack ? {
        gameNumber: String(s.game_number),
        packNumber: String(s.pack_number),
        price: Number(s.price_per_ticket),
        exposedTicket: Number(s.current_exposed_ticket_number),
        remaining: Number(s.current_exposed_ticket_number) + 1,
        activationDate: dateLabel(s.activation_date),
        lastCloseDate: dateLabel(s.last_close_date),
        packsInBack: packsInBack(inBack),
      } : null,
      endedToday: ended ? { packKey: `${ended.game_number}-${ended.pack_number}`, reason: ended.end_reason } : null,
    };
  });
}

// --- Activating ---

// req: { box, slot, gameNumber, packNumber, ticketNumber,
//        oldPackEnd?: 'sold_out' | 'returned', oldPackTicket? (the old pack's top ticket, for a return),
//        overridePrice? (owner only), gamePrice?, ticketsPerPack? (owner only, for a game not yet in back stock) }
function activatePack(user, req) {
  const ticket = validateTicket(req.gameNumber, req.packNumber, req.ticketNumber);
  return withLock(() => {
    const config = readTable(monthSheet('SlotConfig')).find(isSlot(req.box, req.slot));
    if (!config) throw new ApiError('no_slot', `There's no slot ${req.slot} in box ${req.box}.`);
    const stateSheet = slotStateSheet();
    const states = readTable(stateSheet);
    const current = states.find(isSlot(req.box, req.slot));

    const packKey = `${ticket.gameNumber}-${ticket.packNumber}`;
    const elsewhere = states.find((s) => s.pack_key === packKey);
    if (elsewhere) {
      throw new ApiError('pack_in_use', `Pack ${packKey} is already live in box ${elsewhere.box}, slot ${elsewhere.slot_number}.`);
    }
    if (readTable(monthSheet('PackHistory')).some((p) => `${p.game_number}-${p.pack_number}` === packKey)) {
      throw new ApiError('pack_ended', `Pack ${packKey} was already sold out or returned.`);
    }

    const reserveSheet = monthSheet('ReserveInventory');
    let reserve = findReserve(ticket.gameNumber);
    if (!reserve) reserve = addGameToReserve(user, ticket.gameNumber, req.gamePrice, req.ticketsPerPack);
    const gamePrice = Number(reserve.price_per_ticket);
    const ticketsPerPack = Number(reserve.tickets_per_pack);
    if (ticket.ticketNumber >= ticketsPerPack) {
      throw new ApiError('bad_ticket', `Ticket ${ticket.ticketNumber} can't be in a ${ticketsPerPack}-ticket pack (they count down from ${ticketsPerPack - 1}).`);
    }

    const slotPrice = Number(config.price_per_ticket);
    const priceChanged = gamePrice !== slotPrice;
    if (priceChanged) {
      if (user.role !== 'owner') {
        throw new ApiError('price_mismatch', `Game ${ticket.gameNumber} is $${gamePrice}, but this is a $${slotPrice} slot. Ask the owner.`);
      }
      if (req.overridePrice !== true) {
        throw new ApiError('price_mismatch', `Game ${ticket.gameNumber} is $${gamePrice}, but this is a $${slotPrice} slot. Confirm to change the slot to $${gamePrice}.`);
      }
      updateRowsWhere(monthSheet('SlotConfig'), isSlot(req.box, req.slot), { price_per_ticket: gamePrice });
    }

    let oldPack = null;
    if (current && current.pack_key) {
      if (!END_REASONS.includes(req.oldPackEnd)) {
        throw new ApiError('slot_occupied', `This slot still has pack ${current.pack_key}. Was it sold out or returned?`);
      }
      oldPack = endPackInSlot(user, current, req.oldPackEnd, req.oldPackTicket);
    }

    const before = packsInBack(reserve);
    const after = Math.max(0, before - 1);
    updateRowsWhere(reserveSheet, (r) => String(r.game_number) === ticket.gameNumber, {
      packs_in_reserve: after,
      tickets_in_reserve: after * ticketsPerPack,
    });

    const today = todayLabel();
    updateRowsWhere(stateSheet, isSlot(req.box, req.slot), {
      pack_key: packKey,
      game_number: ticket.gameNumber,
      pack_number: ticket.packNumber,
      price_per_ticket: gamePrice,
      current_exposed_ticket_number: ticket.ticketNumber,
      activation_date: today,
      last_close_date: '',
      price_before_activation: priceChanged ? slotPrice : '',
      took_from_reserve: before > 0,
    });

    return {
      box: Number(req.box),
      slot: Number(req.slot),
      packKey,
      packsInBack: after,
      backWasEmpty: before <= 0,
      oldPack,
    };
  });
}

function validateTicket(gameNumber, packNumber, ticketNumber) {
  gameNumber = String(gameNumber || '');
  packNumber = String(packNumber || '');
  ticketNumber = Number(ticketNumber);
  if (!/^\d{4}$/.test(gameNumber) || !/^\d{7}$/.test(packNumber) || !Number.isInteger(ticketNumber) || ticketNumber < 0 || ticketNumber > 999) {
    throw new ApiError('bad_ticket', "That doesn't look like a ticket number.");
  }
  return { gameNumber, packNumber, ticketNumber };
}

// A game seen for the first time: the owner gives its price and pack size. It starts with
// nothing in back stock (shipments aren't tracked yet).
function addGameToReserve(user, gameNumber, gamePrice, ticketsPerPack) {
  gamePrice = Number(gamePrice);
  ticketsPerPack = Number(ticketsPerPack);
  if (user.role !== 'owner') {
    throw new ApiError('unknown_game', `Game ${gameNumber} isn't in back stock yet. Ask the owner to activate this pack.`);
  }
  if (!(gamePrice > 0) || !Number.isInteger(ticketsPerPack) || ticketsPerPack <= 0) {
    throw new ApiError('unknown_game', `Game ${gameNumber} is new. Enter its ticket price and how many tickets are in a pack.`);
  }
  const row = { game_number: gameNumber, price_per_ticket: gamePrice, tickets_per_pack: ticketsPerPack, packs_in_reserve: 0, tickets_in_reserve: 0 };
  appendObject(monthSheet('ReserveInventory'), row);
  return row;
}

// --- Ending a pack ---

// Empties a slot without a replacement (it shows as out of stock until a pack is activated).
function endPack(user, req) {
  return withLock(() => {
    const current = readTable(monthSheet('SlotState')).find(isSlot(req.box, req.slot));
    if (!current || !current.pack_key) throw new ApiError('slot_empty', 'This slot has no pack.');
    if (!END_REASONS.includes(req.reason)) throw new ApiError('bad_request', 'Say whether the pack sold out or was returned.');
    if (req.reason === 'returned' && user.role !== 'owner') throw new ApiError('forbidden', 'Only the owner can return a pack.');
    return endPackInSlot(user, current, req.reason, req.ticketNumber);
  });
}

// Logs the pack's sales since the last close, records it in PackHistory, and clears the slot.
// Sold out: every remaining ticket sold. Returned: tickets above the scanned top ticket sold,
// the rest go back to the lottery. Call inside withLock.
function endPackInSlot(user, state, reason, topTicket) {
  const exposed = Number(state.current_exposed_ticket_number);
  const price = Number(state.price_per_ticket);
  let remaining = 0;
  if (reason === 'returned') {
    topTicket = topTicket === '' || topTicket == null ? NaN : Number(topTicket);
    if (!Number.isInteger(topTicket) || topTicket < 0 || topTicket > exposed) {
      throw new ApiError('bad_ticket', `Scan the top ticket of pack ${state.pack_key} (it should be ${exposed} or lower).`);
    }
    remaining = topTicket + 1;
  }
  const soldNow = exposed + 1 - remaining;
  const today = todayLabel();

  appendObject(monthSheet('DailyCloseLog'), {
    close_date: today,
    box: Number(state.box),
    slot_number: Number(state.slot_number),
    pack_key: state.pack_key,
    previous_exposed_ticket_number: exposed,
    current_exposed_ticket_number: reason === 'returned' ? topTicket : '',
    tickets_sold: soldNow,
    price_per_ticket: price,
    dollars_sold: soldNow * price,
    remaining_after_close: 0,
    close_type: reason,
    late_activation: false,
    performed_by: user.username,
  });

  const reserve = findReserve(state.game_number);
  const ticketsPerPack = reserve ? Number(reserve.tickets_per_pack) : null;
  const soldTotal = ticketsPerPack ? ticketsPerPack - remaining : '';
  appendObject(monthSheet('PackHistory'), {
    game_number: String(state.game_number),
    pack_number: String(state.pack_number),
    box: Number(state.box),
    slot_number: Number(state.slot_number),
    price_per_ticket: price,
    activation_date: dateLabel(state.activation_date) || '',
    end_date: today,
    end_reason: reason,
    final_tickets_sold_total: soldTotal,
    remaining_at_return: remaining,
    total_dollars_sold: soldTotal === '' ? '' : soldTotal * price,
    performed_by: user.username,
  });

  clearSlot(state.box, state.slot_number);
  return { packKey: state.pack_key, reason, ticketsSoldToday: soldNow, remainingReturned: remaining };
}

function clearSlot(box, slot) {
  updateRowsWhere(slotStateSheet(), isSlot(box, slot), {
    pack_key: '', game_number: '', pack_number: '', price_per_ticket: '',
    current_exposed_ticket_number: '', activation_date: '', last_close_date: '',
    price_before_activation: '', took_from_reserve: '',
  });
}

// --- Fixing mistakes ---

// Takes back a pack activated into the wrong slot. Only before the slot's first close, since
// after that its sales are on record. A pack ended to make room for it stays ended.
function undoActivation(user, req) {
  return withLock(() => {
    const state = readTable(slotStateSheet()).find(isSlot(req.box, req.slot));
    if (!state || !state.pack_key) throw new ApiError('slot_empty', 'This slot has no pack.');
    if (state.last_close_date !== '') {
      throw new ApiError('already_closed', `Pack ${state.pack_key} has been through a close, so it can't be undone. Mark it sold out or returned instead.`);
    }

    const reserve = findReserve(state.game_number);
    let inBack = packsInBack(reserve);
    if (state.took_from_reserve === true && reserve) {
      inBack += 1;
      updateRowsWhere(monthSheet('ReserveInventory'), (r) => String(r.game_number) === String(state.game_number), {
        packs_in_reserve: inBack,
        tickets_in_reserve: inBack * Number(reserve.tickets_per_pack),
      });
    }

    let slotPrice = Number(readTable(monthSheet('SlotConfig')).find(isSlot(req.box, req.slot)).price_per_ticket);
    if (state.price_before_activation !== '') {
      slotPrice = Number(state.price_before_activation);
      updateRowsWhere(monthSheet('SlotConfig'), isSlot(req.box, req.slot), { price_per_ticket: slotPrice });
    }

    clearSlot(req.box, req.slot);
    return {
      packKey: state.pack_key,
      gameNumber: String(state.game_number),
      returnedToBack: state.took_from_reserve === true,
      packsInBack: inBack,
      slotPrice,
    };
  });
}

// Owner only: sets a slot's price tier. A live pack keeps its own price; this is the price the
// slot expects from the next pack.
function setSlotPrice(req) {
  const price = Number(req.price);
  if (!(price > 0)) throw new ApiError('bad_price', 'Enter a price above $0.');
  return withLock(() => {
    if (!updateRowsWhere(monthSheet('SlotConfig'), isSlot(req.box, req.slot), { price_per_ticket: price })) {
      throw new ApiError('no_slot', `There's no slot ${req.slot} in box ${req.box}.`);
    }
    return { box: Number(req.box), slot: Number(req.slot), slotPrice: price };
  });
}

// Owner only: puts back a pack marked sold out or returned by mistake today. Removes that
// ending's DailyCloseLog and PackHistory rows and restores the slot as it was.
function undoEndPack(req) {
  return withLock(() => {
    const today = todayLabel();
    const state = readTable(slotStateSheet()).find(isSlot(req.box, req.slot));
    if (!state) throw new ApiError('no_slot', `There's no slot ${req.slot} in box ${req.box}.`);
    if (state.pack_key) {
      throw new ApiError('slot_occupied', `Pack ${state.pack_key} is in this slot now. Undo that activation first.`);
    }
    if (readTable(monthSheet('DailySummary')).some((d) => dateLabel(d.close_date) === today)) {
      throw new ApiError('already_closed', "Today has already been closed, so this can't be undone.");
    }
    const ended = readTable(monthSheet('PackHistory'))
      .filter((p) => isSlot(req.box, req.slot)(p) && dateLabel(p.end_date) === today).pop();
    if (!ended) throw new ApiError('nothing_to_undo', 'No pack was marked sold out or returned in this slot today.');
    const packKey = `${ended.game_number}-${ended.pack_number}`;
    const isEnding = (row) => row.pack_key === packKey && END_REASONS.includes(row.close_type) && dateLabel(row.close_date) === today;
    const log = readTable(monthSheet('DailyCloseLog')).find(isEnding);
    if (!log) throw new ApiError('nothing_to_undo', `Can't find today's sales entry for pack ${packKey}.`);

    deleteRowsWhere(monthSheet('DailyCloseLog'), isEnding);
    deleteRowsWhere(monthSheet('PackHistory'), (p) => `${p.game_number}-${p.pack_number}` === packKey);

    // The last regular close of this pack, if any, is when it was last closed.
    const lastClose = readTable(monthSheet('DailyCloseLog'))
      .filter((r) => r.pack_key === packKey && !END_REASONS.includes(r.close_type))
      .map((r) => dateLabel(r.close_date)).sort().pop() || '';
    const exposed = Number(log.previous_exposed_ticket_number);
    updateRowsWhere(slotStateSheet(), isSlot(req.box, req.slot), {
      pack_key: packKey,
      game_number: String(ended.game_number),
      pack_number: String(ended.pack_number),
      price_per_ticket: Number(ended.price_per_ticket),
      current_exposed_ticket_number: exposed,
      activation_date: dateLabel(ended.activation_date) || '',
      last_close_date: lastClose,
    });
    return { packKey, reason: ended.end_reason, exposedTicket: exposed };
  });
}

// --- Rearranging ---

// Every SlotState column that belongs to the pack rather than the position (all but box,
// slot_number, and the remaining_count formula).
const PACK_COLUMNS = MONTHLY_TABS.SlotState.filter((h) => !['box', 'slot_number', 'remaining_count'].includes(h));

// Owner only: swaps everything in two slots — the packs (with their top tickets and dates) and
// the slots' price tiers. Either slot may be empty, which moves a pack. Swapping the same two
// slots again puts things back. Nothing is sold and back stock is untouched.
function swapSlots(req) {
  if (Number(req.box) === Number(req.toBox) && Number(req.slot) === Number(req.toSlot)) {
    throw new ApiError('bad_request', 'Pick a different slot to swap with.');
  }
  return withLock(() => {
    const configSheet = monthSheet('SlotConfig');
    const configs = readTable(configSheet);
    const a = configs.find(isSlot(req.box, req.slot));
    const b = configs.find(isSlot(req.toBox, req.toSlot));
    if (!a || !b) throw new ApiError('no_slot', "One of those slots doesn't exist.");

    const stateSheet = slotStateSheet();
    const states = readTable(stateSheet);
    const stateA = states.find(isSlot(req.box, req.slot)) || {};
    const stateB = states.find(isSlot(req.toBox, req.toSlot)) || {};
    const packFields = (s) => Object.fromEntries(PACK_COLUMNS.map((h) => [h, s[h] === undefined ? '' : s[h]]));
    const fieldsA = packFields(stateA);
    const fieldsB = packFields(stateB);
    updateRowsWhere(stateSheet, isSlot(req.box, req.slot), fieldsB);
    updateRowsWhere(stateSheet, isSlot(req.toBox, req.toSlot), fieldsA);
    updateRowsWhere(configSheet, isSlot(req.box, req.slot), { price_per_ticket: Number(b.price_per_ticket) });
    updateRowsWhere(configSheet, isSlot(req.toBox, req.toSlot), { price_per_ticket: Number(a.price_per_ticket) });

    return {
      from: { box: Number(req.box), slot: Number(req.slot), packKey: fieldsB.pack_key || null },
      to: { box: Number(req.toBox), slot: Number(req.toSlot), packKey: fieldsA.pack_key || null },
    };
  });
}
